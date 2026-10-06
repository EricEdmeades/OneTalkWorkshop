// lib/sol-service.js — steps shared by the Said Out Loud email endpoints.
// Order matters: the delivery email goes first (the visitor is waiting), then
// Blob bookkeeping and Keap, neither of which may fail a request whose email
// already went out.
import { isBlobConfigured } from './keap-store.js';
import { emailHash } from './email-hash.js';
import { signToken, LINK_TTL_MS } from './sol-token.js';
import { buildDeliveryEmail } from './sol-email.js';
import { sendEmail } from './sol-resend-client.js';
import { recordSend as appendSend } from './sol-ratelimit.js';
import { writeRate, writeOptin, writePending } from './sol-store.js';
import { makePending } from './sol-pending.js';
import { syncContactToKeap } from './sol-keap.js';

export const REQUIRED_ENV = ['RESEND_API_KEY', 'SOL_LINK_SECRET', 'KEAP_API_KEY', 'KEAP_TAG_ID_SAID_OUT_LOUD'];

export function missingConfig(names = REQUIRED_ENV) {
  const missing = names.filter((n) => !process.env[n]);
  return isBlobConfigured() ? missing : [...missing, 'BLOB'];
}

export function publicBaseUrl(env = process.env) {
  if (env.SOL_PUBLIC_BASE_URL) return env.SOL_PUBLIC_BASE_URL.replace(/\/+$/, '');
  if (env.VERCEL_ENV === 'production') return 'https://onetalkworkshop.com';
  if (env.VERCEL_BRANCH_URL) return `https://${env.VERCEL_BRANCH_URL}`;
  return 'http://localhost:3000';
}

export function downloadLink(email, now) {
  const t = signToken({ email, exp: now + LINK_TTL_MS }, process.env.SOL_LINK_SECRET);
  return `${publicBaseUrl()}/said-out-loud/download?t=${encodeURIComponent(t)}`;
}

export async function sendDelivery({ email, firstName, now }) {
  const { subject, html, text } = buildDeliveryEmail({ firstName, link: downloadLink(email, now) });
  await sendEmail({ to: email, subject, html, text, idempotencyKey: `sol-${emailHash(email)}-${Math.floor(now / 60_000)}` });
}

export async function recordSend(email, firstName, recent, now, { withOptin, skipRate = false }) {
  try {
    if (!skipRate) await writeRate(email, appendSend(recent, now));
    if (withOptin) await writeOptin(email, { firstName, now });
  } catch (err) {
    console.error(`[sol] Blob bookkeeping failed after a successful send: ${err?.message || err}`);
  }
}

export async function syncOrQueue({ email, firstName, speakAbout, ref, now }) {
  const record = makePending({ email, firstName, speakAbout, ref, now });
  try {
    await syncContactToKeap(record, Number(process.env.KEAP_TAG_ID_SAID_OUT_LOUD));
    return 'synced';
  } catch (err) {
    console.error(`[sol] Keap sync failed, queueing for retry: ${err?.message || err}`);
  }
  try {
    await writePending(record);
    return 'queued';
  } catch (err) {
    console.error(`[sol] LOST Keap write for opt-in at ${record.createdAt}: queue write failed: ${err?.message || err}`);
    return 'lost';
  }
}
