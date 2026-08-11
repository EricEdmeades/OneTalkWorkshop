# Two-Channel /results (Stripe + Keap) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/results/registrations` a two-channel report — headcount from Keap Aug/Sep tags, revenue from Stripe Checkout net **+** Keap-order net (`total + refund_total`), summed with a hashed-email de-dup guard.

**Architecture:** Three new pure modules (`lib/email-hash.js`, `lib/keap-orders.js`, `lib/results-combined.js`) do all the counting/merging and are unit-tested. `api/results.js` gains Keap IO (tag counts, tag-member sets, orders) and hands projected data to the pure combiner. `lib/results.js` (Stripe aggregation) is unchanged. The render consumes a combined report shape.

**Tech Stack:** Node ESM, Vercel Serverless Functions, Stripe `22.3.0`, Keap REST v1 (`X-Keap-API-Key`), Vitest.

---

## File Structure

- **Create** `lib/email-hash.js` — `emailHash(email)`, one-way sha256 of normalised email.
- **Create** `lib/email-hash.test.js`
- **Create** `lib/keap-orders.js` — `buildKeapReport(orders)`, pure Keap-channel aggregation.
- **Create** `lib/keap-orders.test.js`
- **Create** `lib/results-combined.js` — `dedupeKeapOrders(orders, stripeHashes)` + `combineChannels(stripeReport, keapReport, tagCounts, overlapCount)`.
- **Create** `lib/results-combined.test.js`
- **Modify** `lib/report-chrome.js` — add a little CSS for the per-event channel summary.
- **Modify** `lib/registrations-render.js` — render the combined shape (Keap headcount, per-channel breakdown, web per-code table, awareness lines).
- **Modify** `lib/registrations-render.test.js` — rewrite tests for the combined report shape.
- **Modify** `api/results.js` — Keap IO + email-hash on sessions + combine + cache; pass combined report to both the registrations page and the dashboard panel.

Run tests: `npm test`. Build: `npm run build`.

Reference data (verified live 2026-08-11): Keap product id `49` = "One Talk Workshop"; tags August `2008` = 211, September `1825` = 130; Keap OTW `refund_total` sums to −$7,630.50; Keap base URL `https://api.infusionsoft.com/crm/rest/v1`, header `X-Keap-API-Key`.

---

## Task 1: Email hash — `lib/email-hash.js`

**Files:** Create `lib/email-hash.js`, `lib/email-hash.test.js`.

- [ ] **Step 1: Write the failing test** — create `lib/email-hash.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { emailHash } from './email-hash.js';

describe('emailHash', () => {
  it('is stable and normalises case and surrounding whitespace', () => {
    const a = emailHash('Gail@Example.COM');
    const b = emailHash('  gail@example.com  ');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes different emails', () => {
    expect(emailHash('a@x.com')).not.toBe(emailHash('b@x.com'));
  });

  it('returns null for empty or non-string input', () => {
    expect(emailHash('')).toBeNull();
    expect(emailHash('   ')).toBeNull();
    expect(emailHash(null)).toBeNull();
    expect(emailHash(undefined)).toBeNull();
    expect(emailHash(42)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm it fails** — `npm test -- lib/email-hash.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `lib/email-hash.js`:

```js
// lib/email-hash.js — one-way email hash for cross-channel de-dup. Same idea as
// the survey respondent hash: an email is read only in the IO layer, reduced to
// this opaque digest, and the raw value never travels further. Two records for
// the same person hash identically (case/whitespace-normalised), so a buyer who
// appears in both the Stripe and Keap channels can be matched without any
// identifier reaching aggregation or render.
import crypto from 'node:crypto';

export function emailHash(email) {
  if (typeof email !== 'string') return null;
  const normalised = email.trim().toLowerCase();
  if (!normalised) return null;
  return crypto.createHash('sha256').update(normalised).digest('hex');
}
```

- [ ] **Step 4: Run and confirm pass** — `npm test -- lib/email-hash.test.js` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/email-hash.js lib/email-hash.test.js
git commit -m "feat: one-way email hash for cross-channel de-dup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Keap-channel aggregation — `lib/keap-orders.js`

**Files:** Create `lib/keap-orders.js`, `lib/keap-orders.test.js`. Imports `EVENTS` from `lib/results.js` (already exported there).

- [ ] **Step 1: Write the failing test** — create `lib/keap-orders.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildKeapReport } from './keap-orders.js';

// A projected Keap order: date bucket + integer cents (net/gross/refund).
const order = (o = {}) => ({ date: 'august', grossCents: 99700, refundCents: 0, netCents: 99700, ...o });

describe('buildKeapReport', () => {
  it('always returns both events, zeroed, for empty input', () => {
    const r = buildKeapReport([]);
    expect(r.events.map((e) => e.date)).toEqual(['august', 'september']);
    expect(r.totals).toEqual({ orders: 0, netCents: 0, grossCents: 0, refundCents: 0 });
  });

  it('sums net, gross and refund per event and in totals', () => {
    const r = buildKeapReport([
      order({ date: 'august', grossCents: 129700, refundCents: 0, netCents: 129700 }),
      order({ date: 'august', grossCents: 99700, refundCents: 99700, netCents: 0 }), // fully refunded
      order({ date: 'september', grossCents: 81790, refundCents: 0, netCents: 81790 }),
    ]);
    const [aug, sep] = r.events;
    expect(aug.orders).toBe(2);
    expect(aug.grossCents).toBe(229400);
    expect(aug.refundCents).toBe(99700);
    expect(aug.netCents).toBe(129700);
    expect(sep.netCents).toBe(81790);
    expect(r.totals.netCents).toBe(211490);
    expect(r.totals.refundCents).toBe(99700);
  });

  it('ignores orders with an unknown date bucket', () => {
    const r = buildKeapReport([order({ date: 'october' }), order({ date: undefined })]);
    expect(r.totals.orders).toBe(0);
  });

  it('treats non-finite amounts as zero', () => {
    const r = buildKeapReport([{ date: 'august' }]);
    expect(r.events[0].orders).toBe(1);
    expect(r.events[0].netCents).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm it fails** — `npm test -- lib/keap-orders.test.js` → FAIL.

- [ ] **Step 3: Implement** — create `lib/keap-orders.js`:

```js
// lib/keap-orders.js — pure aggregation for the Keap/WooCommerce sales channel
// of the /results report. No Keap or network access (mirrors lib/results.js):
// api/results.js fetches and projects orders, this counts the money.
//
// Each order arrives already attributed to a workshop date, already de-duped
// against the Stripe channel, and reduced to plain integer cents. netCents =
// gross + refund_total (Keap stores refunds as a negative refund_total), so a
// refunded Woo order nets down here the way a refunded Stripe session does in
// lib/results.js.
import { EVENTS } from './results.js';

function emptyEvent({ date, label }) {
  return { date, label, orders: 0, netCents: 0, grossCents: 0, refundCents: 0 };
}

const int = (v) => (Number.isFinite(v) ? v : 0);

export function buildKeapReport(orders) {
  const byDate = new Map(EVENTS.map((e) => [e.date, emptyEvent(e)]));
  const list = Array.isArray(orders) ? orders : [];

  for (const order of list) {
    const bucket = byDate.get(order?.date);
    if (!bucket) continue; // not one of the two workshops
    bucket.orders += 1;
    bucket.netCents += int(order.netCents);
    bucket.grossCents += int(order.grossCents);
    bucket.refundCents += int(order.refundCents);
  }

  const events = EVENTS.map((e) => byDate.get(e.date));
  const totals = events.reduce(
    (acc, e) => ({
      orders: acc.orders + e.orders,
      netCents: acc.netCents + e.netCents,
      grossCents: acc.grossCents + e.grossCents,
      refundCents: acc.refundCents + e.refundCents,
    }),
    { orders: 0, netCents: 0, grossCents: 0, refundCents: 0 }
  );

  return { events, totals };
}
```

- [ ] **Step 4: Run and confirm pass** — `npm test -- lib/keap-orders.test.js` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/keap-orders.js lib/keap-orders.test.js
git commit -m "feat: pure Keap/Woo channel aggregation for /results

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Channel combiner — `lib/results-combined.js`

**Files:** Create `lib/results-combined.js`, `lib/results-combined.test.js`. Imports `EVENTS` from `lib/results.js`.

- [ ] **Step 1: Write the failing test** — create `lib/results-combined.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { dedupeKeapOrders, combineChannels } from './results-combined.js';

describe('dedupeKeapOrders', () => {
  it('drops orders whose emailHash is in the Stripe set and counts the overlap', () => {
    const orders = [
      { date: 'august', netCents: 100, emailHash: 'aaa' },
      { date: 'august', netCents: 200, emailHash: 'bbb' },
      { date: 'september', netCents: 300, emailHash: null },
    ];
    const { orders: kept, overlapCount } = dedupeKeapOrders(orders, new Set(['bbb']));
    expect(overlapCount).toBe(1);
    expect(kept.map((o) => o.netCents)).toEqual([100, 300]);
  });

  it('keeps everything when there is no overlap and is safe on bad input', () => {
    expect(dedupeKeapOrders([], new Set())).toEqual({ orders: [], overlapCount: 0 });
    expect(dedupeKeapOrders(undefined, undefined)).toEqual({ orders: [], overlapCount: 0 });
  });
});

// Minimal channel-report fixtures shaped like buildReport / buildKeapReport output.
const stripeReport = {
  events: [
    { date: 'august', label: 'August 7–9, 2026', registrations: 3, collectedCents: 300000, contractedCents: 320000, rows: [] },
    { date: 'september', label: 'September 18–20, 2026', registrations: 2, collectedCents: 200000, contractedCents: 200000, rows: [] },
  ],
  totals: { registrations: 5, collectedCents: 500000, contractedCents: 520000, refundedCents: 12345, refundedCount: 6, planRegistrations: 1 },
};
const keapReport = {
  events: [
    { date: 'august', label: 'August 7–9, 2026', orders: 7, netCents: 688200, grossCents: 688200, refundCents: 0 },
    { date: 'september', label: 'September 18–20, 2026', orders: 11, netCents: 817900, grossCents: 900000, refundCents: 82100 },
  ],
  totals: { orders: 18, netCents: 1506100, grossCents: 1588200, refundCents: 82100 },
};

describe('combineChannels', () => {
  it('takes headcount from Keap tags and sums revenue per date', () => {
    const c = combineChannels(stripeReport, keapReport, { august: 211, september: 130 }, 0);
    expect(c.totals.registrations).toBe(341);
    const [aug, sep] = c.events;
    expect(aug.registrations).toBe(211);
    expect(aug.collectedCents).toBe(300000 + 688200);
    expect(aug.contractedCents).toBe(320000 + 688200);
    expect(sep.collectedCents).toBe(200000 + 817900);
    expect(c.totals.collectedCents).toBe(300000 + 688200 + 200000 + 817900);
  });

  it('preserves the per-channel figures and the Stripe web event (rows) for the detail table', () => {
    const c = combineChannels(stripeReport, keapReport, { august: 211, september: 130 }, 0);
    expect(c.events[0].web).toBe(stripeReport.events[0]);
    expect(c.events[0].keapNetCents).toBe(688200);
    expect(c.totals.webCollectedCents).toBe(500000);
    expect(c.totals.keapNetCents).toBe(1506100);
  });

  it('carries the Stripe refund/plan fields and the overlap count for the awareness lines', () => {
    const c = combineChannels(stripeReport, keapReport, { august: 211, september: 130 }, 2);
    expect(c.totals.refundedCents).toBe(12345);
    expect(c.totals.refundedCount).toBe(6);
    expect(c.totals.planRegistrations).toBe(1);
    expect(c.totals.overlapCount).toBe(2);
  });

  it('treats missing tag counts as zero', () => {
    const c = combineChannels(stripeReport, keapReport, {}, 0);
    expect(c.totals.registrations).toBe(0);
    expect(c.events[0].registrations).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm it fails** — `npm test -- lib/results-combined.test.js` → FAIL.

- [ ] **Step 3: Implement** — create `lib/results-combined.js`:

```js
// lib/results-combined.js — pure merge of the two /results revenue channels:
// Stripe Checkout (web) and Keap/WooCommerce. Headcount comes from Keap tags
// (the authoritative roster across both channels); revenue is the sum of the two
// channels' net. No IO here — api/results.js builds each channel report and the
// Stripe email-hash set, and hands them in.
import { EVENTS } from './results.js';

// Drop Keap orders whose buyer also bought through the Stripe channel, so a
// person present in both is counted once (Stripe precedence). Returns the kept
// orders and how many were dropped as duplicates.
export function dedupeKeapOrders(orders, stripeHashes) {
  const set = stripeHashes instanceof Set ? stripeHashes : new Set(stripeHashes || []);
  const kept = [];
  let overlapCount = 0;
  for (const order of Array.isArray(orders) ? orders : []) {
    if (order?.emailHash && set.has(order.emailHash)) overlapCount += 1;
    else kept.push(order);
  }
  return { orders: kept, overlapCount };
}

const tagCount = (counts, date) => (Number.isFinite(counts?.[date]) ? counts[date] : 0);

export function combineChannels(stripeReport, keapReport, tagCounts = {}, overlapCount = 0) {
  const events = EVENTS.map((e) => {
    // Pair by date, not array index, so this never depends on the two builders
    // emitting events in the same order.
    const web = stripeReport.events.find((x) => x.date === e.date);
    const keap = keapReport.events.find((x) => x.date === e.date);
    const registrations = tagCount(tagCounts, e.date);
    return {
      date: e.date,
      label: e.label,
      registrations,
      web, // the Stripe event (carries its per-code rows) for the detail table
      keapNetCents: keap.netCents,
      keapGrossCents: keap.grossCents,
      keapRefundCents: keap.refundCents,
      collectedCents: web.collectedCents + keap.netCents,
      contractedCents: web.contractedCents + keap.netCents,
    };
  });

  const sum = (f) => events.reduce((acc, e) => acc + f(e), 0);
  const totals = {
    registrations: sum((e) => e.registrations),
    collectedCents: sum((e) => e.collectedCents),
    contractedCents: sum((e) => e.contractedCents),
    webCollectedCents: stripeReport.totals.collectedCents,
    webContractedCents: stripeReport.totals.contractedCents,
    keapNetCents: keapReport.totals.netCents,
    keapGrossCents: keapReport.totals.grossCents,
    keapRefundCents: keapReport.totals.refundCents,
    // carried through for the existing Stripe refund / orphan awareness lines
    refundedCents: stripeReport.totals.refundedCents,
    refundedCount: stripeReport.totals.refundedCount,
    planRegistrations: stripeReport.totals.planRegistrations,
    overlapCount,
  };

  return { events, totals };
}
```

- [ ] **Step 4: Run and confirm pass** — `npm test -- lib/results-combined.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/results-combined.js lib/results-combined.test.js
git commit -m "feat: combine Stripe + Keap channels for /results, hashed de-dup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Render the combined report — `lib/registrations-render.js` + CSS

**Files:** Modify `lib/report-chrome.js` (CSS), `lib/registrations-render.js`, `lib/registrations-render.test.js` (rewrite).

- [ ] **Step 1: Add CSS** — in `lib/report-chrome.js`, inside the `PAGE_CSS` template literal, just before the closing `` ` `` and the `@media` block, add:

```css
  .channels { display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 0 0 14px; }
  .chan { font-size: 0.82rem; color: var(--charcoal); }
  .chan .clabel { color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.66rem; font-weight: 700; margin-right: 6px; }
  h3.detail-h { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
  .split-note { margin: -34px 0 40px; color: var(--muted); font-size: 0.82rem; }
```

- [ ] **Step 2: Write the failing tests** — replace the entire contents of `lib/registrations-render.test.js` with:

```js
import { describe, it, expect } from 'vitest';
import { renderRegistrationsPage } from './registrations-render.js';

// A combined report shaped like combineChannels() output.
function combined(over = {}) {
  const webAug = { date: 'august', label: 'August 7–9, 2026', registrations: 3, collectedCents: 372100, contractedCents: 454800, rows: [] };
  const webSep = { date: 'september', label: 'September 18–20, 2026', registrations: 0, collectedCents: 0, contractedCents: 0, rows: [] };
  return {
    events: [
      { date: 'august', label: 'August 7–9, 2026', registrations: 211, web: webAug, keapNetCents: 688200, keapGrossCents: 688200, keapRefundCents: 0, collectedCents: 372100 + 688200, contractedCents: 454800 + 688200 },
      { date: 'september', label: 'September 18–20, 2026', registrations: 130, web: webSep, keapNetCents: 817900, keapGrossCents: 900000, keapRefundCents: 82100, collectedCents: 817900, contractedCents: 817900 },
    ],
    totals: {
      registrations: 341,
      collectedCents: 372100 + 688200 + 817900,
      contractedCents: 454800 + 688200 + 817900,
      webCollectedCents: 372100,
      webContractedCents: 454800,
      keapNetCents: 1506100,
      keapGrossCents: 1588200,
      keapRefundCents: 82100,
      refundedCents: 0,
      refundedCount: 0,
      planRegistrations: 0,
      overlapCount: 0,
      ...over,
    },
  };
}

const opts = (over = {}) => ({ truncated: false, fetchedAt: Date.now(), maxSessions: 25000, unattributedRefundedCents: 0, ...over });

describe('renderRegistrationsPage — two channels', () => {
  it('shows the Keap tag headcount as Registrations', () => {
    const html = renderRegistrationsPage(combined(), opts());
    expect(html).toContain('341');
  });

  it('shows combined revenue and a per-channel split', () => {
    const html = renderRegistrationsPage(combined(), opts());
    // combined collected total = 3721+6882+8179 = $18,782
    expect(html).toContain('$18,782');
    expect(html).toContain('Web'); // channel labels present
    expect(html).toContain('Keap');
  });

  it('renders the de-dup note only when overlap > 0', () => {
    expect(renderRegistrationsPage(combined(), opts())).not.toContain('appear in both channels');
    expect(renderRegistrationsPage(combined({ overlapCount: 2 }), opts())).toContain('appear in both channels');
  });

  it('shows the Stripe refund line when refunds were netted', () => {
    const html = renderRegistrationsPage(combined({ refundedCents: 623350, refundedCount: 6 }), opts());
    expect(html).toContain('Net of refunds');
    expect(html).toContain('$6,233.50');
  });

  it('keeps the web per-code detail table', () => {
    const html = renderRegistrationsPage(combined(), opts());
    expect(html).toContain('Web checkout by code');
  });
});
```

- [ ] **Step 3: Run and confirm it fails** — `npm test -- lib/registrations-render.test.js` → FAIL.

- [ ] **Step 4: Implement** — in `lib/registrations-render.js`, replace `renderEvent` (lines 17-58) with a table-only helper `renderCodeTable`, and replace `renderRegistrationsPage` (lines 82-148) with the combined renderer. Keep `renderRegistrationsPanel` unchanged (it reads `report.totals.registrations/collectedCents/contractedCents`, which the combined totals still provide). Final file below (imports unchanged at top):

```js
function renderCodeTable(webEvent) {
  const rows = webEvent.rows.length
    ? webEvent.rows
        .map(
          (row) => `
          <tr>
            <td class="code">${escapeHtml(row.code)}</td>
            <td class="num">${row.registrations.toLocaleString('en-US')}</td>
            <td class="num">${formatMoney(row.collectedCents)}</td>
            <td class="num">${formatMoney(row.contractedCents)}</td>
            <td class="num share">${formatPct(row.sharePct)}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="empty">No web-checkout registrations.</td></tr>';

  return `
      <table>
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col" class="num">Registrations</th>
            <th scope="col" class="num">Collected</th>
            <th scope="col" class="num">Contracted</th>
            <th scope="col" class="num">% of revenue</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td>Web total</td>
            <td class="num">${webEvent.registrations.toLocaleString('en-US')}</td>
            <td class="num">${formatMoney(webEvent.collectedCents)}</td>
            <td class="num">${formatMoney(webEvent.contractedCents)}</td>
            <td class="num share">${webEvent.rows.length ? '100.0%' : '—'}</td>
          </tr>
        </tfoot>
      </table>`;
}

function renderCombinedEvent(event) {
  return `
    <section class="event">
      <h2>${escapeHtml(event.label)}</h2>
      <div class="channels">
        <div class="chan"><span class="clabel">Registrations (roster)</span>${event.registrations.toLocaleString('en-US')}</div>
        <div class="chan"><span class="clabel">Web · Stripe (net)</span>${formatMoney(event.web.collectedCents)} collected / ${formatMoney(event.web.contractedCents)} contracted</div>
        <div class="chan"><span class="clabel">Keap · Woo (net)</span>${formatMoney(event.keapNetCents)}</div>
        <div class="chan"><span class="clabel">Combined</span>${formatMoney(event.collectedCents)} / ${formatMoney(event.contractedCents)}</div>
      </div>
      <h3 class="detail-h">Web checkout by code</h3>
      ${renderCodeTable(event.web)}
    </section>`;
}

export function renderRegistrationsPage(
  report,
  { truncated, fetchedAt, maxSessions, unattributedRefundedCents = 0 }
) {
  const t = report.totals;

  const refundLine =
    t.refundedCents > 0
      ? `<p class="note">Net of refunds (web channel): ${formatMoney(t.refundedCents)} removed — ${t.refundedCount.toLocaleString('en-US')} ${
          t.refundedCount === 1 ? 'registration' : 'registrations'
        } fully refunded and dropped; partial refunds netted in place.</p>`
      : '';

  const orphanLine =
    t.planRegistrations > 0 && unattributedRefundedCents > 0
      ? `<p class="note">${formatMoney(unattributedRefundedCents)} in Stripe refunds weren't matched to a registration here. Payment-plan refunds aren't auto-netted yet — if a plan was refunded, subtract it manually. (May also include refunds from other products.)</p>`
      : '';

  const keapRefundLine =
    t.keapRefundCents > 0
      ? `<p class="note">Keap/Woo channel: ${formatMoney(t.keapRefundCents)} refunded and netted from the figures above.</p>`
      : '';

  const dedupLine =
    t.overlapCount > 0
      ? `<p class="note">${t.overlapCount.toLocaleString('en-US')} ${
          t.overlapCount === 1 ? 'buyer appears' : 'buyers appear'
        } in both channels; counted once (Stripe side kept) to avoid double-counting.</p>`
      : '';

  return renderShell(
    'Registration Report',
    `
  ${renderBackLink()}
  <span class="eyebrow">The One Talk Workshop</span>
  <h1>Registration Report</h1>
  <p class="generated">${escapeHtml(formatTimestamp(fetchedAt))} Eastern · ${escapeHtml(describeFreshness(fetchedAt, 'Stripe + Keap'))} · <a href="/results/registrations?refresh=1">refresh</a></p>

  ${truncated ? `<p class="warn">Session scan hit the ${maxSessions.toLocaleString('en-US')} record cap — figures below may be incomplete.</p>` : ''}

  <div class="totals">
    <div class="card">
      <div class="label">Registrations</div>
      <div class="value">${t.registrations.toLocaleString('en-US')}</div>
    </div>
    <div class="card">
      <div class="label">Collected</div>
      <div class="value">${formatMoney(t.collectedCents)}</div>
    </div>
    <div class="card">
      <div class="label">Contracted</div>
      <div class="value">${formatMoney(t.contractedCents)}</div>
    </div>
  </div>
  <p class="split-note">Web · Stripe (net) ${formatMoney(t.webCollectedCents)} / ${formatMoney(t.webContractedCents)} · Keap · Woo (net) ${formatMoney(t.keapNetCents)}. Headcount is the Keap Aug/Sep roster; revenue sums both channels.</p>

  ${report.events.map(renderCombinedEvent).join('')}

  ${refundLine}
  ${keapRefundLine}
  ${orphanLine}
  ${dedupLine}

  <p class="note">
    <strong>Registrations</strong> is the Keap roster (Aug/Sep tags), covering both
    the onetalkworkshop.com checkout and the Keap/WooCommerce channel.
    <strong>Collected / Contracted</strong> sum the two channels' net revenue —
    Stripe Checkout (refund-netted) plus Keap orders (net of <code>refund_total</code>).
    The <strong>Web checkout by code</strong> table breaks down the Stripe channel only.
  </p>
  <p class="note">
    Aggregate figures only. No attendee names, emails, customer records, or payment
    identifiers are read or displayed.
  </p>`
  );
}
```

- [ ] **Step 5: Run and confirm pass** — `npm test -- lib/registrations-render.test.js` → PASS. Then `npm test` → whole suite green.

- [ ] **Step 6: Commit**

```bash
git add lib/report-chrome.js lib/registrations-render.js lib/registrations-render.test.js
git commit -m "feat: render two-channel /results (Keap roster + combined revenue)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Keap IO + combine in `api/results.js`

**Files:** Modify `api/results.js`. No unit tests (repo convention — `/api/*` verified manually); the full suite must stay green and `npm run build` pass.

Read the current `api/results.js` first for exact line context. Make these edits.

- [ ] **Step 1: Imports and constants**

Add to the `lib/` imports near the top:

```js
import { emailHash } from '../lib/email-hash.js';
import { buildKeapReport } from '../lib/keap-orders.js';
import { dedupeKeapOrders, combineChannels } from '../lib/results-combined.js';
```

Add Keap constants near `MAX_SESSIONS` / `MAX_REFUNDS`:

```js
const KEAP_BASE_V1 = 'https://api.infusionsoft.com/crm/rest/v1';
const KEAP_TAG_AUGUST = process.env.KEAP_TAG_ID_AUGUST || '2008';
const KEAP_TAG_SEPTEMBER = process.env.KEAP_TAG_ID_SEPTEMBER || '1825';
const KEAP_OTW_PRODUCT_ID = 49; // "One Talk Workshop"
// Bounded scan of the Keap order log (newest first). OTW orders number a few
// dozen; this cap only guards a runaway walk and is surfaced if hit.
const MAX_KEAP_ORDER_PAGES = 60;

function keapHeaders() {
  return { 'X-Keap-API-Key': process.env.KEAP_API_KEY, Accept: 'application/json' };
}
```

- [ ] **Step 2: Record the Stripe buyer email hash on each session**

In `loadSessions`, add `emailHash` to the pushed projection (read the raw email only here, hash immediately — it never travels further):

```js
      // IO-only: hashed for cross-channel de-dup in lib/results-combined.js. The
      // raw email is read here and reduced to a one-way digest; buildReport and
      // every render ignore it.
      emailHash: emailHash(session.customer_details?.email),
```

- [ ] **Step 3: Add the Keap loaders** — add these functions above `loadRegistrations`:

```js
// The set of contact ids carrying a tag — used both as the headcount (its size)
// and to attribute each OTW order to a date without a per-order call.
async function loadKeapTagMembers(tag) {
  const ids = new Set();
  let url = `${KEAP_BASE_V1}/tags/${tag}/contacts?limit=1000`;
  while (url) {
    const res = await fetch(url, { headers: keapHeaders() });
    if (!res.ok) throw new Error(`Keap tag members ${tag}: ${res.status}`);
    const body = await res.json();
    for (const c of body.contacts || []) if (c?.id != null) ids.add(c.id);
    url = body.next || null;
  }
  return ids;
}

// Walk the Keap order log (newest first) and project OTW orders whose contact
// carries an Aug/Sep tag. netCents = (total + refund_total) — Keap stores
// refund_total as a negative number.
async function loadKeapOrders({ augSet, sepSet }) {
  const orders = [];
  let url = `${KEAP_BASE_V1}/orders?limit=100&order=date&order_direction=descending`;
  let pages = 0;
  let truncated = false;

  while (url) {
    if (pages >= MAX_KEAP_ORDER_PAGES) {
      truncated = true;
      console.error('[results] Keap order scan hit MAX_KEAP_ORDER_PAGES; figures may be incomplete');
      break;
    }
    pages += 1;
    const res = await fetch(url, { headers: keapHeaders() });
    if (!res.ok) throw new Error(`Keap orders: ${res.status}`);
    const body = await res.json();

    for (const o of body.orders || []) {
      const isOtw = (o.order_items || []).some(
        (i) => i.product_id === KEAP_OTW_PRODUCT_ID || /one talk/i.test(i.name || '')
      );
      if (!isOtw) continue;

      const contactId = o.contact?.id ?? o.contact_id;
      // A contact in both sets is attributed to August deterministically (see
      // spec); expected count 0.
      let date = null;
      if (augSet.has(contactId)) date = 'august';
      else if (sepSet.has(contactId)) date = 'september';
      if (!date) continue; // not the current cohort (older/untagged)
      if (augSet.has(contactId) && sepSet.has(contactId)) {
        console.warn('[results] Keap contact carries both Aug and Sep tags; attributed to August');
      }

      const total = Number.isFinite(o.total) ? o.total : 0;
      const refund = Number.isFinite(o.refund_total) ? o.refund_total : 0; // negative
      const grossCents = Math.round(total * 100);
      const refundCents = Math.round(-refund * 100);
      orders.push({
        date,
        grossCents,
        refundCents,
        netCents: grossCents - refundCents,
        emailHash: emailHash(o.contact?.email),
      });
    }

    url = body.next || null;
  }

  return { orders, truncated };
}
```

- [ ] **Step 4: Combine inside `loadRegistrations`** — replace the body of `loadRegistrations` with:

```js
async function loadRegistrations({ forceRefresh }) {
  const cached =
    !forceRefresh && reportCache && Date.now() - reportCache.at < CACHE_TTL_MS ? reportCache : null;
  if (cached) return cached;

  // Stripe (web) and Keap (roster + Woo) are independent — fetch concurrently.
  const [promoNames, { sessions, truncated }, refundIndex, augSet, sepSet] =
    await Promise.all([
      loadCodeNames(),
      loadSessions(),
      loadRefundIndex(),
      loadKeapTagMembers(KEAP_TAG_AUGUST),
      loadKeapTagMembers(KEAP_TAG_SEPTEMBER),
    ]);

  // The tag-member set size IS the roster headcount for that date.
  const tagCounts = { august: augSet.size, september: sepSet.size };

  const annotated = annotateRefunds(sessions, refundIndex.byPaymentIntent);
  const stripeReport = buildReport(annotated, promoNames);
  const unattributedRefundedCents = Math.max(
    0,
    refundIndex.totalCents - stripeReport.totals.refundedCents
  );

  const { orders: keapOrdersRaw, truncated: keapTruncated } = await loadKeapOrders({ augSet, sepSet });
  const stripeHashes = new Set(annotated.map((s) => s.emailHash).filter(Boolean));
  const { orders: keapOrders, overlapCount } = dedupeKeapOrders(keapOrdersRaw, stripeHashes);
  const keapReport = buildKeapReport(keapOrders);

  const report = combineChannels(stripeReport, keapReport, tagCounts, overlapCount);

  reportCache = {
    at: Date.now(),
    report,
    truncated: truncated || keapTruncated,
    unattributedRefundedCents,
  };
  return reportCache;
}
```

Note: `annotateRefunds` returns new session objects — confirm it preserves the new `emailHash` field (it spreads `...rest`, so it does). `buildReport` ignores `emailHash`.

- [ ] **Step 5: The dashboard panel** — `renderDashboard` (in `lib/dashboard-render.js`) calls `renderRegistrationsPanel(report)`, which reads `report.totals.registrations/collectedCents/contractedCents`. The combined totals provide all three, so the dashboard now shows combined figures with no change. Confirm by reading `lib/dashboard-render.js` and `renderRegistrationsPanel` — if either reads a field the combined totals lack, stop and report it. (Expected: no change needed.)

- [ ] **Step 6: Env guard** — near the existing `STRIPE_SECRET_KEY` check in the handler, the report now also needs Keap. Add, right after the Stripe key check:

```js
  if (!process.env.KEAP_API_KEY) {
    console.error('[results] KEAP_API_KEY is not set');
    return res
      .status(500)
      .send(renderMessage('Not configured', 'This report is not configured (Keap).'));
  }
```

- [ ] **Step 7: Verify** — `npm test` (whole suite green) and `npm run build` (succeeds).

- [ ] **Step 8: Commit**

```bash
git add api/results.js
git commit -m "feat: fetch Keap roster + Woo orders and combine into /results

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Manual verification

**Files:** none.

- [ ] **Step 1: Build clean** — `npm run build` succeeds.

- [ ] **Step 2: After deploy to a preview**, open `/results/registrations?refresh=1` and confirm:
  - **Registrations** = Keap roster (~211 + 130 = 341).
  - Per event shows the **Web · Stripe (net)** and **Keap · Woo (net)** breakdown and a **Combined** figure.
  - **Web checkout by code** table still lists the Stripe codes.
  - The **de-dup** line stays hidden (overlap 0 expected); the **Keap/Woo refunded** line shows (~$7,630 across the OTW orders, split by date).

- [ ] **Step 3: Privacy** — view-source the page and grep for `@`, `pi_`, `cus_`, `sub_`, `wc_order`. Expected: none — aggregate figures and codes only.

---

## Self-Review Notes

- **Spec coverage:** headcount from Keap tags (Task 5 tag-member set sizes + combineChannels), revenue = Stripe net + Keap net (Tasks 2/3/5), Keap net via `total + refund_total` (Task 5 projection + Task 2), hashed de-dup (Tasks 1/3/5), no Keap per-code (render shows channel-level only, Task 4), privacy via hash-in-IO (Task 5 step 2 + email-hash), awareness lines incl. de-dup + Keap refund (Task 4). All covered.
- **Type consistency:** `emailHash` → string|null used identically in Tasks 1/3/5; Keap order projection `{date, grossCents, refundCents, netCents, emailHash}` matches `buildKeapReport` and `dedupeKeapOrders` inputs; `combineChannels` output (`events[].web`, `keapNetCents`, `totals.*`) matches what `renderRegistrationsPage` reads in Task 4.
- **No placeholders:** every code step is complete; render and pure modules are full source.
