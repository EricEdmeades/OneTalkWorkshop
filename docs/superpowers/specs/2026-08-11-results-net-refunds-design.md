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
- (The sheet also lists $1,908 of `BCD UPSELL` refunds — a different product,
  never a `/results` registration. See the orphan guard below for how these are
  kept from silently corrupting the reconciliation.)

## Goal

Make `/results` show **net-of-refunds** figures so it reconciles with the sheet:

- **Fully refunded registration → dropped entirely** (0 count, 0 collected, 0
  contracted). They are not attending, so they hold no seat.
- **Partially refunded registration → seat kept, revenue reduced** by the
  refunded amount.
- A **de-emphasized awareness line** below the figures records what was removed,
  so a refund never silently lowers a number with no visible trace.

## Scope decision — payment-mode now, subscription deferred behind a guard

The refund logic depends on tying a refund back to a registration. Verified
against the **pinned Stripe API version `2026-06-24.dahlia`** (the installed
`stripe@22.3.0` default):

- **Payment-mode refunds are clean and testable.** A refund carries
  `payment_intent`, and a payment-mode Checkout Session carries the same
  `payment_intent` (both still top-level in dahlia). Direct id match. This
  covers **all 6 refunds that exist today**.
- **Subscription-mode refunds are not cheaply attributable in dahlia.** The
  fields that used to bridge refund → subscription were removed: `charge.invoice`,
  `invoice.charge`, `invoice.subscription`, and `paymentIntent.invoice` are all
  gone. The only version-correct chain is a multi-hop walk
  (`invoices.list({subscription})` → `invoicePayments.list({invoice})` →
  `payment_intent` → refund), which adds Stripe calls per plan and — decisively —
  cannot be validated against real data, because **no payment-plan refund
  exists**.

**Decision:** net payment-mode refunds now (robust, fully tested). Do **not**
build the subscription walk yet. Instead add an **orphan-refund guard**: any
succeeded refund not matched to a counted registration is summed, and when a
payment-plan registration is present, that unmatched total is surfaced as a
muted caveat line so a plan refund can never be silently missed — it gets
flagged for manual netting instead of dropped on the floor.

## Non-goals (YAGNI)

- **Auto-netting subscription / payment-plan refunds.** Deferred; the orphan
  guard flags them for manual handling until a real plan refund exists to build
  and test against.
- Multi-currency refunds (report already assumes USD).
- Disputes / chargebacks (a different Stripe object — `dispute`, not `refund`).
- Refund dates / history timeline — the sheet only needs the current net.

## Constraints inherited from the existing module

- **Privacy invariant:** no attendee identifier (customer, email,
  client_reference_id, payment_intent) may reach aggregation or render. The
  Stripe boundary in `api/results.js` projects sessions down to
  status/mode/amount/date/discount. Refund work must preserve this:
  `payment_intent` ids may be read **only** in the IO + pure-join layer for
  matching, and must be projected to a plain `refundedCents` number **before**
  `buildReport` or any render sees the session.
- Stripe SDK is `stripe@22.3.0`, API `2026-06-24.dahlia` (see scope decision).
- `lib/results.js` is pure and unit-tested; the money/count rules go there.
- The finished report is cached in module scope for 5 minutes; `?refresh=1`
  forces a fresh read. Refund fetching lives inside that same cached path.

## Architecture

```
api/results.js  (IO — Stripe access, privacy boundary)
  loadSessions()        walk checkout.sessions.list (as today) but also keep
                        one IO-only field  paymentIntentId  per session
  loadRefundIndex()     walk stripe.refunds.list({ limit: 100 }) once
                        (refunds are few → ~1 page); keep only status==='succeeded'
                        → { byPaymentIntent: Map<piId, cents>, totalCents }
        │  hand sessions + byPaymentIntent to the pure join
        ▼
lib/refunds.js  (pure — testable, no Stripe/network)
  annotateRefunds(sessions, byPaymentIntent)
        → sessions each carrying refundedCents; paymentIntentId stripped here,
          so buildReport never receives an identifier
        ▼
lib/results.js  buildReport(sessions, promoNames)   (pure — extended)
  per registration (status complete + known date):
    refunded = session.refundedCents || 0 ; collected = collectedCents(session)
    refunded > 0 && refunded >= collected  → DROP (no row); tally
                                             refundedCents += refunded,
                                             refundedCount += 1
    0 < refunded < collected               → keep seat;
                                             collected -= refunded,
                                             contracted -= refunded;
                                             refundedCents += refunded
    mode === 'subscription' (and counted)  → planRegistrations += 1
  event + grand totals carry  refundedCents  and  refundedCount ;
  totals also carry  planRegistrations . Per-code rows and % of revenue
  recompute off the net figures.
        ▼
api/results.js  computes
  unattributedRefundedCents = max(0, refundIndex.totalCents
                                     − report.totals.refundedCents)
        ▼
lib/registrations-render.js  (extended — FULL registrations report only)
  Headline figures (Registrations / Collected / Contracted) are already net.
  Two muted lines below the tables:
   A) when report.totals.refundedCents > 0 — the net-of-refunds awareness line.
   B) when report.totals.planRegistrations > 0 AND unattributedRefundedCents > 0
      — the orphan/plan caveat.
  The dashboard panel reads report.totals, so its figures are already net — it
  gets NO extra lines (kept clean); the lines live only on the full report.
```

### Full vs partial refund rule

`refunded > 0 && refunded >= collectedCents(session)` defines "fully refunded".
Correct for both modes: a one-time full refund returns the whole `amount_total`;
a cancelled-and-refunded plan only ever collected installment 1, so a refund of
that installment meets the threshold. The `refunded > 0` clause keeps a $0 comp
(no charge, nothing to refund) on its normal path. Anything strictly between 0
and collected is a partial: seat stays, both revenue columns drop by the
refunded amount.

### The awareness lines (copy)

A) Net-of-refunds (shown when `refundedCents > 0`), muted, below the tables:

> Net of refunds: $6,233.50 removed from the figures above — 6 registrations
> fully refunded and dropped; partial refunds netted in place.

B) Orphan/plan caveat (shown when `planRegistrations > 0` and
`unattributedRefundedCents > 0`), muted:

> $X in Stripe refunds weren't matched to a registration here. Payment-plan
> refunds aren't auto-netted yet — if a plan was refunded, subtract it manually.
> (May also include refunds from other products.)

`unattributedRefundedCents` is derived from *all* account refunds, so it can
include unrelated products (e.g. the BCD upsell). Gating line B on the presence
of a payment-plan registration keeps it silent in the common all-payment case,
and its copy is explicit that the figure is a prompt to check, not a precise
OTW number.

## Data flow example (today's live data)

- 6 payment-mode refunds totalling $6,233.50, each ≥ its session's
  `amount_total` → 6 registrations dropped.
- Collected and Contracted each fall by $6,233.50 → Contracted lands at ~$16,018,
  matching the sheet. Headcount falls by 6.
- Line A: "$6,233.50 removed … 6 registrations fully refunded and dropped".
- Line B: shows only if the 1 payment plan has an unmatched refund; today it
  has none, so line B is silent unless other-product refunds exist in-account.

## Error handling

- Refund fetching is inside the same `try` as the session walk on the GET path,
  which already returns 502 "Could not reach Stripe" on failure — so a throw is
  caught there and the page never shows half-netted numbers silently.
- A refund with no matching registration is not attributed; it feeds the orphan
  total instead of vanishing.
- Multiple refunds on one payment intent are summed.
- Refunds with `status !== 'succeeded'` (pending/failed/canceled) are ignored.

## Testing (TDD)

- **`lib/refunds.test.js`** (new): payment-intent match attaches refundedCents;
  multiple refunds on one PI summed; session with no matching PI gets 0;
  `paymentIntentId` stripped from annotated output; non-array input safe.
- **`lib/results.test.js`** (extend): fully-refunded row drops count + both
  revenue columns; partial refund keeps count and nets both columns;
  `refundedCents` / `refundedCount` totals per event and grand total; a $0 comp
  with 0 refund stays on its normal path; `planRegistrations` counts
  subscription-mode registrations; `% of revenue` computed off net contracted;
  sessions without a `refundedCents` field behave exactly as before (regression).
- **`lib/registrations-render.test.js`** (new): line A present when
  `refundedCents > 0`, absent at zero; line B present only when
  `planRegistrations > 0` and `unattributedRefundedCents > 0`, absent otherwise;
  headline figures render the net numbers.

## Verification points during implementation

- Confirm `refund.amount`, `refund.status`, and `refund.payment_intent` shapes
  against installed `stripe@22.3.0` (dahlia) — done at design time, re-confirm in
  code.
- Confirm `stripe.refunds.list()` auto-paginates via `for await` like the
  existing `sessions.list()` / `promotionCodes.list()` walks.
- After deploy, load `/results/registrations?refresh=1` and confirm Contracted
  ≈ $16,018 and headcount dropped by 6.
