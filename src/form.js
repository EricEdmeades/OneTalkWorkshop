// =============================================================================
// Lead-magnet form handler
// -----------------------------------------------------------------------------
// Intercepts the "5 Steps to Overcoming Stage Fright" form, validates client-
// side, POSTs JSON to /api/subscribe-otw, and swaps the form for a success
// card on 200. Fires GA4 + Meta Pixel events on success.
// =============================================================================

const ENDPOINT = '/api/subscribe-otw';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function initLeadMagnetForm() {
  const form = document.querySelector('[data-form="lead-magnet"]');
  if (!form) return;

  const firstInput = form.querySelector('input[name="firstName"]');
  const lastInput = form.querySelector('input[name="lastName"]');
  const emailInput = form.querySelector('input[name="email"]');
  const submitBtn = form.querySelector('button[type="submit"]');
  const errorEl = form.querySelector('.lead-error');

  if (!firstInput || !lastInput || !emailInput || !submitBtn) return;

  // Clear aria-invalid state as the user types.
  [firstInput, lastInput, emailInput].forEach((input) => {
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      if (errorEl) errorEl.textContent = '';
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const firstName = firstInput.value.trim();
    const lastName = lastInput.value.trim();
    const email = emailInput.value.trim();

    const invalid = validate({ firstName, lastName, email });
    if (invalid) {
      showError(errorEl, invalid.message);
      const field = form.querySelector(`input[name="${invalid.field}"]`);
      if (field) {
        field.setAttribute('aria-invalid', 'true');
        field.focus();
      }
      return;
    }

    showError(errorEl, '');
    const originalLabel = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email }),
      });

      let data = {};
      try { data = await res.json(); } catch (_) { /* ignore */ }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Submission failed. Please try again.');
      }

      if (typeof window.gtag === 'function') {
        window.gtag('event', 'lead_magnet_submit', { lead_magnet: 'stage_fright' });
      }
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'Lead', { content_name: 'stage_fright' });
      }

      swapForConfirmation(form);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
      showError(errorEl, err.message || 'Something went wrong. Please try again.');
    }
  });
}

function validate({ firstName, lastName, email }) {
  if (!firstName) return { field: 'firstName', message: 'Please enter your first name.' };
  if (!lastName) return { field: 'lastName', message: 'Please enter your last name.' };
  if (!EMAIL_RE.test(email)) return { field: 'email', message: 'Please enter a valid email address.' };
  return null;
}

function showError(el, text) {
  if (el) el.textContent = text;
}

function swapForConfirmation(form) {
  const confirm = document.createElement('div');
  confirm.className = 'lead-confirm';
  confirm.innerHTML =
    '<strong>You\u2019re in.</strong>Check your email for the 5 Steps to Overcoming Stage Fright worksheet.';
  form.replaceWith(confirm);
}
