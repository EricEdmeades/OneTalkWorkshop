// lib/spam-gates.js — anti-spam gates shared by the public form endpoints.
// Callers return a silent `200 {success:true}` when spamReason() is non-null,
// so a bot cannot tell a block from a real success.

// A real person cannot fill the form in under 3 seconds; bots that POST without
// sitting on the page trip this. Older than 24h is treated as a replay.
export const MIN_FORM_FILL_MS = 3000;
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

const ALLOWED_HOST_SUFFIXES = ['onetalkworkshop.com', 'onetalk.ericedmeades.com', '.vercel.app'];
const ALLOWED_HOSTS_EXACT = ['localhost', '127.0.0.1'];

export function isAllowedOrigin(originOrReferer) {
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

export function spamReason({ origin, honeypot, formStartedAt, now = Date.now() }) {
  if (!isAllowedOrigin(origin)) return 'origin';
  if (honeypot) return 'honeypot';
  const started = Number(formStartedAt);
  if (!Number.isFinite(started)) return 'timing';
  const elapsed = now - started;
  if (elapsed < MIN_FORM_FILL_MS || elapsed > MAX_FORM_AGE_MS) return 'timing';
  return null;
}
