# OneTalkWorkshop — Net Out Refunds on `/results`

**Date:** 2026-08-11
**Status:** Approved (brainstormed interactively)

## Context

`/results` reports registration counts and revenue by walking Stripe Checkout
Sessions (see `api/results.js` + `lib/results.js`). It counts a session iff
`status === 'complete'` and `metadata.date` is `august` or `september`, then
sums `amount_total` (Collected) and `amount_total × SUBSCRIPTION_PERIOD_COUNT`
for subscriptions (Contracted).

**The report is refund-blind.** Refunding a payment in Stripe does not change a
session's `status` or `amount_total`, so a fully-refunded buyer still counts as
a registration at full value. This is the entire cause of the mismatch against
the admin reconciliation sheet, which moves refunds off its active roster.

Reconciliation against the sheet (investigated 2026-08-11):

- Sheet "Investment" tab (net of refunds): **$16,018.00**
- `/results` Contracted (refunds still counted): **≈ $16,018 + $6,233.50 ≈ $22,252**
- The whole money gap is **$6,233.50 of refunds** across **6 OTW registrations**,
  all on one-time (payment-mode) charges. `/results` also counts those 6 people
  in its headcount, where the sheet does not.
- (Unrelated to `/results`: the sheet also lists $1,908 of `BCD UPSELL` refunds —
  a different product, never in `/results`. Out of scope here.)

## Goal

Make `/results` show **net-of-refunds** figures so it reconciles with the sheet:

- **Fully refunded registration → dropped entirely** (0 count, 0 collected, 0
  contracted). They are not attending, so they hold no seat.
- **Partially refunded registration → seat kept, revenue reduced** by the
  refunded amount.
- A **de-emphasized awareness line** below the figures records what was removed,
  so a refund never silently lowers a number with no visible trace.
- Handle **both** payment-mode and subscription-mode refunds now.

## Non-goals (YAGNI)

- Multi-currency refunds (report already assumes USD).
- Disputes / chargebacks (a different Stripe object — `dispute`, not `refund`).
- Refund dates / history timeline — the sheet only needs the current net.

## Constraints inherited from the existing module

- **Privacy invariant:** no attendee identifier (customer, email,
  client_reference_id, payment_intent) may reach aggregation or render. The
  Stripe boundary in `api/results.js` projects sessions down to
  status/mode/amount/date/discount. Refund work must preserve this: payment_intent
  and subscription ids may be read **only** in the IO + pure-join layer for
  matching, and must be projected to a plain `refundedCents` number **before**
  `buildReport` or any render sees the session.
- **Stripe SDK is v22** (`^22.3.0`), a 2025-era API version where
  `invoice.subscription` moved under `invoice.parent`. The design deliberately
  avoids reading that reverse field (see §1).
- `lib/results.js` is pure and unit-tested; the money/count rules go there.
- The finished report is cached in module scope for 5 minutes; `?refresh=1`
  forces a fresh read. Refund fetching lives inside that same cached path.

## Architecture

```
api/results.js  (IO — Stripe access, privacy boundary)
  loadSessions()          walk checkout.sessions.list (as today) but also keep
                          IO-only  { paymentIntentId, subscriptionId }  per session
  loadPaymentRefunds()    walk stripe.refunds.list({ expand:['data.charge'] }) once
                          → Map<paymentIntentId, refundedCents>
  loadSubscriptionRefunds(subIds)
                          for each subscription-mode registration:
                          stripe.invoices.list({ subscription, expand:['data.charge'] })
                          sum charge.amount_refunded
                          → Map<subscriptionId, refundedCents>
        │  hand sessions + the two maps to the pure join
        ▼
lib/refunds.js  (pure — testable, no Stripe/network)
  refundCentsByPaymentIntent(refunds)     build Map from raw refund array
  annotateRefunds(sessions, piMap, subMap)
        → sessions each carrying refundedCents; paymentIntentId/subscriptionId
          stripped here, so buildReport never receives them
        ▼
lib/results.js  buildReport(sessions, promoNames)   (pure — extended)
  per registration:
    refundedCents >= collectedCents  → DROP (0 count / 0 collected / 0 contracted)
    0 < refundedCents < collectedCents → keep seat; collected -= refunded;
                                         contracted -= refunded
  event + grand totals also carry  refundedCents  and  refundedCount
  (tallied even from dropped rows); per-code rows and % of revenue recompute
  off the net figures
        ▼
lib/registrations-render.js  (extended)
  headline figures (Registrations / Collected / Contracted) are already net.
  Add ONE de-emphasized line below the tables on the FULL registrations report
  (/results/registrations), shown only when refundedCents > 0.
  The dashboard panel figures read report.totals, so they are already net — but
  the dashboard panel gets NO awareness line (kept clean); the line lives only
  on the full report.
```

### Matching strategy — why split by mode

- **Payment-mode** (all 6 current refunds): a refund and its checkout session
  share a stable top-level `payment_intent` id. One `refunds.list` page keys
  everything — O(number of refunds), which is tiny.
- **Subscription-mode** (payment plans): the installment charges are **not**
  tied to the session's `payment_intent` (null for subscription mode). Rather
  than read `invoice.subscription` (moved under `invoice.parent` in this API
  version), fetch the subscription's own invoices with
  `stripe.invoices.list({ subscription })` and sum `charge.amount_refunded`.
  Stable across versions; O(number of plan registrations) — 1 today, bounded and
  cached.

### Full vs partial refund rule

`refundedCents >= collectedCents` defines "fully refunded". This is correct for
both modes: a one-time full refund returns the whole `amount_total`; a
cancelled-and-refunded plan only ever collected installment 1, so its refund of
that installment meets the threshold and the row drops. Anything strictly
between 0 and collected is a partial: the seat stays and both revenue columns
drop by the refunded amount.

### The awareness line

Muted, below the tables, rendered only when refunds exist. Wording:

> Net of refunds: $6,233.50 returned across 6 registrations removed (fully
> refunded); partial refunds netted.

## Data flow example (today's live data)

- 6 payment-mode refunds totalling $6,233.50, each ≥ its session's
  `amount_total` → 6 registrations dropped.
- Collected and Contracted each fall by $6,233.50 → Contracted lands at ~$16,018,
  matching the sheet.
- Headcount falls by 6.
- Awareness line reports "$6,233.50 across 6 registrations removed".

## Error handling

- A failure fetching refunds must degrade the same way a Stripe failure already
  does on this route (the GET path returns 502 "Could not reach Stripe"). Refund
  fetching is inside the same `try` as the session walk, so a throw is caught
  there — the page never shows half-netted numbers silently.
- A refund with no matching registration (refund on a non-registration / test /
  old session) is ignored, not attributed.
- Multiple refunds on one session are summed.

## Testing (TDD)

- **`lib/refunds.test.js`** (new): payment-intent match; subscription match;
  multiple refunds summed onto one session; unmatched refund ignored;
  identifiers stripped from annotated output.
- **`lib/results.test.js`** (extend): fully-refunded row drops count + both
  revenue columns; partial refund keeps count and nets both columns;
  `refundedCents` / `refundedCount` totals per event and grand total include
  dropped rows; `% of revenue` computed off net contracted.
- **`lib/registrations-render.test.js`** (extend): awareness line present on the
  full registrations report with refunds, absent at zero refunds; dashboard
  panel renders net figures with no awareness line.

## Verification points during implementation

- Confirm `charge.amount_refunded` and `refund.amount` shapes against the
  installed stripe v22 types.
- Confirm `stripe.invoices.list({ subscription })` returns installment charges
  with `amount_refunded` as expected on this API version.
- Confirm `refund.payment_intent` is populated as a top-level id on
  `refunds.list` output (it is the join key for payment-mode).
