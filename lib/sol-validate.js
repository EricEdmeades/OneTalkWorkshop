// lib/sol-validate.js — validation and normalisation for the Said Out Loud form.
// Email is normalised once here so the token, Blob keys, rate limit and Keap
// all see the same value.

export const LIMITS = Object.freeze({ firstName: 100, email: 254, speakAbout: 500 });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

export function normaliseEmail(value) {
  return clean(value).toLowerCase();
}

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= LIMITS.email && EMAIL_RE.test(email);
}

const fail = (field, error) => ({ ok: false, field, error });

export function validateOptin(body) {
  const firstName = clean(body?.firstName);
  const email = normaliseEmail(body?.email);
  const speakAbout = clean(body?.speakAbout);
  if (!firstName) return fail('firstName', 'Please enter your first name.');
  if (firstName.length > LIMITS.firstName) return fail('firstName', 'That name is too long.');
  if (!isValidEmail(email)) return fail('email', 'We need a valid email to send the book.');
  if (speakAbout.length > LIMITS.speakAbout) return fail('speakAbout', 'Please keep this under 500 characters.');
  return { ok: true, value: { firstName, email, speakAbout } };
}
