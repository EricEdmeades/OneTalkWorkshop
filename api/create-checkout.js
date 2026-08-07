// api/create-checkout.js — creates a Stripe Checkout Session for a chosen
// workshop date + payment plan. Tier (Early/Retail) is always re-derived
// here from the server clock — never trusted from the client, so a
// stale/bookmarked link can't buy early pricing after the cutoff.

import Stripe from 'stripe';
import { getActiveTier, isValidDate, isValidPlan, isEventOver } from '../lib/pricing.js';
import { hasSeatTicker, isSoldOutByCount, isForcedSoldOut } from '../lib/seats.js';
import { countConsumedSeats } from '../lib/seat-count.js';
import { sanitizeRef } from '../lib/ref.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_ENV_VARS = {
  early: { full: 'STRIPE_PRICE_EARLY_FULL', plan: 'STRIPE_PRICE_EARLY_PLAN' },
  retail: { full: 'STRIPE_PRICE_RETAIL_FULL', plan: 'STRIPE_PRICE_RETAIL_PLAN' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[create-checkout] STRIPE_SECRET_KEY is not set');
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  const body = req.body || {};
  const { date, plan, ref } = body;

  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'Invalid or missing date.' });
  }
  if (!isValidPlan(plan)) {
    return res.status(400).json({ error: 'Invalid or missing plan.' });
  }

  // Sales close when the workshop itself is over — a bookmarked link or a
  // cached page must not be able to sell a seat to a finished event.
  if (isEventOver(date)) {
    return res.status(410).json({ error: 'This workshop has already taken place.' });
  }

  // A hand-closed date refuses outright, before Stripe: the seat counter
  // can still show room (it only counts checkouts since countFromUnix), so
  // this gate is the only thing standing between a stale card and a sale
  // into a full room.
  if (isForcedSoldOut(date)) {
    return res.status(409).json({ error: 'This date is sold out.' });
  }

  // Seat gate, re-derived server-side for the same reason the tier is:
  // the client's view of remaining seats is display only and may be stale.
  // A Stripe failure here must not block a sale, so it is logged and the
  // sale is allowed through rather than refusing on incomplete data.
  if (hasSeatTicker(date)) {
    try {
      const consumed = await countConsumedSeats(stripe, date);
      if (isSoldOutByCount(date, consumed)) {
        return res.status(409).json({ error: 'This date is sold out.' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[create-checkout] Seat count failed for ${date}, allowing sale:`, message);
    }
  }

  const tier = getActiveTier(date);
  const priceEnvVar = PRICE_ENV_VARS[tier][plan];
  const priceId = process.env[priceEnvVar];
  if (!priceId) {
    console.error(`[create-checkout] Missing env var ${priceEnvVar}`);
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const cleanRef = sanitizeRef(ref);
  const metadata = { date, tier, plan, ...(cleanRef ? { ref: cleanRef } : {}) };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: plan === 'plan' ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      client_reference_id: typeof ref === 'string' && ref ? ref : undefined,
      // Always collect the buyer's name so customer_details.name is populated
      // for the Keap contact. Without this, free/100%-off registrations (no
      // card collected via `if_required`) arrive nameless and the webhook
      // falls back to "Unknown Unknown".
      billing_address_collection: 'required',
      // Show the "Add promotion code" field so restricted 100%-off codes work
      // for team testing. Real subscribers still pay (coupon must be entered).
      allow_promotion_codes: true,
      success_url: `${origin}/register.html?success=1&date=${encodeURIComponent(date)}&tier=${encodeURIComponent(tier)}&plan=${encodeURIComponent(plan)}`,
      cancel_url: `${origin}/register.html?canceled=1`,
      // if_required: with a 100%-off coupon nothing is ever due, so Checkout
      // skips card collection (frictionless test); real subscribers owe >$0 and
      // are still asked for a card.
      ...(plan === 'plan'
        ? { subscription_data: { metadata }, payment_method_collection: 'if_required' }
        : {}),
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[create-checkout]', message);
    return res.status(500).json({ error: "We couldn't start checkout. Please try again." });
  }
}
