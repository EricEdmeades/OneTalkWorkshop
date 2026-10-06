# Said Out Loud Ebook Opt-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `onetalkworkshop.com/said-out-loud`: an opt-in page that emails the *Said Out Loud* ebook via Resend (signed 30-day link → branded download page → presigned private-Blob PDF), records every opt-in in Keap, and retries Keap in the background when it is throttled.

**Architecture:** Three new static Vite pages styled with the Speaker Nation Claude Design tokens (scoped, never touching existing OTW CSS). Four new Vercel functions (`sol-optin`, `sol-resend`, `sol-download`, `sol-sync-keap`) built from small pure `lib/sol-*` modules plus one Blob IO module. Keap contact helpers are extracted from `api/subscribe-otw.js` into `lib/keap-contact.js` and shared; anti-spam gates are extracted into `lib/spam-gates.js`.

**Tech Stack:** Vanilla HTML/CSS/JS, Vite 8, Vercel Functions (Node, ESM), `@vercel/blob` (private store, presigned URLs), Resend REST API via `fetch`, Keap REST v1/v2, vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-06-said-out-loud-optin-design.md`

## Global Constraints

- Work only in the worktree `~/Code/OneTalkWorkshop-said-out-loud` on branch `feature/said-out-loud`.
- **Never put a test file under `api/`** — Vercel deploys every `.js` there as an endpoint. Handler tests live in `lib/*.test.js` (existing convention, see `lib/results-delete-guard.test.js`).
- Plain ESM JavaScript, no TypeScript, no new runtime dependencies (Resend is called with `fetch`). `@vercel/blob` may be upgraded if `presignUrl` is missing.
- From: `Speaker Nation <support@speakernation.com>` · Reply-To: `support@speakernation.com`.
- Signed link TTL **30 days**; presigned PDF URL TTL **5 minutes**.
- Rate limit per email: **1 per 60s, 3 per 24h** (the opt-in send counts).
- Field caps: first name 100, email 254, speakAbout 500.
- Spam-gate rejections return **`200 {success:true}`** silently.
- Every Keap request has a **12s timeout** and never retries in-request (shared 240 req/min account bucket).
- All `sol/*` blobs are `access: 'private'`; Blob path keys use `emailHash()` from `lib/email-hash.js`, never a raw email.
- PDF pathname constant: `said-out-loud/Said-Out-Loud-Eric-Edmeades.pdf`.
- The PDF source folder `SaidOutLoud/` is **never committed** (add to `.gitignore`).
- Existing pages (`index.html`, `register.html`, `stories.html`, `survey.html`) and `src/styles.css` must not change.
- Copy is verbatim from spec §4. Do not "improve" it.
- Functions < 50 lines, files < 800 lines, immutable updates (return new objects).
- Commit format `<type>: <description>`; every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Same email submitted to the opt-in form repeatedly (a victim's address, or an impatient double-click)** → after the first send, further sends inside 60s / beyond 3 a day are skipped with a silent success, and Keap is not touched again. Test: Task 7 "rate-limited opt-in sends nothing and skips Keap".
2. **First name containing HTML or quotes (`<b>Jo</b> "x"`)** → escaped in the email HTML, raw in the text part. Test: Task 4 "escapes first name in HTML".
3. **Email with uppercase / surrounding spaces (`  Jane@Example.COM `)** → normalised to `jane@example.com` for sending, token, Blob keys and Keap, so resend and rate limit find the same record. Tests: Task 3 "normalises email", Task 8 "resend finds an opt-in made with different casing".
4. **Blob write fails after Resend already sent** → visitor still gets `200` (they have the book), error is logged, nothing throws past the handler. Tests: Task 7 "never throws on Blob failure", "blob failure after send still succeeds".
5. **Download link whose `t` was mangled by an email client (trailing `.`, `%2E`, `>`)** → treated as invalid, redirected to the fresh-link state, never a 500. Test: Task 9 "mangled token redirects to expired state".

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/spam-gates.js` | create | `isAllowedOrigin`, `spamReason` (shared by opt-in endpoints) |
| `lib/keap-contact.js` | create | Keap contact upsert / tag / note with timeouts (extracted) |
| `api/subscribe-otw.js` | modify | Use the two modules above; behavior unchanged |
| `lib/subscribe-otw.test.js` | create | Pins stage-fright handler behavior before + after extraction |
| `lib/sol-token.js` | create | Sign / verify download tokens |
| `lib/sol-validate.js` | create | Opt-in input validation + normalisation |
| `lib/sol-email.js` | create | Delivery email subject / HTML / text |
| `lib/sol-resend-client.js` | create | Resend REST send |
| `lib/sol-ratelimit.js` | create | Pure rate decision |
| `lib/sol-pending.js` | create | Pure pending-record shape + retry bookkeeping |
| `lib/sol-store.js` | create | All Blob IO for `sol/*` |
| `lib/sol-keap.js` | create | `syncContactToKeap(record, tagId)` + note body |
| `lib/sol-service.js` | create | `publicBaseUrl`, `sendDelivery`, `recordSend`, `syncOrQueue`, `missingConfig` |
| `lib/sol-pdf.js` | create | Presigned PDF URL |
| `api/sol-optin.js` | create | Opt-in endpoint |
| `api/sol-resend.js` | create | Resend endpoint |
| `api/sol-download.js` | create | Token → presigned redirect |
| `api/sol-sync-keap.js` | create | Cron drain of pending Keap writes |
| `scripts/upload-sol-pdf.mjs` | create | One-off PDF upload |
| `src/sol/tokens/*.css` | create (copied) | Design system C tokens, verbatim |
| `src/sol/said-out-loud.css` | create | Styles for all three pages |
| `src/sol/messages.js` | create | Pure client copy/state helpers (tested) |
| `src/sol/optin.js`, `thanks.js`, `download.js` | create | Page entrypoints |
| `said-out-loud/index.html`, `thanks.html`, `download.html` | create | Pages |
| `public/assets/sol-cover.jpg` | create | Cover rendered from PDF page 1 |
| `vite.config.js`, `vercel.json`, `.gitignore`, `.env.example`, `CLAUDE.md` | modify | Wiring + docs |

---

### Task 1: Pin stage-fright behavior, extract `spam-gates` and `keap-contact`

**Files:**
- Create: `lib/subscribe-otw.test.js`, `lib/spam-gates.js`, `lib/spam-gates.test.js`, `lib/keap-contact.js`, `lib/keap-contact.test.js`
- Modify: `api/subscribe-otw.js` (whole file), `.gitignore`

**Interfaces:**
- Produces:
  - `isAllowedOrigin(originOrReferer: string): boolean`
  - `spamReason({origin, honeypot, formStartedAt, now?}): null | 'origin' | 'honeypot' | 'timing'`
  - `MIN_FORM_FILL_MS = 3000`, `MAX_FORM_AGE_MS = 86_400_000`
  - `findContactByEmail(email): Promise<{id:number}|null>`
  - `createContact({firstName, lastName, email, optInReason}): Promise<number>`
  - `updateContact(id, {firstName, lastName, email}): Promise<void>`
  - `upsertContact({firstName, lastName, email, optInReason}): Promise<number>`
  - `applyTag(contactId, tagId): Promise<void>` (throws on HTTP error or per-tag error in a 200 body)
  - `addNote(contactId, title, text): Promise<boolean>` (never throws; logs and returns false)
  - 429 → `KeapThrottleError`, hang → `KeapTimeoutError` (both from `lib/keap-api.js`, `.retryable === true`).

- [ ] **Step 1: Install deps and confirm the baseline is green**

```bash
cd ~/Code/OneTalkWorkshop-said-out-loud
npm ci
npm test
```
Expected: 0 failed (baseline on 2026-10-06 was `207 passed | 10 skipped`). Record the number.

- [ ] **Step 2: Ignore the PDF source folder**

Append to `.gitignore`:
```
# Ebook source PDFs — uploaded to Blob by scripts/upload-sol-pdf.mjs, never committed
SaidOutLoud/
```

- [ ] **Step 3: Write the pinning test for the current handler**

Create `lib/subscribe-otw.test.js`:
```js
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
```

- [ ] **Step 4: Run the pinning test against the unchanged handler**

Run: `npx vitest run lib/subscribe-otw.test.js`
Expected: all PASS. This test must pass **before** refactoring. If one fails, the test is wrong about current behavior: fix the test, not the handler.

- [ ] **Step 5: Write failing tests for `spam-gates`**

Create `lib/spam-gates.test.js`:
```js
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
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run lib/spam-gates.test.js`
Expected: FAIL, cannot resolve `./spam-gates.js`.

- [ ] **Step 7: Implement `lib/spam-gates.js`**

```js
// lib/spam-gates.js — anti-spam gates shared by the public form endpoints.
// Callers return a silent `200 {success:true}` when spamReason() is non-null,
// so a bot cannot tell a block from a real success.

// A real person cannot fill the form in under 3 seconds; bots that POST without
// sitting on the page trip this. Older than 24h is treated as a replay.
export const MIN_FORM_FILL_MS = 3000;
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

const ALLOWED_HOST_SUFFIXES = ['onetalkworkshop.com', 'onetalk.ericedmeades.com', '.vercel.app'];
const ALLOWED_HOSTS_EXACT = ['localhost', '127.0.0.1'];

export function isAllowedOrigin(originOrReferer) {
  if (!originOrReferer) return false;
  let host;
  try {
    host = new URL(originOrReferer).hostname;
  } catch (_) {
    return false;
  }
  if (ALLOWED_HOSTS_EXACT.includes(host)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix,
  );
}

export function spamReason({ origin, honeypot, formStartedAt, now = Date.now() }) {
  if (!isAllowedOrigin(origin)) return 'origin';
  if (honeypot) return 'honeypot';
  const started = Number(formStartedAt);
  if (!Number.isFinite(started)) return 'timing';
  const elapsed = now - started;
  if (elapsed < MIN_FORM_FILL_MS || elapsed > MAX_FORM_AGE_MS) return 'timing';
  return null;
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npx vitest run lib/spam-gates.test.js` → PASS.

- [ ] **Step 9: Write failing tests for `keap-contact`**

Create `lib/keap-contact.test.js`:
```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findContactByEmail, upsertContact, applyTag, addNote } from './keap-contact.js';
import { KeapThrottleError, KeapTimeoutError } from './keap-api.js';

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});
const timeout = () => Object.assign(new Error('t'), { name: 'TimeoutError' });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.KEAP_API_KEY = 'k';
});

describe('keap-contact', () => {
  it('sends the API key and a timeout signal on every request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ contacts: [] }));
    await findContactByEmail('a@b.co');
    const [url, init] = spy.mock.calls[0];
    expect(url).toContain('email=a%40b.co');
    expect(init.headers['X-Keap-API-Key']).toBe('k');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('upsert creates when not found and passes the opt-in reason', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ contacts: [] }))
      .mockResolvedValueOnce(json({ id: 9 }));
    const id = await upsertContact({ firstName: 'A', lastName: '', email: 'a@b.co', optInReason: 'Why' });
    expect(id).toBe(9);
    expect(JSON.parse(spy.mock.calls[1][1].body).opt_in_reason).toBe('Why');
  });

  it('upsert patches when found', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ contacts: [{ id: 3 }] }))
      .mockResolvedValueOnce(json({}));
    expect(await upsertContact({ firstName: 'A', lastName: '', email: 'a@b.co', optInReason: 'x' })).toBe(3);
    expect(spy.mock.calls[1][1].method).toBe('PATCH');
  });

  it('maps 429 to KeapThrottleError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}, 429));
    await expect(findContactByEmail('a@b.co')).rejects.toBeInstanceOf(KeapThrottleError);
  });

  it('maps an aborted request to KeapTimeoutError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(timeout());
    await expect(findContactByEmail('a@b.co')).rejects.toBeInstanceOf(KeapTimeoutError);
  });

  it('applyTag throws on a per-tag error inside a 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ 77: 'TAG_ID_NOT_FOUND' }));
    await expect(applyTag(1, 77)).rejects.toThrow(/tag\(s\) \[77\]/);
  });

  it('applyTag accepts success metadata objects', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ 77: { date_applied: 'x' } }));
    await expect(applyTag(1, 77)).resolves.toBeUndefined();
  });

  it('addNote returns false and does not throw on HTTP error or timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({}, 500)).mockRejectedValueOnce(timeout());
    expect(await addNote(1, 't', 'b')).toBe(false);
    expect(await addNote(1, 't', 'b')).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 10: Run to verify failure**

Run: `npx vitest run lib/keap-contact.test.js` → FAIL, module not found.

- [ ] **Step 11: Implement `lib/keap-contact.js`**

```js
// lib/keap-contact.js — Keap contact writes shared by the lead-magnet endpoints
// (api/subscribe-otw.js, api/sol-optin.js, api/sol-sync-keap.js).
//
// Every request carries a 12s timeout and none retries in place: Keap's
// 240 req/min limit is one bucket shared by every integration on the account
// (see CLAUDE.md), so an in-request retry only deepens a throttle. A 429 or a
// hang surfaces as KeapThrottleError / KeapTimeoutError (both `.retryable`),
// letting callers queue the work instead.
import { KeapThrottleError, KeapTimeoutError } from './keap-api.js';

const KEAP_BASE_V1 = 'https://api.infusionsoft.com/crm/rest/v1';
const KEAP_BASE_V2 = 'https://api.infusionsoft.com/crm/rest/v2';
const REQUEST_TIMEOUT_MS = 12_000;

function keapHeaders() {
  return { 'Content-Type': 'application/json', 'X-Keap-API-Key': process.env.KEAP_API_KEY };
}

async function keapRequest(url, { method = 'GET', body, what }) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: keapHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new KeapTimeoutError(what);
    throw err;
  }
  if (res.status === 429) throw new KeapThrottleError(what);
  return res;
}

export async function findContactByEmail(email) {
  const url = `${KEAP_BASE_V1}/contacts?email=${encodeURIComponent(email)}`;
  const res = await keapRequest(url, { what: 'contact search' });
  if (!res.ok) throw new Error(`Keap search failed: ${res.status}`);
  const data = await res.json();
  return (data.contacts && data.contacts[0]) || null;
}

export async function createContact({ firstName, lastName, email, optInReason }) {
  const res = await keapRequest(`${KEAP_BASE_V1}/contacts`, {
    method: 'POST',
    what: 'contact create',
    body: {
      given_name: firstName,
      family_name: lastName,
      email_addresses: [{ email, field: 'EMAIL1' }],
      opt_in_reason: optInReason,
    },
  });
  if (!res.ok) throw new Error(`Keap create failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

export async function updateContact(contactId, { firstName, lastName, email }) {
  const res = await keapRequest(`${KEAP_BASE_V1}/contacts/${contactId}`, {
    method: 'PATCH',
    what: 'contact update',
    body: { given_name: firstName, family_name: lastName, email_addresses: [{ email, field: 'EMAIL1' }] },
  });
  if (!res.ok) throw new Error(`Keap update failed: ${res.status} ${await res.text()}`);
}

export async function upsertContact({ firstName, lastName, email, optInReason }) {
  const existing = await findContactByEmail(email);
  if (!existing) return createContact({ firstName, lastName, email, optInReason });
  await updateContact(existing.id, { firstName, lastName, email });
  return existing.id;
}

// Keap returns HTTP 200 even when a tag ID is unknown, signalling per-tag
// failure inside the body (e.g. {"1831":"TAG_ID_NOT_FOUND"}). Success values
// are objects; failure values are strings.
function isTagFailureValue(v) {
  if (typeof v !== 'string') return false;
  const upper = v.toUpperCase();
  return upper.includes('ERROR') || upper.includes('NOT_FOUND');
}

export async function applyTag(contactId, tagId) {
  const res = await keapRequest(`${KEAP_BASE_V1}/contacts/${contactId}/tags`, {
    method: 'POST',
    what: 'tag apply',
    body: { tagIds: [tagId] },
  });
  if (!res.ok) {
    throw new Error(`Keap tag apply HTTP ${res.status} for contact ${contactId} tag ${tagId}: ${await res.text()}`);
  }
  const body = await res.json().catch(() => ({}));
  const failedIds = Object.entries(body).filter(([, v]) => isTagFailureValue(v)).map(([id]) => id);
  if (failedIds.length > 0) {
    throw new Error(
      `Keap tag apply rejected for contact ${contactId} tag(s) [${failedIds.join(', ')}]: ${JSON.stringify(body)}`,
    );
  }
}

// A missing note must never fail a submission whose tag already applied, so
// this logs and returns false instead of throwing — timeouts included.
export async function addNote(contactId, title, text) {
  try {
    const res = await keapRequest(`${KEAP_BASE_V2}/contacts/${contactId}/notes`, {
      method: 'POST',
      what: 'note add',
      body: { title, text },
    });
    if (res.ok) return true;
    console.error(`[keap-contact] Note add failed for contact ${contactId}: ${res.status} ${await res.text()}`);
    return false;
  } catch (err) {
    console.error(`[keap-contact] Note add failed for contact ${contactId}: ${err?.message || err}`);
    return false;
  }
}
```

- [ ] **Step 12: Run to verify pass**

Run: `npx vitest run lib/keap-contact.test.js` → PASS.

- [ ] **Step 13: Rewrite `api/subscribe-otw.js` on the shared modules**

Replace the whole file with:
```js
// =============================================================================
// /api/subscribe-otw — Keap integration for the "5 Steps to Overcoming Stage
// Fright" lead-magnet opt-in.
// -----------------------------------------------------------------------------
// On submit we upsert the contact, apply KEAP_TAG_ID_STAGE_FRIGHT (default
// 1831) — which triggers the existing Keap automation that delivers the
// 5 Steps emails + worksheet — and add a contact-timeline note.
//
// We do NOT send emails ourselves — Keap's automation handles delivery once
// the tag is applied. Keap helpers live in lib/keap-contact.js; spam gates in
// lib/spam-gates.js (shared with api/sol-optin.js).
// =============================================================================
import { spamReason } from '../lib/spam-gates.js';
import { upsertContact, applyTag, addNote } from '../lib/keap-contact.js';

const TAG_ID = Number(process.env.KEAP_TAG_ID_STAGE_FRIGHT || 1831);
const OPT_IN_REASON = 'One Talk Workshop landing page — 5 Steps opt-in';

const trim = (value) => (typeof value === 'string' ? value.trim() : '');
const isValidEmail = (email) => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function validationError({ firstName, lastName, email }) {
  if (!firstName) return 'Please enter your first name.';
  if (!lastName) return 'Please enter your last name.';
  if (!isValidEmail(email)) return 'Please enter a valid email address.';
  return null;
}

// Contact exists but the tag did not apply, so the delivery automation will
// not fire — that must surface as a hard failure.
async function tagApplied(contactId) {
  try {
    await applyTag(contactId, TAG_ID);
    return true;
  } catch (tagErr) {
    console.error(`[subscribe-otw] Tag apply failed (contact ${contactId} tag ${TAG_ID}): ${tagErr?.message || tagErr}`);
    return false;
  }
}

function noteBody({ firstName, lastName, email }) {
  return [
    'Source: onetalkworkshop.com',
    'Form: 5 Steps to Overcoming Stage Fright',
    `Tag applied: ${TAG_ID}`,
    `Name: ${firstName} ${lastName}`,
    `Email: ${email}`,
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!process.env.KEAP_API_KEY) {
    console.error('[subscribe-otw] KEAP_API_KEY is not set');
    return res.status(500).json({ success: false, error: 'Server is not configured.' });
  }

  const body = req.body || {};
  const spam = spamReason({
    origin: req.headers.origin || req.headers.referer || '',
    honeypot: trim(body.website),
    formStartedAt: body.formStartedAt,
  });
  if (spam) {
    console.warn(`[subscribe-otw] Blocked: ${spam}`);
    return res.status(200).json({ success: true });
  }

  const input = { firstName: trim(body.firstName), lastName: trim(body.lastName), email: trim(body.email).toLowerCase() };
  const invalid = validationError(input);
  if (invalid) return res.status(400).json({ success: false, error: invalid });

  try {
    const contactId = await upsertContact({ ...input, optInReason: OPT_IN_REASON });
    if (!(await tagApplied(contactId))) {
      return res.status(500).json({ success: false, error: 'Registration partially failed. Please contact support.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    await addNote(contactId, `OneTalk — 5 Steps opt-in (${today})`, noteBody(input));
    return res.status(200).json({ success: true, contactId });
  } catch (err) {
    console.error('[subscribe-otw]', err?.message || err);
    return res.status(500).json({ success: false, error: "We couldn't process your request. Please try again." });
  }
}
```

- [ ] **Step 14: Run the full suite**

Run: `npm test`
Expected: all previously-passing tests plus the new ones pass; `lib/subscribe-otw.test.js` is green **without edits**.

- [ ] **Step 15: Commit**

```bash
git add .gitignore lib/spam-gates.js lib/spam-gates.test.js lib/keap-contact.js lib/keap-contact.test.js lib/subscribe-otw.test.js api/subscribe-otw.js
git commit -m "refactor: extract Keap contact helpers and spam gates into lib

Pins api/subscribe-otw.js behavior with handler tests first, then moves the
Keap helpers (now with a 12s timeout and typed throttle/timeout errors) and
the anti-spam gates into shared modules for the Said Out Loud opt-in.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Download token (`lib/sol-token.js`)

**Files:**
- Create: `lib/sol-token.js`, `lib/sol-token.test.js`

**Interfaces:**
- Produces:
  - `LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000`
  - `signToken({email: string, exp: number}, secret: string): string` (format `<base64url payload>.<base64url hmac>`)
  - `verifyToken(token: unknown, secret: string, now?: number): {email, exp} | null`
  - Both throw `Error('SOL_LINK_SECRET is required')` when `secret` is falsy.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/sol-token.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// lib/sol-token.js — the signed download link for the Said Out Loud ebook.
// Stateless: the email and expiry ride in the token and an HMAC proves we
// issued it. Nothing to store, nothing to look up on download.
import crypto from 'node:crypto';

export const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function requireSecret(secret) {
  if (!secret) throw new Error('SOL_LINK_SECRET is required');
}

function mac(payload, secret) {
  return crypto.createHmac('sha256', String(secret)).update(payload).digest('base64url');
}

export function signToken({ email, exp }, secret) {
  requireSecret(secret);
  const payload = Buffer.from(JSON.stringify({ e: email, x: exp })).toString('base64url');
  return `${payload}.${mac(payload, secret)}`;
}

// Constant-time over equal-length buffers; a length mismatch is rejected first
// (the expected length is fixed and public, so that check leaks nothing).
function signatureMatches(payload, sig, secret) {
  const expected = Buffer.from(mac(payload, secret));
  const given = Buffer.from(sig);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function decode(payload) {
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data?.e !== 'string' || !Number.isFinite(data?.x)) return null;
    return { email: data.e, exp: data.x };
  } catch (_) {
    return null;
  }
}

export function verifyToken(token, secret, now = Date.now()) {
  requireSecret(secret);
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!signatureMatches(parts[0], parts[1], secret)) return null;
  const data = decode(parts[0]);
  if (!data || data.exp <= now) return null;
  return data;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run lib/sol-token.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sol-token.js lib/sol-token.test.js
git commit -m "feat: add signed download token for Said Out Loud

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Input validation (`lib/sol-validate.js`)

**Files:**
- Create: `lib/sol-validate.js`, `lib/sol-validate.test.js`

**Interfaces:**
- Produces:
  - `LIMITS = { firstName: 100, email: 254, speakAbout: 500 }`
  - `isValidEmail(email: string): boolean`
  - `normaliseEmail(value: unknown): string` (trim + lower-case; `''` for non-strings)
  - `validateOptin(body): {ok: true, value: {firstName, email, speakAbout}} | {ok: false, field, error}`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/sol-validate.test.js` → FAIL.

- [ ] **Step 3: Implement**

```js
// lib/sol-validate.js — validation and normalisation for the Said Out Loud form.
// Email is normalised once here so the token, Blob keys, rate limit and Keap
// all see the same value.

export const LIMITS = Object.freeze({ firstName: 100, email: 254, speakAbout: 500 });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v) => (typeof v === 'string' ? v.trim() : '');

export function normaliseEmail(value) {
  return clean(value).toLowerCase();
}

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= LIMITS.email && EMAIL_RE.test(email);
}

const fail = (field, error) => ({ ok: false, field, error });

export function validateOptin(body) {
  const firstName = clean(body?.firstName);
  const email = normaliseEmail(body?.email);
  const speakAbout = clean(body?.speakAbout);
  if (!firstName) return fail('firstName', 'Please enter your first name.');
  if (firstName.length > LIMITS.firstName) return fail('firstName', 'That name is too long.');
  if (!isValidEmail(email)) return fail('email', 'We need a valid email to send the book.');
  if (speakAbout.length > LIMITS.speakAbout) return fail('speakAbout', 'Please keep this under 500 characters.');
  return { ok: true, value: { firstName, email, speakAbout } };
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sol-validate.js lib/sol-validate.test.js
git commit -m "feat: add Said Out Loud opt-in validation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Delivery email + Resend client

**Files:**
- Create: `lib/sol-email.js`, `lib/sol-email.test.js`, `lib/sol-resend-client.js`, `lib/sol-resend-client.test.js`

**Interfaces:**
- Produces:
  - `SUBJECT = 'Your copy of Said Out Loud'`, `PREVIEW_TEXT = 'The field guide is inside. One link, no strings.'`
  - `escapeHtml(s: string): string`
  - `buildDeliveryEmail({firstName, link}): {subject, html, text}`
  - `FROM = 'Speaker Nation <support@speakernation.com>'`, `REPLY_TO = 'support@speakernation.com'`
  - `class ResendError extends Error`
  - `sendEmail({to, subject, html, text, idempotencyKey?}): Promise<string>` (Resend message id; throws `ResendError` on non-2xx, network/timeout failure, or missing `RESEND_API_KEY`)

- [ ] **Step 1: Write the failing email test**

```js
import { describe, it, expect } from 'vitest';
import { buildDeliveryEmail, escapeHtml, SUBJECT, PREVIEW_TEXT } from './sol-email.js';

const link = 'https://onetalkworkshop.com/said-out-loud/download?t=abc.def';

describe('sol-email', () => {
  it('uses the spec subject', () => {
    expect(SUBJECT).toBe('Your copy of Said Out Loud');
    expect(buildDeliveryEmail({ firstName: 'Jane', link }).subject).toBe(SUBJECT);
  });

  it('includes preview text, greeting, link, copy and sign-off in HTML', () => {
    const { html } = buildDeliveryEmail({ firstName: 'Jane', link });
    expect(html).toContain(PREVIEW_TEXT);
    expect(html).toContain('Hi Jane,');
    expect(html).toContain(`href="${link}"`);
    expect(html).toContain('Download the book');
    expect(html).toContain('If you catch me breaking one, reply and tell me.');
    expect(html).toContain('This link is yours for 30 days.');
  });

  it('escapes first name in HTML (Review Focus #2) but keeps it raw in text', () => {
    const { html, text } = buildDeliveryEmail({ firstName: '<b>Jo</b> "x"', link });
    expect(html).toContain('Hi &lt;b&gt;Jo&lt;/b&gt; &quot;x&quot;,');
    expect(html).not.toContain('<b>Jo</b>');
    expect(text).toContain('Hi <b>Jo</b> "x",');
  });

  it('has a full plain-text part with the bare link', () => {
    const { text } = buildDeliveryEmail({ firstName: 'Jane', link });
    expect(text).toContain(`Download the book: ${link}`);
    expect(text).toContain('Start with the AI tells chapter.');
    expect(text).toContain('onetalkworkshop.com/said-out-loud');
  });

  it('escapeHtml covers the five characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement `lib/sol-email.js`**

```js
// lib/sol-email.js — the Said Out Loud delivery email. Copy is verbatim from
// the spec (§4.4). Plain single column, one bulletproof button, full text part,
// no attachments (attachments hurt inbox placement).

export const SUBJECT = 'Your copy of Said Out Loud';
export const PREVIEW_TEXT = 'The field guide is inside. One link, no strings.';

const INK = '#141824';
const AMBER = '#E9A13B';
const TEXT = '#1C2128';
const MUTED = '#5C6470';
const PAPER = '#F8F5F0';

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildText({ firstName, link }) {
  return [
    `Hi ${firstName},`,
    '',
    "Here's your copy of Said Out Loud.",
    '',
    `Download the book: ${link}`,
    '',
    'Start with the AI tells chapter. Then read one of your own scripts out loud and see how many you catch.',
    '',
    'The whole book follows its own rules. If you catch me breaking one, reply and tell me.',
    '',
    'Eric',
    '',
    'This link is yours for 30 days. After that, visit onetalkworkshop.com/said-out-loud for a fresh one.',
  ].join('\n');
}

const para = (inner, extra = '') =>
  `<p style="margin:0 0 18px;font:16px/1.7 Inter,Helvetica,Arial,sans-serif;color:${TEXT};${extra}">${inner}</p>`;

function button(href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 26px"><tr>
<td style="border-radius:9999px;background:${AMBER}">
<a href="${href}" style="display:inline-block;padding:14px 30px;font:600 16px Inter,Helvetica,Arial,sans-serif;color:${INK};text-decoration:none;border-radius:9999px">Download the book</a>
</td></tr></table>`;
}

function buildHtml({ firstName, link }) {
  return `<!doctype html><html><body style="margin:0;background:${PAPER}">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(PREVIEW_TEXT)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px"><tr><td style="padding:36px 32px">
${para(`Hi ${escapeHtml(firstName)},`)}
${para("Here's your copy of <em>Said Out Loud</em>.")}
${button(escapeHtml(link))}
${para('Start with the AI tells chapter. Then read one of your own scripts out loud and see how many you catch.')}
${para('The whole book follows its own rules. If you catch me breaking one, reply and tell me.')}
${para('Eric', 'font-weight:600')}
${para('<em>This link is yours for 30 days. After that, visit onetalkworkshop.com/said-out-loud for a fresh one.</em>', `font-size:13px;color:${MUTED};margin:24px 0 0`)}
</td></tr></table></td></tr></table></body></html>`;
}

export function buildDeliveryEmail({ firstName, link }) {
  return { subject: SUBJECT, html: buildHtml({ firstName, link }), text: buildText({ firstName, link }) };
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Write the failing Resend client test**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendEmail, ResendError, FROM, REPLY_TO } from './sol-resend-client.js';

const msg = { to: 'jane@example.com', subject: 'S', html: '<p>h</p>', text: 't' };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.RESEND_API_KEY = 're_test';
});

describe('sol-resend-client', () => {
  it('posts the message with from, reply_to, auth and a timeout', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'msg_1' }) });
    expect(await sendEmail({ ...msg, idempotencyKey: 'k1' })).toBe('msg_1');
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_test');
    expect(init.headers['Idempotency-Key']).toBe('k1');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      from: FROM, to: ['jane@example.com'], reply_to: REPLY_TO, subject: 'S', html: '<p>h</p>', text: 't',
    });
    expect(FROM).toBe('Speaker Nation <support@speakernation.com>');
    expect(REPLY_TO).toBe('support@speakernation.com');
  });

  it('omits Idempotency-Key when not given', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'x' }) });
    await sendEmail(msg);
    expect(spy.mock.calls[0][1].headers).not.toHaveProperty('Idempotency-Key');
  });

  it('throws ResendError with status and body on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 422, text: async () => '{"message":"bad from"}' });
    const err = await sendEmail(msg).catch((e) => e);
    expect(err).toBeInstanceOf(ResendError);
    expect(err.message).toMatch(/422.*bad from/);
  });

  it('wraps network/timeout failures in ResendError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    await expect(sendEmail(msg)).rejects.toBeInstanceOf(ResendError);
  });

  it('throws when the key is missing', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendEmail(msg)).rejects.toThrow('RESEND_API_KEY is not set');
  });
});
```

- [ ] **Step 6: Run to verify failure** — FAIL.

- [ ] **Step 7: Implement `lib/sol-resend-client.js`**

```js
// lib/sol-resend-client.js — sends one email through the Resend REST API with
// fetch (no SDK dependency). speakernation.com is the verified sending domain on
// the Speaker Nation Resend account.

export const FROM = 'Speaker Nation <support@speakernation.com>';
export const REPLY_TO = 'support@speakernation.com';
const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

export class ResendError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResendError';
  }
}

function headers(apiKey, idempotencyKey) {
  const base = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  return idempotencyKey ? { ...base, 'Idempotency-Key': idempotencyKey } : base;
}

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new ResendError('RESEND_API_KEY is not set');
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: headers(apiKey, idempotencyKey),
      body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ResendError(`Resend request failed: ${err?.name || 'Error'} ${err?.message || ''}`.trim());
  }
  if (!res.ok) throw new ResendError(`Resend ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}
```

- [ ] **Step 8: Run to verify pass** — `npx vitest run lib/sol-email.test.js lib/sol-resend-client.test.js` → PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/sol-email.js lib/sol-email.test.js lib/sol-resend-client.js lib/sol-resend-client.test.js
git commit -m "feat: add Said Out Loud delivery email and Resend client

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Pure rate limit + pending record

**Files:**
- Create: `lib/sol-ratelimit.js`, `lib/sol-ratelimit.test.js`, `lib/sol-pending.js`, `lib/sol-pending.test.js`

**Interfaces:**
- Produces:
  - `MIN_GAP_MS = 60_000`, `DAY_MS = 86_400_000`, `MAX_PER_DAY = 3`
  - `checkRate(sentAt: unknown, now: number): {allowed: true, recent: number[]} | {allowed: false, reason: 'too_soon', retryAfterMs: number, recent} | {allowed: false, reason: 'daily_cap', recent}`
  - `recordSend(recent: number[], now: number): number[]` (new array)
  - `PENDING_VERSION = 1`, `MAX_ATTEMPTS = 20`
  - `makePending({email, firstName, speakAbout, ref, now}): PendingRecord`
  - `parsePending(text: string|null): PendingRecord|null`
  - `withFailure(record, err): PendingRecord` (new object, `attempts + 1`, `lastError` ≤ 500 chars)
  - `isDead(record): boolean`
  - `PendingRecord = {version: 1, email, firstName, speakAbout, ref, createdAt: ISO string, attempts: number, lastError: string|null}`

- [ ] **Step 1: Write failing tests**

`lib/sol-ratelimit.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { checkRate, recordSend, MIN_GAP_MS, DAY_MS, MAX_PER_DAY } from './sol-ratelimit.js';

const NOW = 1_800_000_000_000;

describe('sol-ratelimit', () => {
  it('allows the first send', () => expect(checkRate([], NOW)).toEqual({ allowed: true, recent: [] }));

  it('blocks inside the minimum gap with retryAfterMs', () => {
    expect(checkRate([NOW - 10_000], NOW)).toEqual({
      allowed: false, reason: 'too_soon', retryAfterMs: MIN_GAP_MS - 10_000, recent: [NOW - 10_000],
    });
  });

  it('allows exactly at the gap', () => expect(checkRate([NOW - MIN_GAP_MS], NOW).allowed).toBe(true));

  it('caps at MAX_PER_DAY within 24h', () => {
    const sent = [NOW - 3 * 3600_000, NOW - 2 * 3600_000, NOW - 3600_000];
    expect(sent).toHaveLength(MAX_PER_DAY);
    expect(checkRate(sent, NOW)).toMatchObject({ allowed: false, reason: 'daily_cap' });
  });

  it('forgets sends a day old or older and drops junk values', () => {
    expect(checkRate([NOW - DAY_MS - 1, NOW - DAY_MS, 'x', null], NOW)).toEqual({ allowed: true, recent: [] });
  });

  it('tolerates a non-array history', () => expect(checkRate(undefined, NOW).allowed).toBe(true));

  it('recordSend returns a new array', () => {
    const before = [NOW - 120_000];
    expect(recordSend(before, NOW)).toEqual([NOW - 120_000, NOW]);
    expect(before).toEqual([NOW - 120_000]);
  });
});
```

`lib/sol-pending.test.js`:
```js
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
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/sol-ratelimit.test.js lib/sol-pending.test.js` → FAIL.

- [ ] **Step 3: Implement `lib/sol-ratelimit.js`**

```js
// lib/sol-ratelimit.js — per-email send limit for the Said Out Loud delivery
// email. Pure: the caller loads and stores the history (lib/sol-store.js).
// The opt-in send counts, so a person gets the first email plus two resends a day.

export const MIN_GAP_MS = 60_000;
export const DAY_MS = 86_400_000;
export const MAX_PER_DAY = 3;

export function checkRate(sentAt, now) {
  const history = Array.isArray(sentAt) ? sentAt : [];
  const recent = history.filter((t) => Number.isFinite(t) && now - t < DAY_MS);
  const last = recent.length ? Math.max(...recent) : -Infinity;
  if (now - last < MIN_GAP_MS) {
    return { allowed: false, reason: 'too_soon', retryAfterMs: MIN_GAP_MS - (now - last), recent };
  }
  if (recent.length >= MAX_PER_DAY) return { allowed: false, reason: 'daily_cap', recent };
  return { allowed: true, recent };
}

export function recordSend(recent, now) {
  return [...recent, now];
}
```

- [ ] **Step 4: Implement `lib/sol-pending.js`**

```js
// lib/sol-pending.js — a Keap write that could not happen at opt-in time
// (throttle, timeout, Keap error). Stored privately in Blob by lib/sol-store.js
// and drained by api/sol-sync-keap.js. Versioned so a shape change degrades to
// "skip this record" instead of writing garbage into Keap.

export const PENDING_VERSION = 1;
export const MAX_ATTEMPTS = 20;
const MAX_ERROR_CHARS = 500;

export function makePending({ email, firstName, speakAbout, ref, now }) {
  return {
    version: PENDING_VERSION,
    email,
    firstName,
    speakAbout: speakAbout || '',
    ref: ref || null,
    createdAt: new Date(now).toISOString(),
    attempts: 0,
    lastError: null,
  };
}

export function parsePending(text) {
  if (!text) return null;
  try {
    const r = JSON.parse(text);
    if (r?.version !== PENDING_VERSION) return null;
    if (typeof r.email !== 'string' || typeof r.firstName !== 'string') return null;
    return r;
  } catch (_) {
    return null;
  }
}

export function withFailure(record, err) {
  const message = String(err?.message || err).slice(0, MAX_ERROR_CHARS);
  return { ...record, attempts: record.attempts + 1, lastError: message };
}

export function isDead(record) {
  return record.attempts >= MAX_ATTEMPTS;
}
```

- [ ] **Step 5: Run to verify pass** — PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/sol-ratelimit.js lib/sol-ratelimit.test.js lib/sol-pending.js lib/sol-pending.test.js
git commit -m "feat: add rate-limit and pending-Keap record logic for Said Out Loud

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Blob IO (`lib/sol-store.js`)

**Files:**
- Create: `lib/sol-store.js`, `lib/sol-store.test.js`

**Interfaces:**
- Consumes: `emailHash` (lib/email-hash.js), `normaliseEmail` (Task 3), `parsePending` (Task 5), `@vercel/blob` `put/get/list/del`.
- Produces (all private blobs):
  - `readOptin(email): Promise<{firstName, createdAt}|null>` / `writeOptin(email, {firstName, now}): Promise<void>` — `sol/optins/<hash>.json`
  - `readRate(email): Promise<number[]>` (`[]` when absent) / `writeRate(email, sentAt: number[]): Promise<void>` — `sol/rate/<hash>.json`, body `{sentAt: [...]}`
  - `pendingPath(record): string` → `sol/pending/<13-digit ms>-<hash>.json`
  - `writePending(record, pathname?): Promise<string>` (returns pathname)
  - `listPending(limit = 25): Promise<string[]>` (pathnames, oldest first)
  - `readPending(pathname): Promise<PendingRecord|null>`
  - `deletePending(pathname): Promise<void>`
  - `moveToDead(pathname, record|null): Promise<void>` (writes `sol/dead/<basename>`, then deletes the pending blob)

- [ ] **Step 1: Write the failing test** (in-memory fake for `@vercel/blob`)

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (pathname, body) => { store.set(pathname, body); return { pathname }; }),
  get: vi.fn(async (pathname) => (store.has(pathname)
    ? { statusCode: 200, stream: new Response(store.get(pathname)).body }
    : null)),
  list: vi.fn(async ({ prefix }) => ({ blobs: [...store.keys()].filter((k) => k.startsWith(prefix)).map((pathname) => ({ pathname })) })),
  del: vi.fn(async (pathname) => { store.delete(pathname); }),
}));

const s = await import('./sol-store.js');
const { put } = await import('@vercel/blob');
const { makePending } = await import('./sol-pending.js');
const { emailHash } = await import('./email-hash.js');

beforeEach(() => { store.clear(); vi.clearAllMocks(); });

describe('sol-store', () => {
  it('writes every blob private, json, overwritable, no random suffix', async () => {
    await s.writeOptin('jane@example.com', { firstName: 'Jane', now: 0 });
    expect(put.mock.calls[0][2]).toMatchObject({
      access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true,
    });
  });

  it('keys by email hash, never the raw email', async () => {
    await s.writeOptin('Jane@Example.com', { firstName: 'Jane', now: 0 });
    const [path] = [...store.keys()];
    expect(path).toBe(`sol/optins/${emailHash('jane@example.com')}.json`);
    expect(path).not.toContain('@');
  });

  it('round-trips the opt-in marker regardless of email casing', async () => {
    await s.writeOptin('jane@example.com', { firstName: 'Jane', now: Date.UTC(2026, 0, 1) });
    expect(await s.readOptin(' JANE@example.com ')).toEqual({ firstName: 'Jane', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(await s.readOptin('nobody@example.com')).toBeNull();
  });

  it('round-trips rate history and defaults to []', async () => {
    expect(await s.readRate('a@b.co')).toEqual([]);
    await s.writeRate('a@b.co', [1, 2]);
    expect(await s.readRate('a@b.co')).toEqual([1, 2]);
  });

  it('lists pending oldest first and reads them back', async () => {
    const later = makePending({ email: 'b@b.co', firstName: 'B', now: 2_000_000_000_000 });
    const earlier = makePending({ email: 'a@b.co', firstName: 'A', now: 1_000_000_000_000 });
    await s.writePending(later);
    await s.writePending(earlier);
    const paths = await s.listPending();
    expect(paths[0]).toMatch(/^sol\/pending\/1000000000000-/);
    expect(await s.readPending(paths[0])).toEqual(earlier);
  });

  it('moveToDead copies then deletes', async () => {
    const r = makePending({ email: 'a@b.co', firstName: 'A', now: 1_000_000_000_000 });
    const path = await s.writePending(r);
    await s.moveToDead(path, r);
    expect(store.has(path)).toBe(false);
    expect([...store.keys()].some((k) => k.startsWith('sol/dead/'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Check the installed SDK's `del` signature**

```bash
grep -n "export declare function del\|declare function del" -A3 node_modules/@vercel/blob/dist/*.d.ts | head
```
If `del` accepts a pathname (or `string | string[]` of url-or-pathname), use the implementation below as is. If it accepts URLs only, add `async function urlFor(pathname)` that calls `list({ prefix: pathname })` and returns `blobs[0].url`, use it in `deletePending`/`moveToDead`, and make the test fake's `list` return `url: pathname`.

- [ ] **Step 4: Implement `lib/sol-store.js`**

```js
// lib/sol-store.js — every Blob read/write for the Said Out Loud funnel.
// All blobs are private. Paths are keyed by a one-way email hash so no raw
// address appears in a pathname; pending records do hold the email and name
// because api/sol-sync-keap.js needs them to write Keap.
import { put, get, list, del } from '@vercel/blob';
import { emailHash } from './email-hash.js';
import { normaliseEmail } from './sol-validate.js';
import { parsePending } from './sol-pending.js';

const key = (dir, email) => `sol/${dir}/${emailHash(normaliseEmail(email))}.json`;

async function readText(pathname) {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).text();
}

async function readJson(pathname) {
  const text = await readText(pathname);
  return text ? JSON.parse(text) : null;
}

async function writeJson(pathname, value) {
  await put(pathname, JSON.stringify(value), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function readOptin(email) {
  return readJson(key('optins', email));
}

export async function writeOptin(email, { firstName, now }) {
  await writeJson(key('optins', email), { firstName, createdAt: new Date(now).toISOString() });
}

export async function readRate(email) {
  const data = await readJson(key('rate', email));
  return Array.isArray(data?.sentAt) ? data.sentAt : [];
}

export async function writeRate(email, sentAt) {
  await writeJson(key('rate', email), { sentAt });
}

export function pendingPath(record) {
  const ms = String(Date.parse(record.createdAt)).padStart(13, '0');
  return `sol/pending/${ms}-${emailHash(record.email)}.json`;
}

export async function writePending(record, pathname = pendingPath(record)) {
  await writeJson(pathname, record);
  return pathname;
}

export async function listPending(limit = 25) {
  const { blobs } = await list({ prefix: 'sol/pending/' });
  return blobs.map((b) => b.pathname).sort().slice(0, limit);
}

export async function readPending(pathname) {
  return parsePending(await readText(pathname));
}

export async function deletePending(pathname) {
  await del(pathname);
}

export async function moveToDead(pathname, record) {
  const name = pathname.split('/').pop();
  await writeJson(`sol/dead/${name}`, record ?? { unreadable: pathname });
  await del(pathname);
}
```

- [ ] **Step 5: Run to verify pass** — PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/sol-store.js lib/sol-store.test.js
git commit -m "feat: add private Blob store for Said Out Loud opt-ins, rate limits and pending Keap writes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Opt-in endpoint (`api/sol-optin.js`) + service layer

**Files:**
- Create: `lib/sol-keap.js`, `lib/sol-keap.test.js`, `lib/sol-service.js`, `lib/sol-service.test.js`, `api/sol-optin.js`, `lib/sol-optin.test.js`

**Interfaces:**
- Consumes: Tasks 1–6; `isBlobConfigured` from `lib/keap-store.js`.
- Produces:
  - `lib/sol-keap.js`: `OPT_IN_REASON = 'Speaker Nation — Said Out Loud ebook opt-in'`; `buildNote(record, tagId): {title, text}`; `syncContactToKeap(record, tagId): Promise<number>` (throws on contact/tag failure; note failure does not throw)
  - `lib/sol-service.js`:
    - `REQUIRED_ENV = ['RESEND_API_KEY', 'SOL_LINK_SECRET', 'KEAP_API_KEY', 'KEAP_TAG_ID_SAID_OUT_LOUD']`
    - `missingConfig(names = REQUIRED_ENV): string[]` (appends `'BLOB'` when `isBlobConfigured()` is false)
    - `publicBaseUrl(env = process.env): string`
    - `downloadLink(email, now): string`
    - `sendDelivery({email, firstName, now}): Promise<void>` (throws `ResendError`)
    - `recordSend(email, firstName, recent, now, {withOptin}): Promise<void>` — **never throws**, logs
    - `syncOrQueue({email, firstName, speakAbout, ref, now}): Promise<'synced'|'queued'|'lost'>` — **never throws**
  - `api/sol-optin.js` default export handler.

- [ ] **Step 1: Write the failing `sol-keap` test**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./keap-contact.js', () => ({
  upsertContact: vi.fn(async () => 42),
  applyTag: vi.fn(async () => undefined),
  addNote: vi.fn(async () => true),
}));
const kc = await import('./keap-contact.js');
const { syncContactToKeap, buildNote, OPT_IN_REASON } = await import('./sol-keap.js');
const { makePending } = await import('./sol-pending.js');

const rec = makePending({ email: 'jane@example.com', firstName: 'Jane', speakAbout: 'Nursing leadership', ref: 'pod1', now: Date.UTC(2026, 9, 6) });

beforeEach(() => vi.clearAllMocks());

describe('sol-keap', () => {
  it('upserts with the opt-in reason, tags, notes', async () => {
    expect(await syncContactToKeap(rec, 555)).toBe(42);
    expect(kc.upsertContact).toHaveBeenCalledWith({ firstName: 'Jane', lastName: '', email: 'jane@example.com', optInReason: OPT_IN_REASON });
    expect(kc.applyTag).toHaveBeenCalledWith(42, 555);
    const { title, text } = buildNote(rec, 555);
    expect(kc.addNote).toHaveBeenCalledWith(42, title, text);
  });

  it('note carries the speak-about answer, source, ref and date', () => {
    const { title, text } = buildNote(rec, 555);
    expect(title).toBe('Said Out Loud opt-in (2026-10-06)');
    expect(text).toContain('Speaks about: Nursing leadership');
    expect(text).toContain('Source: onetalkworkshop.com/said-out-loud');
    expect(text).toContain('Ref: pod1');
    expect(text).toContain('Tag applied: 555');
  });

  it('note says (not given) when speakAbout is empty', () => {
    expect(buildNote({ ...rec, speakAbout: '' }, 1).text).toContain('Speaks about: (not given)');
  });

  it('propagates tag failures', async () => {
    kc.applyTag.mockRejectedValueOnce(new Error('tag bad'));
    await expect(syncContactToKeap(rec, 1)).rejects.toThrow('tag bad');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/sol-keap.test.js` → FAIL.

- [ ] **Step 3: Implement `lib/sol-keap.js`**

```js
// lib/sol-keap.js — writes one Said Out Loud opt-in into Keap: contact, tag,
// timeline note. Shared by api/sol-optin.js (first try) and
// api/sol-sync-keap.js (retries). Keap does NOT send the delivery email.
import { upsertContact, applyTag, addNote } from './keap-contact.js';

export const OPT_IN_REASON = 'Speaker Nation — Said Out Loud ebook opt-in';

export function buildNote(record, tagId) {
  return {
    title: `Said Out Loud opt-in (${record.createdAt.slice(0, 10)})`,
    text: [
      'Source: onetalkworkshop.com/said-out-loud',
      `Speaks about: ${record.speakAbout || '(not given)'}`,
      `Ref: ${record.ref || '(none)'}`,
      `Tag applied: ${tagId}`,
      `Opted in: ${record.createdAt}`,
    ].join('\n'),
  };
}

export async function syncContactToKeap(record, tagId) {
  const contactId = await upsertContact({
    firstName: record.firstName,
    lastName: '',
    email: record.email,
    optInReason: OPT_IN_REASON,
  });
  await applyTag(contactId, tagId);
  const { title, text } = buildNote(record, tagId);
  await addNote(contactId, title, text);
  return contactId;
}
```

Run `npx vitest run lib/sol-keap.test.js` → PASS.

- [ ] **Step 4: Write the failing `sol-service` test**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./sol-resend-client.js', () => ({ sendEmail: vi.fn(async () => 'msg_1') }));
vi.mock('./sol-store.js', () => ({
  writeRate: vi.fn(async () => {}),
  writeOptin: vi.fn(async () => {}),
  writePending: vi.fn(async () => 'sol/pending/x.json'),
}));
vi.mock('./sol-keap.js', () => ({ syncContactToKeap: vi.fn(async () => 42) }));

const svc = await import('./sol-service.js');
const { sendEmail } = await import('./sol-resend-client.js');
const store = await import('./sol-store.js');
const { syncContactToKeap } = await import('./sol-keap.js');
const { verifyToken } = await import('./sol-token.js');
const { KeapThrottleError } = await import('./keap-api.js');

const NOW = 1_800_000_000_000;
const ENV = { RESEND_API_KEY: 'r', SOL_LINK_SECRET: 's'.repeat(40), KEAP_API_KEY: 'k', KEAP_TAG_ID_SAID_OUT_LOUD: '555', BLOB_STORE_ID: 'st' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(process.env, ENV);
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_BRANCH_URL;
  delete process.env.SOL_PUBLIC_BASE_URL;
});

describe('publicBaseUrl', () => {
  it('uses the override first', () => expect(svc.publicBaseUrl({ SOL_PUBLIC_BASE_URL: 'https://x.example/' })).toBe('https://x.example'));
  it('production → onetalkworkshop.com', () => expect(svc.publicBaseUrl({ VERCEL_ENV: 'production' })).toBe('https://onetalkworkshop.com'));
  it('preview → branch url', () => expect(svc.publicBaseUrl({ VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'otw-git-x.vercel.app' })).toBe('https://otw-git-x.vercel.app'));
  it('local fallback', () => expect(svc.publicBaseUrl({})).toBe('http://localhost:3000'));
});

describe('missingConfig', () => {
  it('is empty when all set', () => expect(svc.missingConfig()).toEqual([]));
  it('names missing vars and Blob', () => {
    delete process.env.SOL_LINK_SECRET;
    delete process.env.BLOB_STORE_ID;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(svc.missingConfig()).toEqual(['SOL_LINK_SECRET', 'BLOB']);
  });
});

describe('sendDelivery', () => {
  it('emails a link whose token verifies for this email for 30 days', async () => {
    await svc.sendDelivery({ email: 'jane@example.com', firstName: 'Jane', now: NOW });
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toBe('jane@example.com');
    const t = new URL(msg.text.match(/https?:\/\/\S+/)[0]).searchParams.get('t');
    expect(verifyToken(t, ENV.SOL_LINK_SECRET, NOW + 1).email).toBe('jane@example.com');
    expect(verifyToken(t, ENV.SOL_LINK_SECRET, NOW + 31 * 86_400_000)).toBeNull();
  });

  it('link points at the branded download page', async () => {
    await svc.sendDelivery({ email: 'a@b.co', firstName: 'A', now: NOW });
    expect(sendEmail.mock.calls[0][0].text).toContain('http://localhost:3000/said-out-loud/download?t=');
  });
});

describe('recordSend', () => {
  it('writes rate (and optin when asked)', async () => {
    await svc.recordSend('a@b.co', 'A', [1], NOW, { withOptin: true });
    expect(store.writeRate).toHaveBeenCalledWith('a@b.co', [1, NOW]);
    expect(store.writeOptin).toHaveBeenCalledWith('a@b.co', { firstName: 'A', now: NOW });
  });

  it('never throws on Blob failure (Review Focus #4)', async () => {
    store.writeRate.mockRejectedValueOnce(new Error('blob down'));
    await expect(svc.recordSend('a@b.co', 'A', [], NOW, { withOptin: true })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('syncOrQueue', () => {
  const input = { email: 'a@b.co', firstName: 'A', speakAbout: '', ref: null, now: NOW };

  it('syncs when Keap is healthy', async () => {
    expect(await svc.syncOrQueue(input)).toBe('synced');
    expect(syncContactToKeap.mock.calls[0][1]).toBe(555);
    expect(store.writePending).not.toHaveBeenCalled();
  });

  it('queues on throttle', async () => {
    syncContactToKeap.mockRejectedValueOnce(new KeapThrottleError('x'));
    expect(await svc.syncOrQueue(input)).toBe('queued');
    expect(store.writePending.mock.calls[0][0]).toMatchObject({ email: 'a@b.co', attempts: 0 });
  });

  it('returns lost and logs LOST when even the queue write fails', async () => {
    syncContactToKeap.mockRejectedValueOnce(new Error('keap 500'));
    store.writePending.mockRejectedValueOnce(new Error('blob down'));
    expect(await svc.syncOrQueue(input)).toBe('lost');
    expect(console.error.mock.calls.flat().join(' ')).toMatch(/LOST/);
  });
});
```

- [ ] **Step 5: Run to verify failure, then implement `lib/sol-service.js`**

```js
// lib/sol-service.js — steps shared by the Said Out Loud email endpoints.
// Order matters: the delivery email goes first (the visitor is waiting), then
// Blob bookkeeping and Keap, neither of which may fail a request whose email
// already went out.
import { isBlobConfigured } from './keap-store.js';
import { signToken, LINK_TTL_MS } from './sol-token.js';
import { buildDeliveryEmail } from './sol-email.js';
import { sendEmail } from './sol-resend-client.js';
import { recordSend as appendSend } from './sol-ratelimit.js';
import { writeRate, writeOptin, writePending } from './sol-store.js';
import { makePending } from './sol-pending.js';
import { syncContactToKeap } from './sol-keap.js';

export const REQUIRED_ENV = ['RESEND_API_KEY', 'SOL_LINK_SECRET', 'KEAP_API_KEY', 'KEAP_TAG_ID_SAID_OUT_LOUD'];

export function missingConfig(names = REQUIRED_ENV) {
  const missing = names.filter((n) => !process.env[n]);
  return isBlobConfigured() ? missing : [...missing, 'BLOB'];
}

export function publicBaseUrl(env = process.env) {
  if (env.SOL_PUBLIC_BASE_URL) return env.SOL_PUBLIC_BASE_URL.replace(/\/+$/, '');
  if (env.VERCEL_ENV === 'production') return 'https://onetalkworkshop.com';
  if (env.VERCEL_BRANCH_URL) return `https://${env.VERCEL_BRANCH_URL}`;
  return 'http://localhost:3000';
}

export function downloadLink(email, now) {
  const t = signToken({ email, exp: now + LINK_TTL_MS }, process.env.SOL_LINK_SECRET);
  return `${publicBaseUrl()}/said-out-loud/download?t=${encodeURIComponent(t)}`;
}

export async function sendDelivery({ email, firstName, now }) {
  const { subject, html, text } = buildDeliveryEmail({ firstName, link: downloadLink(email, now) });
  await sendEmail({ to: email, subject, html, text, idempotencyKey: `sol-${email}-${now}` });
}

export async function recordSend(email, firstName, recent, now, { withOptin }) {
  try {
    await writeRate(email, appendSend(recent, now));
    if (withOptin) await writeOptin(email, { firstName, now });
  } catch (err) {
    console.error(`[sol] Blob bookkeeping failed after a successful send: ${err?.message || err}`);
  }
}

export async function syncOrQueue({ email, firstName, speakAbout, ref, now }) {
  const record = makePending({ email, firstName, speakAbout, ref, now });
  try {
    await syncContactToKeap(record, Number(process.env.KEAP_TAG_ID_SAID_OUT_LOUD));
    return 'synced';
  } catch (err) {
    console.error(`[sol] Keap sync failed, queueing for retry: ${err?.message || err}`);
  }
  try {
    await writePending(record);
    return 'queued';
  } catch (err) {
    console.error(`[sol] LOST Keap write for opt-in at ${record.createdAt}: queue write failed: ${err?.message || err}`);
    return 'lost';
  }
}
```

Run `npx vitest run lib/sol-service.test.js` → PASS.

- [ ] **Step 6: Write the failing handler test `lib/sol-optin.test.js`**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./sol-store.js', () => ({
  readRate: vi.fn(async () => []),
  readOptin: vi.fn(async () => null),
  writeRate: vi.fn(async () => {}),
  writeOptin: vi.fn(async () => {}),
  writePending: vi.fn(async () => 'sol/pending/x.json'),
}));
vi.mock('./sol-service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendDelivery: vi.fn(async () => {}),
  recordSend: vi.fn(async () => {}),
  syncOrQueue: vi.fn(async () => 'synced'),
}));

const { default: handler } = await import('../api/sol-optin.js');
const store = await import('./sol-store.js');
const svc = await import('./sol-service.js');

const mockRes = () => ({
  statusCode: null, body: null, headers: {},
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});
const body = (o = {}) => ({ firstName: 'Jane', email: ' Jane@Example.com ', speakAbout: 'Nursing', website: '', formStartedAt: Date.now() - 10_000, ref: 'pod1', ...o });
const post = (b, origin = 'https://onetalkworkshop.com') => ({ method: 'POST', headers: { origin }, body: b });
const RETRY = 'Something went wrong on our side. Try again in a minute.';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(process.env, { RESEND_API_KEY: 'r', SOL_LINK_SECRET: 's'.repeat(40), KEAP_API_KEY: 'k', KEAP_TAG_ID_SAID_OUT_LOUD: '555', BLOB_STORE_ID: 'st' });
});

describe('POST /api/sol-optin', () => {
  it('405 on GET', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('500 with visitor-safe copy when config is missing, logs the var', async () => {
    delete process.env.SOL_LINK_SECRET;
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe(RETRY);
    expect(console.error.mock.calls.flat().join(' ')).toContain('SOL_LINK_SECRET');
  });

  it.each([
    ['origin', body(), 'https://evil.example'],
    ['honeypot', body({ website: 'x' }), undefined],
    ['timing', body({ formStartedAt: Date.now() }), undefined],
  ])('silent 200 on spam (%s), sends nothing', async (_, b, origin) => {
    const res = mockRes();
    await handler(post(b, origin), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(svc.sendDelivery).not.toHaveBeenCalled();
  });

  it('400 with field on invalid email', async () => {
    const res = mockRes();
    await handler(post(body({ email: 'nope' })), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, field: 'email', error: 'We need a valid email to send the book.' });
  });

  it('happy path: sends, records with optin, syncs Keap with normalised email and ref', async () => {
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(svc.sendDelivery).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@example.com', firstName: 'Jane' }));
    expect(svc.recordSend).toHaveBeenCalledWith('jane@example.com', 'Jane', [], expect.any(Number), { withOptin: true });
    expect(svc.syncOrQueue).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@example.com', speakAbout: 'Nursing', ref: 'pod1' }));
  });

  it('rate-limited opt-in sends nothing and skips Keap (Review Focus #1)', async () => {
    store.readRate.mockResolvedValueOnce([Date.now() - 5_000]);
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(svc.sendDelivery).not.toHaveBeenCalled();
    expect(svc.syncOrQueue).not.toHaveBeenCalled();
  });

  it('502 with retry copy when Resend fails, and skips Keap', async () => {
    svc.sendDelivery.mockRejectedValueOnce(new Error('resend down'));
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe(RETRY);
    expect(svc.syncOrQueue).not.toHaveBeenCalled();
  });

  it('rate read failure fails open (still sends) and logs', async () => {
    store.readRate.mockRejectedValueOnce(new Error('blob down'));
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(200);
    expect(svc.sendDelivery).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('blob failure after send still succeeds (Review Focus #4)', async () => {
    svc.recordSend.mockImplementationOnce(async () => { console.error('[sol] Blob bookkeeping failed'); });
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(200);
  });

  it('truncates an oversized ref to 100 chars', async () => {
    const res = mockRes();
    await handler(post(body({ ref: 'r'.repeat(300) })), res);
    expect(svc.syncOrQueue.mock.calls[0][0].ref).toHaveLength(100);
  });
});
```

- [ ] **Step 7: Run to verify failure, then implement `api/sol-optin.js`**

```js
// /api/sol-optin — Said Out Loud ebook opt-in.
// Order: spam gates → validate → rate check → Resend delivery email → Blob
// bookkeeping → Keap (or queue for api/sol-sync-keap.js). Keap never sends the
// delivery email; it only stores the contact, tag and note.
import { spamReason } from '../lib/spam-gates.js';
import { validateOptin } from '../lib/sol-validate.js';
import { checkRate } from '../lib/sol-ratelimit.js';
import { readRate } from '../lib/sol-store.js';
import { missingConfig, sendDelivery, recordSend, syncOrQueue } from '../lib/sol-service.js';

const RETRY_COPY = 'Something went wrong on our side. Try again in a minute.';
const trim = (v) => (typeof v === 'string' ? v.trim() : '');

async function loadHistory(email) {
  try {
    return await readRate(email);
  } catch (err) {
    // Fail open: a Blob outage must not stop someone getting the book.
    console.error(`[sol-optin] Rate read failed, allowing send: ${err?.message || err}`);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const missing = missingConfig();
  if (missing.length) {
    console.error(`[sol-optin] Missing config: ${missing.join(', ')}`);
    return res.status(500).json({ success: false, error: RETRY_COPY });
  }

  const body = req.body || {};
  const spam = spamReason({ origin: req.headers.origin || req.headers.referer || '', honeypot: trim(body.website), formStartedAt: body.formStartedAt });
  if (spam) {
    console.warn(`[sol-optin] Blocked: ${spam}`);
    return res.status(200).json({ success: true });
  }

  const v = validateOptin(body);
  if (!v.ok) return res.status(400).json({ success: false, field: v.field, error: v.error });
  const { firstName, email, speakAbout } = v.value;
  const now = Date.now();

  const rate = checkRate(await loadHistory(email), now);
  if (!rate.allowed) {
    console.warn(`[sol-optin] Rate-limited (${rate.reason}); not resending`);
    return res.status(200).json({ success: true });
  }

  try {
    await sendDelivery({ email, firstName, now });
  } catch (err) {
    console.error(`[sol-optin] Delivery email failed: ${err?.message || err}`);
    return res.status(502).json({ success: false, error: RETRY_COPY });
  }

  await recordSend(email, firstName, rate.recent, now, { withOptin: true });
  await syncOrQueue({ email, firstName, speakAbout, ref: trim(body.ref).slice(0, 100) || null, now });
  return res.status(200).json({ success: true });
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npx vitest run lib/sol-keap.test.js lib/sol-service.test.js lib/sol-optin.test.js` → PASS. Then `npm test` → all PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/sol-keap.js lib/sol-keap.test.js lib/sol-service.js lib/sol-service.test.js lib/sol-optin.test.js api/sol-optin.js
git commit -m "feat: add Said Out Loud opt-in endpoint

Sends the delivery email through Resend first, then records the send and
writes Keap, queueing the Keap write to Blob when Keap is throttled.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Resend endpoint (`api/sol-resend.js`)

**Files:**
- Create: `api/sol-resend.js`, `lib/sol-resend.test.js`

**Interfaces:**
- Consumes: `isAllowedOrigin`, `normaliseEmail`, `isValidEmail`, `checkRate`, `readOptin`, `readRate`, `missingConfig`, `sendDelivery`, `recordSend`.
- Produces: `POST /api/sol-resend {email}` →
  - `200 {success:true}` (sent, or silently ignored: bad origin / unknown email)
  - `400 {success:false, error:'We need a valid email to send the book.'}`
  - `429 {success:false, reason:'too_soon'|'daily_cap', error}`
  - `502 {success:false, error: RETRY_COPY}`; `500` on missing config
- Copy (spec §4.3): too_soon → `We've just sent it. Try again in a minute.`; daily_cap → `We've sent it a few times now. Write to support@speakernation.com and we'll sort it out.`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./sol-store.js', () => ({
  readOptin: vi.fn(async () => ({ firstName: 'Jane', createdAt: '2026-10-06T00:00:00.000Z' })),
  readRate: vi.fn(async () => []),
  writeRate: vi.fn(async () => {}),
  writeOptin: vi.fn(async () => {}),
  writePending: vi.fn(async () => 'sol/pending/x.json'),
}));
vi.mock('./sol-service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendDelivery: vi.fn(async () => {}),
  recordSend: vi.fn(async () => {}),
}));

const { default: handler } = await import('../api/sol-resend.js');
const store = await import('./sol-store.js');
const svc = await import('./sol-service.js');

const mockRes = () => ({
  statusCode: null, body: null, headers: {},
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});
const post = (email, origin = 'https://onetalkworkshop.com') => ({ method: 'POST', headers: { origin }, body: { email } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(process.env, { RESEND_API_KEY: 'r', SOL_LINK_SECRET: 's'.repeat(40), KEAP_API_KEY: 'k', KEAP_TAG_ID_SAID_OUT_LOUD: '555', BLOB_STORE_ID: 'st' });
});

describe('POST /api/sol-resend', () => {
  it('resend finds an opt-in made with different casing (Review Focus #3)', async () => {
    const res = mockRes();
    await handler(post('  JANE@example.com '), res);
    expect(store.readOptin).toHaveBeenCalledWith('jane@example.com');
    expect(svc.sendDelivery).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@example.com', firstName: 'Jane' }));
    expect(svc.recordSend).toHaveBeenCalledWith('jane@example.com', 'Jane', [], expect.any(Number), { withOptin: false });
    expect(res.statusCode).toBe(200);
  });

  it('silent 200 for an unknown email, sends nothing', async () => {
    store.readOptin.mockResolvedValueOnce(null);
    const res = mockRes();
    await handler(post('stranger@example.com'), res);
    expect(res.statusCode).toBe(200);
    expect(svc.sendDelivery).not.toHaveBeenCalled();
  });

  it('silent 200 for a bad origin, reads nothing', async () => {
    const res = mockRes();
    await handler(post('jane@example.com', 'https://evil.example'), res);
    expect(res.statusCode).toBe(200);
    expect(store.readOptin).not.toHaveBeenCalled();
  });

  it('400 on invalid email', async () => {
    const res = mockRes();
    await handler(post('nope'), res);
    expect(res.statusCode).toBe(400);
  });

  it('429 too_soon with spec copy', async () => {
    store.readRate.mockResolvedValueOnce([Date.now() - 1000]);
    const res = mockRes();
    await handler(post('jane@example.com'), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ success: false, reason: 'too_soon', error: "We've just sent it. Try again in a minute." });
  });

  it('429 daily_cap with spec copy', async () => {
    const n = Date.now();
    store.readRate.mockResolvedValueOnce([n - 3 * 3600_000, n - 2 * 3600_000, n - 3600_000]);
    const res = mockRes();
    await handler(post('jane@example.com'), res);
    expect(res.body.error).toBe("We've sent it a few times now. Write to support@speakernation.com and we'll sort it out.");
  });

  it('502 when Resend fails', async () => {
    svc.sendDelivery.mockRejectedValueOnce(new Error('down'));
    const res = mockRes();
    await handler(post('jane@example.com'), res);
    expect(res.statusCode).toBe(502);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement `api/sol-resend.js`**

```js
// /api/sol-resend — re-sends the Said Out Loud email to someone who already
// opted in (thank-you page button, expired-link form). Unknown addresses get a
// silent success so this cannot be used to mail strangers or probe the list.
import { isAllowedOrigin } from '../lib/spam-gates.js';
import { normaliseEmail, isValidEmail } from '../lib/sol-validate.js';
import { checkRate } from '../lib/sol-ratelimit.js';
import { readOptin, readRate } from '../lib/sol-store.js';
import { missingConfig, sendDelivery, recordSend } from '../lib/sol-service.js';

const RETRY_COPY = 'Something went wrong on our side. Try again in a minute.';
const LIMIT_COPY = {
  too_soon: "We've just sent it. Try again in a minute.",
  daily_cap: "We've sent it a few times now. Write to support@speakernation.com and we'll sort it out.",
};

async function resendTo(email, res) {
  const optin = await readOptin(email);
  if (!optin) return res.status(200).json({ success: true });
  const now = Date.now();
  const rate = checkRate(await readRate(email), now);
  if (!rate.allowed) return res.status(429).json({ success: false, reason: rate.reason, error: LIMIT_COPY[rate.reason] });
  await sendDelivery({ email, firstName: optin.firstName, now });
  await recordSend(email, optin.firstName, rate.recent, now, { withOptin: false });
  return res.status(200).json({ success: true });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const missing = missingConfig();
  if (missing.length) {
    console.error(`[sol-resend] Missing config: ${missing.join(', ')}`);
    return res.status(500).json({ success: false, error: RETRY_COPY });
  }
  if (!isAllowedOrigin(req.headers.origin || req.headers.referer || '')) {
    console.warn('[sol-resend] Blocked: origin');
    return res.status(200).json({ success: true });
  }
  const email = normaliseEmail(req.body?.email);
  if (!isValidEmail(email)) return res.status(400).json({ success: false, error: 'We need a valid email to send the book.' });
  try {
    return await resendTo(email, res);
  } catch (err) {
    console.error(`[sol-resend] Failed: ${err?.message || err}`);
    return res.status(502).json({ success: false, error: RETRY_COPY });
  }
}
```

- [ ] **Step 3: Run to verify pass** — `npx vitest run lib/sol-resend.test.js` → PASS.

- [ ] **Step 4: Commit**

```bash
git add api/sol-resend.js lib/sol-resend.test.js
git commit -m "feat: add Said Out Loud resend endpoint with per-email rate limit

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Download endpoint, presigned PDF, upload script

**Files:**
- Create: `lib/sol-pdf.js`, `api/sol-download.js`, `lib/sol-download.test.js`, `scripts/upload-sol-pdf.mjs`
- Possibly modify: `package.json`, `package-lock.json` (only if `@vercel/blob` lacks `presignUrl`)

**Interfaces:**
- Produces:
  - `SOL_PDF_PATHNAME = 'said-out-loud/Said-Out-Loud-Eric-Edmeades.pdf'`, `PDF_URL_TTL_MS = 300_000`
  - `presignPdfUrl(now?): Promise<string>`
  - `GET /api/sol-download?t=` → `302` presigned URL (`Cache-Control: no-store`) | `302 /said-out-loud/download?expired=1` | `302 /said-out-loud/download?error=1&t=<t>` on presign failure | `500` text when `SOL_LINK_SECRET` is missing.

- [ ] **Step 1: Confirm the Blob SDK supports presigned URLs**

```bash
node -e "import('@vercel/blob').then(m => console.log(typeof m.issueSignedToken, typeof m.presignUrl))"
```
Expected: `function function`. If either is `undefined`: `npm install @vercel/blob@latest`, rerun the check, run `npm test` (must stay green), and include `package.json` + `package-lock.json` in this task's commit. Then open `node_modules/@vercel/blob/README.md`, search `presignUrl`, and make Step 4's call match the documented signature exactly.

- [ ] **Step 2: Write the failing test**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./sol-pdf.js', () => ({ presignPdfUrl: vi.fn(async () => 'https://store.private.blob.vercel-storage.com/said-out-loud/x.pdf?sig=1') }));
const { default: handler } = await import('../api/sol-download.js');
const pdf = await import('./sol-pdf.js');
const { signToken } = await import('./sol-token.js');

const SECRET = 's'.repeat(40);
const mockRes = () => ({
  statusCode: null, headers: {}, body: null,
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  status(c) { this.statusCode = c; return this; },
  send(b) { this.body = b; return this; },
  end() { return this; },
});
const get = (t) => ({ method: 'GET', query: t === undefined ? {} : { t }, headers: {} });
const fresh = () => signToken({ email: 'a@b.co', exp: Date.now() + 60_000 }, SECRET);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.SOL_LINK_SECRET = SECRET;
});

describe('GET /api/sol-download', () => {
  it('valid token → 302 to presigned URL, no-store', async () => {
    const res = mockRes();
    await handler(get(fresh()), res);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/store\.private\.blob/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([undefined, '', 'garbage'])('missing/invalid token %p → expired state', async (t) => {
    const res = mockRes();
    await handler(get(t), res);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/said-out-loud/download?expired=1');
    expect(pdf.presignPdfUrl).not.toHaveBeenCalled();
  });

  it('mangled token redirects to expired state (Review Focus #5)', async () => {
    const t = fresh();
    for (const bad of [`${t}.`, `${t}%2E`, `${t}>`]) {
      const res = mockRes();
      await handler(get(bad), res);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/said-out-loud/download?expired=1');
    }
  });

  it('expired token → expired state', async () => {
    const t = signToken({ email: 'a@b.co', exp: Date.now() - 1 }, SECRET);
    const res = mockRes();
    await handler(get(t), res);
    expect(res.headers.location).toBe('/said-out-loud/download?expired=1');
  });

  it('presign failure → error state, logged', async () => {
    pdf.presignPdfUrl.mockRejectedValueOnce(new Error('blob down'));
    const t = fresh();
    const res = mockRes();
    await handler(get(t), res);
    expect(res.headers.location).toBe(`/said-out-loud/download?error=1&t=${encodeURIComponent(t)}`);
    expect(console.error).toHaveBeenCalled();
  });

  it('500 when the secret is missing', async () => {
    delete process.env.SOL_LINK_SECRET;
    const res = mockRes();
    await handler(get('x.y'), res);
    expect(res.statusCode).toBe(500);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run lib/sol-download.test.js` → FAIL.

- [ ] **Step 4: Implement `lib/sol-pdf.js`**

```js
// lib/sol-pdf.js — short-lived URL for the private ebook PDF. The project's
// Blob store is private at the store level, so the PDF is private too; a
// download is a 5-minute presigned GET minted per click by api/sol-download.js.
// Streaming through the function is not an option: responses cap at ~4.5 MB
// and the PDF is ~18.6 MB.
import { issueSignedToken, presignUrl } from '@vercel/blob';

export const SOL_PDF_PATHNAME = 'said-out-loud/Said-Out-Loud-Eric-Edmeades.pdf';
export const PDF_URL_TTL_MS = 5 * 60 * 1000;

export async function presignPdfUrl(now = Date.now()) {
  const validUntil = now + PDF_URL_TTL_MS;
  const token = await issueSignedToken({ pathname: SOL_PDF_PATHNAME, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(token, {
    operation: 'get',
    pathname: SOL_PDF_PATHNAME,
    access: 'private',
    validUntil,
  });
  return presignedUrl;
}
```

- [ ] **Step 5: Implement `api/sol-download.js`**

```js
// /api/sol-download?t=<token> — verifies the emailed link and redirects to a
// 5-minute presigned URL for the private PDF. Every failure lands the visitor
// on the branded download page in a recoverable state, never on a raw error.
import { verifyToken } from '../lib/sol-token.js';
import { presignPdfUrl } from '../lib/sol-pdf.js';

const PAGE = '/said-out-loud/download';

function redirect(res, location) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Location', location);
  return res.status(302).end();
}

export default async function handler(req, res) {
  const secret = process.env.SOL_LINK_SECRET;
  if (!secret) {
    console.error('[sol-download] SOL_LINK_SECRET is not set');
    return res.status(500).send('Server is not configured.');
  }
  const t = typeof req.query?.t === 'string' ? req.query.t : '';
  if (!verifyToken(t, secret)) return redirect(res, `${PAGE}?expired=1`);
  try {
    return redirect(res, await presignPdfUrl());
  } catch (err) {
    console.error(`[sol-download] Presign failed: ${err?.message || err}`);
    return redirect(res, `${PAGE}?error=1&t=${encodeURIComponent(t)}`);
  }
}
```

- [ ] **Step 6: Run to verify pass** — `npx vitest run lib/sol-download.test.js` → PASS.

- [ ] **Step 7: Write `scripts/upload-sol-pdf.mjs`**

```js
#!/usr/bin/env node
// Uploads the Said Out Loud PDF to the project's private Blob store at the
// fixed pathname lib/sol-pdf.js presigns. Re-run to replace the book.
//
//   vercel env pull .env.local --environment=production   # BLOB_READ_WRITE_TOKEN
//   node --env-file=.env.local scripts/upload-sol-pdf.mjs <path-to-pdf>
import { readFile } from 'node:fs/promises';
import { put } from '@vercel/blob';
import { SOL_PDF_PATHNAME } from '../lib/sol-pdf.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/upload-sol-pdf.mjs <path-to-pdf>');
  process.exit(1);
}
const bytes = await readFile(path);
if (bytes.subarray(0, 5).toString() !== '%PDF-') {
  console.error(`${path} is not a PDF (missing %PDF- header)`);
  process.exit(1);
}
const blob = await put(SOL_PDF_PATHNAME, bytes, {
  access: 'private',
  contentType: 'application/pdf',
  addRandomSuffix: false,
  allowOverwrite: true,
  multipart: true,
});
console.log(`Uploaded ${(bytes.length / 1e6).toFixed(1)} MB → ${blob.pathname}`);
```

- [ ] **Step 8: Commit**

```bash
git add lib/sol-pdf.js api/sol-download.js lib/sol-download.test.js scripts/upload-sol-pdf.mjs
# also: git add package.json package-lock.json   (only if Step 1 upgraded @vercel/blob)
git commit -m "feat: add Said Out Loud download endpoint with presigned private PDF

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Keap retry cron (`api/sol-sync-keap.js`)

**Files:**
- Create: `api/sol-sync-keap.js`, `lib/sol-sync-keap.test.js`
- Modify: `vercel.json` (`crons`)

**Interfaces:**
- Consumes: `listPending`, `readPending`, `writePending`, `deletePending`, `moveToDead`, `syncContactToKeap`, `withFailure`, `isDead`, `missingConfig`.
- Produces: `GET /api/sol-sync-keap` (Bearer `CRON_SECRET`) → `200 {ok, synced, failed, dead, reason}`; `401` wrong token; `500` when `CRON_SECRET` or Keap/Blob config is missing. `export const config = { maxDuration: 120 }`. Test seams `__setGapMs(ms)`, `__setDeadlineMs(ms)`.
- Behavior: retryable errors (`err.retryable`) stop the run **without** counting an attempt (`reason: 'throttled'`); other errors increment attempts, moving to `sol/dead/` at 20. Unreadable records go to dead immediately. Stops starting new records after 75s (`reason: 'deadline'`). 500ms gap between records.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./sol-store.js', () => ({
  listPending: vi.fn(async () => []),
  readPending: vi.fn(),
  writePending: vi.fn(async () => {}),
  deletePending: vi.fn(async () => {}),
  moveToDead: vi.fn(async () => {}),
}));
vi.mock('./sol-keap.js', () => ({ syncContactToKeap: vi.fn(async () => 1) }));

const mod = await import('../api/sol-sync-keap.js');
const handler = mod.default;
const store = await import('./sol-store.js');
const { syncContactToKeap } = await import('./sol-keap.js');
const { makePending, MAX_ATTEMPTS } = await import('./sol-pending.js');
const { KeapThrottleError } = await import('./keap-api.js');

const mockRes = () => ({
  statusCode: null, body: null,
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});
const auth = (token = 'cron-s') => ({ method: 'GET', headers: { authorization: `Bearer ${token}` } });
const rec = (o = {}) => ({ ...makePending({ email: 'a@b.co', firstName: 'A', now: 1_000_000_000_000 }), ...o });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  Object.assign(process.env, { CRON_SECRET: 'cron-s', KEAP_API_KEY: 'k', KEAP_TAG_ID_SAID_OUT_LOUD: '555', BLOB_STORE_ID: 'st' });
  mod.__setGapMs(0);
  mod.__setDeadlineMs(75_000);
});

describe('GET /api/sol-sync-keap', () => {
  it('pins maxDuration', () => expect(mod.config).toEqual({ maxDuration: 120 }));

  it('fails closed without CRON_SECRET', async () => {
    delete process.env.CRON_SECRET;
    const res = mockRes();
    await handler(auth(), res);
    expect(res.statusCode).toBe(500);
    expect(store.listPending).not.toHaveBeenCalled();
  });

  it('401 on a wrong token', async () => {
    const res = mockRes();
    await handler(auth('nope'), res);
    expect(res.statusCode).toBe(401);
    expect(store.listPending).not.toHaveBeenCalled();
  });

  it('syncs and deletes each pending record', async () => {
    store.listPending.mockResolvedValueOnce(['p1', 'p2']);
    store.readPending.mockResolvedValue(rec());
    const res = mockRes();
    await handler(auth(), res);
    expect(syncContactToKeap).toHaveBeenCalledTimes(2);
    expect(syncContactToKeap.mock.calls[0][1]).toBe(555);
    expect(store.deletePending).toHaveBeenCalledWith('p1');
    expect(res.body).toEqual({ ok: true, synced: 2, failed: 0, dead: 0, reason: null });
  });

  it('stops on throttle without counting an attempt', async () => {
    store.listPending.mockResolvedValueOnce(['p1', 'p2']);
    store.readPending.mockResolvedValue(rec());
    syncContactToKeap.mockRejectedValueOnce(new KeapThrottleError('x'));
    const res = mockRes();
    await handler(auth(), res);
    expect(syncContactToKeap).toHaveBeenCalledTimes(1);
    expect(store.writePending).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason: 'throttled' });
  });

  it('counts a non-retryable failure and rewrites the record in place', async () => {
    store.listPending.mockResolvedValueOnce(['p1']);
    store.readPending.mockResolvedValue(rec());
    syncContactToKeap.mockRejectedValueOnce(new Error('tag rejected'));
    const res = mockRes();
    await handler(auth(), res);
    expect(store.writePending).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, lastError: 'tag rejected' }), 'p1');
    expect(res.body.failed).toBe(1);
  });

  it('moves to dead at MAX_ATTEMPTS', async () => {
    store.listPending.mockResolvedValueOnce(['p1']);
    store.readPending.mockResolvedValue(rec({ attempts: MAX_ATTEMPTS - 1 }));
    syncContactToKeap.mockRejectedValueOnce(new Error('still bad'));
    const res = mockRes();
    await handler(auth(), res);
    expect(store.moveToDead).toHaveBeenCalledWith('p1', expect.objectContaining({ attempts: MAX_ATTEMPTS }));
    expect(res.body.dead).toBe(1);
  });

  it('moves an unreadable record to dead immediately', async () => {
    store.listPending.mockResolvedValueOnce(['bad']);
    store.readPending.mockResolvedValue(null);
    const res = mockRes();
    await handler(auth(), res);
    expect(store.moveToDead).toHaveBeenCalledWith('bad', null);
    expect(syncContactToKeap).not.toHaveBeenCalled();
  });

  it('stops at the deadline', async () => {
    store.listPending.mockResolvedValueOnce(['p1', 'p2']);
    store.readPending.mockResolvedValue(rec());
    mod.__setDeadlineMs(-1);
    const res = mockRes();
    await handler(auth(), res);
    expect(syncContactToKeap).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ ok: false, reason: 'deadline' });
  });

  it('500 when a Blob call throws mid-run', async () => {
    store.listPending.mockRejectedValueOnce(new Error('blob down'));
    const res = mockRes();
    await handler(auth(), res);
    expect(res.statusCode).toBe(500);
    expect(console.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/sol-sync-keap.test.js` → FAIL.

- [ ] **Step 3: Implement `api/sol-sync-keap.js`**

```js
// /api/sol-sync-keap — Vercel Cron. Drains Said Out Loud opt-ins whose Keap
// write failed at submit time. Same discipline as api/refresh-keap.js: fails
// closed without CRON_SECRET, one record at a time with a gap, stops on the
// first throttle (Keap's 240/min bucket is account-wide), and a busy Keap
// returns 200 {ok:false} rather than paging anyone.
import { listPending, readPending, writePending, deletePending, moveToDead } from '../lib/sol-store.js';
import { syncContactToKeap } from '../lib/sol-keap.js';
import { withFailure, isDead } from '../lib/sol-pending.js';
import { missingConfig } from '../lib/sol-service.js';

export const config = { maxDuration: 120 };

let gapMs = 500;
let deadlineMs = 75_000;
// Test seams — production never calls these.
export const __setGapMs = (ms) => { gapMs = ms; };
export const __setDeadlineMs = (ms) => { deadlineMs = ms; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recordFailure(pathname, record, err) {
  const next = withFailure(record, err);
  if (!isDead(next)) {
    await writePending(next, pathname);
    return 'failed';
  }
  console.error(`[sol-sync-keap] Giving up on ${pathname} after ${next.attempts} attempts: ${next.lastError}`);
  await moveToDead(pathname, next);
  return 'dead';
}

async function processOne(pathname, tagId) {
  const record = await readPending(pathname);
  if (!record) {
    console.error(`[sol-sync-keap] Unreadable pending record ${pathname}; moved to dead`);
    await moveToDead(pathname, null);
    return 'dead';
  }
  try {
    await syncContactToKeap(record, tagId);
    await deletePending(pathname);
    return 'synced';
  } catch (err) {
    if (err?.retryable) return 'throttled';
    return recordFailure(pathname, record, err);
  }
}

async function drain(tagId) {
  const started = Date.now();
  const counts = { synced: 0, failed: 0, dead: 0 };
  for (const pathname of await listPending()) {
    if (Date.now() - started > deadlineMs) return { counts, reason: 'deadline' };
    const outcome = await processOne(pathname, tagId);
    if (outcome === 'throttled') return { counts, reason: 'throttled' };
    counts[outcome] += 1;
    await sleep(gapMs);
  }
  return { counts, reason: null };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[sol-sync-keap] CRON_SECRET is not set; refusing to run');
    return res.status(500).json({ ok: false, reason: 'not_configured' });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false, reason: 'unauthorized' });
  const missing = missingConfig(['KEAP_API_KEY', 'KEAP_TAG_ID_SAID_OUT_LOUD']);
  if (missing.length) {
    console.error(`[sol-sync-keap] Missing config: ${missing.join(', ')}`);
    return res.status(500).json({ ok: false, reason: 'not_configured' });
  }
  try {
    const { counts, reason } = await drain(Number(process.env.KEAP_TAG_ID_SAID_OUT_LOUD));
    if (reason) console.warn(`[sol-sync-keap] Stopped early: ${reason}`);
    return res.status(200).json({ ok: !reason, ...counts, reason });
  } catch (err) {
    console.error(`[sol-sync-keap] Run failed: ${err?.message || err}`);
    return res.status(500).json({ ok: false, reason: 'error' });
  }
}
```

- [ ] **Step 4: Register the cron in `vercel.json`**

Replace:
```json
  "crons": [{ "path": "/api/refresh-keap", "schedule": "*/10 * * * *" }],
```
with:
```json
  "crons": [
    { "path": "/api/refresh-keap", "schedule": "*/10 * * * *" },
    { "path": "/api/sol-sync-keap", "schedule": "5-59/10 * * * *" }
  ],
```
Offset by 5 minutes so the project's two Keap consumers never start in the same minute.

- [ ] **Step 5: Run to verify pass** — `npx vitest run lib/sol-sync-keap.test.js` → PASS; `npm test` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add api/sol-sync-keap.js lib/sol-sync-keap.test.js vercel.json
git commit -m "feat: add cron that retries queued Said Out Loud Keap writes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Pages, styles, cover, client scripts

**Files:**
- Create: `src/sol/tokens/{colors,typography,spacing,shape,base}.css` (copied), `src/sol/said-out-loud.css`, `src/sol/messages.js`, `src/sol/messages.test.js`, `src/sol/optin.js`, `src/sol/thanks.js`, `src/sol/download.js`, `said-out-loud/index.html`, `said-out-loud/thanks.html`, `said-out-loud/download.html`, `public/assets/sol-cover.jpg`
- Modify: `vite.config.js`

**Interfaces:**
- Consumes: `initAnalytics` (`src/analytics.js`), `initAffiliateRef`, `getStoredRef` (`src/affiliate-ref.js`); endpoints from Tasks 7–9.
- Produces (`src/sol/messages.js`):
  - `STORAGE_KEY = 'sol_email'`
  - `resendFeedback(status: number, body: object|null): string`
  - `downloadState(search: string): {mode: 'download', t} | {mode: 'expired'} | {mode: 'error', t}`

- [ ] **Step 1: Copy design system C tokens verbatim**

```bash
DS="$HOME/Code/355-SN.SpeakingAcademyLandingPage/Speaker Nation Design System"
mkdir -p src/sol/tokens
cp "$DS"/tokens/{colors,typography,spacing,shape,base}.css src/sol/tokens/
ls src/sol/tokens
```
Expected: 5 files. `fonts.css` is deliberately not copied: fonts load via `<link>` + preconnect in each page head instead of a render-blocking CSS `@import`.

- [ ] **Step 2: Confirm the affiliate-ref exports**

```bash
grep -n "^export" src/affiliate-ref.js
```
Expected: `initAffiliateRef` and `getStoredRef`. If the names differ, use the real names in Step 7.

- [ ] **Step 3: Render the cover from PDF page 1**

```bash
sips -s format jpeg -s formatOptions 82 --resampleWidth 900 \
  ../OneTalkWorkshop/SaidOutLoud/Book.SaidOutLoud.EricEdmeades --out public/assets/sol-cover.jpg
sips -g pixelWidth -g pixelHeight public/assets/sol-cover.jpg
ls -lh public/assets/sol-cover.jpg
```
Expected: a JPEG of ~250 KB or less. **Write down the pixel width and height** for Step 6. If `sips` produces a blank image, use `qlmanage -t -s 900 -o "$TMPDIR" <pdf>` then `sips -s format jpeg` on the PNG it writes. Open the image (Read tool) and confirm it is the cover.

- [ ] **Step 4: Write the failing tests for `src/sol/messages.js`**

```js
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
```

Run `npx vitest run src/sol/messages.test.js` → FAIL.

- [ ] **Step 5: Implement `src/sol/messages.js`**

```js
// Pure copy/state helpers for the Said Out Loud pages (unit-tested).
export const STORAGE_KEY = 'sol_email';
const RETRY_COPY = 'Something went wrong on our side. Try again in a minute.';

export function resendFeedback(status, body) {
  if (status === 200) return 'Sent again. Give it a minute.';
  return (body && typeof body.error === 'string' && body.error) || RETRY_COPY;
}

export function downloadState(search) {
  const q = new URLSearchParams(search);
  const t = q.get('t') || '';
  if (q.get('expired') === '1' || !t) return { mode: 'expired' };
  if (q.get('error') === '1') return { mode: 'error', t };
  return { mode: 'download', t };
}
```

Run `npx vitest run src/sol/messages.test.js` → PASS.

- [ ] **Step 6: Write `src/sol/said-out-loud.css`**

```css
/* Said Out Loud pages — Speaker Nation design system C (Claude Design bundle).
   Scoped to these three pages; never imported by the existing OTW pages. */
@import './tokens/colors.css';
@import './tokens/typography.css';
@import './tokens/spacing.css';
@import './tokens/shape.css';
@import './tokens/base.css';

*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; }
img { max-width: 100%; height: auto; display: block; }

.sol-wrap { width: 100%; max-width: var(--site-content-max); margin: 0 auto; padding: 0 16px; }
@media (min-width: 768px) { .sol-wrap { padding: 0 var(--site-space-5); } }

.sol-top { padding: var(--site-space-4) 0; }
.sol-top img { height: 28px; width: auto; }

/* Hero — stage moment: dark ink, amber spotlight on the one CTA. */
.sol-hero { padding: var(--site-space-6) 0 var(--site-section-pad-mobile); }
@media (min-width: 900px) { .sol-hero { padding: var(--site-space-7) 0 var(--site-section-pad); } }
.sol-hero__grid { display: grid; gap: var(--site-space-6); align-items: start; }
@media (min-width: 900px) { .sol-hero__grid { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: var(--site-space-7); } }
.sol-hero h1 { font-size: clamp(2.5rem, 1.4rem + 4.6vw, var(--site-text-5xl)); margin: var(--site-space-2) 0 var(--site-space-4); }
.sol-sub { font-size: var(--site-text-md); color: var(--site-muted-on-dark); max-width: 34ch; margin: 0; }
.sol-cover { width: min(320px, 70%); border-radius: var(--site-rounded-sm); box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.55); transform: rotate(-2deg); margin-top: var(--site-space-5); }

/* Form card on the stage: white surface, the single soft shadow. */
.sol-card { background: var(--site-surface); color: var(--site-text); border-radius: var(--site-rounded-lg); padding: var(--site-space-5) var(--site-space-4); box-shadow: var(--site-shadow-soft); }
@media (min-width: 768px) { .sol-card { padding: var(--site-space-5); } }
.sol-hook { font-family: var(--site-font-heading); font-style: italic; color: var(--site-text-muted); margin: 0 0 var(--site-space-4); }

.sol-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: var(--site-space-3); }
.sol-field label { font-size: var(--site-text-sm); font-weight: var(--site-weight-medium); }
.sol-optional { color: var(--site-text-muted); font-weight: 400; }
.sol-field input, .sol-field textarea {
  font: inherit; font-size: var(--site-text-base); color: var(--site-text); background: var(--site-surface);
  border: 1px solid var(--site-hairline-strong); border-radius: var(--site-rounded-sm); padding: 11px 14px; width: 100%;
  transition: border-color var(--site-duration) var(--site-ease), box-shadow var(--site-duration) var(--site-ease);
}
.sol-field textarea { min-height: 88px; resize: vertical; }
.sol-field input:focus-visible, .sol-field textarea:focus-visible { outline: none; border-color: var(--site-accent); box-shadow: 0 0 0 3px var(--site-accent-soft); }
.sol-field [aria-invalid="true"] { border-color: var(--site-error); }
.sol-error { font-size: var(--site-text-xs); color: var(--site-error); min-height: 1em; }
.sol-hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }

.sol-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
  padding: 16px 34px; font: var(--site-weight-semibold) 1.0625rem/1 var(--site-font-body);
  color: var(--site-text); background: var(--site-accent); border: 1px solid var(--site-accent);
  border-radius: var(--site-rounded-full); cursor: pointer; text-decoration: none;
  transition: transform var(--site-duration-fast) var(--site-ease), background var(--site-duration) var(--site-ease);
}
.sol-btn:hover { background: #DB9127; border-color: #DB9127; color: var(--site-text); }
.sol-btn:active { transform: scale(0.98); }
.sol-btn:focus-visible { outline: 3px solid var(--site-focus-ring); outline-offset: 3px; }
.sol-btn[disabled] { opacity: 0.45; cursor: not-allowed; }
.sol-btn--ghost { background: transparent; border-color: var(--site-secondary); color: var(--site-secondary); width: auto; padding: 12px 26px; font-size: 1rem; }
.sol-btn--ghost:hover { background: rgba(28, 33, 40, 0.06); border-color: var(--site-secondary); color: var(--site-secondary); }
.sol-fine { font-size: var(--site-text-xs); color: var(--site-text-muted); text-align: center; margin: var(--site-space-2) 0 0; }
.sol-status { font-size: var(--site-text-sm); margin-top: var(--site-space-2); min-height: 1.4em; }
.sol-status[data-kind="error"] { color: var(--site-error); }

/* Editorial body — light, prose width. */
.sol-body { padding: var(--site-section-pad-mobile) 0; }
@media (min-width: 900px) { .sol-body { padding: var(--site-section-pad) 0; } }
.sol-prose { max-width: var(--site-prose-max); font-size: 1.0625rem; }
.sol-prose p { margin: 0 0 var(--site-space-4); }
.sol-prose h2 { font-size: var(--site-text-xl); margin: var(--site-space-6) 0 0; }
.sol-inside { list-style: none; padding: 0; margin: var(--site-space-4) 0 var(--site-space-6); display: grid; gap: var(--site-space-4); }
.sol-inside li { padding-left: var(--site-space-4); border-left: 3px solid var(--site-accent); }
.sol-inside strong { font-family: var(--site-font-heading); }
.sol-who { background: var(--site-surface-sunken); border-radius: var(--site-rounded-md); padding: var(--site-space-5) var(--site-space-4); }
.sol-who p { margin: 0 0 var(--site-space-4); }

.sol-bio { display: grid; gap: var(--site-space-4); align-items: center; padding: var(--site-space-6) 0 0; margin-top: var(--site-space-6); border-top: 1px solid var(--site-hairline); }
@media (min-width: 768px) { .sol-bio { grid-template-columns: 160px 1fr; } }
.sol-bio img { width: 160px; height: 160px; object-fit: cover; border-radius: var(--site-rounded-full); }
.sol-bio p { margin: 0; color: var(--site-text-muted); max-width: 60ch; }

.sol-foot { padding: var(--site-space-5) 0; font-size: var(--site-text-xs); color: var(--site-text-muted); border-top: 1px solid var(--site-hairline); }

/* Thanks + download: one centred panel. */
.sol-panel { max-width: 620px; margin: var(--site-space-7) auto; }
.sol-panel > img { margin-bottom: var(--site-space-6); }
.sol-panel h1 { font-size: clamp(2.25rem, 1.5rem + 3vw, var(--site-text-4xl)); margin: 0 0 var(--site-space-4); }
.sol-help { background: var(--site-surface-sunken); border-radius: var(--site-rounded-md); padding: var(--site-space-4); margin: var(--site-space-5) 0; }
.sol-help p { margin: 0; }
[hidden] { display: none !important; }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; } .sol-cover { transform: none; } }
```

- [ ] **Step 7: Write `said-out-loud/index.html`**

Replace `COVER_W` / `COVER_H` with the numbers recorded in Step 3.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Said Out Loud — a free field guide from Speaker Nation</title>
  <meta name="description" content="Said Out Loud is a free field guide to the rhetorical devices that move a room, and to the patterns that quietly give you away.">
  <meta property="og:title" content="Your Audience Can Hear the AI in Your Script">
  <meta property="og:description" content="Said Out Loud: a free field guide from Eric Edmeades and Speaker Nation.">
  <meta property="og:image" content="https://onetalkworkshop.com/assets/sol-cover.jpg">
  <link rel="icon" href="/assets/favicon-512.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Manrope:wght@500;600;700&family=Inter:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/src/sol/said-out-loud.css">
</head>
<body>
  <header class="section-stage">
    <div class="sol-wrap sol-top">
      <img src="/assets/speaker-nation-logo-white.png" alt="Speaker Nation" width="160" height="28">
    </div>
  </header>

  <main>
    <section class="section-stage sol-hero" aria-labelledby="sol-title">
      <div class="sol-wrap sol-hero__grid">
        <div>
          <p class="site-eyebrow">Free field guide · Said Out Loud</p>
          <h1 id="sol-title" class="site-display">Your Audience Can Hear the AI in Your Script</h1>
          <p class="sol-sub">Said Out Loud is a free field guide to the rhetorical devices that move a room, and to the patterns that quietly give you away.</p>
          <img class="sol-cover" src="/assets/sol-cover.jpg" alt="Cover of Said Out Loud by Eric Edmeades" width="COVER_W" height="COVER_H" loading="eager" fetchpriority="high">
        </div>

        <div class="sol-card" id="get-the-book">
          <p class="sol-hook">The whole book is written by its own rules. If you catch me breaking one, tell me.</p>
          <form data-form="sol-optin" novalidate>
            <div class="sol-field">
              <label for="sol-first">First name</label>
              <input id="sol-first" name="firstName" autocomplete="given-name" required maxlength="100" aria-describedby="sol-first-err">
              <span class="sol-error" id="sol-first-err"></span>
            </div>
            <div class="sol-field">
              <label for="sol-email">Email</label>
              <input id="sol-email" name="email" type="email" autocomplete="email" required maxlength="254" aria-describedby="sol-email-err">
              <span class="sol-error" id="sol-email-err"></span>
            </div>
            <div class="sol-field">
              <label for="sol-about">What do you do, or what might you speak about? <span class="sol-optional">(optional)</span></label>
              <textarea id="sol-about" name="speakAbout" maxlength="500" aria-describedby="sol-about-err"></textarea>
              <span class="sol-error" id="sol-about-err"></span>
            </div>
            <div class="sol-hp" aria-hidden="true">
              <label for="sol-website">Website</label>
              <input id="sol-website" name="website" tabindex="-1" autocomplete="off">
            </div>
            <input type="hidden" name="formStartedAt">
            <button class="sol-btn" type="submit">Send Me the Book</button>
            <p class="sol-fine">Free. Delivered to your inbox. No spam, ever.</p>
            <p class="sol-status" data-kind="error" role="status" aria-live="polite"></p>
          </form>
        </div>
      </div>
    </section>

    <section class="sol-body" aria-label="About the book">
      <div class="sol-wrap sol-prose">
        <p>I recently watched a speaker open his talk with "the velvet hush before dawn" and "the cathedral of your heart," then say "believe" four times in a row. Part of the room loved it. Part of the room rolled its eyes.</p>
        <p>Even the people who loved it didn't buy his book. They didn't come back to see him again. It was like a tanning salon: it looks a bit like sun, but you didn't get any.</p>
        <p>AI writing tools have filled the world with scripts that use the same handful of rhetorical moves at the same steady rate. Audiences have learned to spot them, often without knowing why. And speakers who lean on those scripts are starting to sound like them, even when they're talking off the cuff.</p>
        <p>The fix isn't to stop using rhetoric. The great speeches of history are full of it. The fix is to know the tools well enough to use them on purpose.</p>

        <h2>In Said Out Loud, you'll get:</h2>
        <ul class="sol-inside">
          <li><strong>The working toolkit.</strong> The fifty or so devices that do nearly all the work in modern speaking, in six families, with examples you can use in your next talk.</li>
          <li><strong>The dosage.</strong> How much of each device a page or a stage can take, and where to spend it. Most rhetoric books never tell you this.</li>
          <li><strong>The AI tells.</strong> The ten patterns audiences now flag on sight, with the human version of each.</li>
          <li><strong>A line-by-line teardown.</strong> The "cathedral of your heart" opening, taken apart device by device, so you can hear what went wrong.</li>
          <li><strong>The colour audit.</strong> A ten-minute exercise that shows at a glance whether your writing spends its devices well or feels performed all the way through.</li>
          <li><strong>A one-page cheat sheet</strong> to keep beside your desk when you write and rehearse.</li>
        </ul>

        <div class="sol-who">
          <p>This book is for anyone who speaks for a living, or wants to: keynote speakers, coaches, leaders, trainers, and anyone who's ever read a script back and thought, "That doesn't sound like me."</p>
          <a class="sol-btn sol-btn--ghost" href="#get-the-book">Send Me the Book</a>
        </div>

        <div class="sol-bio">
          <img src="/assets/eric-portrait-800.jpg" alt="Eric Edmeades" width="160" height="160" loading="lazy">
          <p>Eric Edmeades is an international speaker, entrepreneur and the founder of Speaker Nation. He created the Speech Map™ method, which replaces scripts with a visual map of your talk so the words arrive in your own voice. He is the author of The Evolution Gap and The WildFit Way.</p>
        </div>
      </div>
    </section>
  </main>

  <footer class="sol-foot">
    <div class="sol-wrap">Speaker Nation™ — Amplifying Human Wisdom · <a href="mailto:support@speakernation.com">support@speakernation.com</a></div>
  </footer>

  <script type="module" src="/src/sol/optin.js"></script>
</body>
</html>
```

The second "Send Me the Book" is a ghost button, so the amber CTA stays the single accent per view (design system rule).

- [ ] **Step 8: Write `src/sol/optin.js`**

```js
// Opt-in page: stamps formStartedAt, validates, posts to /api/sol-optin, keeps
// the email in sessionStorage for the thank-you page's resend button, navigates.
import { initAnalytics } from '../analytics.js';
import { initAffiliateRef, getStoredRef } from '../affiliate-ref.js';
import { STORAGE_KEY } from './messages.js';

const RETRY_COPY = 'Something went wrong on our side. Try again in a minute.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELDS = ['firstName', 'email', 'speakAbout'];

function setFieldError(form, name, message) {
  const input = form.elements[name];
  const slot = form.querySelector(`#${input.getAttribute('aria-describedby')}`);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  slot.textContent = message || '';
  if (message) input.focus();
}

function readForm(form) {
  const fd = new FormData(form);
  const keys = [...FIELDS, 'website', 'formStartedAt'];
  return Object.fromEntries(keys.map((k) => [k, String(fd.get(k) || '').trim()]));
}

function clientError(data) {
  if (!data.firstName) return ['firstName', 'Please enter your first name.'];
  if (!EMAIL_RE.test(data.email)) return ['email', 'We need a valid email to send the book.'];
  return null;
}

function remember(email) {
  try { sessionStorage.setItem(STORAGE_KEY, email); } catch (_) { /* private mode: thanks page hides the resend button */ }
}

function track() {
  if (typeof window.gtag === 'function') window.gtag('event', 'sol_optin', { form: 'said_out_loud' });
  if (typeof window.fbq === 'function') window.fbq('track', 'Lead', { content_name: 'Said Out Loud' });
}

async function post(data) {
  const res = await fetch('/api/sol-optin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, ref: getStoredRef() || '' }),
  });
  return { res, body: await res.json().catch(() => null) };
}

async function submit(form, status, button) {
  const data = readForm(form);
  FIELDS.forEach((n) => setFieldError(form, n, ''));
  const invalid = clientError(data);
  if (invalid) return setFieldError(form, ...invalid);
  button.disabled = true;
  status.textContent = '';
  try {
    const { res, body } = await post(data);
    if (res.status === 400 && body?.field) return setFieldError(form, body.field, body.error);
    if (!res.ok) throw new Error(body?.error || RETRY_COPY);
    remember(data.email.toLowerCase());
    track();
    window.location.assign('/said-out-loud/thanks');
  } catch (err) {
    status.textContent = err.message || RETRY_COPY;
  } finally {
    button.disabled = false;
  }
  return undefined;
}

document.addEventListener('DOMContentLoaded', () => {
  initAnalytics();
  initAffiliateRef();
  const form = document.querySelector('[data-form="sol-optin"]');
  form.elements.formStartedAt.value = String(Date.now());
  const status = form.querySelector('.sol-status');
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(form, status, button);
  });
});
```

- [ ] **Step 9: Write `said-out-loud/thanks.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Check your inbox — Said Out Loud</title>
  <meta name="robots" content="noindex">
  <link rel="icon" href="/assets/favicon-512.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Manrope:wght@500;600;700&family=Inter:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/src/sol/said-out-loud.css">
</head>
<body>
  <main class="sol-wrap">
    <section class="sol-panel" aria-labelledby="sol-thanks-title">
      <img src="/assets/speaker-nation-logo-black.png" alt="Speaker Nation" width="160" height="28">
      <h1 id="sol-thanks-title" class="site-display">Check your inbox.</h1>
      <p><em>Said Out Loud</em> is on its way from <strong>support@speakernation.com</strong>. It usually arrives within a minute.</p>
      <div class="sol-help">
        <p><strong>Can't find it?</strong> Look in Spam or Promotions. If it landed there, drag it into your inbox and add support@speakernation.com to your contacts, so the next one arrives where you'll see it.</p>
      </div>
      <div data-resend>
        <p>Still nothing after five minutes? <button class="sol-btn sol-btn--ghost" type="button">Send it again</button></p>
        <p class="sol-status" role="status" aria-live="polite"></p>
      </div>
      <p data-no-resend hidden>Still nothing after five minutes? Write to <a href="mailto:support@speakernation.com">support@speakernation.com</a>.</p>
    </section>
  </main>
  <script type="module" src="/src/sol/thanks.js"></script>
</body>
</html>
```

- [ ] **Step 10: Write `src/sol/thanks.js`**

```js
// Thank-you page: "Send it again" posts the email stored by the opt-in page.
import { initAnalytics } from '../analytics.js';
import { STORAGE_KEY, resendFeedback } from './messages.js';

function storedEmail() {
  try { return sessionStorage.getItem(STORAGE_KEY) || ''; } catch (_) { return ''; }
}

async function resend(email, button, status) {
  button.disabled = true;
  try {
    const res = await fetch('/api/sol-resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => null);
    status.dataset.kind = res.ok ? '' : 'error';
    status.textContent = resendFeedback(res.status, body);
    if (res.ok && typeof window.gtag === 'function') window.gtag('event', 'sol_resend');
  } catch (_) {
    status.dataset.kind = 'error';
    status.textContent = resendFeedback(0, null);
  } finally {
    button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initAnalytics();
  const email = storedEmail();
  const block = document.querySelector('[data-resend]');
  if (!email) {
    block.hidden = true;
    document.querySelector('[data-no-resend]').hidden = false;
    return;
  }
  const button = block.querySelector('button');
  const status = block.querySelector('.sol-status');
  button.addEventListener('click', () => resend(email, button, status));
});
```

- [ ] **Step 11: Write `said-out-loud/download.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Said Out Loud — your download</title>
  <meta name="robots" content="noindex">
  <meta name="referrer" content="no-referrer">
  <link rel="icon" href="/assets/favicon-512.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Manrope:wght@500;600;700&family=Inter:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/src/sol/said-out-loud.css">
</head>
<body>
  <main class="sol-wrap">
    <section class="sol-panel">
      <img src="/assets/speaker-nation-logo-black.png" alt="Speaker Nation" width="160" height="28">

      <div data-state="download" hidden>
        <h1 class="site-display">Said Out Loud is yours.</h1>
        <a class="sol-btn" data-download href="#">Download the PDF</a>
        <p>Keep the one-page cheat sheet at the back of the book near your desk.</p>
      </div>

      <div data-state="error" hidden>
        <h1 class="site-display">Almost there.</h1>
        <p>Something went wrong on our side. Try again in a minute.</p>
        <a class="sol-btn" data-download href="#">Try the download again</a>
      </div>

      <div data-state="expired" hidden>
        <h1 class="site-display">This link has expired.</h1>
        <p>Enter your email and we'll send a fresh one.</p>
        <form data-form="sol-fresh" novalidate>
          <div class="sol-field">
            <label for="sol-fresh-email">Email</label>
            <input id="sol-fresh-email" name="email" type="email" autocomplete="email" required maxlength="254">
          </div>
          <button class="sol-btn" type="submit">Send a fresh link</button>
          <p class="sol-status" role="status" aria-live="polite"></p>
        </form>
      </div>
    </section>
  </main>
  <script type="module" src="/src/sol/download.js"></script>
</body>
</html>
```

- [ ] **Step 12: Write `src/sol/download.js`**

```js
// Download page: the download button for a token link, or the fresh-link form
// when the link is missing/expired. The button goes through /api/sol-download,
// which verifies the token and redirects to a short-lived presigned PDF URL.
import { initAnalytics } from '../analytics.js';
import { downloadState, resendFeedback } from './messages.js';

// Neutral on purpose: /api/sol-resend silently succeeds for unknown emails.
const FRESH_SENT = 'If that address has the book, a fresh link is on its way.';

function show(mode) {
  document.querySelectorAll('[data-state]').forEach((el) => { el.hidden = el.dataset.state !== mode; });
}

function wireDownload(t) {
  document.querySelectorAll('[data-download]').forEach((a) => {
    a.href = `/api/sol-download?t=${encodeURIComponent(t)}`;
    a.addEventListener('click', () => {
      if (typeof window.gtag === 'function') window.gtag('event', 'sol_download');
    });
  });
}

async function requestFresh(form, status, button) {
  button.disabled = true;
  try {
    const res = await fetch('/api/sol-resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.elements.email.value.trim() }),
    });
    const body = await res.json().catch(() => null);
    status.dataset.kind = res.ok ? '' : 'error';
    status.textContent = res.ok ? FRESH_SENT : resendFeedback(res.status, body);
  } catch (_) {
    status.dataset.kind = 'error';
    status.textContent = resendFeedback(0, null);
  } finally {
    button.disabled = false;
  }
}

function wireFresh() {
  const form = document.querySelector('[data-form="sol-fresh"]');
  const status = form.querySelector('.sol-status');
  const button = form.querySelector('button');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    requestFresh(form, status, button);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initAnalytics();
  const state = downloadState(window.location.search);
  show(state.mode);
  if (state.t) wireDownload(state.t);
  if (state.mode === 'expired') wireFresh();
});
```

- [ ] **Step 13: Register the entrypoints in `vite.config.js`**

```js
      input: {
        main: resolve(__dirname, 'index.html'),
        stories: resolve(__dirname, 'stories.html'),
        register: resolve(__dirname, 'register.html'),
        survey: resolve(__dirname, 'survey.html'),
        solOptin: resolve(__dirname, 'said-out-loud/index.html'),
        solThanks: resolve(__dirname, 'said-out-loud/thanks.html'),
        solDownload: resolve(__dirname, 'said-out-loud/download.html'),
      },
```

- [ ] **Step 14: Build and verify output paths**

```bash
npm run build
ls dist/said-out-loud/
git diff --stat main -- index.html register.html stories.html survey.html src/styles.css
```
Expected: `download.html  index.html  thanks.html`, and an **empty** diff for the existing pages. With `cleanUrls: true` + `trailingSlash: false`, Vercel serves `/said-out-loud`, `/said-out-loud/thanks`, `/said-out-loud/download`.

- [ ] **Step 15: Local visual smoke test**

```bash
npx vite --port 5173
```
Open `http://localhost:5173/said-out-loud/`, `/said-out-loud/thanks.html`, `/said-out-loud/download.html?t=x`, and `?expired=1`. Check: Anton headline loads; cover renders without layout shift; no console errors; no horizontal scroll at 320 / 768 / 1024 / 1440 px; Tab order goes first name → email → about → button with a visible amber focus ring. (API calls are exercised on the preview in Task 13.)

- [ ] **Step 16: Run the full suite** — `npm test` → all PASS.

- [ ] **Step 17: Commit**

```bash
git add src/sol said-out-loud public/assets/sol-cover.jpg vite.config.js
git commit -m "feat: add Said Out Loud opt-in, thank-you and download pages

Speaker Nation design system C tokens, scoped to these pages only.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Docs and env template

**Files:**
- Modify: `.env.example`, `CLAUDE.md`

- [ ] **Step 1: Append to `.env.example`**

```bash
# --- Said Out Loud ebook opt-in (/said-out-loud) ---------------------------
# Resend API key from the Speaker Nation Resend account (speakernation.com is
# the verified sending domain; From/Reply-To are support@speakernation.com).
RESEND_API_KEY=
# HMAC secret for the 30-day download links. 32+ random bytes:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
SOL_LINK_SECRET=
# Keap tag "Said Out Loud – ebook". Applied for CRM/nurture only; Keap does
# not send the delivery email.
KEAP_TAG_ID_SAID_OUT_LOUD=
# Optional: override the base URL used in emailed links.
# Default: production → https://onetalkworkshop.com, preview → VERCEL_BRANCH_URL.
SOL_PUBLIC_BASE_URL=
```

- [ ] **Step 2: Update `CLAUDE.md`**

1. In Commands, change `npm test           # vitest — currently covers lib/pricing.js only` to `npm test           # vitest — lib/*.test.js (handler tests live in lib/, never api/) and src/sol/*.test.js`.
2. Change `**Three HTML entrypoints**` to `**HTML entrypoints**` and add the bullet `- said-out-loud/{index,thanks,download}.html — the Said Out Loud ebook funnel (see below).`
3. Insert this section immediately before `### The Keap channel of /results is a stored snapshot, never a live read`:

```markdown
### Said Out Loud ebook opt-in (`/said-out-loud`)

A Speaker Nation lead magnet hosted here until speakernation.com is rebuilt. Spec: `docs/superpowers/specs/2026-10-06-said-out-loud-optin-design.md`.

- **Pages** (`said-out-loud/*.html`, `src/sol/*`) use the Claude Design "Speaker Nation Design System" tokens copied into `src/sol/tokens/` (ink/amber, Anton/Manrope/Inter). They never load `src/styles.css`, and the existing pages never load `src/sol/*`.
- **Delivery is Resend, not Keap.** `api/sol-optin.js` sends the email first (from/reply-to `support@speakernation.com`), then records the send in Blob, then writes Keap (contact + `KEAP_TAG_ID_SAID_OUT_LOUD` + a note with the "speak about" answer). A Resend failure is a 502 the visitor sees; a Keap failure is queued to `sol/pending/` and retried by `api/sol-sync-keap.js` (cron `5-59/10`, same fail-closed / paced / stop-on-throttle rules as `refresh-keap.js`). Records that fail 20 times move to `sol/dead/`.
- **Email-only delivery.** The thank-you page never offers the file. The email carries a stateless HMAC token (`lib/sol-token.js`, 30 days); `api/sol-download.js` verifies it and 302s to a 5-minute **presigned** URL for the private PDF (`lib/sol-pdf.js`). Streaming is not possible: function responses cap at ~4.5 MB and the PDF is ~18.6 MB.
- **Rate limit** (`lib/sol-ratelimit.js`): 1 send per 60s and 3 per 24h per email, the opt-in included. `sol-optin` answers a limited request with a silent success and skips Keap; `sol-resend` answers 429. `sol-resend` only mails addresses with an opt-in marker.
- **Replacing the book:** `node --env-file=.env.local scripts/upload-sol-pdf.mjs <pdf>` overwrites the fixed pathname. The source PDF lives in `SaidOutLoud/` (git-ignored).
- Keap helpers shared with `subscribe-otw.js` live in `lib/keap-contact.js`; anti-spam gates in `lib/spam-gates.js`.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: document the Said Out Loud opt-in funnel

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Verify, configure, upload, preview QA, launch (needs Eric)

**Files:** none (operations). Record outcomes in the PR description.

- [ ] **Step 1: Coverage gate**

```bash
npx vitest run --coverage --coverage.include='lib/sol-*.js' --coverage.include='lib/spam-gates.js' --coverage.include='lib/keap-contact.js' --coverage.include='api/sol-*.js'
```
Expected: ≥ 80% lines and branches. If `@vitest/coverage-v8` is missing: `npm i -D @vitest/coverage-v8@^4`, rerun, and commit `package.json` + lock as `chore: add vitest coverage provider`.

- [ ] **Step 2: Reviews.** Dispatch `ecc:code-reviewer` and `ecc:security-reviewer` on `git diff main...HEAD`. Fix CRITICAL/HIGH findings in `fix: …` commits; rerun `npm test`.

- [ ] **Step 3: Eric — Keap tag.** Ask Eric to create the tag **"Said Out Loud – ebook"** in Keap and send its numeric ID.

- [ ] **Step 4: Resend domain check.** Using the `RESEND_API_KEY` from the speakernation Vercel project:
```bash
curl -s https://api.resend.com/domains -H "Authorization: Bearer $RESEND_API_KEY" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.map(x=>x.name+' '+x.status)))"
```
Expected: includes `speakernation.com verified`. If not, stop and tell Eric.

- [ ] **Step 5: Set env vars on the OTW Vercel project** for Preview **and** Production, after Eric approves: `RESEND_API_KEY`, `SOL_LINK_SECRET` (freshly generated), `KEAP_TAG_ID_SAID_OUT_LOUD`. Confirm `CRON_SECRET`, `KEAP_API_KEY` and Blob credentials also exist for **Preview** (CLAUDE.md notes some vars are Production-only).

- [ ] **Step 6: Upload the PDF**

```bash
vercel env pull .env.local --environment=production
node --env-file=.env.local scripts/upload-sol-pdf.mjs ../OneTalkWorkshop/SaidOutLoud/Book.SaidOutLoud.EricEdmeades
rm .env.local
```
Expected: `Uploaded 18.6 MB → said-out-loud/Said-Out-Loud-Eric-Edmeades.pdf`. Preview and Production share the one Blob store.

- [ ] **Step 7: Push and open the PR**

```bash
git push
gh pr create --title "feat: Said Out Loud ebook opt-in funnel" --body "$(cat <<'EOF'
## Summary
- `/said-out-loud` opt-in, `/thanks` and `/download` pages in Speaker Nation design system C
- Resend delivers the ebook link (from/reply-to support@speakernation.com); Keap gets contact + tag + note, with a Blob-queued cron retry when Keap is throttled
- Signed 30-day email links → 5-minute presigned URL for the private PDF
- Keap helpers + spam gates extracted from `subscribe-otw.js` (behavior pinned by tests first)

## Copy not in the spec (please confirm)
- Expired-link form success: "If that address has the book, a fresh link is on its way."
- Download error state: "Almost there." / "Try the download again"

## Test plan
- [ ] `npm test` green; coverage ≥ 80% on new modules
- [ ] Preview: full loop with a real inbox
- [ ] Preview: resend + rate limit, expired link, mangled link
- [ ] Preview: 320/768/1024/1440, keyboard-only, contrast
- [ ] Preview: stage-fright form on `/` still works
- [ ] Eric's review-mode pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 8: Preview QA in a real browser** (Canary session or `/qa`) on the preview URL:
  1. Opt in with a real inbox → lands on `/said-out-loud/thanks`.
  2. Email arrives from `Speaker Nation <support@speakernation.com>`, reply-to `support@speakernation.com`, link host = preview URL.
  3. Click the link → download page → **Download the PDF** → PDF opens or downloads.
  4. Keap: contact has tag `KEAP_TAG_ID_SAID_OUT_LOUD` and the note with the speak-about answer.
  5. "Send it again" immediately → "We've just sent it. Try again in a minute."; after 60s → "Sent again. Give it a minute."; third send in the day → daily-cap copy.
  6. `/said-out-loud/download?t=garbage` → expired form; submit the opted-in email → a new email arrives.
  7. Widths 320/768/1024/1440: no horizontal scroll; keyboard-only submit works; CTA text contrast ≥ 4.5:1 (`#1C2128` on `#E9A13B`).
  8. No console errors on all three pages.
  9. Regression: the stage-fright form on `/` still submits.
  10. Cron: `curl -H "Authorization: Bearer $CRON_SECRET" https://<preview>/api/sol-sync-keap` → `{"ok":true,...}`.

- [ ] **Step 9: Eric's review.** Add Review Mode to the preview (`review-mode` skill) and send Eric the link. Apply his comments as `fix:` / `style:` commits.

- [ ] **Step 10: Launch.** After Eric approves: merge the PR to `main` → production. Run one real opt-in on `https://onetalkworkshop.com/said-out-loud`. Then remove the worktree from the main checkout: `git -C ~/Code/OneTalkWorkshop worktree remove ../OneTalkWorkshop-said-out-loud`.
