// api/create-checkout.js — creates a Stripe Checkout Session for a chosen
// workshop date + payment plan. Tier (Early/Retail) is always re-derived
// here from the server clock — never trusted from the client, so a
// stale/bookmarked link can't buy early pricing after the cutoff.

import Stripe from 'stripe';
import { getActiveTier, isValidDate, isValidPlan } from '../lib/pricing.js';

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

  const tier = getActiveTier(date);
  const priceEnvVar = PRICE_ENV_VARS[tier][plan];
  const priceId = process.env[priceEnvVar];
  if (!priceId) {
    console.error(`[create-checkout] Missing env var ${priceEnvVar}`);
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const metadata = { date, tier, plan };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: plan === 'plan' ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      client_reference_id: typeof ref === 'string' && ref ? ref : undefined,
      success_url: `${origin}/register.html?success=1&date=${encodeURIComponent(date)}&tier=${encodeURIComponent(tier)}&plan=${encodeURIComponent(plan)}`,
      cancel_url: `${origin}/register.html?canceled=1`,
      ...(plan === 'plan' ? { subscription_data: { metadata } } : {}),
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[create-checkout]', message);
    return res.status(500).json({ error: "We couldn't start checkout. Please try again." });
  }
}
