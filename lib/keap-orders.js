// lib/keap-orders.js — pure aggregation for the Keap/WooCommerce sales channel
// of the /results report. No Keap or network access (mirrors lib/results.js):
// api/results.js fetches and projects orders, this counts the money.
//
// Each order arrives already attributed to a workshop date, already de-duped
// against the Stripe channel, and reduced to plain integer cents. netCents =
// gross + refund_total (Keap stores refunds as a negative refund_total), so a
// refunded Woo order nets down here the way a refunded Stripe session does in
// lib/results.js.
import { EVENTS } from './results.js';

function emptyEvent({ date, label }) {
  return { date, label, orders: 0, netCents: 0, grossCents: 0, refundCents: 0 };
}

const int = (v) => (Number.isFinite(v) ? v : 0);

export function buildKeapReport(orders) {
  const byDate = new Map(EVENTS.map((e) => [e.date, emptyEvent(e)]));
  const list = Array.isArray(orders) ? orders : [];

  for (const order of list) {
    const bucket = byDate.get(order?.date);
    if (!bucket) continue; // not one of the two workshops
    bucket.orders += 1;
    bucket.netCents += int(order.netCents);
    bucket.grossCents += int(order.grossCents);
    bucket.refundCents += int(order.refundCents);
  }

  const events = EVENTS.map((e) => byDate.get(e.date));
  const totals = events.reduce(
    (acc, e) => ({
      orders: acc.orders + e.orders,
      netCents: acc.netCents + e.netCents,
      grossCents: acc.grossCents + e.grossCents,
      refundCents: acc.refundCents + e.refundCents,
    }),
    { orders: 0, netCents: 0, grossCents: 0, refundCents: 0 }
  );

  return { events, totals };
}
