// Thank-you page: "Send it again" posts the email stored by the opt-in page.
import './botid.js';
import { initAnalytics } from '../analytics.js';
import { STORAGE_KEY, resendFeedback } from './messages.js';

function storedEmail() {
  try { return sessionStorage.getItem(STORAGE_KEY) || ''; } catch (_) { return ''; }
}

async function resend(email, button, status) {
  button.disabled = true;
  try {
    const res = await fetch('/api/sol-resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => null);
    status.dataset.kind = res.ok ? '' : 'error';
    status.textContent = resendFeedback(res.status, body);
    if (res.ok && typeof window.gtag === 'function') window.gtag('event', 'sol_resend');
  } catch (_) {
    status.dataset.kind = 'error';
    status.textContent = resendFeedback(0, null);
  } finally {
    button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initAnalytics();
  const email = storedEmail();
  const block = document.querySelector('[data-resend]');
  if (!email) {
    block.hidden = true;
    document.querySelector('[data-no-resend]').hidden = false;
    return;
  }
  const button = block.querySelector('button');
  const status = block.querySelector('.sol-status');
  button.addEventListener('click', () => resend(email, button, status));
});
