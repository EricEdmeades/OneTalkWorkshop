// lib/sol-token.js — the signed download link for the Said Out Loud ebook.
// Stateless: the email and expiry ride in the token and an HMAC proves we
// issued it. Nothing to store, nothing to look up on download.
import crypto from 'node:crypto';

export const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function requireSecret(secret) {
  if (!secret) throw new Error('SOL_LINK_SECRET is required');
}

function mac(payload, secret) {
  return crypto.createHmac('sha256', String(secret)).update(payload).digest('base64url');
}

export function signToken({ email, exp }, secret) {
  requireSecret(secret);
  const payload = Buffer.from(JSON.stringify({ e: email, x: exp })).toString('base64url');
  return `${payload}.${mac(payload, secret)}`;
}

// Constant-time over equal-length buffers; a length mismatch is rejected first
// (the expected length is fixed and public, so that check leaks nothing).
function signatureMatches(payload, sig, secret) {
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(sig);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function decode(payload) {
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data?.e !== 'string' || !Number.isFinite(data?.x)) return null;
    return { email: data.e, exp: data.x };
  } catch (_) {
    return null;
  }
}

export function verifyToken(token, secret, now = Date.now()) {
  requireSecret(secret);
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!signatureMatches(parts[0], parts[1], secret)) return null;
  const data = decode(parts[0]);
  if (!data || data.exp <= now) return null;
  return data;
}
