import { describe, it, expect } from 'vitest';
import { makePending, parsePending, withFailure, isDead, MAX_ATTEMPTS, PENDING_VERSION } from './sol-pending.js';

const NOW = Date.UTC(2026, 9, 6, 14, 3);
const base = { email: 'jane@example.com', firstName: 'Jane', speakAbout: 'Nursing', ref: null, now: NOW };

describe('sol-pending', () => {
  it('makes a v1 record', () => {
    expect(makePending(base)).toEqual({
      version: PENDING_VERSION, email: 'jane@example.com', firstName: 'Jane', speakAbout: 'Nursing',
      ref: null, createdAt: '2026-10-06T14:03:00.000Z', attempts: 0, lastError: null,
    });
  });

  it('parses its own output', () => {
    const r = makePending(base);
    expect(parsePending(JSON.stringify(r))).toEqual(r);
  });

  it.each([null, '', 'not json', '{"version":2,"email":"a@b.co","firstName":"A"}', '{"version":1,"firstName":"A"}'])(
    'rejects %p', (t) => expect(parsePending(t)).toBeNull());

  it('withFailure increments without mutating and truncates the error', () => {
    const r = makePending(base);
    const next = withFailure(r, new Error('x'.repeat(900)));
    expect(next.attempts).toBe(1);
    expect(next.lastError).toHaveLength(500);
    expect(r.attempts).toBe(0);
  });

  it('isDead at MAX_ATTEMPTS', () => {
    expect(isDead({ ...makePending(base), attempts: MAX_ATTEMPTS - 1 })).toBe(false);
    expect(isDead({ ...makePending(base), attempts: MAX_ATTEMPTS })).toBe(true);
  });
});
