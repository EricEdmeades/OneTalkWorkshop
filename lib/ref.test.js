import { describe, it, expect } from 'vitest';
import { sanitizeRef } from './ref.js';

describe('sanitizeRef', () => {
  it('returns a clean code unchanged', () => {
    expect(sanitizeRef('Karms')).toBe('Karms');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeRef('  Brian  ')).toBe('Brian');
  });

  it('strips disallowed characters', () => {
    expect(sanitizeRef('Fran<script>')).toBe('Franscript');
  });

  it('keeps url-safe punctuation (dot, dash, underscore)', () => {
    expect(sanitizeRef('a.b-c_d')).toBe('a.b-c_d');
  });

  it('caps length at 50 characters', () => {
    const long = 'x'.repeat(80);
    expect(sanitizeRef(long)).toHaveLength(50);
  });

  it('returns empty string for null / undefined / empty', () => {
    expect(sanitizeRef(null)).toBe('');
    expect(sanitizeRef(undefined)).toBe('');
    expect(sanitizeRef('')).toBe('');
  });

  it('returns empty string when only disallowed characters remain', () => {
    expect(sanitizeRef('   $$$   ')).toBe('');
  });

  it('returns empty string for a non-string input', () => {
    expect(sanitizeRef(42)).toBe('');
  });
});
