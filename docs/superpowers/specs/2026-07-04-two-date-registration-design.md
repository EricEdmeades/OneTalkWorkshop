# OneTalkWorkshop — Two-Date Registration via Stripe

**Date:** 2026-07-04
**Status:** Approved (brainstormed interactively; final index.html content pass made autonomously per user go-ahead)

## Context

The workshop is back on with two confirmed dates, and the page needs to come out of waitlist mode (see `2026-06-09-postpone-waitlist-design.md`) into real registration — but now with a date choice the previous single-flow design never had. Checkout is also moving off the old `speakernation.com/flow/...` funnel onto Stripe directly, with a webhook applying a Keap tag so we know which date each buyer picked. Keap tags already exist and were provided: **August = `2008`**, **September = `1825`**.

### The two dates and their pricing

| | **August 7–9, 2026** | **September 18–20, 2026** |
|---|---|---|
| Time | 10:00 AM–2:00 PM Eastern (UTC-4) each day | same |
| Early Registration | Through Jul 7 · **$1,297** (retail $1,597 crossed out) · or 2×$677=$1,354, final payment due Jul 21 | Through Jul 30 · **$1,297** (retail $1,597 crossed out) · or 2×$677=$1,354 |
| Retail Registration | Starts Jul 8 · **$1,597** · or 2×$827=$1,654, plan available Jul 8–24, final due Aug 7 | Starts Aug 1 · **$1,597** · or 2×$827=$1,654, plan available Aug 1–Sep 4, final due Sep 18 |

Dollar amounts are **identical** between the two dates — only the tier cutoff calendars differ. Checking the math, every stated "final payment due" date is exactly **14 days after** the corresponding registration-window's end (Jul 7+14=Jul 21; Jul 24+14=Aug 7; Sep 4+14=Sep 18), which also matches old removed FAQ copy about installments being "due two weeks apart." So: **the 2nd installment always charges 14 days after the 1st, universally** — no per-date/tier scheduling needed.

---

## Architecture

```
index.html CTAs (nav / hero / new date-teaser section / final_cta)
        │  all point to /register.html
        ▼
/register.html (new page, new Vite entry point — same pattern as stories.html)
  two date cards; each shows the CURRENTLY ACTIVE tier (client-side date check,
  display only — not trusted for pricing) and two buttons: "Pay in Full" / "2 Payments"
        │ button click → POST /api/create-checkout { date, plan, ref? }
        ▼
api/create-checkout.js (new)
  - re-derives the active tier itself from the server clock — authoritative
  - creates a Stripe Checkout Session (mode:"payment" for full-pay;
    mode:"subscription" with subscription_data.cancel_at = now+15d for the plan
    — 1 day after the 2nd billing-cycle charge, not exactly on it; see note below)
  - metadata: { date, tier, plan }; client_reference_id = stored affiliate ref
  - returns { url }; browser redirects there
        ▼
Stripe Checkout (hosted) — collects payment + buyer name/email itself
        │ on checkout.session.completed →
        ▼
api/stripe-webhook.js (new)
  - verifies Stripe signature (raw body, bodyParser disabled)
  - reads session.metadata.date + session.customer_details
  - find-or-create Keap contact (same helpers as subscribe-otw.js)
  - applies tag 2008 (august) or 1825 (september)
  - adds a note with date/tier/plan/amount
  - 500 on Keap failure so Stripe retries; 200 otherwise
```

### Stripe objects (created manually in the Dashboard, IDs wired as env vars)

Only **4 Prices** are needed — reused across both dates, since amounts don't vary by date:

- `STRIPE_PRICE_EARLY_FULL` — $1,297 one-time
- `STRIPE_PRICE_RETAIL_FULL` — $1,597 one-time
- `STRIPE_PRICE_EARLY_PLAN` — $677 recurring, every 2 weeks
- `STRIPE_PRICE_RETAIL_PLAN` — $827 recurring, every 2 weeks

Plus `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `KEAP_TAG_ID_AUGUST` (default `2008`), `KEAP_TAG_ID_SEPTEMBER` (default `1825`) — same env var pattern as existing `KEAP_TAG_ID_STAGE_FRIGHT`/`KEAP_TAG_ID_WAITLIST`. Reuses the existing `KEAP_API_KEY`.

New npm dependency: `stripe` (official SDK), used by both new `/api` functions.

### Tier cutoffs (server-authoritative, fixed UTC timestamps for ET deadlines — same technique as the old early-bird `<head>` script)

- **August**: Early through Jul 7 23:59:59 ET → Retail from Jul 8
- **September**: Early through Jul 30 23:59:59 ET → Retail from Aug 1

The client (`/register.html`) computes the same cutoffs independently for *display* (so the page shows the right price without a round-trip), but `api/create-checkout.js` recomputes it server-side and that's what actually determines the Stripe Price used — a stale/bookmarked page can't buy early pricing after the cutoff.

**Subscription cancel timing:** the recurring Price's own billing interval (every 2 weeks) is what actually fires the 2nd charge, ~14 days after subscription creation — `cancel_at` only needs to stop the *3rd* cycle from ever billing. Setting it to exactly `now + 14 days` would race the subscription's own cycle boundary and risk canceling before the 2nd invoice is generated. Setting it to `now + 15 days` guarantees the 2nd charge has already landed before cancellation fires, while still canceling well before a 3rd cycle (day 28) could start.

---

## `/register.html` (new page)

- New Vite entry point (`vite.config.js` gets a third `register` input, alongside `main` and `stories`).
- Reuses the same nav/footer markup and `styles.css` as `index.html`/`stories.html`.
- Two date cards (August, September), each showing: date range, time window, current tier label, price (with retail crossed out during Early), payment-plan detail line, and two buttons — "Pay in Full — $X" / "2 Payments of $Y".
- **No name/email form on this page** — Stripe Checkout's hosted page collects buyer name/email itself; the webhook creates/updates the Keap contact from `session.customer_details`.
- Button click → disable both buttons on that card, `fetch POST /api/create-checkout`, redirect to the returned `url` on success; re-enable with an inline error message on failure.
- Reads the stored affiliate ref (`affiliate-ref.js` gets a small exported getter alongside its existing link-rewriting logic) and includes it as `ref` in the POST body.
- Handles two return states via query string set in `success_url`/`cancel_url`:
  - `?success=1&date=...` → swap the date cards for a confirmation panel; fire a GA4 `purchase` + Meta `Purchase` event using the known tier amount.
  - `?canceled=1` → just re-show the date cards (Stripe Checkout was abandoned).
- Supports a `#august` / `#september` anchor (set by teaser links from `index.html`) to pre-scroll/highlight the relevant card — it does not skip tier/plan selection.
- New `src/register.js` module, with its own small boot script (parallel to `stories.js`), calling `initAnalytics()`, `wrapHeadingWords()`, and the new date-selection logic.

---

## `index.html` changes

Coming out of waitlist mode, restoring real registration surfaces, generalized for two dates:

- **Nav CTA**: "Join Waitlist" → "Register Now"; `href="#waitlist"` → `href="/register.html"`.
- **Hero flag**: → "Live · 3 Days · Two Dates in 2026".
- **Hero buy button**: restored, `href="/register.html"`, text "Reserve My Seat →" (no dollar figure here — two dates can be in different tiers at once, so a single hero price would go stale/wrong; exact pricing lives on `/register.html`). Restore the `.micro-assure` money-back-guarantee paragraph beneath it.
- **Hero meta**: add back two safe (date-invariant) rows: "Aug 7–9 & Sep 18–20, 2026" and "10am–2pm Eastern each day"; keep the existing "Cohort capped at 100" row.
- **New compact teaser section** (replaces the old single-flow `#register` offer section, and removes the `#waitlist` section entirely): "Two Dates. One Workshop." with two small date cards (name, dates, one-line tier status) each linking to `/register.html#august` / `/register.html#september`. Detailed pricing/tiers are NOT duplicated here — that's `/register.html`'s job; this keeps pricing logic in one place.
- **Final CTA section**: restore purchase-oriented copy — "The book deal, the podcast invitation, the paid speaking gig, the client — they all start with one talk. Two dates to choose from in 2026 — pick yours." Button → `/register.html`, text "Reserve My Seat →". Footnote → "100% money-back guarantee" (drop the specific early-bird date mention here since it's now covered on the register page).
- **FAQ** — restore, generalized for two dates:
  - *"$1,297 is a real commitment. Is it worth it right now?"* — restored, referencing both figures ($1,297 Early / $1,597 Retail) since they're identical across dates.
  - *"Is there a payment plan?"* — restored, updated: "2 payments 14 days apart, handled securely through Stripe" (drop the old provider-specific wording).
  - *"What happens after I sign up?"* — restored as-is (date-agnostic).
  - *"What's the schedule each day?"* — restore the specific "10am–2pm Eastern" (safe to hardcode — identical for both dates).
  - *"I'm too busy. Can I really commit to 3 days live?"* — restore the specific time reference the same way.
- Title/meta description/OG tags — **unchanged** (already date-agnostic).

### What does NOT change

- Hero copy (headline, sub), villain, big idea, future, Eric bio, days/workshop, testimonials, guarantee section — untouched.
- Lead-magnet form (5 Steps to Overcoming Stage Fright) and its endpoint — untouched.
- `stories.html` / `stories.js` — untouched.
- All existing CSS classes reused as-is; no new styles beyond what's needed for the register page's date cards (built from existing `.price-frame`/`.offer`-family classes).

---

## Error handling & edge cases

- **`api/create-checkout.js`**: invalid `date`/`plan` → 400. Stripe API error → 500, page shows an inline error and re-enables the buttons (same UX pattern as the existing lead-magnet/waitlist forms).
- **`api/stripe-webhook.js`**: signature verification failure → 400 (reject, don't process). Keap tag-apply failure → 500 so Stripe's automatic webhook retry (up to 3 days) gets another shot — this is a deliberate departure from the existing form endpoints, which return a hard error to the browser instead, because a webhook has no user waiting on it to retry manually.
- **No idempotency store**: there's no database in this stack. Duplicate Keap tag application (on a Stripe retry) is harmless; a duplicate note is a minor cosmetic cost, not worth adding infrastructure for.
- **Failed 2nd installment charge**: out of scope for this pass — relies on Stripe's default Smart Retries / dunning behavior. Not handled specially.
- **After both event dates have passed**: out of scope — page will need a manual follow-up pass then, same as the original postponement was handled manually.

---

## Env vars to add (`.env.example`)

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_EARLY_FULL=
STRIPE_PRICE_RETAIL_FULL=
STRIPE_PRICE_EARLY_PLAN=
STRIPE_PRICE_RETAIL_PLAN=
KEAP_TAG_ID_AUGUST=2008
KEAP_TAG_ID_SEPTEMBER=1825
```

## Manual setup required before launch (not part of this codebase)

- Create the 4 Stripe Prices (and their Products) in the Dashboard, and the 2 subscription Prices' billing interval set to every 2 weeks.
- Register the webhook endpoint (`/api/stripe-webhook`) in the Stripe Dashboard for `checkout.session.completed`, and copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
- Confirm Keap tags `2008`/`1825` fire the correct registrant automations (logistics/access emails per date) — same as the existing `KEAP_TAG_ID_STAGE_FRIGHT` automation, just event-specific.
- Set all new env vars in Vercel (production + preview).
