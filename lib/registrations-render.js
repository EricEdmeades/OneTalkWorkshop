// lib/registrations-render.js — the registration report at
// /results/registrations, plus its summary panel on the /results dashboard.
//
// PRIVACY: this renders only what api/results.js loaded, and that projection
// drops every attendee identifier at the Stripe boundary. There is nothing to
// filter out here because nothing identifying ever arrives.

import { formatMoney, formatPct } from './results.js';
import { describeAge } from './keap-snapshot.js';
import {
  escapeHtml,
  renderShell,
  renderBackLink,
  formatTimestamp,
  describeFreshness,
} from './report-chrome.js';

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

// `keapError` matters here for the same reason it does on the full page: the
// roster count comes entirely from Keap, so without a snapshot the honest
// answer is "—". Rendering the 0 that combineChannels produces would read as
// "nobody has registered" and be believed.
export function renderRegistrationsPanel(report, { keapError = null } = {}) {
  const registrationsValue = keapError ? '—' : report.totals.registrations.toLocaleString('en-US');
  return `
    <a class="panel" href="/results/registrations">
      <h2>Registrations</h2>
      <div class="panel-figures">
        <div class="panel-figure">
          <div class="label">Registrations</div>
          <div class="value">${registrationsValue}</div>
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

export function renderRegistrationsPage(
  report,
  {
    truncated,
    fetchedAt,
    maxSessions,
    unattributedRefundedCents = 0,
    keapError = null,
    keapStale = false,
    keapFetchedAt = null,
  }
) {
  const t = report.totals;

  // Keap degraded: the web (Stripe) channel still rendered, but the roster
  // headcount and Woo revenue are missing. Say so loudly, and show the roster
  // as "—" rather than a misleading 0.
  const keapDownBanner = keapError
    ? `<p class="warn">Keap channel unavailable — no roster snapshot has been stored yet, so this shows the web (Stripe) checkout channel only. The registration roster and Keap/WooCommerce revenue are missing from these figures. The background refresh retries on a schedule; reload in a few minutes.</p>`
    : '';
  // The Keap figures always come from a stored snapshot rather than a live read
  // (Keap's rate limit is account-wide and saturated in bursts by another
  // system, so a live read on page load fails about half the time). Say how old
  // they are once they pass the freshness window — a quiet note, not an alarm.
  const keapStaleNote =
    !keapError && keapStale
      ? `<p class="note">Keap roster/Woo figures are from a stored snapshot taken ${describeAge(
          keapFetchedAt == null ? Infinity : Math.max(0, Date.now() - keapFetchedAt)
        )}; the background refresh updates them on its next successful read.</p>`
      : '';
  const registrationsValue = keapError ? '—' : t.registrations.toLocaleString('en-US');

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
  ${keapDownBanner}

  <div class="totals">
    <div class="card">
      <div class="label">Registrations</div>
      <div class="value">${registrationsValue}</div>
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

  ${keapStaleNote}
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
