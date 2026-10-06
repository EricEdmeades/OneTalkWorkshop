// =============================================================================
// /api/subscribe-otw — Keap integration for the "5 Steps to Overcoming Stage
// Fright" lead-magnet opt-in.
// -----------------------------------------------------------------------------
// On submit we upsert the contact, apply KEAP_TAG_ID_STAGE_FRIGHT (default
// 1831) — which triggers the existing Keap automation that delivers the
// 5 Steps emails + worksheet — and add a contact-timeline note.
//
// We do NOT send emails ourselves — Keap's automation handles delivery once
// the tag is applied. Keap helpers live in lib/keap-contact.js; spam gates in
// lib/spam-gates.js (shared with api/sol-optin.js).
// =============================================================================
import { spamReason } from '../lib/spam-gates.js';
import { upsertContact, applyTag, addNote } from '../lib/keap-contact.js';

const TAG_ID = Number(process.env.KEAP_TAG_ID_STAGE_FRIGHT || 1831);
const OPT_IN_REASON = 'One Talk Workshop landing page — 5 Steps opt-in';

const trim = (value) => (typeof value === 'string' ? value.trim() : '');
const isValidEmail = (email) => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function validationError({ firstName, lastName, email }) {
  if (!firstName) return 'Please enter your first name.';
  if (!lastName) return 'Please enter your last name.';
  if (!isValidEmail(email)) return 'Please enter a valid email address.';
  return null;
}

// Contact exists but the tag did not apply, so the delivery automation will
// not fire — that must surface as a hard failure.
async function tagApplied(contactId) {
  try {
    await applyTag(contactId, TAG_ID);
    return true;
  } catch (tagErr) {
    console.error(`[subscribe-otw] Tag apply failed (contact ${contactId} tag ${TAG_ID}): ${tagErr?.message || tagErr}`);
    return false;
  }
}

function noteBody({ firstName, lastName, email }) {
  return [
    'Source: onetalkworkshop.com',
    'Form: 5 Steps to Overcoming Stage Fright',
    `Tag applied: ${TAG_ID}`,
    `Name: ${firstName} ${lastName}`,
    `Email: ${email}`,
  ].join('\n');
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

  const body = req.body || {};
  const spam = spamReason({
    origin: req.headers.origin || req.headers.referer || '',
    honeypot: trim(body.website),
    formStartedAt: body.formStartedAt,
  });
  if (spam) {
    console.warn(`[subscribe-otw] Blocked: ${spam}`);
    return res.status(200).json({ success: true });
  }

  const input = { firstName: trim(body.firstName), lastName: trim(body.lastName), email: trim(body.email).toLowerCase() };
  const invalid = validationError(input);
  if (invalid) return res.status(400).json({ success: false, error: invalid });

  try {
    const contactId = await upsertContact({ ...input, optInReason: OPT_IN_REASON });
    if (!(await tagApplied(contactId))) {
      return res.status(500).json({ success: false, error: 'Registration partially failed. Please contact support.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    await addNote(contactId, `OneTalk — 5 Steps opt-in (${today})`, noteBody(input));
    return res.status(200).json({ success: true, contactId });
  } catch (err) {
    console.error('[subscribe-otw]', err?.message || err);
    return res.status(500).json({ success: false, error: "We couldn't process your request. Please try again." });
  }
}
