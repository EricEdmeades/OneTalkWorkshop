# OneTalkWorkshop — Two-Channel `/results` (Stripe + Keap)

**Date:** 2026-08-11
**Status:** Approved (brainstormed interactively)

## Context

`/results/registrations` reports OTW sales by walking Stripe **Checkout Sessions**
(`api/results.js` → `lib/results.js`). Investigation on 2026-08-11 (after shipping
refund-netting, see `2026-08-11-results-net-refunds-design.md`) found the report
is **missing an entire sales channel**:

- OTW sells through **two systems that both charge one shared Stripe account**:
  1. **onetalkworkshop.com** → Stripe **Checkout Session** carrying an OTW Price ID
     and `metadata.date`. `/results` sees these (366 sessions, $23,412 gross).
  2. **speakernation.com (WooCommerce)** → a bare Stripe **PaymentIntent**
     (`description: "… Order NNNNN"`, metadata = `order_id` + `site_url` only, **no
     product, no date**), *and* a **Keap order**. `/results` cannot see these —
     there is no Checkout Session, and the Stripe charge has nothing identifying
     it as OTW.

Evidence: the example customer had **zero** Checkout Sessions and a `$997`
PaymentIntent labelled "Speaker Nation - Order 24626" (a WooCommerce order).
Every OTW-priced Checkout Session already carries a date, so `/results` captures
100% of the *web* channel — but nothing of the *Woo/Keap* channel.

**Keap is the unifying source.** Every registrant (both channels) lands in Keap
with an Aug/Sep tag, and Woo sales create Keap **orders** with amounts. Keap tag
counts (**August `2008` = 211**, **September `1825` = 130**) match the admin
sheet's row counts exactly — the sheet is effectively the Keap roster.

**The sheet cannot be matched exactly** (it is internally inconsistent — $17,615
vs $16,018 across its own tabs). The goal is a **correct, well-defined** number
from the two real sources; the sheet gets reconciled to `/results`, not the
reverse.

## Goal

Make `/results/registrations` a **two-channel** report:

- **Headcount** = Keap tag counts (Aug/Sep). One authoritative roster covering
  both channels; includes $0 comps and any still-tagged refunded contacts (raw
  roster — matches the sheet).
- **Revenue (Collected / Contracted)** = **Stripe Checkout net** (existing
  refund-netted figure) **+ Keap-order net**, summed, with a hashed-email de-dup
  guard.
- Keap-order net is computed **per order** as `total + refund_total` (Keap stores
  `refund_total` as a negative number; verified populated — OTW orders sum to
  `refund_total = −$7,630.50`).

## Design decisions (locked in the brainstorm)

1. **Keap OTW orders** = orders containing product **id `49` ("One Talk
   Workshop")** whose **contact carries an Aug or Sep tag**. The tag requirement
   cleanly excludes the 2025 postponed-cohort orders (13 untagged OTW orders
   dating back to 2025-07). Date attribution comes from **which tag** the
   contact holds.
2. **Keap refunds are netted** via `refund_total` (not gross+awareness — that
   earlier call was made before we found `refund_total` exists).
3. **No Keap per-code table.** The promo code is not on the order (the discount
   is a generic `"Discount"` line item with no code name). The Keap/Woo channel
   is shown at **date + channel** level only. The existing Stripe **per-code**
   table stays (web channel).
4. **De-dup across channels via one-way hashed email.** A buyer present in both
   channels (bought via onetalkworkshop.com *and* Woo) is counted once for
   revenue — Stripe channel takes precedence, the duplicate Keap order's net is
   excluded. Expected overlap ≈ 0 (channels are structurally near-disjoint). Raw
   emails are read **only** in the IO layer, hashed immediately (same one-way
   hash pattern the survey uses), and never reach aggregation or render.
5. **Headcount = raw Keap tag count.** Comps and any still-tagged refunded
   contacts are included (consistent with "the roster").

## Non-goals (YAGNI)

- Exact match to the current admin sheet (internally inconsistent).
- Keap per-code breakdown (code not available on the order).
- Netting the Woo channel's refunds from *Stripe* (we use Keap `refund_total`
  instead — simpler and already by-date via the tag).

## Numbers grounding (as of 2026-08-11)

| Source | Figure |
|---|---|
| Keap tag August (2008) | 211 contacts |
| Keap tag September (1825) | 130 contacts |
| Keap OTW orders, current cohort | 7 Aug ($6,882) + 11 Sep ($8,179) gross |
| Keap OTW `refund_total` (all OTW orders) | −$7,630.50 |
| Stripe Checkout (web) | 366 sessions, $23,412 gross, ~$7,442 net after refunds |

## Architecture

```
api/results.js  (IO — Stripe + Keap access, privacy boundary)
  existing Stripe loaders (loadSessions, loadRefundIndex, loadCodeNames)  [unchanged]
  + loadKeapTagCounts()      GET /tags/2008/contacts?limit=1 (read `count`) and 1825
                             → { august, september }   (headcount)
  + loadKeapTagMembers()     GET /tags/{id}/contacts paged → Set<contactId> for aug, sep
                             (used to date-attribute orders without per-order calls)
  + loadKeapOrders()         page /orders; keep those with an OTW line item (product 49)
                             whose contact ∈ aug/sep set; project each to
                             { date, netCents = round((total+refund_total)*100),
                               grossCents, refundCents, emailHash }
        │  hand the projected orders + Stripe report to a pure combiner
        ▼
lib/keap-orders.js  (pure — testable, no Keap/network)
  buildKeapReport(orders)    → { events:[{date,label,registrations,netCents,grossCents,
                                 refundCents}], totals } for the Keap channel
        ▼
lib/results-combined.js  (pure — testable)
  combineChannels(stripeReport, keapReport, keapTagCounts, overlapHashes)
     - Registrations   = keapTagCounts (per date + total)
     - Collected/Contracted per date = stripeNet + keapNet, minus de-duped overlap
     - carries per-channel figures so the render can show the breakdown
        ▼
lib/registrations-render.js  (extended)
  top line: Registrations (Keap) · Collected · Contracted (combined)
  per event: a small per-channel breakdown —
     Web (Stripe, net)   |   Keap/Woo (net)   →  combined total
  existing Stripe per-code table stays (labelled web channel)
  awareness lines: existing Stripe refund/orphan line; a de-dup note iff overlap>0
```

`lib/results.js` (Stripe aggregation) is unchanged. Hashing uses a small shared
helper (`lib/email-hash.js`, `sha256(lowercased-trimmed-email)`), matching the
survey respondent-hash approach.

### Date attribution for Keap orders

An order's date = the Aug/Sep tag on its **contact**. Build the two tagged-contact
id sets once (`loadKeapTagMembers`), then bucket each OTW order by set membership.
An order whose contact is in **neither** set is excluded (not current cohort — the
2025 orders). An order whose contact is in **both** sets is attributed **deterministically to
August** and the occurrence is logged (`console.warn`). Expected count 0; the rule
just guarantees a stable, non-double-counting bucket rather than dropping the
order or counting it twice.

### De-dup

Both channels expose a buyer email in the IO layer only:
- Keap: `order.contact.email` → `emailHash`.
- Stripe: `session.customer_details.email` → `emailHash` (this field is currently
  projected away in `loadSessions`; it will be read, hashed, and dropped — the raw
  value never leaves IO).
`combineChannels` receives the set of hashes present in **both** channels; for each
overlapping hash it removes that contact's Keap-order net from the combined revenue
(Stripe precedence) and increments an `overlap` counter surfaced as a muted note.

## Performance

- Headcount: 2 count calls (instant).
- Tagged-member sets: ~341 contacts over a few paged calls.
- Orders: page `/orders` (Keap has no product filter on list — bounded scan,
  newest-first, stop after a page yields no 2026 orders). OTW orders are few
  (~31 all-time).
- Reuse the existing 5-minute module cache; the Keap fetch lives inside it, in the
  same `Promise.all` and `try` as the Stripe walk (a Keap failure surfaces as the
  existing 502, never a half-built report).

## Privacy

Preserves the module's invariant: no attendee identifier reaches aggregation or
render. New identifiers (`contact.email`, `customer_details.email`) are read only
in the IO layer to produce a one-way `emailHash`, which is used solely for de-dup
counting and never rendered. Keap contact names/addresses are never read.

## Error handling

- A Keap failure degrades like the existing Stripe failure on the GET path (502),
  since the Keap fetch is inside the same `try`/`Promise.all`. It must never show
  the Stripe channel alone as if it were the whole picture — a combined report
  with a missing channel would under-report silently, so a Keap error fails the
  page loudly (same 502), matching how the report already treats Stripe.

## Testing (TDD)

- **`lib/email-hash.test.js`**: stable hash; case/whitespace-insensitive; empty → null.
- **`lib/keap-orders.test.js`**: net = total + refund_total; by-date bucketing;
  gross/refund/net totals; empty input safe; a $0 comp order counts as a
  registration-free revenue-zero row (Keap channel tracks revenue only — headcount
  is tags).
- **`lib/results-combined.test.js`**: Registrations = tag counts; combined revenue
  = stripeNet + keapNet per date; de-dup removes an overlapping buyer's Keap net
  once and counts the overlap; per-channel figures preserved.
- **`lib/registrations-render.test.js`** (extend): renders Keap tag headcount,
  the per-channel breakdown, and the de-dup note only when overlap>0.
- `api/results.js` Keap IO: no unit tests (repo convention — manual verification),
  full suite stays green, `npm run build` passes.

## Verification points during implementation

- Confirm Keap `/orders` list items expose `product_id`/product to identify id 49,
  and `total` + `refund_total` (list vs detail view — a detail fetch per order is
  acceptable given the small count if the list omits fields).
- Confirm `/tags/{id}/contacts` returns `count` (headcount) and paginates via `next`.
- Confirm `order.contact.email` is present on the list (else fetch contact).
- After deploy, spot-check: combined August/September against a manual Keap+Stripe
  tally, and confirm the de-dup note stays hidden (overlap 0).
