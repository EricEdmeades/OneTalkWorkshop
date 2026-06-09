// =============================================================================
// /api/subscribe-otw — Keap integration for the "5 Steps to Overcoming Stage
// Fright" lead-magnet opt-in.
// -----------------------------------------------------------------------------
// On submit we:
//   1. Look up the contact in Keap by email
//   2. Create the contact if new, PATCH if existing
//   3. Apply tag KEAP_TAG_ID_STAGE_FRIGHT (default 1831) — triggers the
//      existing Keap automation that delivers the 5 Steps emails + worksheet
//   4. Add a contact-timeline note with the submission source
//
// We do NOT send emails ourselves — Keap's automation handles delivery once
// the tag is applied.
//
// Auth pattern mirrors ericedmeades.com's /lib/keap.ts (X-Keap-API-Key header,
// same base URL). Credentials share KEAP_API_KEY — one Keap account.
// =============================================================================

const KEAP_BASE_V1 = 'https://api.infusionsoft.com/crm/rest/v1';
const KEAP_BASE_V2 = 'https://api.infusionsoft.com/crm/rest/v2';
const TAG_ID = Number(process.env.KEAP_TAG_ID_STAGE_FRIGHT || 1831);

// Anti-spam: minimum elapsed time between form render and submission. A real
// user cannot fill three fields in under 3 seconds; bots that POST directly
// without sitting on the page will trip this.
const MIN_FORM_FILL_MS = 3000;
// Reject submissions whose timestamp is older than 24h — likely replayed.
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

const ALLOWED_HOST_SUFFIXES = ['onetalkworkshop.com', 'onetalk.ericedmeades.com', '.vercel.app'];
const ALLOWED_HOSTS_EXACT = ['localhost', '127.0.0.1'];

function isAllowedOrigin(originOrReferer) {
  if (!originOrReferer) return false;
  let host;
  try {
    host = new URL(originOrReferer).hostname;
  } catch (_) {
    return false;
  }
  if (ALLOWED_HOSTS_EXACT.includes(host)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix,
  );
}

function keapHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Keap-API-Key': process.env.KEAP_API_KEY,
  };
}

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
      opt_in_reason: 'One Talk Workshop landing page — 5 Steps opt-in',
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

// Keap returns HTTP 200 even when a tag ID is unknown, signaling per-tag
// failure inside the response body (e.g. {"1831":"TAG_ID_NOT_FOUND"}).
// A bare res.ok check is insufficient — we must inspect the body too.
function isTagFailureValue(v) {
  if (v == null) return false;
  if (typeof v !== 'string') return false; // success metadata is an object
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
    throw new Error(
      `Keap tag apply HTTP ${res.status} for contact ${contactId} tag ${tagId}: ${text}`,
    );
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
    throw new Error(
      `Keap tag apply rejected for contact ${contactId} tag(s) [${failedIds}]: ${JSON.stringify(body)}`,
    );
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
    // Note failure should not fail the whole submission — log and continue.
    console.error(`[subscribe-otw] Note add failed: ${res.status} ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!process.env.KEAP_API_KEY) {
    console.error('[subscribe-otw] KEAP_API_KEY is not set');
    return res.status(500).json({ success: false, error: 'Server is not configured.' });
  }

  // Vercel auto-parses JSON bodies when Content-Type: application/json
  const body = req.body || {};
  const firstName = trim(body.firstName);
  const lastName = trim(body.lastName);
  const email = trim(body.email).toLowerCase();
  const honeypot = trim(body.website);
  const formStartedAt = Number(body.formStartedAt);

  // -- Anti-spam gates (return silent success so bots think they got through) -
  const origin = req.headers.origin || req.headers.referer || '';
  if (!isAllowedOrigin(origin)) {
    console.warn(`[subscribe-otw] Blocked: bad origin "${origin}"`);
    return res.status(200).json({ success: true });
  }
  if (honeypot) {
    console.warn(`[subscribe-otw] Blocked: honeypot filled ("${honeypot}")`);
    return res.status(200).json({ success: true });
  }
  if (!Number.isFinite(formStartedAt)) {
    console.warn('[subscribe-otw] Blocked: missing/invalid formStartedAt');
    return res.status(200).json({ success: true });
  }
  const elapsed = Date.now() - formStartedAt;
  if (elapsed < MIN_FORM_FILL_MS || elapsed > MAX_FORM_AGE_MS) {
    console.warn(`[subscribe-otw] Blocked: form age ${elapsed}ms out of range`);
    return res.status(200).json({ success: true });
  }
  // ---------------------------------------------------------------------------

  if (!firstName) {
    return res.status(400).json({ success: false, error: 'Please enter your first name.' });
  }
  if (!lastName) {
    return res.status(400).json({ success: false, error: 'Please enter your last name.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }

  try {
    const existing = await findContactByEmail(email);
    let contactId;
    if (existing) {
      contactId = existing.id;
      await updateContact(contactId, { firstName, lastName, email });
    } else {
      contactId = await createContact({ firstName, lastName, email });
    }

    try {
      await applyTag(contactId, TAG_ID);
    } catch (tagErr) {
      const message = tagErr instanceof Error ? tagErr.message : String(tagErr);
      // Contact has been created/updated but the tag did not apply, which
      // means the email automation will not fire — surface as a hard failure.
      console.error(
        `[subscribe-otw] Tag apply failed (contact ${contactId} tag ${TAG_ID}): ${message}`,
      );
      return res.status(500).json({
        success: false,
        error: 'Registration partially failed. Please contact support.',
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    await addNote(
      contactId,
      `OneTalk — 5 Steps opt-in (${today})`,
      [
        'Source: onetalkworkshop.com',
        'Form: 5 Steps to Overcoming Stage Fright',
        `Tag applied: ${TAG_ID}`,
        `Name: ${firstName} ${lastName}`,
        `Email: ${email}`,
      ].join('\n'),
    );

    return res.status(200).json({ success: true, contactId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[subscribe-otw]', message);
    return res.status(500).json({
      success: false,
      error: "We couldn't process your request. Please try again.",
    });
  }
}
