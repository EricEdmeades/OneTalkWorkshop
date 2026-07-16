import { describe, it, expect } from 'vitest';
import { getActiveTier, getSubscriptionCancelAt, isValidDate, isValidPlan } from './pricing.js';

describe('getActiveTier', () => {
  it('is early for August before the cutoff', () => {
    const beforeCutoff = Date.UTC(2026, 6, 8, 3, 59, 58);
    expect(getActiveTier('august', beforeCutoff)).toBe('early');
  });

  it('is retail for August at/after the cutoff', () => {
    const atCutoff = Date.UTC(2026, 6, 8, 3, 59, 59);
    expect(getActiveTier('august', atCutoff)).toBe('retail');
  });

  it('is early for September before the cutoff', () => {
    const beforeCutoff = Date.UTC(2026, 6, 31, 3, 59, 58);
    expect(getActiveTier('september', beforeCutoff)).toBe('early');
  });

  it('is retail for September at/after the cutoff', () => {
    const atCutoff = Date.UTC(2026, 6, 31, 3, 59, 59);
    expect(getActiveTier('september', atCutoff)).toBe('retail');
  });

  it('throws for an unknown date', () => {
    expect(() => getActiveTier('october', Date.now())).toThrow('Unknown date: october');
  });
});

describe('getSubscriptionCancelAt', () => {
  it('returns the exact end of the 2nd billing period (anchor + 28 days, unix seconds)', () => {
    const anchor = Math.floor(Date.UTC(2026, 6, 15, 17, 34, 0) / 1000);
    expect(getSubscriptionCancelAt(anchor)).toBe(anchor + 28 * 24 * 60 * 60);
  });

  it('lands on the period boundary to the second (no proration sliver)', () => {
    // Regression: a cancel_at inside period 2 made flexible billing mode
    // prorate the 2nd $827 installment down to ~$59 for one day of coverage.
    const anchor = 1_800_000_000; // arbitrary epoch seconds
    const periodSeconds = 14 * 24 * 60 * 60;
    const cancelAt = getSubscriptionCancelAt(anchor);
    expect((cancelAt - anchor) % periodSeconds).toBe(0);
    expect((cancelAt - anchor) / periodSeconds).toBe(2);
  });

  it('throws on a missing/invalid anchor instead of returning NaN', () => {
    expect(() => getSubscriptionCancelAt(undefined)).toThrow();
    expect(() => getSubscriptionCancelAt(NaN)).toThrow();
  });
});

describe('isValidDate / isValidPlan', () => {
  it('accepts known dates and rejects others', () => {
    expect(isValidDate('august')).toBe(true);
    expect(isValidDate('september')).toBe(true);
    expect(isValidDate('october')).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });

  it('accepts known plans and rejects others', () => {
    expect(isValidPlan('full')).toBe(true);
    expect(isValidPlan('plan')).toBe(true);
    expect(isValidPlan('installments')).toBe(false);
  });
});
