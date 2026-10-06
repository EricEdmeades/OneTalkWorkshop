import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./sol-store.js', () => ({
  listPending: vi.fn(async () => []),
  readPending: vi.fn(),
  writePending: vi.fn(async () => {}),
  deletePending: vi.fn(async () => {}),
  moveToDead: vi.fn(async () => {}),
}));
vi.mock('./sol-keap.js', () => ({ syncContactToKeap: vi.fn(async () => 1) }));

const mod = await import('../api/sol-sync-keap.js');
const handler = mod.default;
const store = await import('./sol-store.js');
const { syncContactToKeap } = await import('./sol-keap.js');
const { makePending, MAX_ATTEMPTS } = await import('./sol-pending.js');
const { KeapThrottleError } = await import('./keap-api.js');

const mockRes = () => ({
  statusCode: null, body: null,
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});
const auth = (token = 'cron-s') => ({ method: 'GET', headers: { authorization: `Bearer ${token}` } });
const rec = (o = {}) => ({ ...makePending({ email: 'a@b.co', firstName: 'A', now: 1_000_000_000_000 }), ...o });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  Object.assign(process.env, { CRON_SECRET: 'cron-s', KEAP_API_KEY: 'k', KEAP_TAG_ID_SAID_OUT_LOUD: '555', BLOB_STORE_ID: 'st' });
  mod.__setGapMs(0);
  mod.__setDeadlineMs(75_000);
});

describe('GET /api/sol-sync-keap', () => {
  it('pins maxDuration', () => expect(mod.config).toEqual({ maxDuration: 120 }));

  it('fails closed without CRON_SECRET', async () => {
    delete process.env.CRON_SECRET;
    const res = mockRes();
    await handler(auth(), res);
    expect(res.statusCode).toBe(500);
    expect(store.listPending).not.toHaveBeenCalled();
  });

  it('401 on a wrong token', async () => {
    const res = mockRes();
    await handler(auth('nope'), res);
    expect(res.statusCode).toBe(401);
    expect(store.listPending).not.toHaveBeenCalled();
  });

  it('syncs and deletes each pending record', async () => {
    store.listPending.mockResolvedValueOnce(['p1', 'p2']);
    store.readPending.mockResolvedValue(rec());
    const res = mockRes();
    await handler(auth(), res);
    expect(syncContactToKeap).toHaveBeenCalledTimes(2);
    expect(syncContactToKeap.mock.calls[0][1]).toBe(555);
    expect(store.deletePending).toHaveBeenCalledWith('p1');
    expect(res.body).toEqual({ ok: true, synced: 2, failed: 0, dead: 0, reason: null });
  });

  it('stops on throttle without counting an attempt', async () => {
    store.listPending.mockResolvedValueOnce(['p1', 'p2']);
    store.readPending.mockResolvedValue(rec());
    syncContactToKeap.mockRejectedValueOnce(new KeapThrottleError('x'));
    const res = mockRes();
    await handler(auth(), res);
    expect(syncContactToKeap).toHaveBeenCalledTimes(1);
    expect(store.writePending).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason: 'throttled' });
  });

  it('counts a non-retryable failure and rewrites the record in place', async () => {
    store.listPending.mockResolvedValueOnce(['p1']);
    store.readPending.mockResolvedValue(rec());
    syncContactToKeap.mockRejectedValueOnce(new Error('tag rejected'));
    const res = mockRes();
    await handler(auth(), res);
    expect(store.writePending).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, lastError: 'tag rejected' }), 'p1');
    expect(res.body.failed).toBe(1);
  });

  it('moves to dead at MAX_ATTEMPTS', async () => {
    store.listPending.mockResolvedValueOnce(['p1']);
    store.readPending.mockResolvedValue(rec({ attempts: MAX_ATTEMPTS - 1 }));
    syncContactToKeap.mockRejectedValueOnce(new Error('still bad'));
    const res = mockRes();
    await handler(auth(), res);
    expect(store.moveToDead).toHaveBeenCalledWith('p1', expect.objectContaining({ attempts: MAX_ATTEMPTS }));
    expect(res.body.dead).toBe(1);
  });

  it('moves an unreadable record to dead immediately', async () => {
    store.listPending.mockResolvedValueOnce(['bad']);
    store.readPending.mockResolvedValue(null);
    const res = mockRes();
    await handler(auth(), res);
    expect(store.moveToDead).toHaveBeenCalledWith('bad', null);
    expect(syncContactToKeap).not.toHaveBeenCalled();
  });

  it('stops at the deadline', async () => {
    store.listPending.mockResolvedValueOnce(['p1', 'p2']);
    store.readPending.mockResolvedValue(rec());
    mod.__setDeadlineMs(-1);
    const res = mockRes();
    await handler(auth(), res);
    expect(syncContactToKeap).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ ok: false, reason: 'deadline' });
  });

  it('500 when a Blob call throws mid-run', async () => {
    store.listPending.mockRejectedValueOnce(new Error('blob down'));
    const res = mockRes();
    await handler(auth(), res);
    expect(res.statusCode).toBe(500);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('Keap bucket courtesy (review Important 3, minor 4)', () => {
  it('drains at most 8 records per run', async () => {
    const res = mockRes();
    await handler(auth(), res);
    expect(store.listPending).toHaveBeenCalledWith(8);
  });

  it('counts a timeout as a failed attempt so one hung record cannot stall the queue forever', async () => {
    const { KeapTimeoutError } = await import('./keap-api.js');
    store.listPending.mockResolvedValueOnce(['p1', 'p2']);
    store.readPending.mockResolvedValue(rec());
    syncContactToKeap.mockRejectedValueOnce(new KeapTimeoutError('x'));
    const res = mockRes();
    await handler(auth(), res);
    expect(store.writePending).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1 }), 'p1');
    expect(syncContactToKeap).toHaveBeenCalledTimes(2);
  });

  it('defaults to a 2s gap and a 60s deadline', () => {
    expect(mod.DEFAULT_GAP_MS).toBe(2000);
    expect(mod.DEFAULT_DEADLINE_MS).toBe(60_000);
  });
});
