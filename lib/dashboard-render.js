// lib/dashboard-render.js — the /results landing page: one panel per report,
// each showing the handful of numbers worth glancing at and linking through
// to the full thing.
//
// The panels deliberately carry figures rather than being bare links. The
// common case is opening /results to answer "how are we doing" — that should
// not need two more clicks.

import { renderRegistrationsPanel } from './registrations-render.js';
import { renderFeedbackPanel } from './feedback-render.js';
import {
  escapeHtml,
  renderShell,
  formatTimestamp,
  describeFreshness,
} from './report-chrome.js';

export function renderDashboard({ report, feedback, fetchedAt, truncated, maxSessions }) {
  return renderShell(
    'Reports',
    `
  <span class="eyebrow">The One Talk Workshop</span>
  <h1>Reports</h1>
  <p class="generated">${escapeHtml(formatTimestamp(fetchedAt))} Eastern · ${escapeHtml(describeFreshness(fetchedAt, 'Stripe + Keap'))} · <a href="/results?refresh=1">refresh</a></p>

  ${truncated ? `<p class="warn">Session scan hit the ${maxSessions.toLocaleString('en-US')} record cap — registration figures may be incomplete.</p>` : ''}

  <div class="panels">
    ${renderRegistrationsPanel(report)}
    ${renderFeedbackPanel(feedback)}
  </div>

  <p class="note">
    Registration figures come from Stripe and Keap and are cached for a few minutes; feedback is
    read live from the survey table on every view. Both are aggregate — no attendee
    names, emails, or payment identifiers appear on any of these pages.
  </p>`
  );
}
