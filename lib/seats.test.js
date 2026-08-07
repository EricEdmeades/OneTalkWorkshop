import { describe, it, expect } from 'vitest';
import {
  hasSeatTicker,
  getRemainingSeats,
  isSoldOut,
  isSoldOutByCount,
  isForcedSoldOut,
  getSeatNoticeText,
  isSeatExemptDiscount,
  SEAT_EXEMPT_PROMOTION_CODES,
} from './seats.js';
import { isEventOver } from './pricing.js';

describe('hasSeatTicker', () => {
  it('is on for august only', () => {
    expect(hasSeatTicker('august')).toBe(true);
    expect(hasSeatTicker('september')).toBe(false);
    expect(hasSeatTicker('nonsense')).toBe(false);
  });
});

describe('getRemainingSeats', () => {
  it('counts down one seat per completed checkout', () => {
    expect(getRemainingSeats('august', 0)).toBe(5);
    expect(getRemainingSeats('august', 1)).toBe(4);
    expect(getRemainingSeats('august', 4)).toBe(1);
  });

  it('floors at zero and never goes negative on oversell', () => {
    expect(getRemainingSeats('august', 5)).toBe(0);
    expect(getRemainingSeats('august', 99)).toBe(0);
  });

  it('returns null for a date with no ticker', () => {
    expect(getRemainingSeats('september', 0)).toBeNull();
  });

  it('rejects a nonsense consumed count rather than guessing', () => {
    expect(() => getRemainingSeats('august', -1)).toThrow();
    expect(() => getRemainingSeats('august', NaN)).toThrow();
  });
});

describe('isSoldOutByCount', () => {
  it('flips only when the last seat goes', () => {
    expect(isSoldOutByCount('august', 4)).toBe(false);
    expect(isSoldOutByCount('august', 5)).toBe(true);
    expect(isSoldOutByCount('august', 6)).toBe(true);
  });

  it('is never true for a date without a ticker', () => {
    expect(isSoldOutByCount('september', 999)).toBe(false);
  });
});

describe('isForcedSoldOut', () => {
  it('closes august by hand', () => {
    expect(isForcedSoldOut('august')).toBe(true);
  });

  it('leaves september selling', () => {
    expect(isForcedSoldOut('september')).toBe(false);
    expect(isForcedSoldOut('nonsense')).toBe(false);
  });
});

describe('isSoldOut', () => {
  it('reports a hand-closed date as sold out with seats still on the counter', () => {
    expect(isSoldOut('august', 0)).toBe(true);
    expect(isSoldOut('august', 4)).toBe(true);
  });

  it('still falls back to the seat count for dates left open', () => {
    expect(isSoldOut('september', 999)).toBe(false);
  });
});

describe('getSeatNoticeText', () => {
  it('uses the singular at one seat', () => {
    expect(getSeatNoticeText(1)).toBe('Only 1 ticket left');
    expect(getSeatNoticeText(5)).toBe('Only 5 tickets left');
    expect(getSeatNoticeText(0)).toBe('Sold out');
  });
});

describe('isSeatExemptDiscount', () => {
  const SIM2026 = SEAT_EXEMPT_PROMOTION_CODES[0];

  it('exempts a SIM2026 redemption from consuming a seat', () => {
    expect(isSeatExemptDiscount([{ promotion_code: SIM2026 }])).toBe(true);
  });

  it('still counts other comp codes', () => {
    expect(isSeatExemptDiscount([{ promotion_code: 'promo_someOtherCode' }])).toBe(false);
  });

  it('counts an ordinary paid checkout with no discount', () => {
    expect(isSeatExemptDiscount([])).toBe(false);
    expect(isSeatExemptDiscount(undefined)).toBe(false);
    expect(isSeatExemptDiscount(null)).toBe(false);
  });

  it('exempts when SIM2026 appears alongside another discount', () => {
    expect(isSeatExemptDiscount([{ coupon: 'x' }, { promotion_code: SIM2026 }])).toBe(true);
  });
});

describe('isEventOver', () => {
  // August runs 7–9 Aug 2026, last session ending 2pm ET = 18:00 UTC.
  const duringFinalDay = Date.UTC(2026, 7, 9, 17, 0, 0);
  const justAfterEnd = Date.UTC(2026, 7, 9, 18, 0, 1);

  it('is false while the final session is still running', () => {
    expect(isEventOver('august', duringFinalDay)).toBe(false);
  });

  it('is true once the final session has finished', () => {
    expect(isEventOver('august', justAfterEnd)).toBe(true);
  });

  it('tracks september independently', () => {
    expect(isEventOver('september', justAfterEnd)).toBe(false);
    expect(isEventOver('september', Date.UTC(2026, 8, 20, 18, 0, 1))).toBe(true);
  });

  it('throws on an unknown date rather than silently allowing a sale', () => {
    expect(() => isEventOver('october')).toThrow();
  });
});
