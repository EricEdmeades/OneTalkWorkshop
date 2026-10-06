import { describe, it, expect } from 'vitest';
import { isAllowedOrigin, spamReason, MIN_FORM_FILL_MS, MAX_FORM_AGE_MS } from './spam-gates.js';

describe('isAllowedOrigin', () => {
  it.each([
    'https://onetalkworkshop.com/said-out-loud',
    'https://onetalk.ericedmeades.com',
    'https://otw-git-feature.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
  ])('allows %s', (o) => expect(isAllowedOrigin(o)).toBe(true));

  it.each(['', 'not a url', 'https://evil.example', 'https://onetalkworkshop.com.evil.example', 'https://vercel.app.evil.example'])(
    'rejects %s', (o) => expect(isAllowedOrigin(o)).toBe(false));
});

describe('spamReason', () => {
  const now = 1_000_000_000;
  const ok = { origin: 'https://onetalkworkshop.com', honeypot: '', formStartedAt: now - 10_000, now };

  it('returns null for a clean submission', () => expect(spamReason(ok)).toBeNull());
  it('checks origin first', () => expect(spamReason({ ...ok, origin: 'https://x.example', honeypot: 'y' })).toBe('origin'));
  it('flags honeypot', () => expect(spamReason({ ...ok, honeypot: 'filled' })).toBe('honeypot'));
  it('flags non-numeric timestamp', () => expect(spamReason({ ...ok, formStartedAt: 'x' })).toBe('timing'));
  it('flags too-fast fill', () => expect(spamReason({ ...ok, formStartedAt: now - MIN_FORM_FILL_MS + 1 })).toBe('timing'));
  it('flags stale form', () => expect(spamReason({ ...ok, formStartedAt: now - MAX_FORM_AGE_MS - 1 })).toBe('timing'));
  it('accepts exactly the minimum', () => expect(spamReason({ ...ok, formStartedAt: now - MIN_FORM_FILL_MS })).toBeNull());
});
