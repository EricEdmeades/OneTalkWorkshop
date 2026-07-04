# Two-Date Stripe Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let buyers choose between two confirmed workshop dates (Aug 7–9 / Sep 18–20, 2026) on a new `/register.html` page, pay via Stripe Checkout (full or 2-payment plan), and have a webhook apply the right Keap tag (`2008` August / `1825` September) so we always know which date each buyer picked.

**Architecture:** `index.html` CTAs point at a new `/register.html` (own Vite entry, no name/email form — Stripe Checkout collects that). Its buttons POST `{date, plan}` to a new `api/create-checkout.js`, which re-derives the Early/Retail tier itself from the server clock (never trusts the client) and creates a Stripe Checkout Session. A new `api/stripe-webhook.js` listens for `checkout.session.completed` and applies the Keap tag, reusing the Keap helper pattern already in `api/subscribe-otw.js`. A shared `lib/pricing.js` module holds the tier-cutoff/date math so client display and server enforcement can't drift apart — it has unit tests (this repo has no test runner yet, so this task also introduces `vitest`).

**Tech Stack:** Vite (existing), vanilla JS ES modules (existing), Vercel Serverless Functions (existing pattern), `stripe` npm SDK (new), `vitest` (new, for the one pure-logic module worth unit testing).

**Spec:** `docs/superpowers/specs/2026-07-04-two-date-registration-design.md`

---

### Task 1: Shared pricing/tier module with unit tests

**Files:**
- Create: `lib/pricing.js`
- Test: `lib/pricing.test.js`
- Modify: `package.json`

- [ ] **Step 1: Install vitest and add a test script**

Run:
```bash
npm install -D vitest
```

Then edit `package.json` — add a `"test"` script (keep existing scripts):

```json
{
  "name": "onetalk-landing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  }
}
```

(`npm install` already added `vitest` under `devDependencies` — don't hand-edit that part.)

- [ ] **Step 2: Write the failing test file**

Create `lib/pricing.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { getActiveTier, getSubscriptionCancelAt, isValidDate, isValidPlan } from './pricing.js';

describe('getActiveTier', () => {
  it('is early for August before the cutoff', () => {
    const beforeCutoff = Date.UTC(2026, 6, 8, 3, 59, 58);
    expect(getActiveTier('august', beforeCutoff)).toBe('early');
  });

  it('is retail for August at/after the cutoff', () => {
    const atCutoff = Date.UTC(2026, 6, 8, 3, 59, 59);
    expect(getActiveTier('august', atCutoff)).toBe('retail');
  });

  it('is early for September before the cutoff', () => {
    const beforeCutoff = Date.UTC(2026, 6, 31, 3, 59, 58);
    expect(getActiveTier('september', beforeCutoff)).toBe('early');
  });

  it('is retail for September at/after the cutoff', () => {
    const atCutoff = Date.UTC(2026, 6, 31, 3, 59, 59);
    expect(getActiveTier('september', atCutoff)).toBe('retail');
  });

  it('throws for an unknown date', () => {
    expect(() => getActiveTier('october', Date.now())).toThrow('Unknown date: october');
  });
});

describe('getSubscriptionCancelAt', () => {
  it('returns unix seconds 15 days after now', () => {
    const now = Date.UTC(2026, 6, 1, 0, 0, 0);
    const expected = Math.floor((now + 15 * 24 * 60 * 60 * 1000) / 1000);
    expect(getSubscriptionCancelAt(now)).toBe(expected);
  });
});

describe('isValidDate / isValidPlan', () => {
  it('accepts known dates and rejects others', () => {
    expect(isValidDate('august')).toBe(true);
    expect(isValidDate('september')).toBe(true);
    expect(isValidDate('october')).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });

  it('accepts known plans and rejects others', () => {
    expect(isValidPlan('full')).toBe(true);
    expect(isValidPlan('plan')).toBe(true);
    expect(isValidPlan('installments')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `lib/pricing.js` does not exist (`Cannot find module './pricing.js'` or similar).

- [ ] **Step 4: Implement `lib/pricing.js`**

Create `lib/pricing.js`:

```js
// lib/pricing.js — shared pure pricing/tier logic for the two workshop
// dates. No Stripe/Keap/env access here — imported by both the client
// bundle (src/register.js, for display) and the server
// (api/create-checkout.js, authoritative). Keeping the cutoff dates in
// exactly one place prevents client display and server pricing from
// drifting out of sync.

const EARLY_CUTOFFS_UTC = {
  // "Early through Jul 7" (ET, UTC-4) ends Jul 8 03:59:59 UTC.
  august: Date.UTC(2026, 6, 8, 3, 59, 59),
  // "Early through Jul 30" (ET, UTC-4) ends Jul 31 03:59:59 UTC.
  september: Date.UTC(2026, 6, 31, 3, 59, 59),
};

export const PRICES = {
  early: { full: 1297, plan: 677, planTotal: 1354 },
  retail: { full: 1597, plan: 827, planTotal: 1654 },
};

export function isValidDate(date) {
  return date === 'august' || date === 'september';
}

export function isValidPlan(plan) {
  return plan === 'full' || plan === 'plan';
}

export function getActiveTier(date, now = Date.now()) {
  const cutoff = EARLY_CUTOFFS_UTC[date];
  if (cutoff == null) throw new Error(`Unknown date: ${date}`);
  return now < cutoff ? 'early' : 'retail';
}

// The recurring Price's own 2-week billing cycle fires the 2nd charge
// around day 14 after subscription creation. cancel_at is set to day 15
// (not day 14) so it stops the subscription right after that charge
// lands, never before it — see the design spec for the full reasoning.
const SUBSCRIPTION_CANCEL_DELAY_MS = 15 * 24 * 60 * 60 * 1000;

export function getSubscriptionCancelAt(now = Date.now()) {
  return Math.floor((now + SUBSCRIPTION_CANCEL_DELAY_MS) / 1000);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 8 tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/pricing.js lib/pricing.test.js
git commit -m "feat: add shared pricing/tier module with vitest unit tests"
```

---

### Task 2: Stripe SDK dependency and env var scaffolding

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install the Stripe SDK**

Run:
```bash
npm install stripe
```

- [ ] **Step 2: Add the new env vars**

Edit `.env.example` — append this new section after the existing Keap section (keep everything already in the file):

```
# ─ Stripe (server-side only, used by /api/create-checkout and /api/stripe-webhook) ─
# Live/test secret key from the Stripe Dashboard.
STRIPE_SECRET_KEY=

# Signing secret for the /api/stripe-webhook endpoint (Dashboard → Webhooks
# → your endpoint → Signing secret). Required to verify incoming events.
STRIPE_WEBHOOK_SECRET=

# Price IDs for the 4 combos. Amounts are identical for both workshop
# dates, so these 4 Prices are reused across August and September —
# which date it is gets carried in Checkout Session metadata instead.
STRIPE_PRICE_EARLY_FULL=
STRIPE_PRICE_RETAIL_FULL=
STRIPE_PRICE_EARLY_PLAN=
STRIPE_PRICE_RETAIL_PLAN=

# Keap tag IDs applied by /api/stripe-webhook once a Stripe Checkout
# Session completes, so we know which date a buyer registered for.
KEAP_TAG_ID_AUGUST=2008
KEAP_TAG_ID_SEPTEMBER=1825
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add Stripe SDK dependency and env var scaffolding"
```

---

### Task 3: `api/create-checkout.js` — Stripe Checkout Session creation

**Files:**
- Create: `api/create-checkout.js`

- [ ] **Step 1: Write the endpoint**

Create `api/create-checkout.js`:

```js
// api/create-checkout.js — creates a Stripe Checkout Session for a chosen
// workshop date + payment plan. Tier (Early/Retail) is always re-derived
// here from the server clock — never trusted from the client, so a
// stale/bookmarked link can't buy early pricing after the cutoff.

import Stripe from 'stripe';
import { getActiveTier, getSubscriptionCancelAt, isValidDate, isValidPlan } from '../lib/pricing.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_ENV_VARS = {
  early: { full: 'STRIPE_PRICE_EARLY_FULL', plan: 'STRIPE_PRICE_EARLY_PLAN' },
  retail: { full: 'STRIPE_PRICE_RETAIL_FULL', plan: 'STRIPE_PRICE_RETAIL_PLAN' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[create-checkout] STRIPE_SECRET_KEY is not set');
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  const body = req.body || {};
  const { date, plan, ref } = body;

  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'Invalid or missing date.' });
  }
  if (!isValidPlan(plan)) {
    return res.status(400).json({ error: 'Invalid or missing plan.' });
  }

  const tier = getActiveTier(date);
  const priceEnvVar = PRICE_ENV_VARS[tier][plan];
  const priceId = process.env[priceEnvVar];
  if (!priceId) {
    console.error(`[create-checkout] Missing env var ${priceEnvVar}`);
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const metadata = { date, tier, plan };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: plan === 'plan' ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      client_reference_id: typeof ref === 'string' && ref ? ref : undefined,
      success_url: `${origin}/register.html?success=1&date=${encodeURIComponent(date)}&tier=${encodeURIComponent(tier)}&plan=${encodeURIComponent(plan)}`,
      cancel_url: `${origin}/register.html?canceled=1`,
      ...(plan === 'plan'
        ? { subscription_data: { cancel_at: getSubscriptionCancelAt(), metadata } }
        : {}),
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[create-checkout]', message);
    return res.status(500).json({ error: "We couldn't start checkout. Please try again." });
  }
}
```

- [ ] **Step 2: Verify request validation without hitting Stripe**

There's no test runner set up for HTTP handlers in this repo (the existing `api/subscribe-otw.js`/`api/notify-otw.js` have none either — they're verified manually via `vercel dev`). The date/plan validation and tier lookup are already covered indirectly by `lib/pricing.test.js`. Confirm the file has no syntax errors:

Run: `node --check api/create-checkout.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add api/create-checkout.js
git commit -m "feat: add /api/create-checkout Stripe Checkout Session endpoint"
```

**Note for later manual verification (needs your own Stripe test-mode credentials — not runnable by an agent without them):** once `STRIPE_SECRET_KEY` and the 4 `STRIPE_PRICE_*` test-mode IDs are set locally (`.env.local`) or in Vercel, run `vercel dev` and:
```bash
curl -X POST http://localhost:3000/api/create-checkout \
  -H "Content-Type: application/json" \
  -d '{"date":"august","plan":"full"}'
```
Expected: `{"url":"https://checkout.stripe.com/..."}`. A bad payload (`{"date":"october","plan":"full"}`) should return 400.

---

### Task 4: `api/stripe-webhook.js` — Keap tagging on checkout completion

**Files:**
- Create: `api/stripe-webhook.js`

- [ ] **Step 1: Write the webhook handler**

Create `api/stripe-webhook.js`:

```js
// api/stripe-webhook.js — applies a Keap tag (August or September) the
// moment a Stripe Checkout Session completes, so we know which workshop
// date a buyer registered for. Keap helpers mirror api/subscribe-otw.js.
//
// Unlike the form endpoints, a Keap failure here returns 500 (not 200)
// so Stripe's automatic webhook retry (up to 3 days) gets another shot —
// there's no user waiting on this request to retry manually.

import Stripe from 'stripe';

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const KEAP_BASE_V1 = 'https://api.infusionsoft.com/crm/rest/v1';
const KEAP_BASE_V2 = 'https://api.infusionsoft.com/crm/rest/v2';

function tagIds() {
  return {
    august: Number(process.env.KEAP_TAG_ID_AUGUST || 2008),
    september: Number(process.env.KEAP_TAG_ID_SEPTEMBER || 1825),
  };
}

function keapHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Keap-API-Key': process.env.KEAP_API_KEY,
  };
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function findContactByEmail(email) {
  const url = `${KEAP_BASE_V1}/contacts?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: keapHeaders() });
  if (!res.ok) throw new Error(`Keap search failed: ${res.status}`);
  const data = await res.json();
  return (data.contacts && data.contacts[0]) || null;
}

async function createContact({ firstName, lastName, email }) {
  const res = await fetch(`${KEAP_BASE_V1}/contacts`, {
    method: 'POST',
    headers: keapHeaders(),
    body: JSON.stringify({
      given_name: firstName,
      family_name: lastName,
      email_addresses: [{ email, field: 'EMAIL1' }],
      opt_in_reason: 'One Talk Workshop — Stripe registration',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keap create failed: ${res.status} ${text}`);
  }
  const created = await res.json();
  return created.id;
}

async function updateContact(contactId, { firstName, lastName, email }) {
  const res = await fetch(`${KEAP_BASE_V1}/contacts/${contactId}`, {
    method: 'PATCH',
    headers: keapHeaders(),
    body: JSON.stringify({
      given_name: firstName,
      family_name: lastName,
      email_addresses: [{ email, field: 'EMAIL1' }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keap update failed: ${res.status} ${text}`);
  }
}

function isTagFailureValue(v) {
  if (v == null) return false;
  if (typeof v !== 'string') return false;
  const upper = v.toUpperCase();
  return upper.includes('ERROR') || upper.includes('NOT_FOUND');
}

async function applyTag(contactId, tagId) {
  const res = await fetch(`${KEAP_BASE_V1}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: keapHeaders(),
    body: JSON.stringify({ tagIds: [tagId] }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keap tag apply HTTP ${res.status} for contact ${contactId} tag ${tagId}: ${text}`);
  }
  let body;
  try {
    body = await res.json();
  } catch (_) {
    body = {};
  }
  const failures = Object.entries(body).filter(([_, v]) => isTagFailureValue(v));
  if (failures.length > 0) {
    const failedIds = failures.map(([id]) => id).join(', ');
    throw new Error(`Keap tag apply rejected for contact ${contactId} tag(s) [${failedIds}]: ${JSON.stringify(body)}`);
  }
}

async function addNote(contactId, title, body) {
  const res = await fetch(`${KEAP_BASE_V2}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: keapHeaders(),
    body: JSON.stringify({ title, text: body }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[stripe-webhook] Note add failed: ${res.status} ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) {
    console.error('[stripe-webhook] Stripe env vars are not set');
    return res.status(500).json({ error: 'Server is not configured.' });
  }

  const signature = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const date = session.metadata?.date;
  const tier = session.metadata?.tier;
  const plan = session.metadata?.plan;
  const tagId = tagIds()[date];

  if (!tagId) {
    console.error(`[stripe-webhook] Unknown date in session metadata: ${date}`);
    return res.status(200).json({ received: true });
  }

  const email = session.customer_details?.email;
  if (!email) {
    console.error(`[stripe-webhook] No customer email on session ${session.id}`);
    return res.status(200).json({ received: true });
  }

  const fullName = session.customer_details?.name || '';
  const [firstName, ...rest] = fullName.split(' ');
  const lastName = rest.join(' ') || firstName || 'Unknown';

  try {
    const existing = await findContactByEmail(email);
    let contactId;
    if (existing) {
      contactId = existing.id;
      await updateContact(contactId, { firstName: firstName || 'Unknown', lastName, email });
    } else {
      contactId = await createContact({ firstName: firstName || 'Unknown', lastName, email });
    }

    await applyTag(contactId, tagId);

    const amount = session.amount_total != null ? (session.amount_total / 100).toFixed(2) : 'unknown';
    const today = new Date().toISOString().slice(0, 10);
    await addNote(
      contactId,
      `OneTalk — ${date} registration (${today})`,
      [
        'Source: onetalkworkshop.com (Stripe Checkout)',
        `Date: ${date}`,
        `Tier: ${tier}`,
        `Plan: ${plan === 'plan' ? '2 payments' : 'pay in full'}`,
        `Amount charged today: $${amount}`,
        `Tag applied: ${tagId}`,
        `Email: ${email}`,
      ].join('\n'),
    );

    return res.status(200).json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] Failed to process session ${session.id}:`, message);
    return res.status(500).json({ error: 'Failed to process registration.' });
  }
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check api/stripe-webhook.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add api/stripe-webhook.js
git commit -m "feat: add /api/stripe-webhook to apply Keap tags on Stripe checkout completion"
```

**Note for later manual verification (needs Stripe CLI + your webhook secret — not runnable by an agent without them):**
```bash
stripe listen --forward-to localhost:3000/api/stripe-webhook
stripe trigger checkout.session.completed
```
Expected: 200 response logged by the CLI, and (with real `KEAP_API_KEY`/`STRIPE_PRICE_*` test data) a new/updated contact with the right tag in Keap.

---

### Task 5: Register `register.html` as a Vite entry point

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: Add the entry**

Edit `vite.config.js`:

```js
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default {
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        stories: resolve(__dirname, 'stories.html'),
        register: resolve(__dirname, 'register.html'),
      },
    },
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add vite.config.js
git commit -m "chore: register register.html as a Vite build entry"
```

(This will fail to build until Task 7 creates `register.html` — that's expected; `npm run build` is verified at the end in Task 13.)

---

### Task 6: Refactor `src/affiliate-ref.js` — export a getter, drop the dead checkout-link rewriting

**Files:**
- Modify: `src/affiliate-ref.js`

The old `CHECKOUT_BASE` (`speakernation.com/flow/...`) no longer appears anywhere on the site once checkout moves to Stripe, so the `a[href^=CHECKOUT_BASE]` link-rewriting half of this file is dead code. The ref-capture-and-store half is still needed — `register.js` (Task 8) will read it back and forward it to `/api/create-checkout`.

- [ ] **Step 1: Rewrite the file**

Replace the full contents of `src/affiliate-ref.js`:

```js
// =============================================================================
// Affiliate ref passthrough
// -----------------------------------------------------------------------------
// Reads ?ref= from the landing URL and persists it in localStorage for 30
// days. register.js reads it back via getStoredRef() and forwards it to
// /api/create-checkout as client_reference_id, so AffiliateWP can attribute
// the sale once Stripe's webhook fires.
// =============================================================================

const STORAGE_KEY = 'otw_affiliate_ref';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function getStoredRef() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { value, ts } = JSON.parse(raw);
    if (!value || typeof ts !== 'number') return null;
    if (Date.now() - ts > MAX_AGE_MS) return null;
    return value;
  } catch {
    return null;
  }
}

function writeStoredRef(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ value, ts: Date.now() }));
  } catch {
    // Storage unavailable (private mode, quota) — ref still applies to this page load.
  }
}

export function initAffiliateRef() {
  const urlRef = new URLSearchParams(window.location.search).get('ref');
  if (urlRef) writeStoredRef(urlRef);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/affiliate-ref.js
git commit -m "refactor: drop dead checkout-link rewriting from affiliate-ref, export getStoredRef"
```

---

### Task 7: `register.html` — the date/tier/plan selection page

**Files:**
- Create: `register.html`

- [ ] **Step 1: Add the new CSS for the date cards**

Append to `src/styles.css` (after the existing `/* ================= OFFER ================= */` block, i.e. after the `.offer-assure-item` rule):

```css
  /* ================= REGISTER (date selection) ================= */
  .date-cards {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;
    max-width: 1040px;
    margin: 0 auto;
  }
  @media (max-width: 900px) {
    .date-cards { grid-template-columns: 1fr; }
  }
  .date-card .price-now .was {
    text-decoration: line-through;
    opacity: 0.5;
    font-size: 0.4em;
    vertical-align: 12%;
    margin-left: 10px;
  }
  .date-card-buttons {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 28px;
  }
```

- [ ] **Step 2: Create `register.html`**

Create `register.html` (nav/footer mirror `stories.html`'s pattern — logo-only nav, same footer):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Register — The One Talk Workshop with Eric Edmeades</title>
<meta name="description" content="Choose your date and reserve your seat for The One Talk Workshop with Eric Edmeades — August 7–9 or September 18–20, 2026.">
<meta name="theme-color" content="#E26320">
<link rel="canonical" href="https://onetalk.ericedmeades.com/register">

<link rel="icon" type="image/png" href="/assets/favicon-512.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/src/styles.css">
</head>
<body>

<!-- Nav (logo only — this page IS the reserve destination) -->
<nav class="topnav">
  <div class="nav-inner">
    <a href="/" class="nav-logo">
      <img src="/assets/speaker-nation-logo-black.png" alt="Speaker Nation" width="150" height="53">
    </a>
  </div>
</nav>

<!-- ================= REGISTER ================= -->
<section class="offer sect-pad">
  <div class="wrap">
    <div class="offer-inner">
      <span class="eyebrow">Reserve Your Seat</span>
      <h1>Choose your date.</h1>
      <p class="lead" style="max-width:560px; margin:0 auto 3rem;">Both dates run the same 3-day format. Pick whichever works for your schedule.</p>
    </div>

    <div class="register-cards">
      <div class="date-cards">
        <div class="price-frame date-card" data-date="august">
          <div class="price-label"></div>
          <h3 style="margin-top:0;">August 7–9, 2026</h3>
          <p style="opacity:0.75; margin-bottom:0;">10:00 AM–2:00 PM Eastern each day</p>

          <div class="price-block">
            <div class="price-now"><span class="dollar">$</span><span class="amount"></span></div>
            <div class="price-detail"></div>
          </div>

          <div class="date-card-buttons">
            <button type="button" class="btn-primary" data-plan="full"></button>
            <button type="button" class="btn-primary" data-plan="plan"></button>
          </div>
          <p class="lead-error" role="alert" aria-live="polite"></p>
        </div>

        <div class="price-frame date-card" data-date="september">
          <div class="price-label"></div>
          <h3 style="margin-top:0;">September 18–20, 2026</h3>
          <p style="opacity:0.75; margin-bottom:0;">10:00 AM–2:00 PM Eastern each day</p>

          <div class="price-block">
            <div class="price-now"><span class="dollar">$</span><span class="amount"></span></div>
            <div class="price-detail"></div>
          </div>

          <div class="date-card-buttons">
            <button type="button" class="btn-primary" data-plan="full"></button>
            <button type="button" class="btn-primary" data-plan="plan"></button>
          </div>
          <p class="lead-error" role="alert" aria-live="polite"></p>
        </div>
      </div>
    </div>

    <p class="lead-micro" style="text-align:center; margin-top:2rem;">100% money-back guarantee. Your information is 100% secure.</p>
  </div>
</section>

<!-- Footer -->
<footer>
  <div class="foot-inner">
    <div class="foot-logo">
      <img src="/assets/speaker-nation-logo-white.png" alt="Speaker Nation" width="1000" height="354" loading="lazy" decoding="async">
    </div>
    <div class="foot-links">
      <a href="https://speakernation.com/privacy-policy/">Privacy Policy</a>
      <a href="https://speakernation.com/terms-and-conditions/">Terms &amp; Conditions</a>
      <a href="mailto:support@speakernation.com">Contact</a>
    </div>
    <div class="foot-copy">© 2026 Speaker Nation. All rights reserved.</div>
  </div>
  <div class="disclaimer">
    <strong>Results Disclaimer:</strong> The outcomes and results referenced on this page represent what past participants have experienced. Individual results will vary based on experience, effort, background, and market conditions. Nothing on this page constitutes a guarantee of income, business growth, or any specific outcome.
  </div>
</footer>

<script type="module" src="/src/register.js"></script>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add register.html src/styles.css
git commit -m "feat: add register.html date-selection page markup"
```

(This page has no behavior yet — the buttons are empty and the price fields are blank until Task 8 wires up `src/register.js`. Don't manually verify in a browser until then.)

---

### Task 8: `src/register.js` — client-side date-card logic

**Files:**
- Create: `src/register.js`

- [ ] **Step 1: Write the module**

Create `src/register.js`:

```js
// =============================================================================
// /register.html — date + tier + plan selection.
// -----------------------------------------------------------------------------
// Renders the currently-active tier/price into each date card (display
// only — the server re-derives the tier authoritatively in
// api/create-checkout.js), then POSTs the buyer's choice there and
// redirects to the returned Stripe Checkout URL. Also handles the
// ?success=1 / ?canceled=1 return states from Stripe.
// =============================================================================

import { getActiveTier, PRICES } from '../lib/pricing.js';
import { initAnalytics, trackCtaClick } from './analytics.js';
import { wrapHeadingWords } from './word-hover.js';
import { initAffiliateRef, getStoredRef } from './affiliate-ref.js';

const DATE_LABELS = {
  august: 'August 7–9, 2026',
  september: 'September 18–20, 2026',
};

function renderCard(card) {
  const date = card.dataset.date;
  const tier = getActiveTier(date);
  const price = PRICES[tier];

  const tierLabelEl = card.querySelector('.price-label');
  const amountEl = card.querySelector('.price-now .amount');
  const detailEl = card.querySelector('.price-detail');

  tierLabelEl.textContent = tier === 'early' ? 'Early Registration' : 'Retail Registration';
  amountEl.innerHTML = tier === 'early'
    ? `${price.full}<span class="was">$${PRICES.retail.full}</span>`
    : `${price.full}`;
  detailEl.textContent = `or 2 payments of $${price.plan} ($${price.planTotal} total)`;

  card.querySelectorAll('button[data-plan]').forEach((btn) => {
    const plan = btn.dataset.plan;
    btn.textContent = plan === 'full' ? `Pay in Full — $${price.full}` : `2 Payments of $${price.plan}`;
  });
}

async function startCheckout(date, plan, button) {
  const card = button.closest('.date-card');
  const errorEl = card.querySelector('.lead-error');
  const buttons = card.querySelectorAll('button[data-plan]');
  buttons.forEach((b) => { b.disabled = true; });
  if (errorEl) errorEl.textContent = '';

  try {
    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, plan, ref: getStoredRef() }),
    });

    let data = {};
    try { data = await res.json(); } catch (_) { /* ignore */ }

    if (!res.ok || !data.url) {
      throw new Error(data.error || 'Could not start checkout. Please try again.');
    }

    trackCtaClick(`register_${date}_${plan}`);
    window.location.href = data.url;
  } catch (err) {
    buttons.forEach((b) => { b.disabled = false; });
    if (errorEl) errorEl.textContent = err.message || 'Something went wrong. Please try again.';
  }
}

function showConfirmation(params) {
  const container = document.querySelector('.register-cards');
  if (!container) return;

  const date = params.get('date');
  const tier = params.get('tier');
  const dateLabel = DATE_LABELS[date] || 'your workshop';
  const tierLabel = tier === 'early' ? 'Early Registration' : 'Retail Registration';

  container.innerHTML = `
    <div class="lead-confirm">
      <strong>You're registered!</strong>
      ${dateLabel} · ${tierLabel}. Check your email for confirmation and access details.
    </div>
  `;

  const amount = tier === 'early' ? PRICES.early.full : PRICES.retail.full;
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'purchase', {
      transaction_id: `${date}-${Date.now()}`,
      value: amount,
      currency: 'USD',
      items: [{ item_name: `OTW ${date}`, item_variant: params.get('plan') }],
    });
  }
  if (typeof window.fbq === 'function') {
    window.fbq('track', 'Purchase', { value: amount, currency: 'USD' });
  }
}

function scrollToHashedCard() {
  const hash = window.location.hash.slice(1);
  if (hash !== 'august' && hash !== 'september') return;
  const target = document.querySelector(`.date-card[data-date="${hash}"]`);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function init() {
  wrapHeadingWords();
  initAnalytics();
  initAffiliateRef();

  const params = new URLSearchParams(window.location.search);
  if (params.get('success') === '1') {
    showConfirmation(params);
    return;
  }

  document.querySelectorAll('.date-card').forEach(renderCard);
  document.querySelectorAll('.date-card button[data-plan]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.date-card');
      startCheckout(card.dataset.date, btn.dataset.plan, btn);
    });
  });

  scrollToHashedCard();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

- [ ] **Step 2: Add the `.register-cards` wrapper class reference check**

`register.html` (Task 7) already wraps the two `.date-card`s in a `<div class="register-cards">` — `showConfirmation` replaces that wrapper's contents. No markup change needed here; this step is just confirming the class name matches (`register-cards` in both files).

- [ ] **Step 3: Run the dev server and manually verify**

Run: `npm run dev`, then open `http://localhost:5173/register.html`

Expected:
- Both cards show "Early Registration" and `$1,297` with `$1,597` struck through (today's date in this repo's environment is before both cutoffs).
- Each card has two buttons reading "Pay in Full — $1,297" and "2 Payments of $677".
- Clicking a button disables both buttons on that card and attempts a `fetch` to `/api/create-checkout` — without `vercel dev` and real Stripe env vars this will fail; confirm the inline error message appears in `.lead-error` rather than a silent failure or a thrown exception in the console.
- Visiting `http://localhost:5173/register.html?success=1&date=august&tier=early&plan=full` replaces the cards with the "You're registered!" confirmation panel.

- [ ] **Step 4: Commit**

```bash
git add src/register.js
git commit -m "feat: add register.js date-card rendering, checkout POST, and confirmation handling"
```

---

### Task 9: Retire the waitlist code

**Files:**
- Delete: `api/notify-otw.js`
- Modify: `src/form.js`
- Modify: `src/main.js`

Real dates now exist, so the "notify me when registration opens" waitlist flow is fully retired (not just hidden) — `index.html`'s `#waitlist` section is removed in Task 10, which makes this code unreachable dead code.

- [ ] **Step 1: Delete the waitlist API endpoint**

```bash
git rm api/notify-otw.js
```

- [ ] **Step 2: Remove `initWaitlistForm` from `src/form.js`**

Delete the entire `export function initWaitlistForm() { ... }` function and its `swapForWaitlistConfirmation` helper (everything from the `export function initWaitlistForm()` line to the end of the file — lines 115–204 in the current file). The file should end right after the `swapForConfirmation` function that serves `initLeadMagnetForm`:

```js
function swapForConfirmation(form) {
  const confirm = document.createElement('div');
  confirm.className = 'lead-confirm';
  confirm.innerHTML =
    '<strong>You’re in.</strong>Check your email for the 5 Steps to Overcoming Stage Fright worksheet.';
  form.replaceWith(confirm);
}
```

(Everything above that line — `initLeadMagnetForm`, `validate`, `showError` — stays unchanged.)

- [ ] **Step 3: Remove the import/call in `src/main.js`**

Edit `src/main.js`:

```js
import { initAnalytics } from './analytics.js';
import { wrapHeadingWords } from './word-hover.js';
import { initLeadMagnetForm } from './form.js';
import { initTestimonialCarousel } from './testimonials.js';
import { initAffiliateRef } from './affiliate-ref.js';

function boot() {
  wrapHeadingWords();
  initAnalytics();
  initAffiliateRef();
  initLeadMagnetForm();
  initTestimonialCarousel();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
```

- [ ] **Step 4: Commit**

```bash
git add -A api/notify-otw.js src/form.js src/main.js
git commit -m "chore: retire the waitlist opt-in flow now that real registration is live"
```

---

### Task 10: `index.html` — restore registration surfaces for two dates

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Nav CTA**

Find:
```html
    <a href="#waitlist" class="nav-cta" data-cta="nav"><span class="nav-cta-full">Join Waitlist</span><span class="nav-cta-short">Waitlist</span></a>
```
Replace with:
```html
    <a href="/register.html" class="nav-cta" data-cta="nav"><span class="nav-cta-full">Register Now</span><span class="nav-cta-short">Register</span></a>
```

- [ ] **Step 2: Hero flag**

Find:
```html
        <span class="hero-flag">Live · 3 Days · Online</span>
```
Replace with:
```html
        <span class="hero-flag">Live · 3 Days · Two Dates in 2026</span>
```

- [ ] **Step 3: Hero button, guarantee line, and hero meta**

Find:
```html
        <div>
          <a href="#waitlist" class="btn-primary" data-cta="hero">
            Join the Waitlist
            <span class="arrow">→</span>
          </a>
        </div>

        <div class="hero-meta">
          <div class="hero-meta-item"><span class="dot">●</span> Live Online</div>
          <div class="hero-meta-item"><span class="dot">●</span> Cohort capped at 100</div>
        </div>
```
Replace with:
```html
        <div>
          <a href="/register.html" class="btn-primary" data-cta="hero">
            Reserve My Seat
            <span class="arrow">→</span>
          </a>
          <p class="micro-assure"><strong>100% money-back guarantee.</strong> Attend all 3 days — if you don't leave with a complete framework for your signature talk, we refund you in full.</p>
        </div>

        <div class="hero-meta">
          <div class="hero-meta-item"><span class="dot">●</span> Aug 7–9 &amp; Sep 18–20, 2026</div>
          <div class="hero-meta-item"><span class="dot">●</span> 10am–2pm Eastern each day</div>
          <div class="hero-meta-item"><span class="dot">●</span> Cohort capped at 100</div>
        </div>
```

- [ ] **Step 4: Replace the `#waitlist` section with a "Choose Your Date" teaser**

Find the entire block:
```html
<!-- ================= WAITLIST ================= -->
<section class="offer sect-pad" id="waitlist">
  <div class="wrap">
    <div class="offer-inner">
      <span class="eyebrow">Stay In The Loop</span>
      <h2>Registration is opening soon.<br>Be the first to know.</h2>
      <p class="lead" style="text-align:center; max-width:520px; margin:0 auto 2rem;">
        Leave your name and email and we'll notify you the moment registration opens — including any early-bird pricing.
      </p>

      <div class="price-frame">
        <form class="lead-form" data-form="waitlist" action="/api/notify-otw" method="post" novalidate>
          <div class="lead-row">
            <div class="lead-field">
              <label for="waitlist-firstname" class="sr-only">First name</label>
              <input id="waitlist-firstname" name="firstName" type="text" required placeholder="First name" autocomplete="given-name">
            </div>
            <div class="lead-field">
              <label for="waitlist-lastname" class="sr-only">Last name</label>
              <input id="waitlist-lastname" name="lastName" type="text" required placeholder="Last name" autocomplete="family-name">
            </div>
          </div>
          <div class="lead-field lead-field-full">
            <label for="waitlist-email" class="sr-only">Email address</label>
            <input id="waitlist-email" name="email" type="email" required placeholder="your@email.com" autocomplete="email">
          </div>
          <div class="lead-hp" aria-hidden="true">
            <label for="waitlist-website">Website (leave blank)</label>
            <input id="waitlist-website" name="website" type="text" tabindex="-1" autocomplete="off">
          </div>
          <input type="hidden" name="formStartedAt" value="">
          <button type="submit" class="btn-primary lead-submit">
            Notify Me When Registration Opens
            <span class="arrow">→</span>
          </button>
          <p class="lead-error" role="alert" aria-live="polite"></p>
        </form>
        <p class="lead-micro" style="text-align:center; margin-top:1rem;">Your information is 100% secure and will never be shared with anyone.</p>
      </div>
    </div>
  </div>
</section>
```

Replace with:
```html
<!-- ================= DATES ================= -->
<section class="offer sect-pad" id="dates">
  <div class="wrap">
    <div class="offer-inner">
      <span class="eyebrow">Choose Your Date</span>
      <h2>Two dates. One workshop. Pick what works for you.</h2>
    </div>
    <div class="date-cards" style="margin-top:40px;">
      <div class="day-card" style="align-items:center; text-align:center; padding:32px;">
        <h3 style="margin-top:0;">August 7–9, 2026</h3>
        <p style="opacity:0.75; margin-bottom:24px;">10am–2pm Eastern each day</p>
        <a href="/register.html#august" class="btn-primary" data-cta="dates_august">
          Reserve My Seat
          <span class="arrow">→</span>
        </a>
      </div>
      <div class="day-card" style="align-items:center; text-align:center; padding:32px;">
        <h3 style="margin-top:0;">September 18–20, 2026</h3>
        <p style="opacity:0.75; margin-bottom:24px;">10am–2pm Eastern each day</p>
        <a href="/register.html#september" class="btn-primary" data-cta="dates_september">
          Reserve My Seat
          <span class="arrow">→</span>
        </a>
      </div>
    </div>
    <p class="lead-micro" style="text-align:center; margin-top:2rem;">Full pricing and payment-plan details are on the registration page.</p>
  </div>
</section>
```

(`.date-cards` was added to `src/styles.css` in Task 7 — it applies equally well here as a 2-up grid.)

- [ ] **Step 5: Final CTA copy and button**

Find:
```html
      <p class="lead">
        The book deal, the podcast invitation, the paid speaking gig, the client — they all start with one talk. Join the waitlist and be first to know when registration opens.
      </p>
      <a href="#waitlist" class="btn-primary btn-hero" data-cta="final_cta">
        Join the Waitlist
        <span class="arrow">→</span>
      </a>
      <p style="margin-top: 24px; font-size: 0.82rem; opacity: 0.6; letter-spacing: 0.04em;">Be the first to know when registration opens.</p>
```
Replace with:
```html
      <p class="lead">
        The book deal, the podcast invitation, the paid speaking gig, the client — they all start with one talk. Two dates to choose from in 2026 — pick yours.
      </p>
      <a href="/register.html" class="btn-primary btn-hero" data-cta="final_cta">
        Reserve My Seat
        <span class="arrow">→</span>
      </a>
      <p style="margin-top: 24px; font-size: 0.82rem; opacity: 0.6; letter-spacing: 0.04em;">100% money-back guarantee</p>
```

- [ ] **Step 6: FAQ — restore date/pricing-specific answers, insert 3 new items**

Find:
```html
      <details class="faq-item">
        <summary>"I've tried speaking courses before and they didn't work."</summary>
        <div class="faq-answer">
          Most speaking courses teach delivery techniques — voice, posture, eye contact — on top of the broken "write-and-memorize" foundation. That's why they don't stick. The One Talk Workshop is different because we start at the architecture layer. If the structure is right, delivery follows. If the structure is wrong, no amount of polish will save it.
        </div>
      </details>


      <details class="faq-item">
        <summary>"I'm too busy. Can I really commit to 3 days live?"</summary>
        <div class="faq-answer">
          The workshop runs for approximately four hours a day, live, over three days. If you can't protect 12 hours for the thing that will carry your work for the next decade, the issue isn't your calendar — it's your priorities, and we understand if this isn't the right season. But if you can: it is the highest-leverage 12 hours you will spend on your career this year.
        </div>
      </details>
```
Replace with:
```html
      <details class="faq-item">
        <summary>"I've tried speaking courses before and they didn't work."</summary>
        <div class="faq-answer">
          Most speaking courses teach delivery techniques — voice, posture, eye contact — on top of the broken "write-and-memorize" foundation. That's why they don't stick. The One Talk Workshop is different because we start at the architecture layer. If the structure is right, delivery follows. If the structure is wrong, no amount of polish will save it.
        </div>
      </details>

      <details class="faq-item">
        <summary>"$1,297 is a real commitment. Is it worth it right now?"</summary>
        <div class="faq-answer">
          Fair question. Here's the math: Eric's keynote fee starts at $50,000/hour. His Speaking Academy is $15,000. The workshop is three full days of direct instruction with him for $1,297 during Early Registration (retail is $1,597). If the talk you leave with leads to one paid booking, one client from a stage, one podcast invitation that changes your business — the workshop has paid for itself. And if it doesn't work for you, the guarantee refunds every dollar.
        </div>
      </details>

      <details class="faq-item">
        <summary>"Is there a payment plan?"</summary>
        <div class="faq-answer">
          Yes. At checkout you can choose to split your investment into 2 payments, charged 14 days apart, instead of paying in full — handled securely through Stripe. Full workshop access is unlocked as soon as your first payment processes.
        </div>
      </details>

      <details class="faq-item">
        <summary>"What happens after I sign up?"</summary>
        <div class="faq-answer">
          You'll receive a confirmation email immediately with your access details, how to prepare for Day 1, and how to join the live sessions each day.
        </div>
      </details>

      <details class="faq-item">
        <summary>"I'm too busy. Can I really commit to 3 days live?"</summary>
        <div class="faq-answer">
          The workshop runs 10am–2pm Eastern for three days. Four hours a day, live. If you can't protect 12 hours for the thing that will carry your work for the next decade, the issue isn't your calendar — it's your priorities, and we understand if this isn't the right season. But if you can: it is the highest-leverage 12 hours you will spend on your career this year.
        </div>
      </details>
```

- [ ] **Step 7: FAQ — restore the specific daily schedule time**

Find:
```html
      <details class="faq-item">
        <summary>"What's the schedule each day?"</summary>
        <div class="faq-answer">
          Each day runs for approximately four hours. You'll have a mix of live training, group exercises, and individual practice — paced to the progress of the cohort. Plan a little extra time outside the live sessions to work on your talk.
        </div>
      </details>
```
Replace with:
```html
      <details class="faq-item">
        <summary>"What's the schedule each day?"</summary>
        <div class="faq-answer">
          Each day runs 10am–2pm Eastern. You'll have a mix of live training, group exercises, and individual practice — paced to the progress of the cohort. Plan a little extra time outside the live sessions to work on your talk.
        </div>
      </details>
```

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: restore two-date registration surfaces on index.html"
```

---

### Task 11: Update `README.md` and `CLAUDE.md`

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `README.md`'s project layout and "what's wired" table**

Edit `README.md` — in the "Project layout" section, add the new files (`register.html`, `src/register.js`, `lib/pricing.js`, `api/create-checkout.js`, `api/stripe-webhook.js`) alongside the existing entries, and remove `api/notify-otw.js` if it's listed. In the "What's wired, what's not" table, replace the "Checkout CTAs" row:

Find:
```
| Checkout CTAs | ✅ All four Reserve-My-Seat buttons → `speakernation.com/flow/one-talk-workshop-may-2026/otw-may-2026-checkout/` |
```
Replace with:
```
| Registration | ✅ `/register.html` — two dates, Early/Retail auto-tiering, Stripe Checkout (full pay or 2-payment plan), Keap tag applied via webhook |
```

- [ ] **Step 2: Update `CLAUDE.md`'s "Current state note"**

Edit the `## Current state note` section at the bottom of `CLAUDE.md` to replace the postponement/waitlist description with the current two-date-registration architecture (new `register.html`/`src/register.js`/`lib/pricing.js`/`api/create-checkout.js`/`api/stripe-webhook.js`, Stripe as the payment processor, Keap tags `2008`/`1825`).

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md for two-date Stripe registration"
```

---

### Task 12: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run: `npm test`
Expected: PASS (all `lib/pricing.test.js` tests green).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds, `dist/` contains `index.html`, `stories.html`, and `register.html`.

- [ ] **Step 3: Preview and click through**

Run: `npm run preview`, open `http://localhost:4173`

Checklist:
- Nav "Register Now" → `/register.html`.
- Hero "Reserve My Seat" → `/register.html`.
- New "Choose Your Date" section renders two cards with working links to `/register.html#august` / `#september`.
- `/register.html` shows both cards with current tier/price and 2 buttons each.
- Anchors `#august`/`#september` scroll to the right card.
- Final CTA button → `/register.html`.
- FAQ shows the 3 restored items plus the 2 time-specific updates.
- `stories.html` is unaffected.
- No console errors on any of the 3 pages.

- [ ] **Step 4: Note remaining manual setup for the user**

This cannot be completed by an agent — flag it clearly instead of claiming it's done:
- Create the 4 Stripe Prices (Products) in the Dashboard; note their IDs into `.env.local`/Vercel.
- Register the `/api/stripe-webhook` endpoint in the Stripe Dashboard for `checkout.session.completed`; copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
- Confirm Keap tags `2008`/`1825` trigger the correct per-date registrant automations.
- Set all new env vars in Vercel (production + preview).
- Run an actual test-mode purchase end to end (both plans, both dates) before going live.
