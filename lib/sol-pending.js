// lib/sol-pending.js — a Keap write that could not happen at opt-in time
// (throttle, timeout, Keap error). Stored privately in Blob by lib/sol-store.js
// and drained by api/sol-sync-keap.js. Versioned so a shape change degrades to
// "skip this record" instead of writing garbage into Keap.

export const PENDING_VERSION = 1;
export const MAX_ATTEMPTS = 20;
const MAX_ERROR_CHARS = 500;

export function makePending({ email, firstName, speakAbout, ref, now }) {
  return {
    version: PENDING_VERSION,
    email,
    firstName,
    speakAbout: speakAbout || '',
    ref: ref || null,
    createdAt: new Date(now).toISOString(),
    attempts: 0,
    lastError: null,
  };
}

export function parsePending(text) {
  if (!text) return null;
  try {
    const r = JSON.parse(text);
    if (r?.version !== PENDING_VERSION) return null;
    if (typeof r.email !== 'string' || typeof r.firstName !== 'string') return null;
    return r;
  } catch (_) {
    return null;
  }
}

export function withFailure(record, err) {
  const message = String(err?.message || err).slice(0, MAX_ERROR_CHARS);
  return { ...record, attempts: record.attempts + 1, lastError: message };
}

export function isDead(record) {
  return record.attempts >= MAX_ATTEMPTS;
}
