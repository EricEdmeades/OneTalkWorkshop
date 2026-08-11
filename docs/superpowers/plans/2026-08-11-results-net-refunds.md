# Net Out Refunds on /results — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/results` net Stripe refunds out of its registration figures so it reconciles with the admin sheet — fully-refunded rows drop, partial refunds reduce revenue, with a muted awareness line and an orphan-refund guard for the deferred payment-plan case.

**Architecture:** A single new `stripe.refunds.list()` walk in the IO layer (`api/results.js`) builds a `payment_intent → cents` index. A new pure module `lib/refunds.js` annotates each session with `refundedCents` (matching on payment intent, then stripping the id). The pure `buildReport` in `lib/results.js` applies the drop/net rules and exposes `refundedCents`, `refundedCount`, and `planRegistrations`. `lib/registrations-render.js` shows two muted lines on the full report only.

**Tech Stack:** Node ESM, Vercel Serverless Functions, Stripe SDK `22.3.0` (API `2026-06-24.dahlia`), Vitest.

---

## File Structure

- **Create** `lib/refunds.js` — pure: `annotateRefunds(sessions, byPaymentIntent)`. Strips `paymentIntentId`, adds `refundedCents`.
- **Create** `lib/refunds.test.js` — unit tests for the join.
- **Modify** `lib/results.js` — `buildReport` nets refunds; adds `refundedCents`/`refundedCount` to events + totals and `planRegistrations` to totals.
- **Modify** `lib/results.test.js` — extend for the new rules (append; do not rewrite existing tests).
- **Modify** `lib/registrations-render.js` — two muted lines (A: net-of-refunds; B: orphan/plan caveat); new `unattributedRefundedCents` option.
- **Create** `lib/registrations-render.test.js` — render tests for both lines + net figures.
- **Modify** `api/results.js` — `loadSessions` keeps `paymentIntentId`; new `loadRefundIndex()`; wire annotate + `unattributedRefundedCents` into `loadRegistrations`; pass it to `renderRegistrationsPage`.

Run all tests with: `npm test` (Vitest, from the project root).

---

## Task 1: Pure refund join — `lib/refunds.js`

**Files:**
- Create: `lib/refunds.js`
- Test: `lib/refunds.test.js`

- [ ] **Step 1: Write the failing test**

Create `lib/refunds.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { annotateRefunds } from './refunds.js';

// Minimal session shape carrying only what annotateRefunds touches.
function session(overrides = {}) {
  return {
    status: 'complete',
    mode: 'payment',
    amount_total: 129700,
    metadata: { date: 'august' },
    paymentIntentId: 'pi_1',
    ...overrides,
  };
}

describe('annotateRefunds', () => {
  it('attaches refundedCents from a matching payment intent', () => {
    const map = new Map([['pi_1', 129700]]);
    const [out] = annotateRefunds([session()], map);
    expect(out.refundedCents).toBe(129700);
  });

  it('attaches zero when no refund matches the payment intent', () => {
    const [out] = annotateRefunds([session({ paymentIntentId: 'pi_other' })], new Map());
    expect(out.refundedCents).toBe(0);
  });

  it('attaches zero when the session has no payment intent', () => {
    const [out] = annotateRefunds([session({ paymentIntentId: null })], new Map([['pi_1', 5000]]));
    expect(out.refundedCents).toBe(0);
  });

  it('strips the payment intent id so it cannot reach the report or render', () => {
    const [out] = annotateRefunds([session()], new Map([['pi_1', 100]]));
    expect(out).not.toHaveProperty('paymentIntentId');
    // Everything else the report needs survives.
    expect(out.status).toBe('complete');
    expect(out.amount_total).toBe(129700);
    expect(out.metadata).toEqual({ date: 'august' });
  });

  it('is safe on non-array input', () => {
    expect(annotateRefunds(undefined, new Map())).toEqual([]);
    expect(annotateRefunds(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/refunds.test.js`
Expected: FAIL — `Failed to resolve import "./refunds.js"` / `annotateRefunds is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/refunds.js`:

```js
// lib/refunds.js — pure refund attribution for the /results report. No Stripe
// or network access (same reasoning as lib/results.js): api/results.js fetches
// the refunds and passes a plain payment_intent → cents map in here.
//
// PRIVACY: paymentIntentId is used ONLY here, to join a refund to its session,
// and is stripped from the returned objects. buildReport and every render
// downstream receive `refundedCents` — a number — never an identifier. The
// module's aggregate-only-by-construction guarantee is preserved.

// Match each session's refund by payment intent (the only clean, testable join
// in Stripe's dahlia API — see the spec's scope decision). Subscription-mode
// refunds do not match here by design; the orphan guard in the report catches
// them. Returns new session objects with `refundedCents` and no `paymentIntentId`.
export function annotateRefunds(sessions, byPaymentIntent = new Map()) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list.map((session) => {
    const { paymentIntentId, ...rest } = session;
    const refundedCents =
      paymentIntentId && byPaymentIntent.has(paymentIntentId)
        ? byPaymentIntent.get(paymentIntentId)
        : 0;
    return { ...rest, refundedCents };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/refunds.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/refunds.js lib/refunds.test.js
git commit -m "feat: pure refund-to-session join for /results

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: buildReport nets refunds — `lib/results.js`

**Files:**
- Modify: `lib/results.js` (the `buildReport` function, lines ~61-125)
- Test: `lib/results.test.js` (append new `describe` blocks)

- [ ] **Step 1: Write the failing tests**

Append to `lib/results.test.js` (after the existing `describe('buildReport — revenue', ...)` block).

**Important:** the `session()` helper at the top of that file destructures only known keys (`date/status/mode/amount/discounts`) and therefore **drops** any `refundedCents` passed to it. So attach refunds by spreading the helper output: `{ ...session({ amount: 129700 }), refundedCents: 129700 }`.

```js
describe('buildReport — refunds', () => {
  it('drops a fully refunded one-time registration entirely', () => {
    const report = buildReport(
      [
        { ...session({ amount: 129700 }), refundedCents: 129700 }, // fully refunded → dropped
        session({ amount: 129700 }),                               // kept
      ],
      {}
    );
    expect(report.totals.registrations).toBe(1);
    expect(report.totals.collectedCents).toBe(129700);
    expect(report.totals.contractedCents).toBe(129700);
  });

  it('counts a fully refunded registration in refundedCents and refundedCount', () => {
    const report = buildReport([{ ...session({ amount: 129700 }), refundedCents: 129700 }], {});
    expect(report.totals.refundedCount).toBe(1);
    expect(report.totals.refundedCents).toBe(129700);
    expect(report.events[0].refundedCount).toBe(1);
    expect(report.events[0].refundedCents).toBe(129700);
  });

  it('keeps a partially refunded seat and nets both revenue columns', () => {
    // $1,297 charged, $300 refunded → seat stays, revenue is $997.
    const report = buildReport([{ ...session({ amount: 129700 }), refundedCents: 30000 }], {});
    const row = report.events[0].rows[0];
    expect(report.totals.registrations).toBe(1);
    expect(row.collectedCents).toBe(99700);
    expect(row.contractedCents).toBe(99700);
    expect(report.totals.refundedCents).toBe(30000);
    expect(report.totals.refundedCount).toBe(0); // partial is not a "dropped" row
  });

  it('nets a partial refund on a payment plan across both installments', () => {
    // subscription: collected 82700 (installment 1), contracted 165400.
    // A 20000 partial refund reduces both by 20000.
    const report = buildReport(
      [{ ...session({ mode: 'subscription', amount: 82700 }), refundedCents: 20000 }],
      {}
    );
    const row = report.events[0].rows[0];
    expect(row.collectedCents).toBe(62700);
    expect(row.contractedCents).toBe(145400);
  });

  it('leaves a $0 comp on its normal path (no refund to apply)', () => {
    const report = buildReport(
      [session({ amount: 0, discounts: [{ promotion_code: 'p' }] })],
      { p: 'SIM2026' }
    );
    const row = report.events[0].rows[0];
    expect(report.totals.registrations).toBe(1);
    expect(row.collectedCents).toBe(0);
    expect(report.totals.refundedCount).toBe(0);
  });

  it('counts payment-plan registrations in planRegistrations', () => {
    const report = buildReport(
      [
        session({ mode: 'subscription', amount: 82700 }),
        session({ mode: 'payment', amount: 129700 }),
      ],
      {}
    );
    expect(report.totals.planRegistrations).toBe(1);
  });

  it('treats sessions with no refundedCents field exactly as before', () => {
    const report = buildReport([session({ amount: 129700 })], {});
    expect(report.totals.registrations).toBe(1);
    expect(report.totals.collectedCents).toBe(129700);
    expect(report.totals.refundedCents).toBe(0);
    expect(report.totals.refundedCount).toBe(0);
  });

  it('computes % of revenue off the net contracted total', () => {
    // Two August rows: NoCode $1,000 net (partial-refunded from $1,300),
    // HALF $3,000. Net total $4,000 → HALF is 75%.
    const report = buildReport(
      [
        { ...session({ amount: 130000 }), refundedCents: 30000 },
        session({ amount: 300000, discounts: [{ promotion_code: 'p' }] }),
      ],
      { p: 'HALF' }
    );
    const aug = report.events[0];
    const half = aug.rows.find((r) => r.code === 'HALF');
    expect(half.sharePct).toBeCloseTo(75, 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/results.test.js`
Expected: FAIL — new assertions on `refundedCents`, `refundedCount`, `planRegistrations` fail (currently `undefined`), and the fully-refunded drop test fails (row still counted).

- [ ] **Step 3: Write the implementation**

In `lib/results.js`, replace the `emptyEvent` helper and the whole `buildReport` function (lines ~57-125) with:

```js
function emptyEvent({ date, label }) {
  return {
    date,
    label,
    registrations: 0,
    collectedCents: 0,
    contractedCents: 0,
    refundedCents: 0,
    refundedCount: 0,
    rows: [],
  };
}

export function buildReport(sessions, promoNames = {}) {
  const buckets = new Map(EVENTS.map((e) => [e.date, new Map()]));
  // Refund tallies live outside the code buckets: a fully-refunded row is
  // dropped from its bucket but its money still has to be reported on the
  // awareness line, so it is accumulated here per event.
  const refundTally = new Map(EVENTS.map((e) => [e.date, { cents: 0, count: 0 }]));
  const planByDate = new Map(EVENTS.map((e) => [e.date, 0]));
  const list = Array.isArray(sessions) ? sessions : [];

  for (const session of list) {
    if (!isRegistration(session)) continue;

    const date = session?.metadata?.date;
    const byCode = buckets.get(date);
    // Unknown or missing date: not one of the two workshops, so it is not a
    // registration in this report (test-mode noise, a future date, etc).
    if (!byCode) continue;

    const collected = collectedCents(session);
    const contracted = contractedCents(session);
    const refunded = Number.isFinite(session?.refundedCents) ? session.refundedCents : 0;
    const tally = refundTally.get(date);

    // Fully refunded: the seat is gone (they are not attending). Drop the row
    // entirely, but record the money and the head so the awareness line can
    // report what was removed. The `refunded > 0` guard keeps a $0 comp — which
    // has no charge to refund — on its normal path.
    if (refunded > 0 && refunded >= collected) {
      tally.cents += refunded;
      tally.count += 1;
      continue;
    }

    // Partial refund: keep the seat, net both revenue columns by the refund.
    const netCollected = collected - refunded;
    const netContracted = contracted - refunded;
    if (refunded > 0) tally.cents += refunded;
    if (session?.mode === 'subscription') planByDate.set(date, planByDate.get(date) + 1);

    const code = resolveCode(session, promoNames);
    const row = byCode.get(code) || { code, registrations: 0, collectedCents: 0, contractedCents: 0 };

    byCode.set(code, {
      code,
      registrations: row.registrations + 1,
      collectedCents: row.collectedCents + netCollected,
      contractedCents: row.contractedCents + netContracted,
    });
  }

  const events = EVENTS.map((event) => {
    const tally = refundTally.get(event.date);
    const rows = [...buckets.get(event.date).values()];
    if (!rows.length) {
      return { ...emptyEvent(event), refundedCents: tally.cents, refundedCount: tally.count };
    }

    const totals = rows.reduce(
      (acc, row) => ({
        registrations: acc.registrations + row.registrations,
        collectedCents: acc.collectedCents + row.collectedCents,
        contractedCents: acc.contractedCents + row.contractedCents,
      }),
      { registrations: 0, collectedCents: 0, contractedCents: 0 }
    );

    return {
      ...event,
      ...totals,
      refundedCents: tally.cents,
      refundedCount: tally.count,
      rows: rows
        .map((row) => ({
          ...row,
          // Share is of THIS event's revenue, so each event's column reads
          // to 100% on its own. A fully comped event has no denominator —
          // report 0 rather than NaN.
          sharePct: totals.contractedCents > 0 ? (row.contractedCents / totals.contractedCents) * 100 : 0,
        }))
        // Revenue first, then headcount — so two $0 comp codes still order
        // by how many people they actually put in the room.
        .sort((a, b) => b.contractedCents - a.contractedCents || b.registrations - a.registrations),
    };
  });

  const totals = events.reduce(
    (acc, e) => ({
      registrations: acc.registrations + e.registrations,
      collectedCents: acc.collectedCents + e.collectedCents,
      contractedCents: acc.contractedCents + e.contractedCents,
      refundedCents: acc.refundedCents + e.refundedCents,
      refundedCount: acc.refundedCount + e.refundedCount,
    }),
    { registrations: 0, collectedCents: 0, contractedCents: 0, refundedCents: 0, refundedCount: 0 }
  );
  totals.planRegistrations = [...planByDate.values()].reduce((a, b) => a + b, 0);

  return { events, totals };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/results.test.js`
Expected: PASS — the new `buildReport — refunds` block plus all pre-existing `buildReport` tests (they pass `refundedCents: undefined`, which is treated as 0).

- [ ] **Step 5: Commit**

```bash
git add lib/results.js lib/results.test.js
git commit -m "feat: net refunds in buildReport, drop fully-refunded rows

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Awareness lines on the full report — `lib/registrations-render.js`

**Files:**
- Modify: `lib/registrations-render.js` (`renderRegistrationsPage`, lines ~82-123)
- Test: `lib/registrations-render.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `lib/registrations-render.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { renderRegistrationsPage } from './registrations-render.js';

// A report shaped like buildReport output, with the refund fields Task 2 added.
function report({
  registrations = 10,
  collectedCents = 1601800,
  contractedCents = 1601800,
  refundedCents = 0,
  refundedCount = 0,
  planRegistrations = 0,
} = {}) {
  return {
    events: [
      { date: 'august', label: 'August 7–9, 2026', registrations, collectedCents, contractedCents, refundedCents, refundedCount, rows: [] },
      { date: 'september', label: 'September 18–20, 2026', registrations: 0, collectedCents: 0, contractedCents: 0, refundedCents: 0, refundedCount: 0, rows: [] },
    ],
    totals: { registrations, collectedCents, contractedCents, refundedCents, refundedCount, planRegistrations },
  };
}

const opts = (over = {}) => ({ truncated: false, fetchedAt: Date.now(), maxSessions: 25000, unattributedRefundedCents: 0, ...over });

describe('renderRegistrationsPage — refund awareness', () => {
  it('shows the net-of-refunds line when refunds were netted', () => {
    const html = renderRegistrationsPage(report({ refundedCents: 623350, refundedCount: 6 }), opts());
    expect(html).toContain('Net of refunds');
    expect(html).toContain('$6,233.50');
    expect(html).toContain('6 registrations');
  });

  it('omits the net-of-refunds line when there were no refunds', () => {
    const html = renderRegistrationsPage(report(), opts());
    expect(html).not.toContain('Net of refunds');
  });

  it('shows the orphan caveat only when a plan exists and refunds are unmatched', () => {
    const html = renderRegistrationsPage(
      report({ planRegistrations: 1 }),
      opts({ unattributedRefundedCents: 190800 })
    );
    expect(html).toContain("weren't matched");
    expect(html).toContain('$1,908');
  });

  it('omits the orphan caveat when there is no payment plan', () => {
    const html = renderRegistrationsPage(report(), opts({ unattributedRefundedCents: 190800 }));
    expect(html).not.toContain("weren't matched");
  });

  it('omits the orphan caveat when nothing is unmatched', () => {
    const html = renderRegistrationsPage(report({ planRegistrations: 1 }), opts({ unattributedRefundedCents: 0 }));
    expect(html).not.toContain("weren't matched");
  });

  it('renders the net headline figures', () => {
    const html = renderRegistrationsPage(report({ registrations: 4, collectedCents: 1601800, contractedCents: 1601800 }), opts());
    expect(html).toContain('$16,018');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/registrations-render.test.js`
Expected: FAIL — "Net of refunds" / "weren't matched" not present (lines not implemented yet).

- [ ] **Step 3: Write the implementation**

In `lib/registrations-render.js`, change the `renderRegistrationsPage` signature to accept the new option and render the two muted lines. Replace the function (lines ~82-123) with:

```js
export function renderRegistrationsPage(
  report,
  { truncated, fetchedAt, maxSessions, unattributedRefundedCents = 0 }
) {
  const { refundedCents, refundedCount, planRegistrations } = report.totals;

  // A) What was netted out. Muted, below the tables — a refund must leave a
  // visible trace, never silently lower a number.
  const refundLine =
    refundedCents > 0
      ? `<p class="note refunds">Net of refunds: ${formatMoney(refundedCents)} removed from the figures above — ${refundedCount.toLocaleString('en-US')} ${
          refundedCount === 1 ? 'registration' : 'registrations'
        } fully refunded and dropped; partial refunds netted in place.</p>`
      : '';

  // B) Orphan guard: payment-plan refunds are not auto-netted yet (see spec).
  // Only surfaces when a plan exists AND some refund could not be matched, so
  // a plan refund is flagged for manual netting instead of silently missed.
  const orphanLine =
    planRegistrations > 0 && unattributedRefundedCents > 0
      ? `<p class="note refunds">${formatMoney(unattributedRefundedCents)} in Stripe refunds weren't matched to a registration here. Payment-plan refunds aren't auto-netted yet — if a plan was refunded, subtract it manually. (May also include refunds from other products.)</p>`
      : '';

  return renderShell(
    'Registration Report',
    `
  ${renderBackLink()}
  <span class="eyebrow">The One Talk Workshop</span>
  <h1>Registration Report</h1>
  <p class="generated">${escapeHtml(formatTimestamp(fetchedAt))} Eastern · ${escapeHtml(describeFreshness(fetchedAt, 'Stripe'))} · <a href="/results/registrations?refresh=1">refresh</a></p>

  ${truncated ? `<p class="warn">Session scan hit the ${maxSessions.toLocaleString('en-US')} record cap — figures below may be incomplete.</p>` : ''}

  <div class="totals">
    <div class="card">
      <div class="label">Registrations</div>
      <div class="value">${report.totals.registrations.toLocaleString('en-US')}</div>
    </div>
    <div class="card">
      <div class="label">Collected</div>
      <div class="value">${formatMoney(report.totals.collectedCents)}</div>
    </div>
    <div class="card">
      <div class="label">Contracted</div>
      <div class="value">${formatMoney(report.totals.contractedCents)}</div>
    </div>
  </div>

  ${report.events.map(renderEvent).join('')}

  ${refundLine}
  ${orphanLine}

  <p class="note">
    <strong>Collected</strong> is what Stripe has actually taken, net of refunds.
    <strong>Contracted</strong> counts each payment-plan registration at its full
    two-installment value, so the gap between the columns is the installments still
    scheduled to bill. A 100%-off comp counts as a registration with zero revenue —
    it occupies a seat in the room like any other. <strong>% of revenue</strong> is
    each code's share of that event's contracted total.
  </p>
  <p class="note">
    Aggregate figures only. No attendee names, emails, customer records, or payment
    identifiers are read or displayed.
  </p>`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/registrations-render.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/registrations-render.js lib/registrations-render.test.js
git commit -m "feat: muted refund awareness + orphan-guard lines on registrations report

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire Stripe refunds into the IO layer — `api/results.js`

**Files:**
- Modify: `api/results.js` — `loadSessions` (~235-256), add `loadRefundIndex`, `loadRegistrations` (~258-270), and the `renderRegistrationsPage` call (~536-544).

No unit test (the `/api/*` functions are verified manually per `CLAUDE.md`). Verification is manual + the full suite must stay green.

- [ ] **Step 1: Add `paymentIntentId` to the session projection**

In `loadSessions`, inside the `sessions.push({ ... })` object, add one field (keep everything else identical):

```js
    sessions.push({
      status: session.status,
      mode: session.mode,
      amount_total: session.amount_total,
      metadata: { date: session.metadata?.date },
      discounts: session.discounts,
      // IO-only: used to join refunds in lib/refunds.js, then stripped there
      // before buildReport or any render sees the session.
      paymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null,
    });
```

- [ ] **Step 2: Add the refund index loader**

Add a constant near `MAX_SESSIONS` (top of file, after line ~42):

```js
// Refunds are few (dozens at most); this cap only guards against a runaway walk.
const MAX_REFUNDS = 5000;
```

Add this function just above `loadRegistrations` (after `loadSessions`, ~256):

```js
// Walk every refund once and index the SUCCEEDED ones by payment_intent. The
// checkout session carries the same payment_intent for a one-time payment, so
// lib/refunds.js can net the refund against that registration. Subscription
// installment refunds do not share the session's payment_intent (it is null in
// subscription mode) and so are not matched here by design — the orphan guard
// on the report surfaces them for manual handling (see the design spec).
//
// totalCents is EVERY succeeded refund in the account (including other
// products); the report subtracts what it managed to attribute to get the
// unattributed figure the orphan line reports.
async function loadRefundIndex() {
  const byPaymentIntent = new Map();
  let totalCents = 0;
  let seen = 0;

  for await (const refund of stripe.refunds.list({ limit: 100 })) {
    if (seen >= MAX_REFUNDS) break;
    seen += 1;
    if (refund.status && refund.status !== 'succeeded') continue;
    const amount = Number.isFinite(refund.amount) ? refund.amount : 0;
    if (amount <= 0) continue;

    totalCents += amount;
    const pi =
      typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : refund.payment_intent?.id;
    if (pi) byPaymentIntent.set(pi, (byPaymentIntent.get(pi) || 0) + amount);
  }

  return { byPaymentIntent, totalCents };
}
```

- [ ] **Step 3: Import the join and wire it into `loadRegistrations`**

Add to the imports at the top of `api/results.js` (next to the other `lib/` imports, ~26-33):

```js
import { annotateRefunds } from '../lib/refunds.js';
```

Replace the body of `loadRegistrations` (~258-270) with:

```js
async function loadRegistrations({ forceRefresh }) {
  const cached =
    !forceRefresh && reportCache && Date.now() - reportCache.at < CACHE_TTL_MS ? reportCache : null;
  if (cached) return cached;

  // Codes, sessions and refunds are independent lookups — fetch concurrently.
  const [promoNames, { sessions, truncated }, refundIndex] = await Promise.all([
    loadCodeNames(),
    loadSessions(),
    loadRefundIndex(),
  ]);

  const annotated = annotateRefunds(sessions, refundIndex.byPaymentIntent);
  const report = buildReport(annotated, promoNames);
  // Every succeeded refund minus what the report netted = refunds we could not
  // tie to a counted registration (payment-plan refunds, other products).
  const unattributedRefundedCents = Math.max(
    0,
    refundIndex.totalCents - report.totals.refundedCents
  );

  reportCache = { at: Date.now(), report, truncated, unattributedRefundedCents };
  return reportCache;
}
```

- [ ] **Step 4: Pass the new figure to the renderer**

In the handler, update the `renderRegistrationsPage` call (~536-544) to pass `unattributedRefundedCents`:

```js
    if (view === VIEWS.registrations) {
      return res.status(200).send(
        renderRegistrationsPage(entry.report, {
          truncated: entry.truncated,
          fetchedAt: entry.at,
          maxSessions: MAX_SESSIONS,
          unattributedRefundedCents: entry.unattributedRefundedCents,
        })
      );
    }
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all suites green (`lib/refunds`, `lib/results`, `lib/registrations-render`, plus every pre-existing suite unchanged).

- [ ] **Step 6: Commit**

```bash
git add api/results.js
git commit -m "feat: load Stripe refunds and net them into /results

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Manual verification against production data

**Files:** none (verification only).

- [ ] **Step 1: Confirm the build is clean**

Run: `npm run build`
Expected: Vite build succeeds (the `lib/` server modules are not bundled into the client, but a broken import would still surface).

- [ ] **Step 2: Verify the numbers after deploy**

Once deployed to a Vercel preview (push the branch), open `/results/registrations?refresh=1` and confirm against the reconciliation done on 2026-08-11:

- **Contracted ≈ $16,018** (was ≈ $22,252 before netting).
- **Registrations** dropped by **6** vs the pre-change figure.
- The muted **"Net of refunds: $6,233.50 … 6 registrations fully refunded and dropped"** line appears below the tables.
- If any other-product refunds exist in the account and the one payment plan is present, the orphan line appears; otherwise it stays hidden.

- [ ] **Step 3: Confirm privacy invariant held**

Grep the rendered HTML source of `/results/registrations` for an `@` sign or any `pi_`/`cus_`/`sub_` id. Expected: none — only aggregate figures and code names.

---

## Self-Review Notes

- **Spec coverage:** full-refund drop (Task 2), partial net (Task 2), awareness line A (Task 3), orphan guard / line B (Tasks 2+3+4), payment-mode-only join (Task 1), privacy-preserving id strip (Task 1), `?refresh` cache path (Task 4). All covered.
- **Type consistency:** `annotateRefunds(sessions, byPaymentIntent)`, `report.totals.{refundedCents,refundedCount,planRegistrations}`, and the render option `unattributedRefundedCents` are used identically across Tasks 1-4.
- **No placeholders:** every code step shows complete code; every test step shows the assertions.
