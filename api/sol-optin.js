// /api/sol-optin — Said Out Loud ebook opt-in.
// Order: spam gates + BotID → validate → rate check → Resend delivery email →
// Blob bookkeeping → respond, with the Keap write (or its queueing for
// api/sol-sync-keap.js) finishing in waitUntil so the visitor never waits on
// Keap. Keap never sends the delivery email; it only stores contact, tag, note.
import { waitUntil } from '@vercel/functions';
import { spamReason } from '../lib/spam-gates.js';
import { isBotRequest } from '../lib/sol-bot.js';
import { validateOptin } from '../lib/sol-validate.js';
import { checkRate } from '../lib/sol-ratelimit.js';
import { readRate } from '../lib/sol-store.js';
import { missingConfig, sendDelivery, recordSend, syncOrQueue } from '../lib/sol-service.js';

const RETRY_COPY = 'Something went wrong on our side. Try again in a minute.';
const trim = (v) => (typeof v === 'string' ? v.trim() : '');

// null = the read failed. The send still goes ahead (fail open), but the
// history is then left untouched rather than overwritten with just this send.
async function loadHistory(email) {
  try {
    return await readRate(email);
  } catch (err) {
    console.error(`[sol-optin] Rate read failed, allowing send: ${err?.message || err}`);
    return null;
  }
}

async function blockedReason(req, body) {
  const spam = spamReason({ origin: req.headers.origin || req.headers.referer || '', honeypot: trim(body.website), formStartedAt: body.formStartedAt });
  if (spam) return spam;
  return (await isBotRequest(req)) ? 'botid' : null;
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
  const blocked = await blockedReason(req, body);
  if (blocked) {
    console.warn(`[sol-optin] Blocked: ${blocked}`);
    return res.status(200).json({ success: true });
  }

  const v = validateOptin(body);
  if (!v.ok) return res.status(400).json({ success: false, field: v.field, error: v.error });
  const { firstName, email, speakAbout } = v.value;
  const now = Date.now();

  const history = await loadHistory(email);
  const rate = checkRate(history ?? [], now);
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

  await recordSend(email, firstName, rate.recent, now, { withOptin: true, skipRate: history === null });
  waitUntil(syncOrQueue({ email, firstName, speakAbout, ref: trim(body.ref).slice(0, 100) || null, now }));
  return res.status(200).json({ success: true });
}
