// lib/submissions-render.js — every individual survey submission, with the
// ability to delete rows. This exists mainly to clear test data: the report
// pages are aggregate, and a stray test response visibly skews an NPS built
// from a handful of answers.
//
// Deletion is a real destructive action sitting behind Basic auth, which
// browsers attach automatically. The form therefore POSTs same-origin and
// api/results.js checks the Origin header before deleting anything — without
// that, a page on another site could post to this endpoint and ride the
// operator's cached credentials.

import { DAY_LABELS } from './survey.js';
import {
  escapeHtml,
  renderShell,
  renderBackLink,
  formatTimestamp,
} from './report-chrome.js';

// Airtable record ids. Anything not matching this never reaches a delete call.
const RECORD_ID = /^rec[A-Za-z0-9]{14,}$/;

export function isRecordId(value) {
  return typeof value === 'string' && RECORD_ID.test(value);
}

// Respondent values are 32-hex hashes. Showing the first 8 with an explicit
// ellipsis marks them as abbreviations — a bare 8-character string reads like
// a whole identifier and invites someone to match on it.
function shortHash(hash) {
  if (!hash) return '—';
  return `${hash.slice(0, 8)}…`;
}

function truncate(text, max = 80) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderRow(row) {
  const comments = [row.bestThing, row.improve, row.anythingElse].filter(Boolean).join(' · ');
  return `
    <tr>
      <td><input type="checkbox" name="id" value="${escapeHtml(row.id)}" aria-label="Select submission from ${escapeHtml(shortHash(row.respondent))}"></td>
      <td>${row.submittedAt ? escapeHtml(formatTimestamp(row.submittedAt)) : '—'}</td>
      <td>${escapeHtml(DAY_LABELS[row.day] || '—')}</td>
      <td class="mono">${escapeHtml(shortHash(row.respondent))}</td>
      <td class="num">${row.nps === null || row.nps === undefined ? '—' : row.nps}</td>
      <td class="num">${row.dayRating === null || row.dayRating === undefined ? '—' : row.dayRating}</td>
      <td>${escapeHtml(truncate(comments))}</td>
      <td>${row.contactEmail ? escapeHtml(row.contactEmail) : ''}</td>
    </tr>`;
}

export function renderSubmissionsPage(rows, { fetchedAt, deleted = 0, error = null } = {}) {
  // Newest first: the rows an operator wants to check or remove are the ones
  // that just came in.
  const ordered = [...rows].sort((a, b) =>
    String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')),
  );

  const body = ordered.length
    ? `
    <form method="post" action="/results/submissions" onsubmit="return confirm('Delete the selected submissions? This cannot be undone.')">
      <table>
        <thead>
          <tr>
            <th scope="col"><span class="sr-only">Select</span></th>
            <th scope="col">Submitted</th>
            <th scope="col">Day</th>
            <th scope="col">Respondent</th>
            <th scope="col" class="num">NPS</th>
            <th scope="col" class="num">Rating</th>
            <th scope="col">Comments</th>
            <th scope="col">Contact (opt-in)</th>
          </tr>
        </thead>
        <tbody>${ordered.map(renderRow).join('')}</tbody>
      </table>
      <div class="actions">
        <button type="submit" class="danger">Delete selected</button>
        <span class="actions-note">Removes the ticked rows from the feedback table. Used for clearing test data.</span>
      </div>
    </form>`
    : '<p class="empty-day">No submissions yet.</p>';

  return renderShell(
    'All Submissions',
    `
  ${renderBackLink()}
  <span class="eyebrow">The One Talk Workshop</span>
  <h1>All Submissions</h1>
  <p class="generated">${escapeHtml(formatTimestamp(fetchedAt))} Eastern · ${ordered.length} row${ordered.length === 1 ? '' : 's'} · <a href="/results/surveys">back to the feedback report</a></p>

  ${deleted ? `<p class="ok">Deleted ${deleted} submission${deleted === 1 ? '' : 's'}.</p>` : ''}
  ${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}

  ${body}

  <p class="note">
    <strong>Respondent</strong> is the first 8 characters of a one-way hash of the
    attendee's email, shown abbreviated — it is what joins one person's three days
    together, and it cannot be turned back into an address. <strong>Contact</strong> is
    filled in only where the attendee ticked the box asking to be contacted.
  </p>`
  );
}
