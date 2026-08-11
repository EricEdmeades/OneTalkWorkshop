import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchKeapChannel, KeapThrottleError, KeapTimeoutError } from './keap-api.js';

// These tests exist because an unbounded `while (url)` over Keap's `next` link
// ran forever in production: three cron runs were killed at the platform limit
// with no log output at all, and no snapshot was ever stored. Termination is a
// correctness property here, not a nicety.

const json = (body) => ({ ok: true, status: 200, json: async () => body });

const contactsPage = (ids, next) => json({
  contacts: ids.map((id) => ({ contact: { id, email: `c${id}@example.com` }, date_applied: 'x' })),
  ...(next ? { next } : {}),
});

const ordersPage = (orders, next) => json({ orders, ...(next ? { next } : {}) });

beforeEach(() => {
  process.env.KEAP_API_KEY = 'test-key';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchKeapChannel pagination', () => {
  it('reads the ordinary single-page case', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(contactsPage([1, 2, 3]))
      .mockResolvedValueOnce(contactsPage([4, 5]))
      .mockResolvedValueOnce(ordersPage([{ contact: { id: 1 }, total: 983, refund_total: 0 }]));

    const { tagCounts, orders } = await fetchKeapChannel({ tagAugust: '2008', tagSeptember: '1825' });

    expect(tagCounts).toEqual({ august: 3, september: 2 });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ date: 'august', grossCents: 98300, netCents: 98300 });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  // THE production hang: Keap keeps handing back a `next` link forever.
  it('terminates when the next link repeats the current page', async () => {
    const url = 'https://api.infusionsoft.com/crm/rest/v1/tags/2008/contacts?limit=1000';
    global.fetch = vi.fn(async (u) =>
      String(u).includes('/tags/') ? contactsPage([1, 2], url) : ordersPage([])
    );

    const { tagCounts } = await fetchKeapChannel({ tagAugust: '2008', tagSeptember: '1825' });

    expect(tagCounts.august).toBe(2);
    // Two tag walks + one orders call. Without the guard this never returns.
    expect(global.fetch.mock.calls.length).toBeLessThan(10);
  });

  it('terminates on an empty page even when a next link is present', async () => {
    global.fetch = vi.fn(async (u) =>
      String(u).includes('/tags/')
        ? contactsPage([], 'https://api.infusionsoft.com/next-forever')
        : ordersPage([])
    );

    const { tagCounts } = await fetchKeapChannel({ tagAugust: '2008', tagSeptember: '1825' });

    expect(tagCounts).toEqual({ august: 0, september: 0 });
    expect(global.fetch.mock.calls.length).toBeLessThan(10);
  });

  // The next link keeps ADVANCING (so the repeat guard cannot catch it) and
  // every page is non-empty (so the empty-page guard cannot either). Only the
  // hard cap ends this walk.
  it('stops at the page cap when next links keep advancing forever', async () => {
    let n = 0;
    global.fetch = vi.fn(async (u) => {
      // Keep the synthetic next links inside the /tags/ path, or they fall
      // through to the orders branch and the walk ends for the wrong reason.
      if (!String(u).includes('/tags/')) return ordersPage([]);
      n += 1;
      return contactsPage([n], `https://api.infusionsoft.com/crm/rest/v1/tags/2008/contacts?p=${n}`);
    });

    await fetchKeapChannel({ tagAugust: '2008', tagSeptember: '1825' });

    // MAX_TAG_PAGES (20) per walk, twice, plus the single orders call.
    expect(global.fetch.mock.calls.length).toBe(41);
    expect(console.error).toHaveBeenCalled();
    // 40 pages at the real 350ms inter-page delay is ~14s of deliberate
    // politeness towards a shared quota, so this one needs room to run.
  }, 30_000);
});

describe('fetchKeapChannel error classification', () => {
  it('raises a retryable throttle error on 429', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    const err = await fetchKeapChannel({ tagAugust: '2008', tagSeptember: '1825' }).catch((e) => e);

    expect(err).toBeInstanceOf(KeapThrottleError);
    expect(err.retryable).toBe(true);
  });

  it('raises a retryable timeout error when the request is aborted', async () => {
    global.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));

    const err = await fetchKeapChannel({ tagAugust: '2008', tagSeptember: '1825' }).catch((e) => e);

    expect(err).toBeInstanceOf(KeapTimeoutError);
    expect(err.retryable).toBe(true);
  });

  it('does not mark an auth failure retryable — waiting cannot fix it', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const err = await fetchKeapChannel({ tagAugust: '2008', tagSeptember: '1825' }).catch((e) => e);

    expect(err.retryable).toBeUndefined();
    expect(err.message).toContain('401');
  });
});
