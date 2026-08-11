// lib/keap-api.js — every Keap read the /results report needs, in one place.
//
// This module is called ONLY by api/refresh-keap.js, the background refresher.
// api/results.js must never import it: rendering a page must not depend on
// reaching Keap. See lib/keap-snapshot.js for why.
//
// PRIVACY: contacts are reduced to an id (used only to attribute an order to a
// workshop date and then discarded) and orders to a one-way email hash. No name,
// email address or contact record leaves this module.

import { emailHash } from './email-hash.js';

const KEAP_BASE_V1 = 'https://api.infusionsoft.com/crm/rest/v1';

// "One Talk Workshop". The orders endpoint filters on this server-side, so the
// whole order flow is a single page rather than a walk of the ~4,600-order log.
export const KEAP_OTW_PRODUCT_ID = 49;

// Backstop only — the product filter means the real answer is one page.
const MAX_ORDER_PAGES = 60;
const ORDER_PAGE_DELAY_MS = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every Keap request gets a hard ceiling. Without one, a connection Keap never
// answers pins the whole function until the platform kills it — which is
// exactly what happened on the first production cron run: a 504 at 300s, so the
// retry loop never ran and no snapshot was ever stored. A hung request must
// cost one attempt, not the entire job.
const REQUEST_TIMEOUT_MS = 12_000;

// Outcomes the refresher should WAIT and retry on, as opposed to ones that will
// never fix themselves (a bad key, a malformed response). Both a throttle and a
// timeout are "Keap is busy right now" — the whole strategy is to come back and
// try again later, so both are retryable.
export class KeapThrottleError extends Error {
  constructor(what) {
    super(`Keap throttled the request (${what})`);
    this.name = 'KeapThrottleError';
    this.throttled = true;
    this.retryable = true;
  }
}

export class KeapTimeoutError extends Error {
  constructor(what) {
    super(`Keap did not respond within ${REQUEST_TIMEOUT_MS}ms (${what})`);
    this.name = 'KeapTimeoutError';
    this.timedOut = true;
    this.retryable = true;
  }
}

function keapHeaders() {
  return { 'X-Keap-API-Key': process.env.KEAP_API_KEY, Accept: 'application/json' };
}

// No retry lives here. Retrying a 429 in place is what previously pinned the
// key: each retry landed inside the same throttled minute, and with a cold
// instance per concurrent request those retries multiplied into a self-
// sustaining storm. The refresher retries instead — once, slowly, with nobody
// waiting on the response.
async function keapFetch(url, what) {
  let res;
  try {
    res = await fetch(url, {
      headers: keapHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // AbortSignal.timeout aborts with a TimeoutError; a dropped connection
    // surfaces as a TypeError. Both mean "no answer this time", which is the
    // retryable case — anything else is re-thrown untouched.
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new KeapTimeoutError(what);
    }
    throw err;
  }
  if (res.status === 429) throw new KeapThrottleError(what);
  if (!res.ok) throw new Error(`Keap ${what}: ${res.status}`);
  return res.json();
}

// The set of contact ids carrying a tag — its size is the headcount, and
// membership attributes each OTW order to a date without a per-order call.
//
// The tag-member endpoint returns items shaped `{ contact: {...}, date_applied }`,
// so the id is at `item.contact.id`, NOT `item.id`. Reading the wrong field
// yields an empty set in silence: zero headcount and a zero-dollar Keap channel
// that looks like a real answer.
async function loadTagMembers(tag) {
  const ids = new Set();
  let url = `${KEAP_BASE_V1}/tags/${tag}/contacts?limit=1000`;
  while (url) {
    const body = await keapFetch(url, `tag members ${tag}`);
    for (const c of body.contacts || []) if (c?.contact?.id != null) ids.add(c.contact.id);
    url = body.next || null;
    if (url) await sleep(ORDER_PAGE_DELAY_MS);
  }
  return ids;
}

// netCents = total + refund_total. Keap stores refund_total as a NEGATIVE
// number and leaves order status at PAID even when refunded, so status is not
// a usable signal here.
async function loadOrders({ augSet, sepSet }) {
  const orders = [];
  let url = `${KEAP_BASE_V1}/orders?product_id=${KEAP_OTW_PRODUCT_ID}&limit=100&order=date&order_direction=descending`;
  let pages = 0;

  while (url) {
    if (pages >= MAX_ORDER_PAGES) {
      console.error('[refresh-keap] order scan hit MAX_ORDER_PAGES; figures may be incomplete');
      break;
    }
    pages += 1;
    const body = await keapFetch(url, 'orders');

    for (const o of body.orders || []) {
      const contactId = o.contact?.id ?? o.contact_id;
      // The tag carries the date, which also excludes the 2025 postponed
      // cohort's orders. A contact somehow tagged for both dates is attributed
      // to August deterministically; expected count is zero.
      let date = null;
      if (augSet.has(contactId)) date = 'august';
      else if (sepSet.has(contactId)) date = 'september';
      if (!date) continue;
      if (augSet.has(contactId) && sepSet.has(contactId)) {
        console.warn('[refresh-keap] contact carries both Aug and Sep tags; attributed to August');
      }

      const total = Number.isFinite(o.total) ? o.total : 0;
      const refund = Number.isFinite(o.refund_total) ? o.refund_total : 0; // negative
      const grossCents = Math.round(total * 100);
      const refundCents = Math.round(-refund * 100);
      orders.push({
        date,
        grossCents,
        refundCents,
        netCents: grossCents - refundCents,
        emailHash: emailHash(o.contact?.email),
      });
    }

    url = body.next || null;
    if (url) await sleep(ORDER_PAGE_DELAY_MS);
  }

  return orders;
}

// One full read of the Keap channel: ~3 requests. Sequential on purpose — two
// concurrent requests is what tipped the shared quota into a 429 on the tag
// walks, and nothing here is urgent enough to be worth the parallelism.
export async function fetchKeapChannel({ tagAugust, tagSeptember }) {
  const augSet = await loadTagMembers(tagAugust);
  const sepSet = await loadTagMembers(tagSeptember);

  // A contact tagged for both dates counts toward both headcounts, while its
  // Woo revenue is attributed to August only.
  const tagCounts = { august: augSet.size, september: sepSet.size };
  const orders = await loadOrders({ augSet, sepSet });

  return { tagCounts, orders };
}
