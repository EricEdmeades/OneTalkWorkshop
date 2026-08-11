// lib/email-hash.js — one-way email hash for cross-channel de-dup. Same idea as
// the survey respondent hash: an email is read only in the IO layer, reduced to
// this opaque digest, and the raw value never travels further. Two records for
// the same person hash identically (case/whitespace-normalised), so a buyer who
// appears in both the Stripe and Keap channels can be matched without any
// identifier reaching aggregation or render.
import crypto from 'node:crypto';

export function emailHash(email) {
  if (typeof email !== 'string') return null;
  const normalised = email.trim().toLowerCase();
  if (!normalised) return null;
  return crypto.createHash('sha256').update(normalised).digest('hex');
}
