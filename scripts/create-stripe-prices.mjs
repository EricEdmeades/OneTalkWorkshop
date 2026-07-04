// scripts/create-stripe-prices.mjs — one-off setup script. Run it yourself
// with your Stripe secret key, e.g.:
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/create-stripe-prices.mjs
//
// Creates one Product ("The One Talk Workshop") and the 4 Prices the app
// needs, then prints the resulting Price IDs to drop into env vars
// (STRIPE_PRICE_EARLY_FULL / STRIPE_PRICE_RETAIL_FULL /
// STRIPE_PRICE_EARLY_PLAN / STRIPE_PRICE_RETAIL_PLAN). Safe to re-run —
// it always creates new objects, so only run it once per Stripe mode
// (test vs live) and discard/archive any duplicates if you do re-run it.

import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Set STRIPE_SECRET_KEY in your shell before running this script.');
  process.exit(1);
}

const stripe = new Stripe(key);

async function main() {
  const product = await stripe.products.create({
    name: 'The One Talk Workshop',
    description: 'Live 3-day workshop with Eric Edmeades — August 7-9 or September 18-20, 2026.',
  });
  console.log(`Product created: ${product.id}`);

  const earlyFull = await stripe.prices.create({
    product: product.id,
    unit_amount: 129700,
    currency: 'usd',
  });

  const retailFull = await stripe.prices.create({
    product: product.id,
    unit_amount: 159700,
    currency: 'usd',
  });

  const earlyPlan = await stripe.prices.create({
    product: product.id,
    unit_amount: 67700,
    currency: 'usd',
    recurring: { interval: 'week', interval_count: 2 },
  });

  const retailPlan = await stripe.prices.create({
    product: product.id,
    unit_amount: 82700,
    currency: 'usd',
    recurring: { interval: 'week', interval_count: 2 },
  });

  console.log('\nAdd these to your env vars (Vercel + .env.local):\n');
  console.log(`STRIPE_PRICE_EARLY_FULL=${earlyFull.id}`);
  console.log(`STRIPE_PRICE_RETAIL_FULL=${retailFull.id}`);
  console.log(`STRIPE_PRICE_EARLY_PLAN=${earlyPlan.id}`);
  console.log(`STRIPE_PRICE_RETAIL_PLAN=${retailPlan.id}`);
}

main().catch((err) => {
  console.error('Failed to create Stripe objects:', err.message);
  process.exit(1);
});
