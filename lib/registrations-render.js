// lib/registrations-render.js — the registration report at
// /results/registrations, plus its summary panel on the /results dashboard.
//
// PRIVACY: this renders only what api/results.js loaded, and that projection
// drops every attendee identifier at the Stripe boundary. There is nothing to
// filter out here because nothing identifying ever arrives.

import { formatMoney, formatPct } from './results.js';
import {
  escapeHtml,
  renderShell,
  renderBackLink,
  formatTimestamp,
  describeFreshness,
} from './report-chrome.js';

function renderEvent(event) {
  const rows = event.rows.length
    ? event.rows
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
    : '<tr><td colspan="5" class="empty">No registrations yet.</td></tr>';

  return `
    <section class="event">
      <h2>${escapeHtml(event.label)}</h2>
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
            <td>Total</td>
            <td class="num">${event.registrations.toLocaleString('en-US')}</td>
            <td class="num">${formatMoney(event.collectedCents)}</td>
            <td class="num">${formatMoney(event.contractedCents)}</td>
            <td class="num share">${event.rows.length ? '100.0%' : '—'}</td>
          </tr>
        </tfoot>
      </table>
    </section>`;
}

export function renderRegistrationsPanel(report) {
  return `
    <a class="panel" href="/results/registrations">
      <h2>Registrations</h2>
      <div class="panel-figures">
        <div class="panel-figure">
          <div class="label">Registrations</div>
          <div class="value">${report.totals.registrations.toLocaleString('en-US')}</div>
        </div>
        <div class="panel-figure">
          <div class="label">Collected</div>
          <div class="value">${formatMoney(report.totals.collectedCents)}</div>
        </div>
        <div class="panel-figure">
          <div class="label">Contracted</div>
          <div class="value">${formatMoney(report.totals.contractedCents)}</div>
        </div>
      </div>
      <div class="panel-cta">By date and discount code &rarr;</div>
    </a>`;
}

export function renderRegistrationsPage(report, { truncated, fetchedAt, maxSessions }) {
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

  <p class="note">
    <strong>Collected</strong> is what Stripe has actually taken.
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
