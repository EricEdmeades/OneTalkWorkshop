// lib/pricing.js — shared pure pricing/tier logic for the two workshop
// dates. No Stripe/Keap/env access here — imported by both the client
// bundle (src/register.js, for display) and the server
// (api/create-checkout.js, authoritative). Keeping the cutoff dates in
// exactly one place prevents client display and server pricing from
// drifting out of sync.

const EARLY_CUTOFFS_UTC = {
  // "Early through Jul 7" (ET, UTC-4) ends Jul 8 03:59:59 UTC.
  august: Date.UTC(2026, 6, 8, 3, 59, 59),
  // "Early through Jul 30" (ET, UTC-4) ends Jul 31 03:59:59 UTC.
  september: Date.UTC(2026, 6, 31, 3, 59, 59),
};

export const PRICES = {
  early: { full: 1297, plan: 677, planTotal: 1354 },
  retail: { full: 1597, plan: 827, planTotal: 1654 },
};

export function isValidDate(date) {
  return date === 'august' || date === 'september';
}

export function isValidPlan(plan) {
  return plan === 'full' || plan === 'plan';
}

export function getActiveTier(date, now = Date.now()) {
  const cutoff = EARLY_CUTOFFS_UTC[date];
  if (cutoff == null) throw new Error(`Unknown date: ${date}`);
  return now < cutoff ? 'early' : 'retail';
}

// The payment plan is 2 charges of the recurring Price's 2-week cycle:
// one at subscription creation, one at the day-14 renewal. cancel_at
// must land EXACTLY on the end of the 2nd billing period (anchor + 28
// days), computed from the subscription's own billing_cycle_anchor —
// never from the webhook's clock, which runs seconds after creation.
//
// Why boundary-aligned: under Stripe's flexible billing mode (the
// default for new subscriptions), a cancel_at INSIDE a period prorates
// that period's invoice to the covered time. The previous "day 15"
// value fell 1 day into period 2 and turned the 2nd $827 installment
// into a ~$59 one-day charge (live bug, Jul 2026). A cancel_at exactly
// on the boundary bills period 2 in full and generates no 3rd invoice —
// this is also how Stripe's own portal implements cancel-at-period-end.
const SUBSCRIPTION_PERIOD_SECONDS = 14 * 24 * 60 * 60; // one 2-week cycle
const SUBSCRIPTION_PERIOD_COUNT = 2;

export function getSubscriptionCancelAt(billingCycleAnchor) {
  if (!Number.isFinite(billingCycleAnchor)) {
    throw new Error(`Invalid billing_cycle_anchor: ${billingCycleAnchor}`);
  }
  return billingCycleAnchor + SUBSCRIPTION_PERIOD_COUNT * SUBSCRIPTION_PERIOD_SECONDS;
}
