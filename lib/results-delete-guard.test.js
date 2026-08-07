// The delete path on /results/submissions, exercised through the handler.
//
// Basic auth credentials are attached by the browser automatically, including
// on a form post from another site. So "is the operator logged in" is NOT the
// control that stops a cross-site delete — a hidden token the attacker cannot
// read is (lib/admin-token.js). This suite drives the handler directly to
// prove that an authenticated POST without a valid token deletes nothing, and
// that a valid one still works when the browser sends no origin headers at
// all — which is what an ordinary Safari click looks like here.
//
// It lives in lib/ rather than api/ on purpose: Vercel turns every .js file
// under api/ into a deployed endpoint, test files included.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { actionToken } from './admin-token.js';

let handler;

const USER = 'admin';
const PASSWORD = 'correct-horse';
const AUTH = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;

beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.RESULTS_USER = USER;
  process.env.RESULTS_PASSWORD = PASSWORD;
  // Unset so the page load after a delete short-circuits instead of calling
  // Airtable — these tests are about the guard, not the table read.
  delete process.env.AIRTABLE_PAT;
  ({ default: handler } = await import('../api/results.js'));
});

function mockRes() {
  return {
    statusCode: null,
    body: '',
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
  };
}

const TOKEN = actionToken(PASSWORD);

const post = (headers, body) => ({
  method: 'POST',
  query: { view: 'submissions' },
  headers: { authorization: AUTH, ...headers },
  body: { token: TOKEN, ...body },
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ records: [] }),
  });
});

describe('POST /results/submissions', () => {
  it('refuses a logged-in request that came from another site', async () => {
    const res = mockRes();
    await handler(post({ origin: 'https://evil.example.com' }, { id: 'recAAAAAAAAAAAAAA' }), res);

    expect(res.statusCode).toBe(403);
    // The decisive assertion: no request left the process, so nothing was deleted.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // Safari omits Origin on a same-origin form post, and this route strips
  // Referer. A valid token with no origin headers is the ordinary case, and
  // rejecting it was the bug that made a real delete fail.
  it('accepts a valid token even when no origin headers are present', async () => {
    const res = mockRes();
    await handler(post({}, { id: 'recAAAAAAAAAAAAAA' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('could not be verified');
  });

  it('refuses a post carrying no token, however it arrived', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { view: 'submissions' },
        headers: { authorization: AUTH, origin: 'https://onetalkworkshop.com' },
        body: { id: 'recAAAAAAAAAAAAAA' },
      },
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refuses a forged token', async () => {
    const res = mockRes();
    await handler(post({}, { id: 'recAAAAAAAAAAAAAA', token: 'not-the-token' }), res);

    expect(res.statusCode).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('issues no delete when the ids are not Airtable record ids', async () => {
    const res = mockRes();
    await handler(
      post({ origin: 'https://onetalkworkshop.com' }, { id: ['../../etc/passwd', 'tblXXXX'] }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Nothing was selected');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated delete before anything else', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { view: 'submissions' },
        headers: { origin: 'https://onetalkworkshop.com' },
        body: { token: TOKEN, id: 'recAAAAAAAAAAAAAA' },
      },
      res,
    );

    expect(res.statusCode).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('does not accept POST on the other report views', async () => {
    const res = mockRes();
    await handler(
      {
        method: 'POST',
        query: { view: 'registrations' },
        headers: { authorization: AUTH, origin: 'https://onetalkworkshop.com' },
        body: {},
      },
      res,
    );

    expect(res.statusCode).toBe(405);
  });
});

// Chrome derives the Origin header on form navigations from the referrer
// policy. This route sends `Referrer-Policy: no-referrer`, so Chrome posts
// with the literal `Origin: null`. Treating an unparseable origin as hostile
// is what refused three real deletes: the header carries no host to check, so
// the token has to decide.
describe('Origin: null (Chrome + Referrer-Policy: no-referrer)', () => {
  it('accepts a valid token when the browser sends a null origin', async () => {
    const res = mockRes();
    await handler(post({ origin: 'null' }, { id: 'recAAAAAAAAAAAAAA' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('could not be verified');
  });

  it('still refuses a null origin when the token is wrong', async () => {
    const res = mockRes();
    await handler(post({ origin: 'null' }, { id: 'recAAAAAAAAAAAAAA', token: 'nope' }), res);

    expect(res.statusCode).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('still refuses a real foreign origin', async () => {
    const res = mockRes();
    await handler(post({ origin: 'https://evil.example.com' }, { id: 'recAAAAAAAAAAAAAA' }), res);

    expect(res.statusCode).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
