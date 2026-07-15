// lib/ref.js — pure sanitizer for the affiliate/source `?ref=` value.
// Mirrors S3-LMS's src/lib/ref.ts sanitize(): trim, cap length, and strip
// to URL-safe identifier characters so junk never lands in Stripe metadata.
// No Stripe/env access here so it stays trivially unit-testable.

const MAX_REF_LENGTH = 50;

export function sanitizeRef(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().slice(0, MAX_REF_LENGTH);
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '');
}
