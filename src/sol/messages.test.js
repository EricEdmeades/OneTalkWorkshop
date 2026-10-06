import { describe, it, expect } from 'vitest';
import { resendFeedback, downloadState } from './messages.js';

describe('resendFeedback', () => {
  it('sent', () => expect(resendFeedback(200, { success: true })).toBe('Sent again. Give it a minute.'));
  it('uses server copy on 429', () => expect(resendFeedback(429, { error: "We've just sent it. Try again in a minute." }))
    .toBe("We've just sent it. Try again in a minute."));
  it('falls back on unknown failure', () => expect(resendFeedback(502, null))
    .toBe('Something went wrong on our side. Try again in a minute.'));
});

describe('downloadState', () => {
  it('token → download', () => expect(downloadState('?t=abc.def')).toEqual({ mode: 'download', t: 'abc.def' }));
  it('expired flag wins', () => expect(downloadState('?t=abc.def&expired=1')).toEqual({ mode: 'expired' }));
  it('no token → expired', () => expect(downloadState('')).toEqual({ mode: 'expired' }));
  it('error flag keeps token for retry', () => expect(downloadState('?error=1&t=abc')).toEqual({ mode: 'error', t: 'abc' }));
});
