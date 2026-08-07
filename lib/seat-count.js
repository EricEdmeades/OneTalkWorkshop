// lib/seat-count.js — server-only: asks Stripe how many seats have been
// consumed since the ticker went live. Kept out of lib/seats.js (which is
// pure and shipped to the browser) and takes the Stripe client as an
// argument so this module never touches env vars itself.

import { getCountFromUnix, hasSeatTicker, isSeatExemptDiscount } from './seats.js';

// Stripe is the single source of truth for seats — there is no separate
// counter to drift out of sync. Only sessions created AFTER countFromUnix
// are scanned, so this stays a 1–2 request lookup rather than a walk
// through ~2000 historical sessions.
export async function countConsumedSeats(stripe, date) {
  if (!hasSeatTicker(date)) return 0;

  const since = getCountFromUnix(date);
  let consumed = 0;

  for await (const session of stripe.checkout.sessions.list({
    limit: 100,
    created: { gte: since },
  })) {
    if (session.metadata?.date !== date) continue;
    // A completed session is a seat taken, whether $1597 or 100%-off —
    // both put a person in the room. Sessions still `open` are someone
    // mid-checkout and are not counted until they finish; with only 5
    // seats and this traffic the oversell window is negligible, and
    // counting them would let an abandoned tab burn a real seat.
    if (session.status !== 'complete') continue;
    // SIM Masterminds comps are seated outside this allocation — see
    // SEAT_EXEMPT_PROMOTION_CODES for why.
    if (isSeatExemptDiscount(session.discounts)) continue;
    consumed += 1;
  }

  return consumed;
}
