// src/date-cards.js — seat state for the "Choose Your Date" cards on the
// landing page. Mirrors what src/register.js does for the registration
// cards, against the landing page's simpler .day-card markup (the CTA
// here is an <a>, not a <button>).
//
// Display only. api/create-checkout.js is what actually refuses a sale.

import { isEventOver } from '../lib/pricing.js';

// One request per date, shared by the cards and the hero stamp.
const seatRequests = new Map();

function getSeats(date) {
  if (!seatRequests.has(date)) {
    seatRequests.set(
      date,
      fetch(`/api/seats?date=${encodeURIComponent(date)}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    );
  }
  return seatRequests.get(date);
}

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

// Swap the link for inert text — a disabled-looking anchor that still
// navigates is worse than no link at all. Idempotent: a card that shipped
// sold-out in the HTML already has the badge and is left alone.
function disableCta(card, label) {
  const cta = card.querySelector('a[data-cta]');
  if (!cta) return;
  const badge = document.createElement('span');
  badge.className = 'btn-primary is-disabled';
  badge.setAttribute('aria-disabled', 'true');
  badge.textContent = label;
  cta.replaceWith(badge);
}

function markSoldOut(card) {
  card.classList.add('is-sold-out');
  insertNotice(card, 'Sold out');
  disableCta(card, 'Sold Out');
}

// A finished workshop stays on the page as a record of what ran — greyed
// out and clearly past, rather than vanishing and leaving the section
// looking like the date never existed. Sold-out dates keep saying so.
function markPast(card) {
  const wasSoldOut = card.classList.contains('is-sold-out');
  card.classList.add('is-past');
  insertNotice(card, wasSoldOut ? 'Sold out — this workshop has finished' : 'This workshop has finished');
  disableCta(card, wasSoldOut ? 'Sold Out' : 'Finished');
}

async function applyCardState(card) {
  const date = card.dataset.date;
  if (!date) return;

  if (isEventOver(date)) {
    markPast(card);
    return;
  }

  // A card that ships sold-out in the HTML needs no lookup — the server
  // agrees (lib/seats.js FORCED_SOLD_OUT_DATES) and nothing can re-open it.
  if (card.classList.contains('is-sold-out')) {
    markSoldOut(card);
    return;
  }

  // Scarcity is an enhancement; a failed lookup leaves the card untouched.
  const data = await getSeats(date);
  if (!data) return;

  if (data.eventOver) {
    markPast(card);
    return;
  }
  if (!data.ticker) return;
  if (data.soldOut) {
    markSoldOut(card);
    return;
  }
  insertNotice(card, data.notice);
}

// Hero stamp: rides inline on its own date's bullet, so the count sits
// next to the date it applies to. Stays hidden unless there is a live
// count to show — a stale or empty "seats left" in the hero is worse than
// none at all, so sold-out leaves it off (the date cards carry that
// state). Once the workshop is over the whole bullet goes.
async function applyHeroStamp(el) {
  const date = el.dataset.seatStamp;
  if (!date) return;

  const bullet = el.closest('.hero-meta-item');
  if (isEventOver(date)) {
    if (bullet) bullet.remove();
    return;
  }

  const data = await getSeats(date);
  if (!data) return;
  if (data.eventOver) {
    if (bullet) bullet.remove();
    return;
  }
  if (!data.ticker || data.soldOut) return;
  if (!Number.isFinite(data.remaining) || data.remaining <= 0) return;

  el.textContent = data.notice;
  el.hidden = false;
}

// A finished workshop drops off the hero list too, stamp or not.
function pruneFinishedHeroBullets() {
  document.querySelectorAll('.hero-meta-item[data-date]').forEach((item) => {
    if (isEventOver(item.dataset.date)) item.remove();
  });
}

export function initDateCards() {
  pruneFinishedHeroBullets();
  document.querySelectorAll('.day-card[data-date]').forEach(applyCardState);
  document.querySelectorAll('[data-seat-stamp]').forEach(applyHeroStamp);
}
