// api/seats.js — read-only seat availability for the "N tickets left"
// ticker. The browser calls this to render the notice; it is NOT the
// thing that stops a sale. api/create-checkout.js re-derives sold-out
// state itself, so a stale page or a hand-crafted POST can't buy a seat
// that no longer exists.

import Stripe from 'stripe';
import {
  hasSeatTicker,
  getRemainingSeats,
  isSoldOutByCount,
  isForcedSoldOut,
  getSeatNoticeText,
} from '../lib/seats.js';
import { countConsumedSeats } from '../lib/seat-count.js';
import { isValidDate, isEventOver } from '../lib/pricing.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const date = typeof req.query?.date === 'string' ? req.query.date : '';
  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'Invalid or missing date.' });
  }

  // Event-over is pure date math, so answer it without calling Stripe.
  if (isEventOver(date)) {
    return res.status(200).json({ date, ticker: false, eventOver: true, soldOut: true, remaining: 0, notice: '' });
  }

  // Hand-closed dates are pure config too — answer before touching Stripe.
  // ticker: true so the card renders the sold-out state rather than treating
  // this like a date that simply has no ticker.
  if (isForcedSoldOut(date)) {
    return res.status(200).json({ date, ticker: true, eventOver: false, soldOut: true, remaining: 0, notice: getSeatNoticeText(0) });
  }

  if (!hasSeatTicker(date)) {
    return res.status(200).json({ date, ticker: false, eventOver: false, soldOut: false, remaining: null, notice: '' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[seats] STRIPE_SECRET_KEY is not set');
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  try {
    const consumed = await countConsumedSeats(stripe, date);
    const remaining = getRemainingSeats(date, consumed);

    // Short cache: the ticker may lag a sale by up to a minute, which is
    // fine for display. Checkout itself is never served from cache.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    return res.status(200).json({
      date,
      ticker: true,
      eventOver: false,
      soldOut: isSoldOutByCount(date, consumed),
      remaining,
      notice: getSeatNoticeText(remaining),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[seats]', message);
    // Fail quiet: a Stripe hiccup should hide the ticker, never block a
    // sale or fake a "sold out" the checkout endpoint would contradict.
    return res.status(200).json({ date, ticker: false, eventOver: false, soldOut: false, remaining: null, notice: '' });
  }
}
