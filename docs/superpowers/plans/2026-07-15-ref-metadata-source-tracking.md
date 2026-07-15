# Sales-source tracking via `?ref=` → Stripe metadata — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the landing-page `?ref=` code into Stripe metadata on OneTalkWorkshop checkouts (S3-LMS already does this) so sales can be attributed to sources `Karms`, `Brian`, `Fran`, `Alex`.

**Architecture:** Extract a small pure `sanitizeRef` helper (mirroring S3-LMS's sanitizer), unit-test it with vitest, then add the sanitized ref to the existing Stripe Checkout Session `metadata` object in `api/create-checkout.js`. Because `subscription_data` reuses that same `metadata` object, the ref lands on both one-time sessions and payment-plan subscriptions. The existing `client_reference_id` (AffiliateWP) is left untouched. No client-side or S3-LMS changes.

**Tech Stack:** Node ESM, Stripe Node SDK, Vercel Serverless Functions, Vitest.

---

### Task 1: `sanitizeRef` pure helper (TDD)

**Files:**
- Create: `lib/ref.js`
- Test: `lib/ref.test.js`

- [ ] **Step 1: Write the failing test**

Create `lib/ref.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ref.test.js`
Expected: FAIL — `sanitizeRef` is not exported / `./ref.js` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

Create `lib/ref.js`:

```js
// lib/ref.js — pure sanitizer for the affiliate/source `?ref=` value.
// Mirrors S3-LMS's src/lib/ref.ts sanitize(): trim, cap length, and strip
// to URL-safe identifier characters so junk never lands in Stripe metadata.
// No Stripe/env access here so it stays trivially unit-testable.

const MAX_REF_LENGTH = 50;

export function sanitizeRef(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().slice(0, MAX_REF_LENGTH);
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ref.test.js`
Expected: PASS — all 8 assertions green.

- [ ] **Step 5: Run the full test suite (no regressions)**

Run: `npm test`
Expected: PASS — pricing tests + new ref tests all green.

- [ ] **Step 6: Commit**

```bash
git add lib/ref.js lib/ref.test.js
git commit -m "feat: add sanitizeRef helper for source tracking

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Write sanitized ref into Stripe metadata

**Files:**
- Modify: `api/create-checkout.js` (import at top; `metadata` construction near line 45)

- [ ] **Step 1: Import the helper**

At the top of `api/create-checkout.js`, add the import next to the existing pricing import:

```js
import { getActiveTier, isValidDate, isValidPlan } from '../lib/pricing.js';
import { sanitizeRef } from '../lib/ref.js';
```

- [ ] **Step 2: Add the sanitized ref to `metadata`**

Replace this line (currently near line 45):

```js
  const metadata = { date, tier, plan };
```

with:

```js
  const cleanRef = sanitizeRef(ref);
  const metadata = { date, tier, plan, ...(cleanRef ? { ref: cleanRef } : {}) };
```

Leave the existing `client_reference_id: typeof ref === 'string' && ref ? ref : undefined` line unchanged — it still feeds AffiliateWP. Because `subscription_data: { metadata }` reuses this same object, the ref automatically propagates to the Subscription for `plan: "plan"` checkouts; no other edit is needed.

- [ ] **Step 3: Sanity-check the file parses and suite still passes**

Run: `node --check api/create-checkout.js && npm test`
Expected: no syntax errors; all tests PASS.

- [ ] **Step 4: Manual end-to-end verification (local)**

1. Run `vercel dev` (needs Stripe env vars per `.env.example`).
2. Open `http://localhost:3000/register.html?ref=Karms` (or whatever port Vercel prints).
3. Pick a date + plan, proceed to Stripe Checkout, complete it with a 100%-off promotion code.
4. In the Stripe dashboard, open the Checkout Session → confirm `metadata.ref = "Karms"`.
5. For a `plan` (payment-plan) purchase, open the resulting Subscription → confirm it also carries `metadata.ref = "Karms"`.
6. Confirm a checkout with **no** `?ref=` produces a session with **no** `ref` key in metadata (not a blank string).

- [ ] **Step 5: Commit**

```bash
git add api/create-checkout.js
git commit -m "feat: write source ref into Stripe checkout metadata

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deliverable (post-merge): the four links

- S3-LMS: `https://s3.speakernation.com/?ref=Karms` · `?ref=Brian` · `?ref=Fran` · `?ref=Alex`
- OneTalkWorkshop: `https://onetalkworkshop.com/?ref=Karms` · `?ref=Brian` · `?ref=Fran` · `?ref=Alex`

## Notes / out of scope

- **S3-LMS:** no code change — verified `?ref=` already lands in `PaymentIntent.metadata.ref`.
- No UTM params, no allowlist, no Keap write (OTW webhook untouched).
- Casing is not normalized; hand out the capitalized links above consistently so Stripe reporting groups cleanly.
