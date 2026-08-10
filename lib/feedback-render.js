// lib/feedback-render.js — the workshop feedback report at /results/surveys,
// plus its summary panel on the /results dashboard.
//
// Attendee comments are arbitrary text typed into a public form, so every
// value that reaches this page goes through escapeHtml. See
// lib/feedback-render.test.js, which asserts exactly that.

import { DAY_LABELS, SESSION_OPTIONS } from './survey.js';
import {
  escapeHtml,
  renderShell,
  renderBackLink,
  formatTimestamp,
  describeFreshness,
} from './report-chrome.js';

export const formatNps = (score) => (score === null ? '—' : score > 0 ? `+${score}` : String(score));

function describeSample(nps) {
  return nps.responses
    ? `from ${nps.responses} response${nps.responses === 1 ? '' : 's'}`
    : 'no responses yet';
}

function renderVerbatims(title, items) {
  if (!items.length) return '';
  return `
    <div class="verbatims">
      <h4>${escapeHtml(title)}</h4>
      <ul>${items.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>
    </div>`;
}

// Whether a quote may be published is the first thing you need to know when
// you are shopping for one, so it is on the quote itself rather than in a
// legend somewhere. "Never asked" is called out as its own state: it looks
// like a missing answer, but it means the question did not exist yet, and
// reading it as a soft yes is exactly the mistake worth designing against.
const CONSENT_BADGES = {
  Named: { label: 'Usable with name', className: 'ok' },
  Anonymous: { label: 'Usable, no name', className: 'ok' },
  Declined: { label: 'Do not publish', className: 'no' },
  unasked: { label: 'Never asked — not consent', className: 'warn' },
};

function renderTestimonial(item) {
  const badge = CONSENT_BADGES[item.consent] || CONSENT_BADGES.unasked;
  const credit =
    item.consent === 'Named' && item.name
      ? ` <span class="testimonial-name">&mdash; ${escapeHtml(item.name)}</span>`
      : '';
  return `
    <li class="testimonial">
      <span class="consent consent-${badge.className}">${escapeHtml(badge.label)}</span>
      <span class="testimonial-text">${escapeHtml(item.text)}</span>${credit}
    </li>`;
}

export function renderTestimonials(items) {
  if (!items.length) return '';

  const usable = items.filter((i) => i.consent === 'Named' || i.consent === 'Anonymous').length;
  const unasked = items.filter((i) => i.consent === 'unasked').length;

  return `
    <section class="event">
      <h2>Testimonial-ready quotes</h2>
      <p class="consent-summary">
        ${usable} of ${items.length} cleared for publication${
          unasked
            ? ` &middot; ${unasked} predate${unasked === 1 ? 's' : ''} the permission question and cannot be used without asking`
            : ''
        }
      </p>
      <div class="verbatims">
        <h4>Day 3 &mdash; how they would describe it</h4>
        <ul>${items.map(renderTestimonial).join('')}</ul>
      </div>
    </section>`;
}

function renderFeedbackDay(day) {
  if (!day.responses) {
    return `
      <section class="event">
        <h2>${escapeHtml(day.label)}</h2>
        <p class="empty-day">No feedback yet.</p>
      </section>`;
  }

  const sessionRows = day.sessions
    .map((session) => {
      const cells = session.distribution
        .map((entry) => `<td class="num">${entry.count || '—'}</td>`)
        .join('');
      return `<tr><td>${escapeHtml(session.label)}</td>${cells}</tr>`;
    })
    .join('');

  return `
    <section class="event">
      <h2>${escapeHtml(day.label)}</h2>
      <div class="totals">
        <div class="card">
          <div class="label">Responses</div>
          <div class="value">${day.respondents.toLocaleString('en-US')}</div>
        </div>
        <div class="card">
          <div class="label">Avg rating</div>
          <div class="value">${day.dayRating === null ? '—' : `${day.dayRating}/10`}</div>
        </div>
        <div class="card">
          <div class="label">NPS</div>
          <div class="value">${formatNps(day.nps.score)}</div>
        </div>
      </div>
      <p class="nps-bands">
        ${day.nps.promoters} promoter${day.nps.promoters === 1 ? '' : 's'} ·
        ${day.nps.passives} passive${day.nps.passives === 1 ? '' : 's'} ·
        ${day.nps.detractors} detractor${day.nps.detractors === 1 ? '' : 's'}
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Session</th>
            ${SESSION_OPTIONS.map((option) => `<th scope="col" class="num">${escapeHtml(option)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${sessionRows}</tbody>
      </table>
      ${renderVerbatims('Most valuable', day.bestThing)}
      ${renderVerbatims('What to improve', day.improve)}
      ${renderVerbatims('Anything else', day.anythingElse)}
    </section>`;
}

// The body only, so the full page, the dashboard and the tests share one
// definition of what the feedback report actually says.
export function renderFeedbackBody(feedback) {
  if (feedback.error) {
    return `<p class="warn">Could not read the feedback table just now (${escapeHtml(feedback.error)}). Nothing else on the site is affected.</p>`;
  }
  if (!feedback.configured) {
    return `<p class="warn">Feedback storage is not configured. Add <code>AIRTABLE_PAT</code> in Vercel &rarr; Environment Variables.</p>`;
  }

  const report = feedback.report;
  const basisLabel = report.headlineNps.basis ? DAY_LABELS[report.headlineNps.basis] : null;

  return `
  <div class="totals">
    <div class="card highlight">
      <div class="label">Workshop NPS${basisLabel ? ` (${escapeHtml(basisLabel)})` : ''}</div>
      <div class="value">${formatNps(report.headlineNps.score)}</div>
      <!-- Sample size sits with the number, not in a footnote: mid-workshop
           this can be a +100 built from one response, and a headline that
           hides that invites a decision it cannot carry. -->
      <div class="card-sub">${describeSample(report.headlineNps)}</div>
    </div>
    <a class="card card-link" href="/results/submissions">
      <div class="label">Attendees responding</div>
      <div class="value">${report.respondents.toLocaleString('en-US')}</div>
      <div class="card-sub">See every submission &rarr;</div>
    </a>
    <div class="card">
      <div class="label">Responses total</div>
      <div class="value">${report.responses.toLocaleString('en-US')}</div>
    </div>
    ${
      report.confidence === null
        ? ''
        : `<div class="card">
             <div class="label">Avg confidence (Day 3)</div>
             <div class="value">${report.confidence}/10</div>
           </div>`
    }
  </div>

  ${report.days.map(renderFeedbackDay).join('')}
  ${renderTestimonials(report.testimonials)}

  <p class="note">
    <strong>Workshop NPS</strong> is the score from the latest day with answers — normally
    Day 3, once attendees have seen the whole thing. It is deliberately not an average of
    the three days, which would count the same attendee up to three times. Promoters score
    9-10, detractors 0-6, and the score is the percentage gap between them.
  </p>
  <p class="note">
    Attendees are identified by a one-way hash of their email, so the same person's three
    days join up without this page ever holding an address.
  </p>`;
}

export function renderFeedbackPanel(feedback) {
  if (!feedback.configured || feedback.error) {
    return `
      <a class="panel" href="/results/surveys">
        <h2>Workshop Feedback</h2>
        <p class="panel-note">${feedback.error ? 'Feedback could not be read just now.' : 'Feedback storage is not configured yet.'}</p>
        <div class="panel-cta">Open the report &rarr;</div>
      </a>`;
  }

  const report = feedback.report;
  const basisLabel = report.headlineNps.basis ? DAY_LABELS[report.headlineNps.basis] : null;

  return `
    <a class="panel" href="/results/surveys">
      <h2>Workshop Feedback</h2>
      <div class="panel-figures">
        <div class="panel-figure">
          <div class="label">NPS${basisLabel ? ` (${escapeHtml(basisLabel)})` : ''}</div>
          <div class="value accent">${formatNps(report.headlineNps.score)}</div>
        </div>
        <div class="panel-figure">
          <div class="label">Attendees responding</div>
          <div class="value">${report.respondents.toLocaleString('en-US')}</div>
        </div>
        <div class="panel-figure">
          <div class="label">Responses</div>
          <div class="value">${report.responses.toLocaleString('en-US')}</div>
        </div>
      </div>
      <p class="panel-note">${escapeHtml(describeSample(report.headlineNps))}.</p>
      <div class="panel-cta">Day by day, with every comment &rarr;</div>
    </a>`;
}

export function renderSurveysPage(feedback, { fetchedAt }) {
  return renderShell(
    'Workshop Feedback',
    `
  ${renderBackLink()}
  <span class="eyebrow">The One Talk Workshop</span>
  <h1>Workshop Feedback</h1>
  <p class="generated">${escapeHtml(formatTimestamp(fetchedAt))} Eastern · ${escapeHtml(describeFreshness(fetchedAt, 'Airtable'))} · <a href="/results/surveys">refresh</a></p>

  ${renderFeedbackBody(feedback)}`
  );
}
