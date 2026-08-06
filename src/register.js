// =============================================================================
// /register.html — date + tier + plan selection.
// -----------------------------------------------------------------------------
// Renders the currently-active tier/price into each date card (display
// only — the server re-derives the tier authoritatively in
// api/create-checkout.js), then POSTs the buyer's choice there and
// redirects to the returned Stripe Checkout URL. Also handles the
// ?success=1 / ?canceled=1 return states from Stripe.
// =============================================================================

import { getActiveTier, PRICES } from '../lib/pricing.js';
import { initAnalytics, trackCtaClick } from './analytics.js';
import { wrapHeadingWords } from './word-hover.js';
import { initAffiliateRef, getStoredRef } from './affiliate-ref.js';

const DATE_LABELS = {
  august: 'August 7–9, 2026',
  september: 'September 18–20, 2026',
};

function renderCard(card) {
  const date = card.dataset.date;
  const tier = getActiveTier(date);
  const price = PRICES[tier];

  const tierLabelEl = card.querySelector('.price-label');
  const amountEl = card.querySelector('.price-now .amount');
  const detailEl = card.querySelector('.price-detail');

  tierLabelEl.textContent = tier === 'early' ? 'Early Registration' : 'Retail Registration';
  amountEl.innerHTML = tier === 'early'
    ? `${price.full}<span class="was">$${PRICES.retail.full}</span>`
    : `${price.full}`;
  detailEl.textContent = `or 2 payments of $${price.plan} ($${price.planTotal} total)`;

  card.querySelectorAll('button[data-plan]').forEach((btn) => {
    const plan = btn.dataset.plan;
    btn.textContent = plan === 'full' ? `Pay in Full — $${price.full}` : `2 Payments of $${price.plan}`;
  });
}

async function startCheckout(date, plan, button) {
  const card = button.closest('.date-card');
  const errorEl = card.querySelector('.lead-error');
  const buttons = card.querySelectorAll('button[data-plan]');
  buttons.forEach((b) => { b.disabled = true; });
  if (errorEl) errorEl.textContent = '';

  try {
    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, plan, ref: getStoredRef() }),
    });

    let data = {};
    try { data = await res.json(); } catch (_) { /* ignore */ }

    if (!res.ok || !data.url) {
      throw new Error(data.error || 'Could not start checkout. Please try again.');
    }

    trackCtaClick(`register_${date}_${plan}`);
    window.location.href = data.url;
  } catch (err) {
    buttons.forEach((b) => { b.disabled = false; });
    if (errorEl) errorEl.textContent = err.message || 'Something went wrong. Please try again.';
  }
}

function showConfirmation(params) {
  const container = document.querySelector('.register-cards');
  if (!container) return;

  const date = params.get('date');
  const tier = params.get('tier');
  const dateLabel = DATE_LABELS[date] || 'your workshop';
  const tierLabel = tier === 'early' ? 'Early Registration' : 'Retail Registration';

  // Swap the "Choose your date." intro too — it lives in a separate
  // .offer-inner block above the cards, so replacing only .register-cards
  // (below) would leave a registered buyer still being told to pick a date.
  const intro = document.querySelector('.offer-inner');
  if (intro) {
    const eyebrow = intro.querySelector('.eyebrow');
    const heading = intro.querySelector('h1');
    const lead = intro.querySelector('.lead');
    if (eyebrow) eyebrow.textContent = "You're all set";
    if (heading) heading.textContent = 'See you there.';
    if (lead) lead.style.display = 'none';
  }

  container.innerHTML = `
    <div class="lead-confirm">
      <strong>You're registered!</strong>
      ${dateLabel} · ${tierLabel}. Check your email for confirmation and access details.
    </div>
  `;

  const amount = tier === 'early' ? PRICES.early.full : PRICES.retail.full;
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'purchase', {
      transaction_id: `${date}-${Date.now()}`,
      value: amount,
      currency: 'USD',
      items: [{ item_name: `OTW ${date}`, item_variant: params.get('plan') }],
    });
  }
  if (typeof window.fbq === 'function') {
    window.fbq('track', 'Purchase', { value: amount, currency: 'USD' });
  }
}

function scrollToHashedCard() {
  const hash = window.location.hash.slice(1);
  if (hash !== 'august' && hash !== 'september') return;
  const target = document.querySelector(`.date-card[data-date="${hash}"]`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function init() {
  wrapHeadingWords();
  initAnalytics();
  initAffiliateRef();

  const params = new URLSearchParams(window.location.search);
  if (params.get('success') === '1') {
    showConfirmation(params);
    return;
  }

  document.querySelectorAll('.date-card').forEach(renderCard);
  document.querySelectorAll('.date-card button[data-plan]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.date-card');
      startCheckout(card.dataset.date, btn.dataset.plan, btn);
    });
  });

  scrollToHashedCard();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
