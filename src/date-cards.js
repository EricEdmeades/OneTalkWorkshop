// src/date-cards.js — seat state for the "Choose Your Date" cards on the
// landing page. Mirrors what src/register.js does for the registration
// cards, against the landing page's simpler .day-card markup (the CTA
// here is an <a>, not a <button>).
//
// Display only. api/create-checkout.js is what actually refuses a sale.

import { isEventOver } from '../lib/pricing.js';

function insertNotice(card, text) {
  if (!text) return;
  let el = card.querySelector('.seat-notice');
  if (!el) {
    el = document.createElement('p');
    el.className = 'seat-notice';
    const cta = card.querySelector('a[data-cta]');
    if (cta) cta.insertAdjacentElement('beforebegin', el);
    else card.append(el);
  }
  el.textContent = text;
}

function markSoldOut(card) {
  card.classList.add('is-sold-out');
  insertNotice(card, 'Sold out');
  const cta = card.querySelector('a[data-cta]');
  if (!cta) return;
  // Swap the link for inert text — a disabled-looking anchor that still
  // navigates is worse than no link at all.
  const badge = document.createElement('span');
  badge.className = 'btn-primary is-disabled';
  badge.setAttribute('aria-disabled', 'true');
  badge.textContent = 'Sold Out';
  cta.replaceWith(badge);
}

async function applyCardState(card) {
  const date = card.dataset.date;
  if (!date) return;

  if (isEventOver(date)) {
    card.remove();
    return;
  }

  let data;
  try {
    const res = await fetch(`/api/seats?date=${encodeURIComponent(date)}`);
    if (!res.ok) return;
    data = await res.json();
  } catch (_) {
    return; // Scarcity is an enhancement; never break the page over it.
  }

  if (data.eventOver) {
    card.remove();
    return;
  }
  if (!data.ticker) return;
  if (data.soldOut) {
    markSoldOut(card);
    return;
  }
  insertNotice(card, data.notice);
}

export function initDateCards() {
  document.querySelectorAll('.day-card[data-date]').forEach(applyCardState);
}
