import { describe, it, expect } from 'vitest';
import {
  SNAPSHOT_VERSION,
  buildSnapshot,
  parseSnapshot,
  snapshotAgeMs,
  isStale,
  describeAge,
} from './keap-snapshot.js';

const order = (over = {}) => ({
  date: 'august',
  grossCents: 98300,
  refundCents: 0,
  netCents: 98300,
  emailHash: 'abc123',
  ...over,
});

describe('buildSnapshot', () => {
  it('keeps the counts and orders it was given', () => {
    const snap = buildSnapshot({
      tagCounts: { august: 211, september: 130 },
      orders: [order()],
      fetchedAt: 1000,
    });
    expect(snap.version).toBe(SNAPSHOT_VERSION);
    expect(snap.fetchedAt).toBe(1000);
    expect(snap.tagCounts).toEqual({ august: 211, september: 130 });
    expect(snap.orders).toHaveLength(1);
  });

  it('drops orders that are not for one of the two workshops', () => {
    const snap = buildSnapshot({
      tagCounts: {},
      orders: [order(), order({ date: 'july' }), order({ date: undefined })],
      fetchedAt: 1,
    });
    expect(snap.orders).toHaveLength(1);
  });

  it('projects away anything the report does not consume', () => {
    const snap = buildSnapshot({
      tagCounts: {},
      orders: [{ ...order(), email: 'someone@example.com', contactId: 42 }],
      fetchedAt: 1,
    });
    // The raw email must never reach the persisted blob.
    expect(snap.orders[0]).toEqual({
      date: 'august',
      grossCents: 98300,
      refundCents: 0,
      netCents: 98300,
      emailHash: 'abc123',
    });
  });

  it('normalises missing or negative counts to zero rather than NaN', () => {
    const snap = buildSnapshot({ tagCounts: { august: -3 }, orders: [], fetchedAt: 1 });
    expect(snap.tagCounts).toEqual({ august: 0, september: 0 });
  });

  it('keeps an order whose contact had no email, with a null hash', () => {
    const snap = buildSnapshot({
      tagCounts: {},
      orders: [order({ emailHash: undefined })],
      fetchedAt: 1,
    });
    expect(snap.orders[0].emailHash).toBeNull();
  });
});

describe('parseSnapshot', () => {
  const good = buildSnapshot({
    tagCounts: { august: 211, september: 130 },
    orders: [order()],
    fetchedAt: 1000,
  });

  it('round-trips a snapshot through JSON', () => {
    expect(parseSnapshot(JSON.stringify(good))).toEqual(good);
  });

  it('accepts an already-parsed object', () => {
    expect(parseSnapshot(good)).toEqual(good);
  });

  it('rejects malformed JSON rather than throwing', () => {
    expect(parseSnapshot('{not json')).toBeNull();
  });

  it('rejects an incompatible version', () => {
    expect(parseSnapshot({ ...good, version: SNAPSHOT_VERSION + 1 })).toBeNull();
  });

  it('rejects a snapshot with no usable timestamp', () => {
    expect(parseSnapshot({ ...good, fetchedAt: 0 })).toBeNull();
    expect(parseSnapshot({ ...good, fetchedAt: 'yesterday' })).toBeNull();
  });

  it('rejects a snapshot whose orders are not a list', () => {
    expect(parseSnapshot({ ...good, orders: null })).toBeNull();
  });

  it('rejects null and undefined', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot(undefined)).toBeNull();
  });
});

describe('snapshotAgeMs / isStale', () => {
  const snap = buildSnapshot({ tagCounts: {}, orders: [], fetchedAt: 10_000 });

  it('measures age from the fetch time', () => {
    expect(snapshotAgeMs(snap, 25_000)).toBe(15_000);
  });

  it('treats a missing snapshot as infinitely old', () => {
    expect(snapshotAgeMs(null, 25_000)).toBe(Infinity);
    expect(isStale(null, 1000, 25_000)).toBe(true);
  });

  it('never reports a negative age when clocks disagree', () => {
    expect(snapshotAgeMs(snap, 5_000)).toBe(0);
  });

  it('is stale only once the ttl has elapsed', () => {
    expect(isStale(snap, 10_000, 19_000)).toBe(false);
    expect(isStale(snap, 10_000, 20_000)).toBe(true);
  });
});

describe('describeAge', () => {
  it('phrases the common ranges', () => {
    expect(describeAge(0)).toBe('just now');
    expect(describeAge(60_000)).toBe('1 minute ago');
    expect(describeAge(4 * 60_000)).toBe('4 minutes ago');
    expect(describeAge(60 * 60_000)).toBe('1 hour ago');
    expect(describeAge(5 * 60 * 60_000)).toBe('5 hours ago');
    expect(describeAge(26 * 60 * 60_000)).toBe('1 day ago');
    expect(describeAge(72 * 60 * 60_000)).toBe('3 days ago');
  });

  it('does not crash on an infinite age', () => {
    expect(describeAge(Infinity)).toBe('unknown');
  });
});
