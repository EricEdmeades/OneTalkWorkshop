// lib/sol-resend-client.js — sends one email through the Resend REST API with
// fetch (no SDK dependency). speakernation.com is the verified sending domain on
// the Speaker Nation Resend account.

export const FROM = 'Speaker Nation <support@speakernation.com>';
export const REPLY_TO = 'support@speakernation.com';
const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

export class ResendError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResendError';
  }
}

function headers(apiKey, idempotencyKey) {
  const base = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  return idempotencyKey ? { ...base, 'Idempotency-Key': idempotencyKey } : base;
}

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new ResendError('RESEND_API_KEY is not set');
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: headers(apiKey, idempotencyKey),
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ResendError(`Resend request failed: ${err?.name || 'Error'} ${err?.message || ''}`.trim());
  }
  if (!res.ok) throw new ResendError(`Resend ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}
