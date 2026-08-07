// lib/results.js — pure aggregation for the /results registration report.
// No Stripe or env access here (same reasoning as lib/pricing.js and
// lib/seats.js): api/results.js does the IO and hands the raw sessions in,
// so all the counting and money math is unit-testable without a network.
//
// PRIVACY: this module deliberately reads no identifying field. It never
// touches customer, customer_details, customer_email, client_reference_id,
// or payment_intent — only status, mode, amount, date, and discount code.
// The report is aggregate-only by construction, not by filtering later.

import { SUBSCRIPTION_PERIOD_COUNT } from './pricing.js';

export const EVENTS = [
  { date: 'august', label: 'August 7–9, 2026' },
  { date: 'september', label: 'September 18–20, 2026' },
];

const NO_CODE = 'No code';

// A session that never reached `complete` is an abandoned tab, not a
// registration — same rule lib/seat-count.js applies to the seat ticker.
function isRegistration(session) {
  return session?.status === 'complete';
}

// Stripe returns discounts as `[{coupon, promotion_code}]` with both as
// plain id strings. Promotion codes are the normal path (the customer typed
// SIM2026 into Checkout); a bare coupon with no promotion_code happens when
// a discount is applied to the session directly rather than redeemed.
export function resolveCode(session, promoNames = {}) {
  const discount = Array.isArray(session?.discounts) ? session.discounts[0] : null;
  if (!discount) return NO_CODE;

  const id = discount.promotion_code || discount.coupon;
  if (!id || typeof id !== 'string') return NO_CODE;

  // Fall back to the raw id so an unmapped code still shows as its own row
  // rather than silently merging into "No code" and distorting the split.
  return promoNames[id] || id;
}

// What Stripe took at checkout. For a payment plan that is installment 1 of
// SUBSCRIPTION_PERIOD_COUNT; the rest is scheduled, not banked.
export function collectedCents(session) {
  const amount = session?.amount_total;
  return Number.isFinite(amount) ? amount : 0;
}

// What the registration is worth in full. cancel_at is pinned to the end of
// the final billing period (see getSubscriptionCancelAt), so a plan bills
// exactly SUBSCRIPTION_PERIOD_COUNT times and never a partial third.
export function contractedCents(session) {
  const collected = collectedCents(session);
  return session?.mode === 'subscription' ? collected * SUBSCRIPTION_PERIOD_COUNT : collected;
}

function emptyEvent({ date, label }) {
  return { date, label, registrations: 0, collectedCents: 0, contractedCents: 0, rows: [] };
}

export function buildReport(sessions, promoNames = {}) {
  const buckets = new Map(EVENTS.map((e) => [e.date, new Map()]));
  const list = Array.isArray(sessions) ? sessions : [];

  for (const session of list) {
    if (!isRegistration(session)) continue;

    const date = session?.metadata?.date;
    const byCode = buckets.get(date);
    // Unknown or missing date: not one of the two workshops, so it is not a
    // registration in this report (test-mode noise, a future date, etc).
    if (!byCode) continue;

    const code = resolveCode(session, promoNames);
    const row = byCode.get(code) || { code, registrations: 0, collectedCents: 0, contractedCents: 0 };

    byCode.set(code, {
      code,
      registrations: row.registrations + 1,
      collectedCents: row.collectedCents + collectedCents(session),
      contractedCents: row.contractedCents + contractedCents(session),
    });
  }

  const events = EVENTS.map((event) => {
    const rows = [...buckets.get(event.date).values()];
    if (!rows.length) return emptyEvent(event);

    const totals = rows.reduce(
      (acc, row) => ({
        registrations: acc.registrations + row.registrations,
        collectedCents: acc.collectedCents + row.collectedCents,
        contractedCents: acc.contractedCents + row.contractedCents,
      }),
      { registrations: 0, collectedCents: 0, contractedCents: 0 }
    );

    return {
      ...event,
      ...totals,
      rows: rows
        .map((row) => ({
          ...row,
          // Share is of THIS event's revenue, so each event's column reads
          // to 100% on its own. A fully comped event has no denominator —
          // report 0 rather than NaN.
          sharePct: totals.contractedCents > 0 ? (row.contractedCents / totals.contractedCents) * 100 : 0,
        }))
        // Revenue first, then headcount — so two $0 comp codes still order
        // by how many people they actually put in the room.
        .sort((a, b) => b.contractedCents - a.contractedCents || b.registrations - a.registrations),
    };
  });

  const totals = events.reduce(
    (acc, e) => ({
      registrations: acc.registrations + e.registrations,
      collectedCents: acc.collectedCents + e.collectedCents,
      contractedCents: acc.contractedCents + e.contractedCents,
    }),
    { registrations: 0, collectedCents: 0, contractedCents: 0 }
  );

  return { events, totals };
}

// Whole dollars by default — these are 4- and 5-figure numbers and the cents
// are noise. Cents appear only when an amount is genuinely not whole, which
// would otherwise silently round and make column sums look wrong.
export function formatMoney(cents) {
  const amount = (Number.isFinite(cents) ? cents : 0) / 100;
  const whole = Number.isInteger(amount);
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

export function formatPct(pct) {
  const value = Number.isFinite(pct) ? pct : 0;
  return `${value.toFixed(1)}%`;
}
