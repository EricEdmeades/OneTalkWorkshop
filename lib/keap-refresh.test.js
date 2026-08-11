import { describe, it, expect, vi, beforeEach } from 'vitest';

// The point of these tests is the FOOTPRINT, not the happy path. The previous
// version of this feature pinned the Keap key by retrying inside the request,
// so what matters is exactly how many calls each outcome costs and that a
// backed-off caller makes none at all.
vi.mock('./keap-api.js', () => ({
  fetchKeapChannel: vi.fn(),
}));
vi.mock('./keap-store.js', () => ({
  isBlobConfigured: vi.fn(() => true),
  shouldAttempt: vi.fn(async () => true),
  writeSnapshot: vi.fn(async () => {}),
  writeLastAttemptAt: vi.fn(async () => {}),
}));

const { fetchKeapChannel } = await import('./keap-api.js');
const { isBlobConfigured, shouldAttempt, writeSnapshot, writeLastAttemptAt } = await import(
  './keap-store.js'
);
const { refreshKeapSnapshot } = await import('./keap-refresh.js');

const throttled = () => Object.assign(new Error('Keap throttled'), { throttled: true });
const channel = { tagCounts: { august: 211, september: 130 }, orders: [] };

beforeEach(() => {
  vi.clearAllMocks();
  isBlobConfigured.mockReturnValue(true);
  shouldAttempt.mockResolvedValue(true);
  process.env.KEAP_API_KEY = 'test-key';
});

describe('refreshKeapSnapshot', () => {
  it('stores a snapshot on the first successful read', async () => {
    fetchKeapChannel.mockResolvedValueOnce(channel);

    const result = await refreshKeapSnapshot({ attempts: 4, spacingMs: 0 });

    expect(result.ok).toBe(true);
    expect(fetchKeapChannel).toHaveBeenCalledTimes(1);
    expect(writeSnapshot).toHaveBeenCalledTimes(1);
    const stored = writeSnapshot.mock.calls[0][0];
    expect(stored.tagCounts).toEqual({ august: 211, september: 130 });
    expect(stored.fetchedAt).toBeGreaterThan(0);
  });

  it('retries a throttled read and keeps the attempt that lands', async () => {
    fetchKeapChannel.mockRejectedValueOnce(throttled()).mockResolvedValueOnce(channel);

    const result = await refreshKeapSnapshot({ attempts: 4, spacingMs: 0 });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(fetchKeapChannel).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt budget and never exceeds it', async () => {
    fetchKeapChannel.mockRejectedValue(throttled());

    const result = await refreshKeapSnapshot({ attempts: 4, spacingMs: 0 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('throttled');
    // The budget is the whole protection against storming the shared quota.
    expect(fetchKeapChannel).toHaveBeenCalledTimes(4);
    expect(writeSnapshot).not.toHaveBeenCalled();
  });

  it('does not retry a non-throttle failure, which waiting cannot fix', async () => {
    fetchKeapChannel.mockRejectedValue(new Error('Keap orders: 401'));

    const result = await refreshKeapSnapshot({ attempts: 4, spacingMs: 0 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Keap orders: 401');
    expect(fetchKeapChannel).toHaveBeenCalledTimes(1);
  });

  it('makes NO Keap call at all when the pacing interval has not elapsed', async () => {
    shouldAttempt.mockResolvedValue(false);

    const result = await refreshKeapSnapshot({ attempts: 4, spacingMs: 0, minIntervalMs: 300_000 });

    expect(result).toEqual({ ok: false, reason: 'backed-off' });
    expect(fetchKeapChannel).not.toHaveBeenCalled();
  });

  it('records the attempt BEFORE fetching, so a crash still costs the interval', async () => {
    const order = [];
    writeLastAttemptAt.mockImplementation(async () => order.push('marker'));
    fetchKeapChannel.mockImplementation(async () => {
      order.push('fetch');
      return channel;
    });

    await refreshKeapSnapshot({ attempts: 1, spacingMs: 0 });

    expect(order).toEqual(['marker', 'fetch']);
  });

  it('refuses to run without Blob configured rather than fetching pointlessly', async () => {
    isBlobConfigured.mockReturnValue(false);

    const result = await refreshKeapSnapshot({ attempts: 4, spacingMs: 0 });

    expect(result).toEqual({ ok: false, reason: 'blob-not-configured' });
    expect(fetchKeapChannel).not.toHaveBeenCalled();
  });

  it('refuses to run without a Keap key', async () => {
    delete process.env.KEAP_API_KEY;

    const result = await refreshKeapSnapshot({ attempts: 4, spacingMs: 0 });

    expect(result).toEqual({ ok: false, reason: 'keap-key-missing' });
    expect(fetchKeapChannel).not.toHaveBeenCalled();
  });

  it('waits between throttled attempts instead of retrying immediately', async () => {
    fetchKeapChannel.mockRejectedValue(throttled());
    const started = Date.now();

    await refreshKeapSnapshot({ attempts: 3, spacingMs: 25 });

    // Two gaps between three attempts. Deliberately loose — this asserts that
    // spacing happens at all, not its precision.
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });
});
