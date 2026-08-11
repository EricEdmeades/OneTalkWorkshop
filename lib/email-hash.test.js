import { describe, it, expect } from 'vitest';
import { emailHash } from './email-hash.js';

describe('emailHash', () => {
  it('is stable and normalises case and surrounding whitespace', () => {
    const a = emailHash('Gail@Example.COM');
    const b = emailHash('  gail@example.com  ');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes different emails', () => {
    expect(emailHash('a@x.com')).not.toBe(emailHash('b@x.com'));
  });

  it('returns null for empty or non-string input', () => {
    expect(emailHash('')).toBeNull();
    expect(emailHash('   ')).toBeNull();
    expect(emailHash(null)).toBeNull();
    expect(emailHash(undefined)).toBeNull();
    expect(emailHash(42)).toBeNull();
  });
});
