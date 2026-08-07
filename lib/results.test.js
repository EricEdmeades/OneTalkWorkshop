import { describe, it, expect } from 'vitest';
import { buildReport, formatMoney } from './results.js';

// Minimal Checkout Session shape — only the fields buildReport reads.
function session({
  date = 'august',
  status = 'complete',
  mode = 'payment',
  amount = 159700,
  discounts = undefined,
} = {}) {
  return {
    status,
    mode,
    amount_total: amount,
    currency: 'usd',
    metadata: { date },
    ...(discounts ? { discounts } : {}),
  };
}

const promo = (code) => [{ promotion_code: code }];

describe('buildReport — which sessions count', () => {
  it('ignores sessions that never completed', () => {
    const report = buildReport(
      [session(), session({ status: 'open' }), session({ status: 'expired' })],
      {}
    );
    expect(report.totals.registrations).toBe(1);
  });

  it('ignores sessions with no recognised workshop date', () => {
    // The no-date case is built literally: session()'s destructuring default
    // fires on an explicit `undefined`, which would quietly make it August.
    const noDate = { status: 'complete', mode: 'payment', amount_total: 159700, metadata: {} };
    const report = buildReport([session(), session({ date: 'october' }), noDate], {});
    expect(report.totals.registrations).toBe(1);
  });

  it('always returns both events, even with zero registrations', () => {
    const report = buildReport([], {});
    expect(report.events.map((e) => e.date)).toEqual(['august', 'september']);
    expect(report.events[1].registrations).toBe(0);
    expect(report.events[1].rows).toEqual([]);
  });

  it('separates registrations by event', () => {
    const report = buildReport(
      [session({ date: 'august' }), session({ date: 'september' }), session({ date: 'september' })],
      {}
    );
    const [aug, sep] = report.events;
    expect(aug.registrations).toBe(1);
    expect(sep.registrations).toBe(2);
    expect(report.totals.registrations).toBe(3);
  });
});

describe('buildReport — code attribution', () => {
  it('labels sessions with no discount as "No code"', () => {
    const report = buildReport([session()], {});
    expect(report.events[0].rows[0].code).toBe('No code');
  });

  it('resolves a promotion code id to its human-readable code', () => {
    const report = buildReport([session({ discounts: promo('promo_abc') })], {
      promo_abc: 'SIM2026',
    });
    expect(report.events[0].rows[0].code).toBe('SIM2026');
  });

  it('falls back to the raw id when the code name is unknown', () => {
    const report = buildReport([session({ discounts: promo('promo_zzz') })], {});
    expect(report.events[0].rows[0].code).toBe('promo_zzz');
  });

  it('labels a bare coupon (no promotion code) by its coupon name', () => {
    const report = buildReport([session({ discounts: [{ coupon: 'cpn_1' }] })], {
      cpn_1: 'FRIENDS50',
    });
    expect(report.events[0].rows[0].code).toBe('FRIENDS50');
  });

  it('treats an empty discounts array as no code', () => {
    const report = buildReport([session({ discounts: [] })], {});
    expect(report.events[0].rows[0].code).toBe('No code');
  });

  it('groups repeated uses of the same code into one row', () => {
    const report = buildReport(
      [
        session({ discounts: promo('promo_abc') }),
        session({ discounts: promo('promo_abc') }),
        session({ discounts: promo('promo_abc') }),
      ],
      { promo_abc: 'SIM2026' }
    );
    expect(report.events[0].rows).toHaveLength(1);
    expect(report.events[0].rows[0].registrations).toBe(3);
  });
});

describe('buildReport — revenue', () => {
  it('counts a one-time payment once', () => {
    const report = buildReport([session({ mode: 'payment', amount: 159700 })], {});
    const row = report.events[0].rows[0];
    expect(row.collectedCents).toBe(159700);
    expect(row.contractedCents).toBe(159700);
  });

  it('counts a payment plan at two installments contracted, one collected', () => {
    const report = buildReport([session({ mode: 'subscription', amount: 82700 })], {});
    const row = report.events[0].rows[0];
    expect(row.collectedCents).toBe(82700);
    expect(row.contractedCents).toBe(165400);
  });

  it('counts a fully comped registration as a seat with zero revenue', () => {
    const report = buildReport(
      [session({ amount: 0, discounts: promo('promo_abc') })],
      { promo_abc: 'SIM2026' }
    );
    const row = report.events[0].rows[0];
    expect(row.registrations).toBe(1);
    expect(row.collectedCents).toBe(0);
    expect(row.contractedCents).toBe(0);
  });

  it('treats a missing amount_total as zero rather than NaN', () => {
    const report = buildReport([{ status: 'complete', mode: 'payment', metadata: { date: 'august' } }], {});
    expect(report.events[0].rows[0].collectedCents).toBe(0);
  });

  it('rolls row revenue up into event and grand totals', () => {
    const report = buildReport(
      [
        session({ date: 'august', amount: 159700 }),
        session({ date: 'august', mode: 'subscription', amount: 82700 }),
        session({ date: 'september', amount: 129700 }),
      ],
      {}
    );
    const [aug, sep] = report.events;
    expect(aug.collectedCents).toBe(242400);
    expect(aug.contractedCents).toBe(325100);
    expect(sep.contractedCents).toBe(129700);
    expect(report.totals.collectedCents).toBe(372100);
    expect(report.totals.contractedCents).toBe(454800);
  });
});

describe('buildReport — share of revenue', () => {
  it('computes each row share against its own event, not the grand total', () => {
    const report = buildReport(
      [
        session({ date: 'august', amount: 100000 }),
        session({ date: 'august', amount: 300000, discounts: promo('p') }),
        session({ date: 'september', amount: 900000 }),
      ],
      { p: 'HALF' }
    );
    const aug = report.events[0];
    const noCode = aug.rows.find((r) => r.code === 'No code');
    const half = aug.rows.find((r) => r.code === 'HALF');
    expect(half.sharePct).toBeCloseTo(75, 5);
    expect(noCode.sharePct).toBeCloseTo(25, 5);
  });

  it('reports zero share instead of dividing by zero when an event is fully comped', () => {
    const report = buildReport([session({ amount: 0, discounts: promo('p') })], { p: 'COMP' });
    expect(report.events[0].rows[0].sharePct).toBe(0);
  });
});

describe('buildReport — ordering', () => {
  it('ranks rows by contracted revenue, highest first', () => {
    const report = buildReport(
      [
        session({ amount: 10000, discounts: promo('small') }),
        session({ amount: 500000, discounts: promo('big') }),
        session({ amount: 100000 }),
      ],
      { small: 'SMALL', big: 'BIG' }
    );
    expect(report.events[0].rows.map((r) => r.code)).toEqual(['BIG', 'No code', 'SMALL']);
  });

  it('breaks a revenue tie by registration count, so comps outrank empty rows', () => {
    const report = buildReport(
      [
        session({ amount: 0, discounts: promo('a') }),
        session({ amount: 0, discounts: promo('b') }),
        session({ amount: 0, discounts: promo('b') }),
      ],
      { a: 'ONE', b: 'MANY' }
    );
    expect(report.events[0].rows.map((r) => r.code)).toEqual(['MANY', 'ONE']);
  });
});

describe('formatMoney', () => {
  it('renders whole dollars with thousands separators', () => {
    expect(formatMoney(159700)).toBe('$1,597');
    expect(formatMoney(5558000)).toBe('$55,580');
    expect(formatMoney(0)).toBe('$0');
  });

  it('keeps cents only when the amount is not whole dollars', () => {
    expect(formatMoney(159750)).toBe('$1,597.50');
  });
});
