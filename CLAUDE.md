# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Static landing page for **The One Talk Workshop** with Eric Edmeades (Speaker Nation brand), deployed to Vercel at onetalkworkshop.com. Plain HTML + CSS + a handful of vanilla JS modules — no framework, no component system, no client-side runtime. Vite is used only as a dev server / bundler, and Vercel Serverless Functions provide the API endpoints. Checkout runs through Stripe; Keap (Infusionsoft) is the email/CRM automation layer, driven off Stripe webhooks and lead-form submissions.

## Commands

```bash
npm install
npm run dev       # Vite dev server at http://localhost:5173
npm run build      # outputs to ./dist
npm run preview    # serves ./dist at http://localhost:4173 — smoke-test the prod bundle before pushing
npm test           # vitest — currently covers lib/pricing.js only
```

There is no lint command configured in this project. `vitest` was introduced specifically for `lib/pricing.js` (the tier-cutoff/date math) — the `/api/*` serverless functions have no automated tests and are verified manually.

To exercise the `/api/*` serverless functions locally (Keap/Stripe integration), use the Vercel CLI instead of plain `vite dev`:

```bash
vercel dev
```

To test analytics locally, copy `.env.example` to `.env.local` and set `VITE_GA_MEASUREMENT_ID` / `VITE_META_PIXEL_ID`. With both unset, no analytics scripts load and the page stays "clean" — this is the expected default for local dev and preview deploys.

## Architecture

**Three HTML entrypoints**, all built by Vite (`vite.config.js` declares `main` → `index.html`, `stories` → `stories.html`, `register` → `register.html`):
- `index.html` — the main landing page. **Copy and structure — do not refactor markup wholesale**, it was ported verbatim from a design reference.
- `register.html` — date + tier + plan selection. No name/email form here — Stripe Checkout's hosted page collects that itself.
- `stories.html` — a static grid of all testimonials (no carousel, hover-reveal via CSS only).

**`src/main.js`** is the entrypoint for `index.html` and wires up every feature module on `DOMContentLoaded`:
- `word-hover.js` — wraps heading words in `<span class="word">` for per-word hover effects (skips `.day-title`, leaves existing inline elements like `.accent`/`<em>` alone).
- `analytics.js` — loads GA4 + Meta Pixel, gated on `VITE_GA_MEASUREMENT_ID` / `VITE_META_PIXEL_ID`. Also exports `trackCtaClick` and wires click tracking on every `[data-cta]` element (labels: `nav`, `hero`, `final_cta`, `dates_august`/`dates_september`, etc.).
- `affiliate-ref.js` — reads `?ref=` from the URL and persists it in `localStorage` for 30 days (`initAffiliateRef`), and exports `getStoredRef()` so `register.js` can forward it to `/api/create-checkout`. It no longer rewrites any links directly — checkout is a POST + redirect now, not a plain `<a href>`.
- `form.js` — handles the lead-magnet form: `[data-form="lead-magnet"]` → `POST /api/subscribe-otw` ("5 Steps to Overcoming Stage Fright" opt-in), client-validated then posted as JSON, swaps the form DOM node for a `.lead-confirm` success message on `200`, and fires GA4/Meta events on success.
- `testimonials.js` — the horizontal auto-scrolling testimonial carousel on the main page (rAF-driven, ~30px/s, clones cards for a seamless loop, pauses on hover/touch/focus/manual-scroll, respects `prefers-reduced-motion`).

`stories.js` is the separate, minimal entrypoint for `stories.html` (touch tap-to-toggle only — everything else is CSS).

**`src/register.js`** is the entrypoint for `register.html`: renders the currently-active Early/Retail tier and price into each date card (via `lib/pricing.js` — display only, not authoritative), POSTs `{date, plan, ref}` to `/api/create-checkout` on button click, and redirects to the returned Stripe Checkout URL. Also handles the `?success=1`/`?canceled=1` return states from Stripe (swaps the cards for a confirmation panel and fires a GA4/Meta purchase event, or just re-shows the cards).

**`lib/pricing.js`** is the single source of truth for the Early/Retail tier cutoff dates and prices, imported by both `src/register.js` (client display) and `api/create-checkout.js` (server-authoritative). Keeping it in one shared module — rather than duplicating the cutoff dates in two places — is what prevents client display and server enforcement from drifting apart. It's the one part of this codebase with unit tests (`lib/pricing.test.js`, run via `npm test`).

**`api/create-checkout.js`** creates a Stripe Checkout Session for a given `{date, plan}`. It always re-derives the Early/Retail tier itself from the server clock (never trusts the client), so a stale/bookmarked link can't buy early pricing after a cutoff. `plan: "full"` is a one-time payment; `plan: "plan"` is a 2-week recurring subscription — **do not** try to pass `cancel_at` inside `subscription_data` here, Checkout Session's `subscription_data` doesn't support that field (only a limited subset — metadata, trial settings, billing cycle anchor, etc.) and Stripe will reject the whole session-creation call if you do (this shipped as a live bug once — see `api/stripe-webhook.js` for where `cancel_at` actually gets set).

**`api/stripe-webhook.js`** listens for `checkout.session.completed` and applies a Keap tag (`KEAP_TAG_ID_AUGUST`/`KEAP_TAG_ID_SEPTEMBER`, default `2008`/`1825`) based on `session.metadata.date`, using the same find-or-create-contact + tag + note pattern as `api/subscribe-otw.js`. For `plan: "plan"` sessions, it also retrieves the subscription and sets `cancel_at` to **exactly the end of the 2nd billing period** (`billing_cycle_anchor + 28 days`, via `getSubscriptionCancelAt`). It must land on the period boundary to the second: under Stripe's **flexible billing mode** (default for new subscriptions), a `cancel_at` *inside* a period prorates that period's invoice — the previous "day 15" value fell 1 day into period 2 and prorated the 2nd $827 installment down to ~$59 (live bug, Jul 2026). Boundary-aligned `cancel_at` bills period 2 in full and generates no 3rd invoice. This is the only place `cancel_at` can be set, since the real Subscription object doesn't exist until the Checkout Session completes. Unlike the form endpoints, a Keap failure here returns `500` (not `200`) so Stripe's automatic webhook retry gets another attempt — there's no user waiting on this request to retry manually. Requires `bodyParser: false` since Stripe signature verification needs the raw request body.

**`api/subscribe-otw.js`** is the lead-magnet Keap integration (unrelated to Stripe): looks up the contact by email, creates or PATCHes it, applies `KEAP_TAG_ID_STAGE_FRIGHT` (which triggers a pre-existing Keap automation to actually send email — **this function never sends email itself**), and adds a contact-timeline note.

`api/subscribe-otw.js` shares anti-spam gates with the (now-retired) waitlist endpoint's original pattern, and **intentionally returns `200 {success:true}` on every rejected-as-spam path** (bad origin, honeypot filled, missing/out-of-range `formStartedAt`) so bots can't distinguish a block from a real success:
- Origin/Referer must match `onetalkworkshop.com`, `onetalk.ericedmeades.com`, `*.vercel.app`, or `localhost`/`127.0.0.1`.
- Hidden `website` field (honeypot) must be empty.
- `formStartedAt` (stamped client-side on render) must show the form was open ≥3s and ≤24h before submit.

A **tag-apply failure is treated as a hard failure** in both `api/subscribe-otw.js` and `api/stripe-webhook.js`, even though the contact was already created/updated — Keap can return HTTP 200 with a per-tag error in the response body (e.g. `{"1831":"TAG_ID_NOT_FOUND"}"`), so `applyTag` inspects the body, not just `res.ok`. If the tag doesn't apply, the delivery automation never fires, so this must surface as an error rather than a silent success.

**`api/results.js`** serves the password-protected registration report at `/results` (a `rewrites` entry in `vercel.json` maps the clean path to the function). HTTP Basic against `RESULTS_USER`/`RESULTS_PASSWORD`, compared with hashed `timingSafeEqual` so neither a wrong username nor a wrong-length password is distinguishable by timing. It walks every Checkout Session and groups completed ones by `metadata.date` and discount code, resolving `promo_…` ids to human-readable codes via `promotionCodes.list()`/`coupons.list()`.

The report is **aggregate-only by construction**: `loadSessions()` projects each session down to `{status, mode, amount_total, metadata.date, discounts}` at the Stripe boundary, so `customer`, `customer_details`, `customer_email`, `client_reference_id` and `payment_intent` never enter the pipeline. There is no downstream "hide the names" filter that a later change could quietly remove.

**`lib/results.js`** holds the pure aggregation (`buildReport`, `formatMoney`, `formatPct`) and is unit-tested in `lib/results.test.js` — same split as `lib/pricing.js`/`lib/seats.js`, so the counting and money math are verifiable without a network. Two revenue columns: **Collected** is `amount_total` as Stripe took it; **Contracted** multiplies a `mode: "subscription"` registration by `SUBSCRIPTION_PERIOD_COUNT` (exported from `lib/pricing.js`) because `cancel_at` pins a plan to exactly 2 billings. Importing that constant rather than hardcoding `2` is what keeps the revenue math and the `cancel_at` math from drifting.

## Deployment

`vercel.json` sets `buildCommand`/`outputDirectory` for Vite, plus security headers (HSTS, X-Frame-Options, etc.) and long-cache `Cache-Control` for `/assets/*`. Branch mapping: `main` → production, any other branch or PR → preview deployment. See `README.md` for the full Vercel Git-integration and custom-domain setup steps.

Stripe requires manual one-time setup outside this codebase before registration works end-to-end: create the 4 Prices (`STRIPE_PRICE_EARLY_FULL`/`STRIPE_PRICE_RETAIL_FULL`/`STRIPE_PRICE_EARLY_PLAN`/`STRIPE_PRICE_RETAIL_PLAN`) in the Stripe Dashboard, register the `/api/stripe-webhook` endpoint for `checkout.session.completed`, and set all the new env vars (see `.env.example`) in Vercel.

`RESULTS_USER` and `RESULTS_PASSWORD` gate the `/results` report and are **not** listed in `.env.example` — set them directly in Vercel → Environment Variables. Both must be present: `api/results.js` returns 500 when either is missing rather than falling open, so a forgotten variable locks the page instead of publishing revenue figures. They are currently set for Production only; a preview deployment will return 500 until they are added to Preview too.

## Current state note

Two workshop dates are confirmed and live: **August 7–9** and **September 18–20, 2026**. Registration runs through `register.html` → Stripe Checkout → `api/stripe-webhook.js` applying a Keap tag per date. The previous postponement/waitlist mode (see `docs/superpowers/specs/2026-06-09-postpone-waitlist-design.md`) has been fully retired — `api/notify-otw.js` and the waitlist form were deleted, not just hidden. See `docs/superpowers/specs/2026-07-04-two-date-registration-design.md` for the full design.
