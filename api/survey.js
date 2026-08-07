// api/survey.js — receives a post-session feedback submission and stores it
// in Airtable.
//
// Identity: an attendee types their email, and we store only a salted HMAC of
// it. That links their Day 1/2/3 answers into one person for the report
// without the survey table ever holding an address. The plain email is kept
// ONLY when the attendee explicitly ticks the contact box, in its own field.
//
// Anti-spam mirrors api/subscribe-otw.js: origin check, honeypot, and a
// form-open timing gate, with every rejected-as-spam path returning
// 200 {success:true} so a bot cannot tell a block from a real save.

import crypto from 'node:crypto';
import {
  QUESTION_SET_VERSION,
  DAY_LABELS,
  SESSION_OPTIONS,
  getQuestionSet,
  isValidDay,
} from '../lib/survey.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const BASE_ID = 'apphi4tks9sL7aMoy';
const TABLE_ID = 'tblIaTmblcwfvDGrY';

// Which workshop these answers belong to. Matches the Airtable select.
const EVENT_LABEL = 'August 2026';

const ALLOWED_ORIGINS = [
  'https://onetalkworkshop.com',
  'https://www.onetalkworkshop.com',
  'https://onetalk.ericedmeades.com',
];

const MIN_FILL_MS = 3_000;
const MAX_FILL_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 5_000;

function originAllowed(req) {
  const raw = req.headers.origin || req.headers.referer || '';
  if (!raw) return false;
  let host;
  try {
    host = new URL(raw).host;
  } catch (_) {
    return false;
  }
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return true;
  if (host.endsWith('.vercel.app')) return true;
  return ALLOWED_ORIGINS.some((allowed) => new URL(allowed).host === host);
}

// A quiet accept. The submission is dropped, but a bot learns nothing.
function pretendAccepted(res) {
  return res.status(200).json({ success: true });
}

function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_TEXT);
}

function cleanScale(value, min, max) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

// Answers are validated against the day's own question set, so a payload can
// only ever contain questions that were actually asked.
export function normaliseAnswers(day, raw) {
  const answers = {};
  for (const q of getQuestionSet(day).questions) {
    const value = raw?.[q.id];
    if (value === undefined || value === null || value === '') continue;

    if (q.type === 'scale') {
      const n = cleanScale(value, q.min, q.max);
      if (n !== null) answers[q.id] = n;
    } else if (q.type === 'choice') {
      if (SESSION_OPTIONS.includes(value)) answers[q.id] = value;
    } else {
      const text = cleanText(value);
      if (text) answers[q.id] = text;
    }
  }
  return answers;
}

// Truncated to 32 hex chars: still far beyond collision range for a room of
// this size, and short enough to read in the Airtable grid.
export function hashEmail(email, salt) {
  return crypto
    .createHmac('sha256', salt)
    .update(String(email).trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

function isEmail(value) {
  return typeof value === 'string' && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value.trim());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const salt = process.env.SURVEY_HASH_SALT;
  const pat = process.env.AIRTABLE_PAT;
  if (!salt || !pat) {
    // Fail loudly to the operator, not silently: a misconfigured survey that
    // drops answers on the floor is worse than one that is visibly down.
    console.error('[survey] Missing SURVEY_HASH_SALT or AIRTABLE_PAT');
    return res.status(500).json({ error: 'The survey is not available right now.' });
  }

  const body = req.body || {};

  if (!originAllowed(req)) return pretendAccepted(res);
  if (cleanText(body.website)) return pretendAccepted(res); // honeypot
  const elapsed = Date.now() - Number(body.formStartedAt);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS || elapsed > MAX_FILL_MS) {
    return pretendAccepted(res);
  }

  const day = body.day;
  if (!isValidDay(day)) {
    return res.status(400).json({ error: 'Please choose which day you are reviewing.' });
  }
  if (!isEmail(body.email)) {
    return res.status(400).json({ error: 'Please enter the email you registered with.' });
  }

  const answers = normaliseAnswers(day, body.answers);
  const respondent = hashEmail(body.email, salt);

  const fields = {
    // One record per attendee per day — the upsert below merges on this, so a
    // second submission corrects the first instead of double-counting.
    'Submission ID': `${EVENT_LABEL} ${DAY_LABELS[day]} ${respondent}`,
    'Submitted At': new Date().toISOString(),
    Event: EVENT_LABEL,
    Day: DAY_LABELS[day],
    Respondent: respondent,
    'Answers JSON': JSON.stringify(answers),
    'Question Set': QUESTION_SET_VERSION,
  };

  if (typeof answers.nps === 'number') fields.NPS = answers.nps;
  if (typeof answers.dayRating === 'number') fields['Day Rating'] = answers.dayRating;
  if (answers.bestThing) fields['Best Thing'] = answers.bestThing;
  if (answers.improve) fields.Improve = answers.improve;
  if (answers.anythingElse) fields['Anything Else'] = answers.anythingElse;
  // Opt-in only: the address is stored because they asked to be contacted.
  if (body.contactOptIn === true) fields['Contact Email'] = String(body.email).trim();

  try {
    const airtable = await fetch(`${AIRTABLE_API}/${BASE_ID}/${TABLE_ID}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: ['Submission ID'] },
        records: [{ fields }],
        typecast: true,
      }),
    });

    if (!airtable.ok) {
      const detail = await airtable.text();
      console.error('[survey] Airtable write failed', airtable.status, detail.slice(0, 300));
      return res.status(502).json({ error: "We couldn't save that. Please try again." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[survey]', message);
    return res.status(502).json({ error: "We couldn't save that. Please try again." });
  }
}
