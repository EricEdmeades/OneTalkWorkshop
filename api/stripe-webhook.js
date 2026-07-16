// api/stripe-webhook.js — applies a Keap tag (August or September) the
// moment a Stripe Checkout Session completes, so we know which workshop
// date a buyer registered for. Keap helpers mirror api/subscribe-otw.js.
//
// Unlike the form endpoints, a Keap failure here returns 500 (not 200)
// so Stripe's automatic webhook retry (up to 3 days) gets another shot —
// there's no user waiting on this request to retry manually.

import Stripe from 'stripe';
import { getSubscriptionCancelAt } from '../lib/pricing.js';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const KEAP_BASE_V1 = 'https://api.infusionsoft.com/crm/rest/v1';
const KEAP_BASE_V2 = 'https://api.infusionsoft.com/crm/rest/v2';

function tagIds() {
  return {
    august: Number(process.env.KEAP_TAG_ID_AUGUST || 2008),
    september: Number(process.env.KEAP_TAG_ID_SEPTEMBER || 1825),
  };
}

function keapHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Keap-API-Key': process.env.KEAP_API_KEY,
  };
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function findContactByEmail(email) {
  const url = `${KEAP_BASE_V1}/contacts?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: keapHeaders() });
  if (!res.ok) throw new Error(`Keap search failed: ${res.status}`);
  const data = await res.json();
  return (data.contacts && data.contacts[0]) || null;
}

async function createContact({ firstName, lastName, email }) {
  const res = await fetch(`${KEAP_BASE_V1}/contacts`, {
    method: 'POST',
    headers: keapHeaders(),
    body: JSON.stringify({
      given_name: firstName,
      family_name: lastName,
      email_addresses: [{ email, field: 'EMAIL1' }],
      opt_in_reason: 'One Talk Workshop — Stripe registration',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keap create failed: ${res.status} ${text}`);
  }
  const created = await res.json();
  return created.id;
}

async function updateContact(contactId, { firstName, lastName, email }) {
  const res = await fetch(`${KEAP_BASE_V1}/contacts/${contactId}`, {
    method: 'PATCH',
    headers: keapHeaders(),
    body: JSON.stringify({
      given_name: firstName,
      family_name: lastName,
      email_addresses: [{ email, field: 'EMAIL1' }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keap update failed: ${res.status} ${text}`);
  }
}

function isTagFailureValue(v) {
  if (v == null) return false;
  if (typeof v !== 'string') return false;
  const upper = v.toUpperCase();
  return upper.includes('ERROR') || upper.includes('NOT_FOUND');
}

async function applyTag(contactId, tagId) {
  const res = await fetch(`${KEAP_BASE_V1}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: keapHeaders(),
    body: JSON.stringify({ tagIds: [tagId] }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keap tag apply HTTP ${res.status} for contact ${contactId} tag ${tagId}: ${text}`);
  }
  let body;
  try {
    body = await res.json();
  } catch (_) {
    body = {};
  }
  const failures = Object.entries(body).filter(([_, v]) => isTagFailureValue(v));
  if (failures.length > 0) {
    const failedIds = failures.map(([id]) => id).join(', ');
    throw new Error(`Keap tag apply rejected for contact ${contactId} tag(s) [${failedIds}]: ${JSON.stringify(body)}`);
  }
}

async function addNote(contactId, title, body) {
  const res = await fetch(`${KEAP_BASE_V2}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: keapHeaders(),
    body: JSON.stringify({ title, text: body }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[stripe-webhook] Note add failed: ${res.status} ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) {
    console.error('[stripe-webhook] Stripe env vars are not set');
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  const signature = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const date = session.metadata?.date;
  const tier = session.metadata?.tier;
  const plan = session.metadata?.plan;
  const tagId = tagIds()[date];

  if (!tagId) {
    console.error(`[stripe-webhook] Unknown date in session metadata: ${date}`);
    return res.status(200).json({ received: true });
  }

  const email = session.customer_details?.email;
  if (!email) {
    console.error(`[stripe-webhook] No customer email on session ${session.id}`);
    return res.status(200).json({ received: true });
  }

  const fullName = session.customer_details?.name || '';
  const [firstName, ...rest] = fullName.split(' ');
  const lastName = rest.join(' ') || firstName || 'Unknown';

  try {
    const existing = await findContactByEmail(email);
    let contactId;
    if (existing) {
      contactId = existing.id;
      await updateContact(contactId, { firstName: firstName || 'Unknown', lastName, email });
    } else {
      contactId = await createContact({ firstName: firstName || 'Unknown', lastName, email });
    }

    await applyTag(contactId, tagId);

    // cancel_at can't be set on Checkout Session creation (Checkout's
    // subscription_data doesn't expose that field) — it has to be applied
    // to the real Subscription object once it exists, which is here. The
    // subscription is retrieved first because cancel_at must be computed
    // from ITS billing_cycle_anchor: it has to land exactly on the end of
    // the 2nd billing period, or flexible billing mode prorates the 2nd
    // installment (see getSubscriptionCancelAt in lib/pricing.js).
    if (plan === 'plan' && session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      await stripe.subscriptions.update(subscription.id, {
        cancel_at: getSubscriptionCancelAt(subscription.billing_cycle_anchor),
      });
    }

    const amount = session.amount_total != null ? (session.amount_total / 100).toFixed(2) : 'unknown';
    const today = new Date().toISOString().slice(0, 10);
    await addNote(
      contactId,
      `OneTalk — ${date} registration (${today})`,
      [
        'Source: onetalkworkshop.com (Stripe Checkout)',
        `Date: ${date}`,
        `Tier: ${tier}`,
        `Plan: ${plan === 'plan' ? '2 payments' : 'pay in full'}`,
        `Amount charged today: $${amount}`,
        `Tag applied: ${tagId}`,
        `Email: ${email}`,
      ].join('\n'),
    );

    return res.status(200).json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] Failed to process session ${session.id}:`, message);
    return res.status(500).json({ error: 'Failed to process registration.' });
  }
}
