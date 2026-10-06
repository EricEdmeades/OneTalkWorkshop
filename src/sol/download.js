// Download page: the download button for a token link, or the fresh-link form
// when the link is missing/expired. The button goes through /api/sol-download,
// which verifies the token and redirects to a short-lived presigned PDF URL.
import { initAnalytics } from '../analytics.js';
import { downloadState, resendFeedback } from './messages.js';

// Neutral on purpose: /api/sol-resend silently succeeds for unknown emails.
const FRESH_SENT = 'If that address has the book, a fresh link is on its way.';

function show(mode) {
  document.querySelectorAll('[data-state]').forEach((el) => { el.hidden = el.dataset.state !== mode; });
}

function wireDownload(t) {
  document.querySelectorAll('[data-download]').forEach((a) => {
    a.href = `/api/sol-download?t=${encodeURIComponent(t)}`;
    a.addEventListener('click', () => {
      if (typeof window.gtag === 'function') window.gtag('event', 'sol_download');
    });
  });
}

async function requestFresh(form, status, button) {
  button.disabled = true;
  try {
    const res = await fetch('/api/sol-resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.elements.email.value.trim() }),
    });
    const body = await res.json().catch(() => null);
    status.dataset.kind = res.ok ? '' : 'error';
    status.textContent = res.ok ? FRESH_SENT : resendFeedback(res.status, body);
  } catch (_) {
    status.dataset.kind = 'error';
    status.textContent = resendFeedback(0, null);
  } finally {
    button.disabled = false;
  }
}

function wireFresh() {
  const form = document.querySelector('[data-form="sol-fresh"]');
  const status = form.querySelector('.sol-status');
  const button = form.querySelector('button');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    requestFresh(form, status, button);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initAnalytics();
  const state = downloadState(window.location.search);
  show(state.mode);
  if (state.t) wireDownload(state.t);
  if (state.mode === 'expired') wireFresh();
});
