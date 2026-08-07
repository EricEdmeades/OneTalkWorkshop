// lib/seats.js — shared seat-scarcity config and math for the "N tickets
// left" ticker. Pure: no Stripe/env access, so it can be imported by both
// the client bundle (display) and the API routes (authoritative). Same
// single-source-of-truth reasoning as lib/pricing.js.

// Only dates listed here get a ticker. September deliberately has none —
// adding it is a matter of adding a key, nothing else changes.
export const SEAT_CONFIG = {
  august: {
    initialSeats: 5,
    // Seats are counted from this instant FORWARD, not from the start of
    // sales. August already had ~235 completed checkouts (225 of them
    // comped via SIM2026) before the ticker existed; counting all of
    // history would show "sold out" the moment this shipped. So the
    // ticker measures the last 5 seats of the room, starting now.
    //
    // 2026-08-07T08:29:39Z — the moment the ticker went live.
    countFromUnix: 1786091379,
  },
};

export function hasSeatTicker(date) {
  return Object.prototype.hasOwnProperty.call(SEAT_CONFIG, date);
}

export function getInitialSeats(date) {
  const config = SEAT_CONFIG[date];
  return config ? config.initialSeats : null;
}

export function getCountFromUnix(date) {
  const config = SEAT_CONFIG[date];
  return config ? config.countFromUnix : null;
}

// consumed = completed checkout sessions since countFromUnix. Every
// completed checkout consumes a seat, paid or 100%-off comped alike —
// a comped attendee occupies a seat in the room exactly like a paying one.
export function getRemainingSeats(date, consumed) {
  const config = SEAT_CONFIG[date];
  if (!config) return null;
  if (!Number.isFinite(consumed) || consumed < 0) {
    throw new Error(`Invalid consumed seat count: ${consumed}`);
  }
  return Math.max(0, config.initialSeats - Math.floor(consumed));
}

export function isSoldOut(date, consumed) {
  if (!hasSeatTicker(date)) return false;
  return getRemainingSeats(date, consumed) === 0;
}

// Airline-style copy. Singular at 1, urgent styling is left to CSS.
export function getSeatNoticeText(remaining) {
  if (!Number.isFinite(remaining)) return '';
  if (remaining <= 0) return 'Sold out';
  if (remaining === 1) return 'Only 1 ticket left';
  return `Only ${remaining} tickets left`;
}
