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

// The recurring Price's own 2-week billing cycle fires the 2nd charge
// around day 14 after subscription creation. cancel_at is set to day 15
// (not day 14) so it stops the subscription right after that charge
// lands, never before it — see the design spec for the full reasoning.
const SUBSCRIPTION_CANCEL_DELAY_MS = 15 * 24 * 60 * 60 * 1000;

export function getSubscriptionCancelAt(now = Date.now()) {
  return Math.floor((now + SUBSCRIPTION_CANCEL_DELAY_MS) / 1000);
}
