import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { signToken, verifyToken, LINK_TTL_MS } from './sol-token.js';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const NOW = 1_800_000_000_000;

describe('sol-token', () => {
  it('round-trips email and expiry', () => {
    const t = signToken({ email: 'jane@example.com', exp: NOW + LINK_TTL_MS }, SECRET);
    expect(verifyToken(t, SECRET, NOW)).toEqual({ email: 'jane@example.com', exp: NOW + LINK_TTL_MS });
  });

  it('is URL-safe', () => {
    const t = signToken({ email: 'a+b@example.com', exp: NOW + 1 }, SECRET);
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('rejects an expired token (exp equal to now counts as expired)', () => {
    const t = signToken({ email: 'a@b.co', exp: NOW }, SECRET);
    expect(verifyToken(t, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const t = signToken({ email: 'a@b.co', exp: NOW + 1000 }, SECRET);
    const [, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ e: 'x@y.co', x: NOW + 1000 })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('rejects the wrong secret', () => {
    const t = signToken({ email: 'a@b.co', exp: NOW + 1000 }, SECRET);
    expect(verifyToken(t, 'other-secret', NOW)).toBeNull();
  });

  it.each([undefined, null, 42, '', 'abc', 'a.b.c', '.', 'abc.'])('rejects malformed %p', (bad) => {
    expect(verifyToken(bad, SECRET, NOW)).toBeNull();
  });

  it('rejects a token with trailing characters (email-client mangling)', () => {
    const t = signToken({ email: 'a@b.co', exp: NOW + 1000 }, SECRET);
    expect(verifyToken(`${t}.`, SECRET, NOW)).toBeNull();
    expect(verifyToken(`${t}x`, SECRET, NOW)).toBeNull();
  });

  it('rejects a validly signed payload of the wrong shape', () => {
    const payload = Buffer.from(JSON.stringify({ e: 5, x: 'soon' })).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(verifyToken(`${payload}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('throws without a secret', () => {
    expect(() => signToken({ email: 'a@b.co', exp: 1 }, '')).toThrow('SOL_LINK_SECRET is required');
    expect(() => verifyToken('a.b', undefined)).toThrow('SOL_LINK_SECRET is required');
  });
});
