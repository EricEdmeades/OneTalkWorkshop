import { describe, it, expect } from 'vitest';
import { checkRate, recordSend, MIN_GAP_MS, DAY_MS, MAX_PER_DAY } from './sol-ratelimit.js';

const NOW = 1_800_000_000_000;

describe('sol-ratelimit', () => {
  it('allows the first send', () => expect(checkRate([], NOW)).toEqual({ allowed: true, recent: [] }));

  it('blocks inside the minimum gap with retryAfterMs', () => {
    expect(checkRate([NOW - 10_000], NOW)).toEqual({
      allowed: false, reason: 'too_soon', retryAfterMs: MIN_GAP_MS - 10_000, recent: [NOW - 10_000],
    });
  });

  it('allows exactly at the gap', () => expect(checkRate([NOW - MIN_GAP_MS], NOW).allowed).toBe(true));

  it('caps at MAX_PER_DAY within 24h', () => {
    const sent = [NOW - 3 * 3600_000, NOW - 2 * 3600_000, NOW - 3600_000];
    expect(sent).toHaveLength(MAX_PER_DAY);
    expect(checkRate(sent, NOW)).toMatchObject({ allowed: false, reason: 'daily_cap' });
  });

  it('forgets sends a day old or older and drops junk values', () => {
    expect(checkRate([NOW - DAY_MS - 1, NOW - DAY_MS, 'x', null], NOW)).toEqual({ allowed: true, recent: [] });
  });

  it('tolerates a non-array history', () => expect(checkRate(undefined, NOW).allowed).toBe(true));

  it('recordSend returns a new array', () => {
    const before = [NOW - 120_000];
    expect(recordSend(before, NOW)).toEqual([NOW - 120_000, NOW]);
    expect(before).toEqual([NOW - 120_000]);
  });
});
