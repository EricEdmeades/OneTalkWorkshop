// api/results.js — the password-protected admin reports. One function serves
// three views (see the rewrites in vercel.json):
//
//   /results                → dashboard, summarising both reports
//   /results/registrations  → registrations by date and discount code
//   /results/surveys        → workshop feedback and NPS
//
// One endpoint rather than three keeps the auth, the throttle and the Stripe
// cache in a single place — three copies of an auth check is how one of them
// ends up subtly weaker than the others.
//
// PRIVACY: no attendee identifiers are read, rendered, or logged. Stripe
// sessions are projected down to status/mode/amount/date/discount at the
// boundary below, so customer, customer_details, customer_email,
// client_reference_id and payment_intent never reach the aggregation or the
// render. Survey responses carry a one-way hash, never an email address.
// There is no "hide the names" filter to accidentally remove later — the
// names are never loaded in the first place.
//
// AUTH: HTTP Basic against RESULTS_USER / RESULTS_PASSWORD. Both must be set —
// if either is missing every view refuses rather than falling open, since
// falling open would publish revenue figures to the whole internet.

import crypto from 'node:crypto';
import Stripe from 'stripe';
import { buildReport } from '../lib/results.js';
import { buildFeedbackReport } from '../lib/survey.js';
import { renderMessage } from '../lib/report-chrome.js';
import { renderRegistrationsPage } from '../lib/registrations-render.js';
import { renderSurveysPage } from '../lib/feedback-render.js';
import { renderDashboard } from '../lib/dashboard-render.js';

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
// walk — this trades staleness for speed, never correctness, and every page
// states how old the figures are. `?refresh=1` forces a fresh read.
const CACHE_TTL_MS = 5 * 60 * 1000;
let reportCache = null; // { at: number, report, truncated }

// Feedback lives in Airtable and is small, so it is read live per view. The
// survey page must never show yesterday's numbers on the evening of a
// workshop day.
const AIRTABLE_API = 'https://api.airtable.com/v0';
const FEEDBACK_BASE_ID = 'apphi4tks9sL7aMoy';
const FEEDBACK_TABLE_ID = 'tblIaTmblcwfvDGrY';

const VIEWS = { dashboard: 'dashboard', registrations: 'registrations', surveys: 'surveys' };

// --- Auth ---------------------------------------------------------------

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

// --- Loading ------------------------------------------------------------

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

async function loadRegistrations({ forceRefresh }) {
  const cached =
    !forceRefresh && reportCache && Date.now() - reportCache.at < CACHE_TTL_MS ? reportCache : null;
  if (cached) return cached;

  // Codes and sessions are independent lookups — fetch them concurrently.
  const [promoNames, { sessions, truncated }] = await Promise.all([
    loadCodeNames(),
    loadSessions(),
  ]);
  reportCache = { at: Date.now(), report: buildReport(sessions, promoNames), truncated };
  return reportCache;
}

const DAY_FROM_LABEL = { 'Day 1': 'day1', 'Day 2': 'day2', 'Day 3': 'day3' };

async function loadFeedbackResponses() {
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

// A feedback failure degrades to a note on the page. It must never cost the
// operator the registration figures beside it, nor take down the dashboard.
async function loadFeedback() {
  try {
    const loaded = await loadFeedbackResponses();
    return loaded.configured
      ? { configured: true, report: buildFeedbackReport(loaded.responses) }
      : { configured: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[results] feedback', message);
    return { configured: true, error: message };
  }
}

// --- Handler ------------------------------------------------------------

function resolveView(req) {
  const raw = req.query?.view;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return VIEWS.dashboard;
  return VIEWS[value] || null;
}

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

  const view = resolveView(req);
  if (!view) {
    return res
      .status(404)
      .send(
        renderMessage(
          'No such report',
          'That report does not exist. Open <code>/results</code> for the list.'
        )
      );
  }

  // The survey report needs no Stripe data at all, so it skips the walk
  // entirely — the page an operator refreshes between sessions is the fast one.
  if (view === VIEWS.surveys) {
    const feedback = await loadFeedback();
    return res.status(200).send(renderSurveysPage(feedback, { fetchedAt: Date.now() }));
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[results] STRIPE_SECRET_KEY is not set');
    return res
      .status(500)
      .send(renderMessage('Not configured', 'This report is not configured.'));
  }

  try {
    const entry = await loadRegistrations({ forceRefresh: req.query?.refresh === '1' });

    if (view === VIEWS.registrations) {
      return res.status(200).send(
        renderRegistrationsPage(entry.report, {
          truncated: entry.truncated,
          fetchedAt: entry.at,
          maxSessions: MAX_SESSIONS,
        })
      );
    }

    const feedback = await loadFeedback();
    return res.status(200).send(
      renderDashboard({
        report: entry.report,
        feedback,
        fetchedAt: entry.at,
        truncated: entry.truncated,
        maxSessions: MAX_SESSIONS,
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
