// Opt-in page: stamps formStartedAt, validates, posts to /api/sol-optin, keeps
// the email in sessionStorage for the thank-you page's resend button, navigates.
import './botid.js';
import { initAnalytics } from '../analytics.js';
import { initAffiliateRef, getStoredRef } from '../affiliate-ref.js';
import { STORAGE_KEY } from './messages.js';

const RETRY_COPY = 'Something went wrong on our side. Try again in a minute.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELDS = ['firstName', 'email', 'speakAbout'];

function setFieldError(form, name, message) {
  const input = form.elements[name];
  const slot = form.querySelector(`#${input.getAttribute('aria-describedby')}`);
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
  slot.textContent = message || '';
  if (message) input.focus();
}

function readForm(form) {
  const fd = new FormData(form);
  const keys = [...FIELDS, 'website', 'formStartedAt'];
  return Object.fromEntries(keys.map((k) => [k, String(fd.get(k) || '').trim()]));
}

function clientError(data) {
  if (!data.firstName) return ['firstName', 'Please enter your first name.'];
  if (!EMAIL_RE.test(data.email)) return ['email', 'We need a valid email to send the book.'];
  return null;
}

function remember(email) {
  try { sessionStorage.setItem(STORAGE_KEY, email); } catch (_) { /* private mode: thanks page hides the resend button */ }
}

function track() {
  if (typeof window.gtag === 'function') window.gtag('event', 'sol_optin', { form: 'said_out_loud' });
  if (typeof window.fbq === 'function') window.fbq('track', 'Lead', { content_name: 'Said Out Loud' });
}

async function post(data) {
  const res = await fetch('/api/sol-optin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, ref: getStoredRef() || '' }),
  });
  return { res, body: await res.json().catch(() => null) };
}

async function submit(form, status, button) {
  const data = readForm(form);
  FIELDS.forEach((n) => setFieldError(form, n, ''));
  const invalid = clientError(data);
  if (invalid) return setFieldError(form, ...invalid);
  button.disabled = true;
  status.textContent = '';
  try {
    const { res, body } = await post(data);
    if (res.status === 400 && body?.field) return setFieldError(form, body.field, body.error);
    if (!res.ok) throw new Error(body?.error || RETRY_COPY);
    remember(data.email.toLowerCase());
    track();
    window.location.assign('/said-out-loud/thanks');
  } catch (err) {
    status.textContent = err.message || RETRY_COPY;
  } finally {
    button.disabled = false;
  }
  return undefined;
}

document.addEventListener('DOMContentLoaded', () => {
  initAnalytics();
  initAffiliateRef();
  const form = document.querySelector('[data-form="sol-optin"]');
  form.elements.formStartedAt.value = String(Date.now());
  const status = form.querySelector('.sol-status');
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(form, status, button);
  });
});
