// lib/keap-contact.js — Keap contact writes shared by the lead-magnet endpoints
// (api/subscribe-otw.js, api/sol-optin.js, api/sol-sync-keap.js).
//
// Every request carries a 12s timeout and none retries in place: Keap's
// 240 req/min limit is one bucket shared by every integration on the account
// (see CLAUDE.md), so an in-request retry only deepens a throttle. A 429 or a
// hang surfaces as KeapThrottleError / KeapTimeoutError (both `.retryable`),
// letting callers queue the work instead.
import { KeapThrottleError, KeapTimeoutError } from './keap-api.js';

const KEAP_BASE_V1 = 'https://api.infusionsoft.com/crm/rest/v1';
const KEAP_BASE_V2 = 'https://api.infusionsoft.com/crm/rest/v2';
const REQUEST_TIMEOUT_MS = 12_000;

function keapHeaders() {
  return { 'Content-Type': 'application/json', 'X-Keap-API-Key': process.env.KEAP_API_KEY };
}

async function keapRequest(url, { method = 'GET', body, what }) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: keapHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new KeapTimeoutError(what);
    throw err;
  }
  if (res.status === 429) throw new KeapThrottleError(what);
  return res;
}

export async function findContactByEmail(email) {
  const url = `${KEAP_BASE_V1}/contacts?email=${encodeURIComponent(email)}`;
  const res = await keapRequest(url, { what: 'contact search' });
  if (!res.ok) throw new Error(`Keap search failed: ${res.status}`);
  const data = await res.json();
  return (data.contacts && data.contacts[0]) || null;
}

export async function createContact({ firstName, lastName, email, optInReason }) {
  const res = await keapRequest(`${KEAP_BASE_V1}/contacts`, {
    method: 'POST',
    what: 'contact create',
    body: {
      given_name: firstName,
      family_name: lastName,
      email_addresses: [{ email, field: 'EMAIL1' }],
      opt_in_reason: optInReason,
    },
  });
  if (!res.ok) throw new Error(`Keap create failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

export async function updateContact(contactId, { firstName, lastName, email }) {
  const res = await keapRequest(`${KEAP_BASE_V1}/contacts/${contactId}`, {
    method: 'PATCH',
    what: 'contact update',
    body: { given_name: firstName, family_name: lastName, email_addresses: [{ email, field: 'EMAIL1' }] },
  });
  if (!res.ok) throw new Error(`Keap update failed: ${res.status} ${await res.text()}`);
}

export async function upsertContact({ firstName, lastName, email, optInReason }) {
  const existing = await findContactByEmail(email);
  if (!existing) return createContact({ firstName, lastName, email, optInReason });
  await updateContact(existing.id, { firstName, lastName, email });
  return existing.id;
}

// For public forms: an unverified submission must never rename an existing
// contact (anyone can type anyone else's email), so an existing contact is
// returned untouched and only new contacts get the submitted name.
export async function findOrCreateContact({ firstName, lastName, email, optInReason }) {
  const existing = await findContactByEmail(email);
  return existing ? existing.id : createContact({ firstName, lastName, email, optInReason });
}

// Keap returns HTTP 200 even when a tag ID is unknown, signalling per-tag
// failure inside the body (e.g. {"1831":"TAG_ID_NOT_FOUND"}). Success values
// are objects; failure values are strings.
function isTagFailureValue(v) {
  if (typeof v !== 'string') return false;
  const upper = v.toUpperCase();
  return upper.includes('ERROR') || upper.includes('NOT_FOUND');
}

export async function applyTag(contactId, tagId) {
  const res = await keapRequest(`${KEAP_BASE_V1}/contacts/${contactId}/tags`, {
    method: 'POST',
    what: 'tag apply',
    body: { tagIds: [tagId] },
  });
  if (!res.ok) {
    throw new Error(`Keap tag apply HTTP ${res.status} for contact ${contactId} tag ${tagId}: ${await res.text()}`);
  }
  const body = await res.json().catch(() => ({}));
  const failedIds = Object.entries(body).filter(([, v]) => isTagFailureValue(v)).map(([id]) => id);
  if (failedIds.length > 0) {
    throw new Error(
      `Keap tag apply rejected for contact ${contactId} tag(s) [${failedIds.join(', ')}]: ${JSON.stringify(body)}`,
    );
  }
}

// A missing note must never fail a submission whose tag already applied, so
// this logs and returns false instead of throwing — timeouts included.
export async function addNote(contactId, title, text) {
  try {
    const res = await keapRequest(`${KEAP_BASE_V2}/contacts/${contactId}/notes`, {
      method: 'POST',
      what: 'note add',
      body: { title, text },
    });
    if (res.ok) return true;
    console.error(`[keap-contact] Note add failed for contact ${contactId}: ${res.status} ${await res.text()}`);
    return false;
  } catch (err) {
    console.error(`[keap-contact] Note add failed for contact ${contactId}: ${err?.message || err}`);
    return false;
  }
}
