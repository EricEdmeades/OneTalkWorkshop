import { describe, it, expect } from 'vitest';
import { annotateRefunds } from './refunds.js';

// Minimal session shape carrying only what annotateRefunds touches.
function session(overrides = {}) {
  return {
    status: 'complete',
    mode: 'payment',
    amount_total: 129700,
    metadata: { date: 'august' },
    paymentIntentId: 'pi_1',
    ...overrides,
  };
}

describe('annotateRefunds', () => {
  it('attaches refundedCents from a matching payment intent', () => {
    const map = new Map([['pi_1', 129700]]);
    const [out] = annotateRefunds([session()], map);
    expect(out.refundedCents).toBe(129700);
  });

  it('attaches zero when no refund matches the payment intent', () => {
    const [out] = annotateRefunds([session({ paymentIntentId: 'pi_other' })], new Map());
    expect(out.refundedCents).toBe(0);
  });

  it('attaches zero when the session has no payment intent', () => {
    const [out] = annotateRefunds([session({ paymentIntentId: null })], new Map([['pi_1', 5000]]));
    expect(out.refundedCents).toBe(0);
  });

  it('strips the payment intent id so it cannot reach the report or render', () => {
    const [out] = annotateRefunds([session()], new Map([['pi_1', 100]]));
    expect(out).not.toHaveProperty('paymentIntentId');
    // Everything else the report needs survives.
    expect(out.status).toBe('complete');
    expect(out.amount_total).toBe(129700);
    expect(out.metadata).toEqual({ date: 'august' });
  });

  it('is safe on non-array input', () => {
    expect(annotateRefunds(undefined, new Map())).toEqual([]);
    expect(annotateRefunds(null)).toEqual([]);
  });
});
