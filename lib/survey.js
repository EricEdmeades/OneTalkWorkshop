// lib/survey.js — the post-session feedback survey: question set, day math,
// and the NPS/aggregation used by the admin report.
//
// Pure. No Airtable, no env, no node builtins — the same module is bundled
// into the browser for src/survey.js (to render the form), imported by
// api/survey.js (to validate a submission), and imported by api/results.js
// (to build the report). Declaring the questions once here is what stops the
// form, the validator and the report from drifting into three different
// surveys, the way lib/pricing.js does for the tier cutoffs.
//
// Hashing lives in api/survey.js, not here: it needs node:crypto, and pulling
// that into this module would break the client bundle.

export const QUESTION_SET_VERSION = 'otw-generic-v1';

export const DAYS = ['day1', 'day2', 'day3'];

export const DAY_LABELS = {
  day1: 'Day 1',
  day2: 'Day 2',
  day3: 'Day 3',
};

// How each taught block scored. "Missed it" is a real answer, not a gap: an
// attendee who stepped out should not drag a session's rating down.
export const SESSION_OPTIONS = ['Excellent', 'Good', 'Fair', 'Poor', 'Missed it'];

export function isValidDay(day) {
  return DAYS.includes(day);
}

// --- Which day is this? -------------------------------------------------
//
// August runs 7-9 Aug 2026, each session ending 2pm ET. The form preselects
// the day from the clock so an attendee never has to work out which day they
// are reviewing, and the window runs to 5am ET so a late-night submission
// still lands on the day it is about. Outside the workshop this returns null
// and the form asks instead of guessing.
const WORKSHOP_DAY_STARTS_UTC = {
  // Keyed by the day's own date at 00:00 ET (04:00 UTC).
  day1: Date.UTC(2026, 7, 7, 4, 0, 0),
  day2: Date.UTC(2026, 7, 8, 4, 0, 0),
  day3: Date.UTC(2026, 7, 9, 4, 0, 0),
};

// 29 hours: midnight ET through 5am ET the following morning.
const DAY_WINDOW_MS = 29 * 60 * 60 * 1000;

export function dayForDate(now = Date.now()) {
  for (const day of DAYS) {
    const start = WORKSHOP_DAY_STARTS_UTC[day];
    if (now >= start && now < start + DAY_WINDOW_MS) return day;
  }
  return null;
}

// --- Question set -------------------------------------------------------
//
// Deliberately short. Three days of long surveys and the day 3 response rate
// collapses, which is the one that matters. Every question is optional at
// submit time: a survey that refuses to save because someone skipped one
// question loses the rest of their answers, and partial data is worth far
// more than a clean record.
//
// Types: 'scale' (numeric buttons), 'choice' (SESSION_OPTIONS), 'text'.
// The generic block below is what ships until a transcript-generated set
// replaces it, at which point only SESSION_QUESTIONS changes shape.

const SESSION_QUESTIONS = [
  { id: 'teaching', type: 'choice', label: 'The teaching content', options: SESSION_OPTIONS },
  { id: 'exercises', type: 'choice', label: 'The exercises and breakout work', options: SESSION_OPTIONS },
  { id: 'pace', type: 'choice', label: 'The pace of the day', options: SESSION_OPTIONS },
  { id: 'clarity', type: 'choice', label: 'Clarity on what to do next', options: SESSION_OPTIONS },
];

function commonQuestions(day) {
  const subject = day === 'day3' ? 'the workshop' : 'today';
  return [
    {
      id: 'dayRating',
      type: 'scale',
      min: 1,
      max: 10,
      label: 'Overall, how would you rate today?',
      lowLabel: 'Poor',
      highLabel: 'Outstanding',
    },
    ...SESSION_QUESTIONS,
    {
      id: 'bestThing',
      type: 'text',
      label: `What was the most valuable thing about ${subject}?`,
    },
    {
      id: 'improve',
      type: 'text',
      label:
        day === 'day3'
          ? 'What one thing would have made the workshop better?'
          : 'What one thing would make tomorrow better?',
    },
    {
      id: 'nps',
      type: 'scale',
      min: 0,
      max: 10,
      label: 'How likely are you to recommend the One Talk Workshop to a friend or colleague?',
      lowLabel: 'Not at all likely',
      highLabel: 'Extremely likely',
    },
  ];
}

const CLOSING_QUESTIONS = [
  {
    id: 'confidence',
    type: 'scale',
    min: 1,
    max: 10,
    label: 'How confident do you feel about delivering your signature talk now?',
    lowLabel: 'Not confident',
    highLabel: 'Completely confident',
  },
  {
    id: 'testimonial',
    type: 'text',
    label: 'If the workshop worked for you, how would you describe it to someone considering it?',
    help: 'We may quote this. Leave it blank if you would rather we did not.',
  },
];

const CLOSER = {
  id: 'anythingElse',
  type: 'text',
  label: 'Anything else you want to tell us?',
};

export function getQuestionSet(day) {
  if (!isValidDay(day)) throw new Error(`Unknown day: ${day}`);
  const questions = [
    ...commonQuestions(day),
    ...(day === 'day3' ? CLOSING_QUESTIONS : []),
    CLOSER,
  ];
  return { version: QUESTION_SET_VERSION, day, label: DAY_LABELS[day], questions };
}

// --- Aggregation --------------------------------------------------------

function numericAnswers(values, min, max) {
  return values.filter(
    (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max,
  );
}

// The real definition, not an average: promoters (9-10) minus detractors
// (0-6) as a share of everyone who answered. Passives sit in the denominator
// but not the numerator, which is exactly why NPS is not a mean score.
export function calculateNps(values) {
  const scores = numericAnswers(values, 0, 10);
  const promoters = scores.filter((v) => v >= 9).length;
  const detractors = scores.filter((v) => v <= 6).length;
  const passives = scores.length - promoters - detractors;
  return {
    responses: scores.length,
    promoters,
    passives,
    detractors,
    // Null rather than 0 when nobody answered: 0 is a real NPS and would read
    // as a genuine, terrible result.
    score: scores.length
      ? Math.round((promoters / scores.length) * 100 - (detractors / scores.length) * 100)
      : null,
  };
}

export function mean(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((sum, v) => sum + v, 0) / nums.length) * 10) / 10;
}

export function distribution(values, options) {
  return options.map((option) => ({
    option,
    count: values.filter((v) => v === option).length,
  }));
}

function verbatims(responses, key) {
  return responses
    .map((r) => {
      const direct = typeof r[key] === 'string' ? r[key] : '';
      const nested = typeof r.answers?.[key] === 'string' ? r.answers[key] : '';
      return (direct || nested).trim();
    })
    .filter(Boolean);
}

// A quote is only publishable if the attendee said so. Every record written
// before the consent question shipped has no answer at all, and silence is
// not consent — those come back as 'unasked' so the report can show them
// while making clear they cannot be used yet.
export const PUBLISHABLE_CONSENT = ['Named', 'Anonymous'];

export function testimonialsWithConsent(responses) {
  return responses
    .map((r) => {
      const text = typeof r.answers?.testimonial === 'string' ? r.answers.testimonial.trim() : '';
      if (!text) return null;
      const consent = PUBLISHABLE_CONSENT.includes(r.marketingConsent)
        ? r.marketingConsent
        : r.marketingConsent === 'Declined'
          ? 'Declined'
          : 'unasked';
      return {
        text,
        consent,
        // Only ever surfaced for a Named consent, so a stale name left on a
        // record that later became Anonymous cannot leak through the report.
        name: consent === 'Named' && typeof r.displayName === 'string' ? r.displayName.trim() : '',
      };
    })
    .filter(Boolean);
}

export function summariseDay(day, responses) {
  const forDay = responses.filter((r) => r.day === day);
  const sessions = SESSION_QUESTIONS.map((q) => ({
    id: q.id,
    label: q.label,
    distribution: distribution(
      forDay.map((r) => r.answers?.[q.id]),
      SESSION_OPTIONS,
    ),
  }));

  return {
    day,
    label: DAY_LABELS[day],
    responses: forDay.length,
    // A person who submits twice is one attendee, not two.
    respondents: new Set(forDay.map((r) => r.respondent).filter(Boolean)).size,
    dayRating: mean(forDay.map((r) => r.dayRating)),
    nps: calculateNps(forDay.map((r) => r.nps)),
    sessions,
    bestThing: verbatims(forDay, 'bestThing'),
    improve: verbatims(forDay, 'improve'),
    anythingElse: verbatims(forDay, 'anythingElse'),
  };
}

// The headline number is the LAST day that has answers — normally day 3, the
// score someone gives once they have seen the whole thing. Pooling all three
// days into one figure would count the same attendee up to three times and
// average away exactly the movement worth seeing.
export function buildFeedbackReport(responses) {
  const days = DAYS.map((day) => summariseDay(day, responses));
  const latestAnswered = [...days].reverse().find((d) => d.nps.responses > 0);

  return {
    days,
    respondents: new Set(responses.map((r) => r.respondent).filter(Boolean)).size,
    responses: responses.length,
    headlineNps: latestAnswered
      ? { ...latestAnswered.nps, basis: latestAnswered.day }
      : { ...calculateNps([]), basis: null },
    confidence: mean(responses.map((r) => r.answers?.confidence)),
    testimonials: testimonialsWithConsent(responses),
  };
}
