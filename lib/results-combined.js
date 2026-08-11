// lib/results-combined.js — pure merge of the two /results revenue channels:
// Stripe Checkout (web) and Keap/WooCommerce. Headcount comes from Keap tags
// (the authoritative roster across both channels); revenue is the sum of the two
// channels' net. No IO here — api/results.js builds each channel report and the
// Stripe email-hash set, and hands them in.
import { EVENTS } from './results.js';

// Drop Keap orders whose buyer also bought through the Stripe channel, so a
// person present in both is counted once (Stripe precedence). Returns the kept
// orders and how many were dropped as duplicates.
export function dedupeKeapOrders(orders, stripeHashes) {
  const set = stripeHashes instanceof Set ? stripeHashes : new Set(stripeHashes || []);
  const kept = [];
  let overlapCount = 0;
  for (const order of Array.isArray(orders) ? orders : []) {
    if (order?.emailHash && set.has(order.emailHash)) overlapCount += 1;
    else kept.push(order);
  }
  return { orders: kept, overlapCount };
}

const tagCount = (counts, date) => (Number.isFinite(counts?.[date]) ? counts[date] : 0);

export function combineChannels(stripeReport, keapReport, tagCounts = {}, overlapCount = 0) {
  const events = EVENTS.map((e) => {
    const web = stripeReport.events.find((x) => x.date === e.date);
    const keap = keapReport.events.find((x) => x.date === e.date);
    const registrations = tagCount(tagCounts, e.date);
    return {
      date: e.date,
      label: e.label,
      registrations,
      web, // the Stripe event (carries its per-code rows) for the detail table
      keapNetCents: keap.netCents,
      keapGrossCents: keap.grossCents,
      keapRefundCents: keap.refundCents,
      collectedCents: web.collectedCents + keap.netCents,
      contractedCents: web.contractedCents + keap.netCents,
    };
  });

  const sum = (f) => events.reduce((acc, e) => acc + f(e), 0);
  const totals = {
    registrations: sum((e) => e.registrations),
    collectedCents: sum((e) => e.collectedCents),
    contractedCents: sum((e) => e.contractedCents),
    webCollectedCents: stripeReport.totals.collectedCents,
    webContractedCents: stripeReport.totals.contractedCents,
    keapNetCents: keapReport.totals.netCents,
    keapGrossCents: keapReport.totals.grossCents,
    keapRefundCents: keapReport.totals.refundCents,
    // carried through for the existing Stripe refund / orphan awareness lines
    refundedCents: stripeReport.totals.refundedCents,
    refundedCount: stripeReport.totals.refundedCount,
    planRegistrations: stripeReport.totals.planRegistrations,
    overlapCount,
  };

  return { events, totals };
}
