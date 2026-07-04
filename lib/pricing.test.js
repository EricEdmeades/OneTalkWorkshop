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
  it('returns unix seconds 15 days after now', () => {
    const now = Date.UTC(2026, 6, 1, 0, 0, 0);
    const expected = Math.floor((now + 15 * 24 * 60 * 60 * 1000) / 1000);
    expect(getSubscriptionCancelAt(now)).toBe(expected);
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
