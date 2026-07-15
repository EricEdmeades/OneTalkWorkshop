# Sales-source tracking via `?ref=` → Stripe metadata

**Date:** 2026-07-15
**Scope:** OneTalkWorkshop (code change) + S3-LMS (no change, documented) — both use the same Stripe account.

## Goal

Attribute checkouts to one of four sales sources — `Karms`, `Brian`, `Fran`, `Alex` — by carrying a code from the landing URL into Stripe **metadata**, so sales can be filtered by source in the Stripe dashboard. This is a lightweight "mini affiliate" attribution layer.

## Decisions

- **Reuse the existing `?ref=` mechanism** in both projects. Do not introduce `utm_*` parameters.
- **No allowlist.** Any `?ref=` value is accepted; reporting relies on using the correct links. This avoids interfering with any other existing affiliate refs.
- **Stripe metadata only.** No Keap changes in this scope.
- **Metadata key = `ref`** in both projects, for consistent reporting.
- Codes are handed out **capitalized exactly as written**; metadata stores whatever casing is in the link.

## S3-LMS — no code change

The pipeline already exists and is live (verified):

```
?ref=  → RefCapture (mounted on LandingPage + checkout page)
       → localStorage("s3_ref", 30-day TTL)   [src/lib/ref.ts]
       → CheckoutForm reads getStoredRef()      [src/components/CheckoutForm.tsx]
       → POST /api/checkout/intent { ref }       [src/app/api/checkout/intent/route.ts]
       → PaymentIntent.metadata.ref
```

`?ref=Karms` already flows to `PaymentIntent.metadata.ref` today. Deliverable is only the links.

## OneTalkWorkshop — focused change

**File:** `api/create-checkout.js`

Today `ref` is only used as `client_reference_id` (for AffiliateWP). It is **not** in `session.metadata`. Change:

1. Add a pure helper `sanitizeRef(raw)`:
   - trim
   - cap at 50 chars
   - strip to `[a-zA-Z0-9._-]`
   - return `""` (or omit) when empty
   - Mirrors S3-LMS's `sanitize()` in `src/lib/ref.ts` so junk/empty values don't pollute metadata.
2. Sanitize first, then add to the existing `metadata` object (omit the key when empty so no blank `ref` is stored):
   ```js
   const cleanRef = sanitizeRef(ref);
   const metadata = { date, tier, plan, ...(cleanRef ? { ref: cleanRef } : {}) };
   ```
   Because `subscription_data: { metadata }` **reuses the same object**, the ref lands on both the Checkout Session and, for `plan: "plan"` subscriptions, the Subscription — no extra wiring.
3. **Leave `client_reference_id` as-is** (still feeds AffiliateWP). Additive change only.

Where to put `sanitizeRef`: extract as a small pure function. Options — a new tiny module or alongside `lib/pricing.js`. Preference: a small standalone helper module (e.g. `lib/ref.js`) so it's independently unit-testable, matching the project's "pure logic gets unit tests" pattern.

### Capture points (already in place)

`initAffiliateRef` runs on both `index.html` (`src/main.js`) and `register.html` (`src/register.js`), so a `?ref=` link to either page is captured. No client change needed.

## Testing

- Add a `vitest` spec for `sanitizeRef` covering: normal code, empty/null, over-length truncation, disallowed-character stripping, whitespace trim. Fits the existing pattern (`lib/pricing.test.js` is the one unit-tested pure module).
- The `create-checkout` handler stays manually verified, per project convention (`/api/*` functions have no automated tests).

### Manual verification (OTW)

1. `vercel dev`, hit `/register.html?ref=Karms`, complete a test checkout (100%-off promo code).
2. Confirm in Stripe the Checkout Session shows `metadata.ref = "Karms"`.
3. For a payment-plan (`plan`) purchase, confirm the resulting Subscription also carries `metadata.ref`.

## Deliverable — the four links

- S3-LMS: `https://s3.speakernation.com/?ref=Karms` · `?ref=Brian` · `?ref=Fran` · `?ref=Alex`
- OneTalkWorkshop: `https://onetalkworkshop.com/?ref=Karms` · `?ref=Brian` · `?ref=Fran` · `?ref=Alex`

## Out of scope

- UTM parameters / analytics attribution.
- Allowlist / code validation.
- Writing ref into Keap (OTW webhook untouched).
- Any S3-LMS code change.
