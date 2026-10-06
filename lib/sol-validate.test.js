import { describe, it, expect } from 'vitest';
import { validateOptin, isValidEmail, normaliseEmail, LIMITS } from './sol-validate.js';

describe('sol-validate', () => {
  it('normalises email (Review Focus #3)', () => {
    expect(normaliseEmail('  Jane@Example.COM ')).toBe('jane@example.com');
    expect(normaliseEmail(undefined)).toBe('');
  });

  it('accepts a full valid submission and trims everything', () => {
    expect(validateOptin({ firstName: ' Jane ', email: ' Jane@Example.com ', speakAbout: ' Nursing leadership ' }))
      .toEqual({ ok: true, value: { firstName: 'Jane', email: 'jane@example.com', speakAbout: 'Nursing leadership' } });
  });

  it('treats speakAbout as optional', () => {
    expect(validateOptin({ firstName: 'J', email: 'j@x.co' }).value.speakAbout).toBe('');
  });

  it('requires a first name', () => {
    expect(validateOptin({ firstName: '  ', email: 'j@x.co' }))
      .toEqual({ ok: false, field: 'firstName', error: 'Please enter your first name.' });
  });

  it('caps the first name', () => {
    expect(validateOptin({ firstName: 'x'.repeat(LIMITS.firstName + 1), email: 'j@x.co' }).field).toBe('firstName');
  });

  it.each(['', 'nope', 'a@b', 'a b@c.co', `${'x'.repeat(250)}@x.co`])('rejects email %p with the spec copy', (email) => {
    expect(validateOptin({ firstName: 'J', email }))
      .toEqual({ ok: false, field: 'email', error: 'We need a valid email to send the book.' });
  });

  it('caps speakAbout at 500', () => {
    expect(validateOptin({ firstName: 'J', email: 'j@x.co', speakAbout: 'x'.repeat(501) }))
      .toEqual({ ok: false, field: 'speakAbout', error: 'Please keep this under 500 characters.' });
  });

  it('ignores non-string fields and a null body', () => {
    expect(validateOptin({ firstName: ['J'], email: 'j@x.co' }).ok).toBe(false);
    expect(validateOptin(null).ok).toBe(false);
  });

  it('isValidEmail', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
  });
});
