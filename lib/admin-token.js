// lib/admin-token.js — the anti-CSRF token for destructive admin actions.
//
// Why this exists rather than an Origin check alone: the first version of the
// delete guard trusted the Origin/Referer headers and refused a legitimate
// click. /results sends `Referrer-Policy: no-referrer`, which strips Referer,
// and Safari omits Origin on a same-origin form POST — so an ordinary delete
// arrived with neither header and was rejected.
//
// A token in the form does not depend on browser header behaviour. It is
// derived from the admin password, so it can only be obtained by loading a
// page that required that password: another site can make your browser POST
// here (Basic auth credentials ride along automatically) but it cannot READ
// the submissions page to learn the token, because cross-origin reads are
// blocked by the same-origin policy regardless of credentials.

import crypto from 'node:crypto';

const PURPOSE = 'otw-admin-action-v1';

export function actionToken(secret) {
  if (!secret) throw new Error('actionToken requires the admin secret');
  return crypto.createHmac('sha256', String(secret)).update(PURPOSE).digest('hex');
}

// Constant-time comparison over fixed-width digests: timingSafeEqual throws on
// a length mismatch, and the length of a rejected guess is itself a small leak.
export function tokenMatches(provided, secret) {
  if (typeof provided !== 'string' || !provided) return false;
  const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
  return crypto.timingSafeEqual(digest(provided), digest(actionToken(secret)));
}
