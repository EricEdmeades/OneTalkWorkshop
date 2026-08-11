import { describe, it, expect } from 'vitest';
import { buildKeapReport } from './keap-orders.js';

// A projected Keap order: date bucket + integer cents (net/gross/refund).
const order = (o = {}) => ({ date: 'august', grossCents: 99700, refundCents: 0, netCents: 99700, ...o });

describe('buildKeapReport', () => {
  it('always returns both events, zeroed, for empty input', () => {
    const r = buildKeapReport([]);
    expect(r.events.map((e) => e.date)).toEqual(['august', 'september']);
    expect(r.totals).toEqual({ orders: 0, netCents: 0, grossCents: 0, refundCents: 0 });
  });

  it('sums net, gross and refund per event and in totals', () => {
    const r = buildKeapReport([
      order({ date: 'august', grossCents: 129700, refundCents: 0, netCents: 129700 }),
      order({ date: 'august', grossCents: 99700, refundCents: 99700, netCents: 0 }), // fully refunded
      order({ date: 'september', grossCents: 81790, refundCents: 0, netCents: 81790 }),
    ]);
    const [aug, sep] = r.events;
    expect(aug.orders).toBe(2);
    expect(aug.grossCents).toBe(229400);
    expect(aug.refundCents).toBe(99700);
    expect(aug.netCents).toBe(129700);
    expect(sep.netCents).toBe(81790);
    expect(r.totals.netCents).toBe(211490);
    expect(r.totals.refundCents).toBe(99700);
  });

  it('ignores orders with an unknown date bucket', () => {
    const r = buildKeapReport([order({ date: 'october' }), order({ date: undefined })]);
    expect(r.totals.orders).toBe(0);
  });

  it('treats non-finite amounts as zero', () => {
    const r = buildKeapReport([{ date: 'august' }]);
    expect(r.events[0].orders).toBe(1);
    expect(r.events[0].netCents).toBe(0);
  });
});
