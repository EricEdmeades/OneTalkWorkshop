// /api/sol-optin — Said Out Loud ebook opt-in.
// Order: spam gates → validate → rate check → Resend delivery email → Blob
// bookkeeping → Keap (or queue for api/sol-sync-keap.js). Keap never sends the
// delivery email; it only stores the contact, tag and note.
import { spamReason } from '../lib/spam-gates.js';
import { validateOptin } from '../lib/sol-validate.js';
import { checkRate } from '../lib/sol-ratelimit.js';
import { readRate } from '../lib/sol-store.js';
import { missingConfig, sendDelivery, recordSend, syncOrQueue } from '../lib/sol-service.js';

const RETRY_COPY = 'Something went wrong on our side. Try again in a minute.';
const trim = (v) => (typeof v === 'string' ? v.trim() : '');

async function loadHistory(email) {
  try {
    return await readRate(email);
  } catch (err) {
    // Fail open: a Blob outage must not stop someone getting the book.
    console.error(`[sol-optin] Rate read failed, allowing send: ${err?.message || err}`);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const missing = missingConfig();
  if (missing.length) {
    console.error(`[sol-optin] Missing config: ${missing.join(', ')}`);
    return res.status(500).json({ success: false, error: RETRY_COPY });
  }

  const body = req.body || {};
  const spam = spamReason({ origin: req.headers.origin || req.headers.referer || '', honeypot: trim(body.website), formStartedAt: body.formStartedAt });
  if (spam) {
    console.warn(`[sol-optin] Blocked: ${spam}`);
    return res.status(200).json({ success: true });
  }

  const v = validateOptin(body);
  if (!v.ok) return res.status(400).json({ success: false, field: v.field, error: v.error });
  const { firstName, email, speakAbout } = v.value;
  const now = Date.now();

  const rate = checkRate(await loadHistory(email), now);
  if (!rate.allowed) {
    console.warn(`[sol-optin] Rate-limited (${rate.reason}); not resending`);
    return res.status(200).json({ success: true });
  }

  try {
    await sendDelivery({ email, firstName, now });
  } catch (err) {
    console.error(`[sol-optin] Delivery email failed: ${err?.message || err}`);
    return res.status(502).json({ success: false, error: RETRY_COPY });
  }

  await recordSend(email, firstName, rate.recent, now, { withOptin: true });
  await syncOrQueue({ email, firstName, speakAbout, ref: trim(body.ref).slice(0, 100) || null, now });
  return res.status(200).json({ success: true });
}
