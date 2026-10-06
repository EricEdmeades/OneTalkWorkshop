// /api/sol-resend — re-sends the Said Out Loud email to someone who already
// opted in (thank-you page button, expired-link form). Unknown addresses get a
// silent success so this cannot be used to mail strangers or probe the list.
import { isAllowedOrigin } from '../lib/spam-gates.js';
import { isBotRequest } from '../lib/sol-bot.js';
import { normaliseEmail, isValidEmail } from '../lib/sol-validate.js';
import { checkRate } from '../lib/sol-ratelimit.js';
import { readOptin, readRate } from '../lib/sol-store.js';
import { missingConfig, sendDelivery, recordSend } from '../lib/sol-service.js';

const RETRY_COPY = 'Something went wrong on our side. Try again in a minute.';
const LIMIT_COPY = {
  too_soon: "We've just sent it. Try again in a minute.",
  daily_cap: "We've sent it a few times now. Write to support@speakernation.com and we'll sort it out.",
};

async function resendTo(email, res) {
  const optin = await readOptin(email);
  if (!optin) return res.status(200).json({ success: true });
  const now = Date.now();
  const rate = checkRate(await readRate(email), now);
  if (!rate.allowed) return res.status(429).json({ success: false, reason: rate.reason, error: LIMIT_COPY[rate.reason] });
  await sendDelivery({ email, firstName: optin.firstName, now });
  await recordSend(email, optin.firstName, rate.recent, now, { withOptin: false });
  return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  // Resends never touch Keap, so Keap config must not be able to break them.
  const missing = missingConfig(['RESEND_API_KEY', 'SOL_LINK_SECRET']);
  if (missing.length) {
    console.error(`[sol-resend] Missing config: ${missing.join(', ')}`);
    return res.status(500).json({ success: false, error: RETRY_COPY });
  }
  if (!isAllowedOrigin(req.headers.origin || req.headers.referer || '') || (await isBotRequest(req))) {
    console.warn('[sol-resend] Blocked: origin or BotID');
    return res.status(200).json({ success: true });
  }
  const email = normaliseEmail(req.body?.email);
  if (!isValidEmail(email)) return res.status(400).json({ success: false, error: 'We need a valid email to send the book.' });
  try {
    return await resendTo(email, res);
  } catch (err) {
    console.error(`[sol-resend] Failed: ${err?.message || err}`);
    return res.status(502).json({ success: false, error: RETRY_COPY });
  }
}
