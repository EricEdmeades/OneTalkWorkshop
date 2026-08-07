// =============================================================================
// /survey — the end-of-day feedback form.
// -----------------------------------------------------------------------------
// Renders the day's questions from lib/survey.js (the same module the API
// validates against, so the form can never ask something the server rejects),
// then POSTs the answers to /api/survey.
//
// The day is preselected from the clock, because an attendee reaching for
// their phone at 2pm should not have to work out whether this is day 2 or
// day 3. They can still change it.
// =============================================================================

import { DAYS, DAY_LABELS, dayForDate, getQuestionSet } from '../lib/survey.js';

const form = document.querySelector('[data-survey]');
const dayPicker = document.querySelector('[data-day-picker]');
const questionsEl = document.querySelector('[data-questions]');
const errorEl = document.querySelector('[data-error]');

// Stamped at render so api/survey.js can tell a human filling in a form from
// a bot posting the instant the page loads.
const formStartedAt = Date.now();

let selectedDay = dayForDate() || 'day1';
const answers = {};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// --- Day picker ---------------------------------------------------------

function renderDayPicker() {
  dayPicker.replaceChildren();
  DAYS.forEach((day) => {
    const btn = el('button', 'survey-option', DAY_LABELS[day]);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(day === selectedDay));
    btn.addEventListener('click', () => {
      if (day === selectedDay) return;
      selectedDay = day;
      // Day 3 asks two extra questions, so the list is rebuilt. Answers are
      // kept: a rating given for "the teaching content" is still that rating.
      renderDayPicker();
      renderQuestions();
    });
    dayPicker.append(btn);
  });
}

// --- Questions ----------------------------------------------------------

function renderScale(q) {
  const wrap = el('div', 'survey-scale');
  for (let value = q.min; value <= q.max; value += 1) {
    const btn = el('button', 'survey-scale-btn', String(value));
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(answers[q.id] === value));
    btn.setAttribute('aria-label', `${value} out of ${q.max}`);
    btn.addEventListener('click', () => {
      answers[q.id] = value;
      renderQuestions();
    });
    wrap.append(btn);
  }

  const ends = el('div', 'survey-scale-ends');
  ends.append(el('span', null, q.lowLabel || ''), el('span', null, q.highLabel || ''));

  const group = el('div');
  group.append(wrap, ends);
  return group;
}

function renderChoice(q) {
  const wrap = el('div', 'survey-options');
  q.options.forEach((option) => {
    const btn = el('button', 'survey-option', option);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(answers[q.id] === option));
    btn.addEventListener('click', () => {
      // Tapping the chosen answer again clears it — the only way back to
      // "no opinion" once a button has been pressed.
      answers[q.id] = answers[q.id] === option ? undefined : option;
      renderQuestions();
    });
    wrap.append(btn);
  });
  return wrap;
}

function renderText(q) {
  const input = document.createElement('textarea');
  input.className = 'survey-text';
  input.rows = 3;
  input.value = answers[q.id] || '';
  input.addEventListener('input', () => {
    answers[q.id] = input.value;
  });
  return input;
}

function renderQuestions() {
  const focusedId = document.activeElement?.closest?.('[data-question]')?.dataset.question;
  questionsEl.replaceChildren();

  getQuestionSet(selectedDay).questions.forEach((q) => {
    const field = el('div', 'survey-q');
    field.dataset.question = q.id;
    field.append(el('p', 'survey-label', q.label));
    if (q.help) field.append(el('p', 'survey-help', q.help));

    if (q.type === 'scale') field.append(renderScale(q));
    else if (q.type === 'choice') field.append(renderChoice(q));
    else field.append(renderText(q));

    questionsEl.append(field);
  });

  // A re-render must not steal the cursor out of the box being typed in.
  if (focusedId) {
    const textarea = questionsEl.querySelector(`[data-question="${focusedId}"] textarea`);
    if (textarea) {
      const end = textarea.value.length;
      textarea.focus();
      textarea.setSelectionRange(end, end);
    }
  }
}

// --- Submit -------------------------------------------------------------

function showThanks() {
  const intro = document.querySelector('.offer-inner');
  if (intro) {
    const eyebrow = intro.querySelector('.eyebrow');
    const heading = intro.querySelector('h1');
    const lead = intro.querySelector('.lead');
    if (eyebrow) eyebrow.textContent = 'Got it';
    if (heading) heading.textContent = 'Thank you.';
    if (lead) lead.textContent = 'Eric reads every one of these before the next session.';
  }

  const confirm = el('div', 'lead-confirm');
  confirm.innerHTML = '<strong>Your feedback is in.</strong> See you tomorrow.';
  form.replaceWith(confirm);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submit(event) {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const email = form.querySelector('input[name="email"]').value.trim();
  errorEl.textContent = '';

  if (!email) {
    errorEl.textContent = 'Please enter the email you registered with.';
    return;
  }

  button.disabled = true;
  button.textContent = 'Sending…';

  try {
    const res = await fetch('/api/survey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        day: selectedDay,
        email,
        answers,
        contactOptIn: form.querySelector('input[name="contactOptIn"]').checked,
        website: form.querySelector('input[name="website"]').value,
        formStartedAt,
      }),
    });

    let data = {};
    try { data = await res.json(); } catch (_) { /* ignore */ }

    if (!res.ok || !data.success) {
      throw new Error(data.error || "We couldn't save that. Please try again.");
    }

    showThanks();
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Send my feedback';
    errorEl.textContent = err.message || 'Something went wrong. Please try again.';
  }
}

function init() {
  if (!form) return;
  renderDayPicker();
  renderQuestions();
  form.addEventListener('submit', submit);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
