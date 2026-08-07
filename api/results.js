// api/results.js — password-protected registration report, served at /results
// (see the rewrite in vercel.json). Aggregate figures only: registrations by
// discount code, revenue contribution, and totals per workshop date.
//
// PRIVACY: no attendee identifiers are read, rendered, or logged. Sessions are
// projected down to status/mode/amount/date/discount at the Stripe boundary
// below, so customer, customer_details, customer_email, client_reference_id
// and payment_intent never reach the aggregation or the render. There is no
// "hide the names" filter to accidentally remove later — the names are never
// loaded in the first place.
//
// AUTH: HTTP Basic against RESULTS_USER / RESULTS_PASSWORD. Both must be set —
// if either is missing the endpoint refuses every request rather than falling
// open, since falling open would publish revenue figures to the whole internet.

import crypto from 'node:crypto';
import Stripe from 'stripe';
import { buildReport, formatMoney, formatPct } from '../lib/results.js';
import { DAY_LABELS, SESSION_OPTIONS, buildFeedbackReport } from '../lib/survey.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const REALM = 'One Talk Workshop results';

// Safety valve on the Stripe walk. At ~2,400 sessions this is ~25 requests;
// the cap only bites if the account grows by an order of magnitude, and
// hitting it is surfaced on the page rather than silently truncating.
const MAX_SESSIONS = 25000;

// The Stripe walk is ~25 sequential paged requests (cursor pagination cannot
// be parallelised), which measured ~35s against the live account. Cache the
// finished report in module scope: Fluid Compute reuses instances, so repeat
// views inside the window are instant. A cold instance still pays the full
// walk — this trades staleness for speed, never correctness, and the page
// always states how old the figures are. `?refresh=1` forces a fresh read.
const CACHE_TTL_MS = 5 * 60 * 1000;
let reportCache = null; // { at: number, report, truncated }

// Best-effort brute-force damper. Vercel Fluid Compute reuses instances, so
// this catches repeated guessing against a warm instance — it is NOT a
// distributed limiter and does not pretend to be. The real protection is that
// the password is a shared secret in env, not a user-guessable login.
const FAILED_ATTEMPTS = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0].trim();
  return ip || 'unknown';
}

function isThrottled(key) {
  const record = FAILED_ATTEMPTS.get(key);
  if (!record) return false;
  if (Date.now() - record.first > ATTEMPT_WINDOW_MS) {
    FAILED_ATTEMPTS.delete(key);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(key) {
  const record = FAILED_ATTEMPTS.get(key);
  if (!record || Date.now() - record.first > ATTEMPT_WINDOW_MS) {
    FAILED_ATTEMPTS.set(key, { count: 1, first: Date.now() });
    return;
  }
  record.count += 1;
}

// Compare digests, not raw strings: timingSafeEqual throws on a length
// mismatch, and the length of a rejected guess is itself a small leak.
// Hashing first makes every comparison the same fixed width.
function safeEqual(a, b) {
  const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

function checkAuth(req) {
  const user = process.env.RESULTS_USER;
  const password = process.env.RESULTS_PASSWORD;
  if (!user || !password) return { ok: false, configured: false };

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return { ok: false, configured: true };

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) return { ok: false, configured: true };

  // Both comparisons always run — no short-circuit on a wrong username, which
  // would reveal whether the username alone was correct.
  const userOk = safeEqual(decoded.slice(0, separator), user);
  const passOk = safeEqual(decoded.slice(separator + 1), password);
  return { ok: userOk && passOk, configured: true };
}

// Stripe hands back discount ids (promo_… / coupon ids). Fetch both lists once
// so the report shows "SIM2026" rather than "promo_1TxjnLHVMaC2CQhqUY9XnRZb".
async function loadCodeNames() {
  const names = {};

  for await (const promo of stripe.promotionCodes.list({ limit: 100 })) {
    if (promo?.id && promo?.code) names[promo.id] = promo.code;
  }
  for await (const coupon of stripe.coupons.list({ limit: 100 })) {
    if (coupon?.id) names[coupon.id] = coupon.name || coupon.id;
  }

  return names;
}

async function loadSessions() {
  const sessions = [];
  let truncated = false;

  for await (const session of stripe.checkout.sessions.list({ limit: 100 })) {
    if (sessions.length >= MAX_SESSIONS) {
      truncated = true;
      break;
    }
    // Project to only what the report needs. Everything identifying is dropped
    // here, at the boundary, so it never reaches aggregation or render.
    sessions.push({
      status: session.status,
      mode: session.mode,
      amount_total: session.amount_total,
      metadata: { date: session.metadata?.date },
      discounts: session.discounts,
    });
  }

  return { sessions, truncated };
}

// --- Feedback (the /survey answers) -------------------------------------
//
// Read live on every view: the survey table is small, and stale feedback on
// the evening of day 1 is the one thing this page must not show. A failure
// here degrades to a note on the page — it must never take down the
// registration figures alongside it.

const AIRTABLE_API = 'https://api.airtable.com/v0';
const FEEDBACK_BASE_ID = 'apphi4tks9sL7aMoy';
const FEEDBACK_TABLE_ID = 'tblIaTmblcwfvDGrY';

const DAY_FROM_LABEL = Object.fromEntries(
  Object.entries(DAY_LABELS).map(([day, label]) => [label, day]),
);

async function loadFeedback() {
  const pat = process.env.AIRTABLE_PAT;
  if (!pat) return { configured: false, responses: [] };

  const responses = [];
  let offset;

  do {
    const url = new URL(`${AIRTABLE_API}/${FEEDBACK_BASE_ID}/${FEEDBACK_TABLE_ID}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
    if (!res.ok) throw new Error(`Airtable ${res.status}`);
    const page = await res.json();

    for (const record of page.records || []) {
      const f = record.fields || {};
      let answers = {};
      try {
        answers = f['Answers JSON'] ? JSON.parse(f['Answers JSON']) : {};
      } catch (_) {
        answers = {}; // A malformed blob loses its detail, not the whole response.
      }
      responses.push({
        day: DAY_FROM_LABEL[f.Day] || null,
        respondent: f.Respondent || null,
        nps: typeof f.NPS === 'number' ? f.NPS : null,
        dayRating: typeof f['Day Rating'] === 'number' ? f['Day Rating'] : null,
        bestThing: f['Best Thing'] || '',
        improve: f.Improve || '',
        anythingElse: f['Anything Else'] || '',
        answers,
      });
    }

    offset = page.offset;
  } while (offset);

  return { configured: true, responses };
}

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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

const formatNps = (score) => (score === null ? '—' : score > 0 ? `+${score}` : String(score));

function renderVerbatims(title, items) {
  if (!items.length) return '';
  return `
    <div class="verbatims">
      <h4>${escapeHtml(title)}</h4>
      <ul>${items.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>
    </div>`;
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

// Exported for api/results.feedback.test.js. This is the one part of the page
// an operator opens mid-workshop, so a template typo here must fail in CI
// rather than as a 502 on the evening of day 1.
export function renderFeedback(feedback) {
  if (feedback.error) {
    return `<section class="event"><h2>Feedback</h2>
      <p class="warn">Could not read the feedback table just now (${escapeHtml(feedback.error)}). The registration figures above are unaffected.</p>
    </section>`;
  }
  if (!feedback.configured) {
    return `<section class="event"><h2>Feedback</h2>
      <p class="warn">Feedback storage is not configured. Add <code>AIRTABLE_PAT</code> in Vercel &rarr; Environment Variables.</p>
    </section>`;
  }

  const report = feedback.report;
  const basisLabel = report.headlineNps.basis ? DAY_LABELS[report.headlineNps.basis] : null;

  return `
  <h1 class="section-head">Workshop Feedback</h1>
  <div class="totals">
    <div class="card highlight">
      <div class="label">Workshop NPS${basisLabel ? ` (${escapeHtml(basisLabel)})` : ''}</div>
      <div class="value">${formatNps(report.headlineNps.score)}</div>
      <!-- Sample size sits with the number, not in a footnote: mid-workshop
           this can be a +100 built from one response, and a headline that
           hides that invites a decision it cannot carry. -->
      <div class="card-sub">${
        report.headlineNps.responses
          ? `from ${report.headlineNps.responses} response${report.headlineNps.responses === 1 ? '' : 's'}`
          : 'no responses yet'
      }</div>
    </div>
    <div class="card">
      <div class="label">Attendees responding</div>
      <div class="value">${report.respondents.toLocaleString('en-US')}</div>
    </div>
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
  ${
    report.testimonials.length
      ? `<section class="event"><h2>Testimonial-ready quotes</h2>
           ${renderVerbatims('Day 3 — how they would describe it', report.testimonials)}
         </section>`
      : ''
  }

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

// Shared chrome so an error state is a real page, not a bare string. A 401
// that renders as one line of unstyled text reads as "the site is broken"
// when the browser does not surface its password prompt.
function renderShell(title, inner) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} — The One Talk Workshop</title>
<link rel="icon" type="image/png" href="/assets/favicon-512.png">
<style>${PAGE_CSS}</style>
</head>
<body><div class="wrap">${inner}</div></body>
</html>`;
}

function renderMessage(title, message) {
  return renderShell(
    title,
    `<span class="eyebrow">The One Talk Workshop</span>
     <h1>${escapeHtml(title)}</h1>
     <p class="msg">${message}</p>`
  );
}

function renderPage(report, { truncated, fetchedAt, feedback }) {
  const generated = new Date(fetchedAt).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const ageMs = Date.now() - fetchedAt;
  // Anything under a few seconds is this request's own Stripe read, not a
  // cache hit — call it live rather than "0 minutes old".
  const freshness =
    ageMs < 5000 ? 'live from Stripe' : `read from Stripe ${Math.round(ageMs / 60000)} min ago`;

  return renderShell(
    'Registration Report',
    `
  <span class="eyebrow">The One Talk Workshop</span>
  <h1>Registration Report</h1>
  <p class="generated">${escapeHtml(generated)} Eastern · ${escapeHtml(freshness)} · <a href="/results?refresh=1">refresh</a></p>

  ${truncated ? `<p class="warn">Session scan hit the ${MAX_SESSIONS.toLocaleString('en-US')} record cap — figures below may be incomplete.</p>` : ''}

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
  </p>

  ${renderFeedback(feedback)}`
  );
}

const PAGE_CSS = `
  :root {
    --paper: #FAF7F2; --black: #141210; --charcoal: #3A342E;
    --wine: #E26320; --rule: #E2DACF; --muted: #7A7168;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 24px 80px;
    background: var(--paper); color: var(--black);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .wrap { max-width: 900px; margin: 0 auto; }
  .eyebrow {
    display: inline-block; padding: 7px 14px; margin-bottom: 20px;
    border: 1.5px solid var(--wine); border-radius: 2px;
    font-size: 0.68rem; font-weight: 700;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--wine);
  }
  h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); margin: 0 0 6px; letter-spacing: -0.02em; }
  .generated { color: var(--muted); font-size: 0.85rem; margin: 0 0 40px; }
  .generated a { color: var(--wine); font-weight: 600; }
  .totals { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 48px; }
  .card {
    flex: 1 1 200px; padding: 18px 20px;
    background: #fff; border: 1px solid var(--rule); border-radius: 3px;
  }
  .card .label {
    font-size: 0.68rem; font-weight: 700; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 6px;
  }
  .card .value { font-size: 1.7rem; font-weight: 700; letter-spacing: -0.02em; }
  .event { margin-bottom: 48px; }
  h2 {
    font-size: 1.15rem; margin: 0 0 14px;
    padding-bottom: 10px; border-bottom: 2px solid var(--black);
  }
  table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  th, td { padding: 11px 12px; text-align: left; border-bottom: 1px solid var(--rule); }
  th {
    font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--muted);
  }
  td.num, th.num { text-align: right; }
  td.code { font-weight: 600; }
  td.share { color: var(--charcoal); }
  td.empty { color: var(--muted); font-style: italic; text-align: center; padding: 22px; }
  tfoot td { font-weight: 700; border-top: 2px solid var(--black); border-bottom: none; }
  .note {
    margin-top: 40px; padding-top: 22px; border-top: 1px solid var(--rule);
    color: var(--muted); font-size: 0.82rem; line-height: 1.65; max-width: 62ch;
  }
  .note strong { color: var(--charcoal); }
  .warn {
    padding: 12px 16px; margin-bottom: 24px; border-radius: 3px;
    background: #FDF0E7; border: 1px solid var(--wine);
    color: var(--charcoal); font-size: 0.85rem;
  }
  .msg {
    font-size: 1rem; line-height: 1.7; color: var(--charcoal);
    max-width: 56ch; margin: 0 0 18px;
  }
  .msg code {
    background: #fff; border: 1px solid var(--rule); border-radius: 3px;
    padding: 2px 7px; font-size: 0.92em;
  }
  .section-head {
    margin: 72px 0 20px; padding-top: 34px;
    border-top: 3px solid var(--black); font-size: clamp(1.5rem, 3vw, 2.1rem);
  }
  .card.highlight { border-color: var(--wine); border-width: 2px; }
  .card.highlight .value { color: var(--wine); }
  .card-sub { margin-top: 4px; font-size: 0.75rem; color: var(--muted); }
  .nps-bands { margin: -34px 0 22px; color: var(--muted); font-size: 0.82rem; }
  .empty-day { color: var(--muted); font-style: italic; margin: 0; }
  .verbatims { margin-top: 22px; }
  .verbatims h4 {
    font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--muted); margin: 0 0 10px;
  }
  .verbatims ul { margin: 0; padding: 0; list-style: none; }
  .verbatims li {
    padding: 11px 14px; margin-bottom: 8px;
    background: #fff; border-left: 3px solid var(--rule); border-radius: 0 3px 3px 0;
    font-size: 0.9rem; line-height: 1.55; white-space: pre-wrap;
  }
  @media (max-width: 560px) {
    body { padding: 32px 16px 60px; }
    th, td { padding: 9px 7px; font-size: 0.82rem; }
    .nps-bands { margin-top: -28px; }
  }
`;

export default async function handler(req, res) {
  // Set the protective headers FIRST, so every exit path below carries them —
  // including 405 and 401, which would otherwise fall back to Vercel's default
  // `public, max-age=0, must-revalidate` on an authenticated route.
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // HEAD is a valid way to probe this URL (curl -I, uptime checks). Treat it
  // as GET and let the platform drop the body, rather than 405-ing a method
  // the resource genuinely supports.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const key = clientKey(req);
  if (isThrottled(key)) {
    return res
      .status(429)
      .send(
        renderMessage(
          'Too many attempts',
          'Too many failed sign-ins from this address. Wait 15 minutes and try again.'
        )
      );
  }

  const auth = checkAuth(req);

  if (!auth.configured) {
    // Fail closed. An unset password must lock the page, never open it.
    console.error('[results] RESULTS_USER / RESULTS_PASSWORD are not set');
    return res
      .status(500)
      .send(
        renderMessage(
          'Not configured',
          'This report has no credentials set. Add <code>RESULTS_USER</code> and <code>RESULTS_PASSWORD</code> in Vercel &rarr; Environment Variables, then redeploy.'
        )
      );
  }

  if (!auth.ok) {
    recordFailure(key);
    res.setHeader('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
    // A styled page, not a bare string: if the browser suppresses its password
    // prompt (or you dismiss it) the old one-line response looked like a blank
    // broken page rather than a locked one.
    return res
      .status(401)
      .send(
        renderMessage(
          'Password required',
          'This report is private. Your browser should prompt for a username and password — if it did not, reload the page. Still stuck? Open <code>https://admin@onetalkworkshop.com/results</code> to force the prompt.'
        )
      );
  }

  FAILED_ATTEMPTS.delete(key);

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[results] STRIPE_SECRET_KEY is not set');
    return res.status(500).send('This report is not configured.');
  }

  const forceRefresh = req.query?.refresh === '1';
  const cached =
    !forceRefresh && reportCache && Date.now() - reportCache.at < CACHE_TTL_MS ? reportCache : null;

  try {
    let entry = cached;

    if (!entry) {
      // Codes and sessions are independent lookups — fetch them concurrently.
      const [promoNames, { sessions, truncated }] = await Promise.all([
        loadCodeNames(),
        loadSessions(),
      ]);
      entry = { at: Date.now(), report: buildReport(sessions, promoNames), truncated };
      reportCache = entry;
    }

    // Feedback is read live and separately: it is cheap, it must not be stale
    // on the evening of a workshop day, and a failure here must not cost the
    // operator the registration figures.
    let feedback;
    try {
      const loaded = await loadFeedback();
      feedback = loaded.configured
        ? { configured: true, report: buildFeedbackReport(loaded.responses) }
        : { configured: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[results] feedback', message);
      feedback = { configured: true, error: message };
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res
      .status(200)
      .send(
        renderPage(entry.report, {
          truncated: entry.truncated,
          fetchedAt: entry.at,
          feedback,
        })
      );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Unlike the public endpoints, this one fails loudly: a silent empty
    // report would read as "no sales" and be believed.
    console.error('[results]', message);
    return res
      .status(502)
      .send(
        renderMessage(
          'Could not reach Stripe',
          'The figures could not be loaded from Stripe just now. Reload to try again.'
        )
      );
  }
}
