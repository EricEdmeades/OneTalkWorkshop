// Pins the observable behavior of api/subscribe-otw.js so the Keap helper
// extraction (lib/keap-contact.js) and spam-gate extraction (lib/spam-gates.js)
// are provably behavior-preserving. Lives in lib/ because every .js under api/
// is deployed as an endpoint.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

let handler;

beforeAll(async () => {
  process.env.KEAP_API_KEY = 'test-key';
  process.env.KEAP_TAG_ID_STAGE_FRIGHT = '1831';
  ({ default: handler } = await import('../api/subscribe-otw.js'));
});

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const validBody = (over = {}) => ({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'Jane@Example.com',
  website: '',
  formStartedAt: Date.now() - 10_000,
  ...over,
});

const req = (body, headers = { origin: 'https://onetalkworkshop.com' }) => ({ method: 'POST', headers, body });

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let calls;
function keapRoutes({ search = { contacts: [] }, tag = {}, noteStatus = 200 } = {}) {
  calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init = {}) => {
    const method = init.method || 'GET';
    const u = String(url);
    calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null });
    if (method === 'GET') return json(search);
    if (u.endsWith('/contacts') && method === 'POST') return json({ id: 42 });
    if (method === 'PATCH') return json({});
    if (u.endsWith('/tags')) return json(tag);
    if (u.endsWith('/notes')) return json({}, noteStatus);
    throw new Error(`unexpected ${method} ${u}`);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('subscribe-otw handler (pinned behavior)', () => {
  it('rejects non-POST with 405', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });

  it.each([
    ['bad origin', validBody(), { origin: 'https://evil.example' }],
    ['honeypot', validBody({ website: 'spam' }), undefined],
    ['too fast', validBody({ formStartedAt: Date.now() - 500 }), undefined],
    ['too old', validBody({ formStartedAt: Date.now() - 25 * 3600_000 }), undefined],
    ['missing timestamp', validBody({ formStartedAt: 'x' }), undefined],
  ])('silently succeeds on spam (%s) without calling Keap', async (_, body, headers) => {
    keapRoutes();
    const res = mockRes();
    await handler(req(body, headers), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(calls).toHaveLength(0);
  });

  it('400s on missing last name', async () => {
    keapRoutes();
    const res = mockRes();
    await handler(req(validBody({ lastName: ' ' })), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Please enter your last name.');
  });

  it('creates a new contact, tags 1831, adds a note, lower-cases email', async () => {
    keapRoutes();
    const res = mockRes();
    await handler(req(validBody()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, contactId: 42 });
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/contacts'));
    expect(create.body.email_addresses[0].email).toBe('jane@example.com');
    expect(create.body.opt_in_reason).toBe('One Talk Workshop landing page — 5 Steps opt-in');
    expect(calls.find((c) => c.url.endsWith('/tags')).body).toEqual({ tagIds: [1831] });
    expect(calls.some((c) => c.url.endsWith('/notes'))).toBe(true);
  });

  it('PATCHes an existing contact instead of creating', async () => {
    keapRoutes({ search: { contacts: [{ id: 7 }] } });
    const res = mockRes();
    await handler(req(validBody()), res);
    expect(res.body).toEqual({ success: true, contactId: 7 });
    expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/contacts/7'))).toBe(true);
  });

  it('500s when Keap reports a per-tag error inside a 200', async () => {
    keapRoutes({ tag: { 1831: 'TAG_ID_NOT_FOUND' } });
    const res = mockRes();
    await handler(req(validBody()), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Registration partially failed. Please contact support.');
  });

  it('still succeeds when the note fails', async () => {
    keapRoutes({ noteStatus: 500 });
    const res = mockRes();
    await handler(req(validBody()), res);
    expect(res.statusCode).toBe(200);
  });

  it('500s with the generic message when the search fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}, 503));
    const res = mockRes();
    await handler(req(validBody()), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("We couldn't process your request. Please try again.");
  });
});

describe('spam log detail (review minor 9)', () => {
  it('logs the blocked origin', async () => {
    keapRoutes();
    const res = mockRes();
    await handler(req(validBody(), { origin: 'https://evil.example' }), res);
    expect(console.warn.mock.calls.flat().join(' ')).toContain('https://evil.example');
  });
});
