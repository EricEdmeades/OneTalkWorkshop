// The delete path on /results/submissions, exercised through the handler.
//
// Basic auth credentials are attached by the browser automatically, including
// on a form post from another site. So "is the operator logged in" is NOT the
// control that stops a cross-site delete — the Origin check is. This suite
// drives the handler directly to prove that an authenticated-but-foreign POST
// deletes nothing.
//
// It lives in lib/ rather than api/ on purpose: Vercel turns every .js file
// under api/ into a deployed endpoint, test files included.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

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

const post = (headers, body) => ({
  method: 'POST',
  query: { view: 'submissions' },
  headers: { authorization: AUTH, ...headers },
  body,
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

  it('refuses when the request carries no origin at all', async () => {
    const res = mockRes();
    await handler(post({}, { id: 'recAAAAAAAAAAAAAA' }), res);

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
        body: { id: 'recAAAAAAAAAAAAAA' },
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
