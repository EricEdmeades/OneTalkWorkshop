import { describe, it, expect } from 'vitest';
import { dedupeKeapOrders, combineChannels } from './results-combined.js';

describe('dedupeKeapOrders', () => {
  it('drops orders whose emailHash is in the Stripe set and counts the overlap', () => {
    const orders = [
      { date: 'august', netCents: 100, emailHash: 'aaa' },
      { date: 'august', netCents: 200, emailHash: 'bbb' },
      { date: 'september', netCents: 300, emailHash: null },
    ];
    const { orders: kept, overlapCount } = dedupeKeapOrders(orders, new Set(['bbb']));
    expect(overlapCount).toBe(1);
    expect(kept.map((o) => o.netCents)).toEqual([100, 300]);
  });

  it('keeps everything when there is no overlap and is safe on bad input', () => {
    expect(dedupeKeapOrders([], new Set())).toEqual({ orders: [], overlapCount: 0 });
    expect(dedupeKeapOrders(undefined, undefined)).toEqual({ orders: [], overlapCount: 0 });
  });
});

// Minimal channel-report fixtures shaped like buildReport / buildKeapReport output.
const stripeReport = {
  events: [
    { date: 'august', label: 'August 7–9, 2026', registrations: 3, collectedCents: 300000, contractedCents: 320000, rows: [] },
    { date: 'september', label: 'September 18–20, 2026', registrations: 2, collectedCents: 200000, contractedCents: 200000, rows: [] },
  ],
  totals: { registrations: 5, collectedCents: 500000, contractedCents: 520000, refundedCents: 12345, refundedCount: 6, planRegistrations: 1 },
};
const keapReport = {
  events: [
    { date: 'august', label: 'August 7–9, 2026', orders: 7, netCents: 688200, grossCents: 688200, refundCents: 0 },
    { date: 'september', label: 'September 18–20, 2026', orders: 11, netCents: 817900, grossCents: 900000, refundCents: 82100 },
  ],
  totals: { orders: 18, netCents: 1506100, grossCents: 1588200, refundCents: 82100 },
};

describe('combineChannels', () => {
  it('takes headcount from Keap tags and sums revenue per date', () => {
    const c = combineChannels(stripeReport, keapReport, { august: 211, september: 130 }, 0);
    expect(c.totals.registrations).toBe(341);
    const [aug, sep] = c.events;
    expect(aug.registrations).toBe(211);
    expect(aug.collectedCents).toBe(300000 + 688200);
    expect(aug.contractedCents).toBe(320000 + 688200);
    expect(sep.collectedCents).toBe(200000 + 817900);
    expect(c.totals.collectedCents).toBe(300000 + 688200 + 200000 + 817900);
  });

  it('preserves the per-channel figures and the Stripe web event (rows) for the detail table', () => {
    const c = combineChannels(stripeReport, keapReport, { august: 211, september: 130 }, 0);
    expect(c.events[0].web).toBe(stripeReport.events[0]);
    expect(c.events[0].keapNetCents).toBe(688200);
    expect(c.totals.webCollectedCents).toBe(500000);
    expect(c.totals.keapNetCents).toBe(1506100);
  });

  it('carries the Stripe refund/plan fields and the overlap count for the awareness lines', () => {
    const c = combineChannels(stripeReport, keapReport, { august: 211, september: 130 }, 2);
    expect(c.totals.refundedCents).toBe(12345);
    expect(c.totals.refundedCount).toBe(6);
    expect(c.totals.planRegistrations).toBe(1);
    expect(c.totals.overlapCount).toBe(2);
  });

  it('treats missing tag counts as zero', () => {
    const c = combineChannels(stripeReport, keapReport, {}, 0);
    expect(c.totals.registrations).toBe(0);
    expect(c.events[0].registrations).toBe(0);
  });
});
