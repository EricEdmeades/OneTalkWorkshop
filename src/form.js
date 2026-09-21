// =============================================================================
// Opt-in form handlers
// -----------------------------------------------------------------------------
// One shared binder drives both opt-in forms on the site:
//   - Lead magnet ("5 Steps to Overcoming Stage Fright") -> /api/subscribe-otw
//   - Waitlist ("Join the Waitlist")                     -> /api/waitlist-otw
// Each intercepts its form, validates client-side, POSTs JSON, and swaps the
// form for a success card on 200. Fires GA4 + Meta Pixel events on success.
// =============================================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bindOptInForm(form, { endpoint, gaEvent, metaName, confirmHTML, requireConsent }) {
  if (!form) return;

  const firstInput = form.querySelector('input[name="firstName"]');
  const lastInput = form.querySelector('input[name="lastName"]');
  const emailInput = form.querySelector('input[name="email"]');
  const websiteInput = form.querySelector('input[name="website"]');
  const consentInput = form.querySelector('input[name="consent"]');
  const startedAtInput = form.querySelector('input[name="formStartedAt"]');
  const submitBtn = form.querySelector('button[type="submit"]');
  const errorEl = form.querySelector('.lead-error');

  if (!firstInput || !lastInput || !emailInput || !submitBtn) return;

  // Stamp the form on render so the server can reject sub-3s submissions.
  if (startedAtInput) startedAtInput.value = String(Date.now());

  // Clear inline error state as the user edits.
  [firstInput, lastInput, emailInput].forEach((input) => {
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      if (errorEl) errorEl.textContent = '';
    });
  });
  if (consentInput) {
    consentInput.addEventListener('change', () => {
      consentInput.removeAttribute('aria-invalid');
      if (errorEl) errorEl.textContent = '';
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const firstName = firstInput.value.trim();
    const lastName = lastInput.value.trim();
    const email = emailInput.value.trim();
    const consent = consentInput ? consentInput.checked : true;

    const invalid = validate({ firstName, lastName, email, consent, requireConsent });
    if (invalid) {
      showError(errorEl, invalid.message);
      const field =
        invalid.field === 'consent'
          ? consentInput
          : form.querySelector(`input[name="${invalid.field}"]`);
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
      const payload = {
        firstName,
        lastName,
        email,
        website: websiteInput ? websiteInput.value : '',
        formStartedAt: startedAtInput ? startedAtInput.value : '',
      };
      if (consentInput) payload.consent = consentInput.checked ? 'yes' : '';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      let data = {};
      try { data = await res.json(); } catch (_) { /* ignore */ }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Submission failed. Please try again.');
      }

      if (typeof window.gtag === 'function') {
        window.gtag('event', gaEvent, { form: metaName });
      }
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'Lead', { content_name: metaName });
      }

      swapForConfirmation(form, confirmHTML);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
      showError(errorEl, err.message || 'Something went wrong. Please try again.');
    }
  });
}

function validate({ firstName, lastName, email, consent, requireConsent }) {
  if (!firstName) return { field: 'firstName', message: 'Please enter your first name.' };
  if (!lastName) return { field: 'lastName', message: 'Please enter your last name.' };
  if (!EMAIL_RE.test(email)) return { field: 'email', message: 'Please enter a valid email address.' };
  if (requireConsent && !consent) {
    return { field: 'consent', message: "Please confirm you'd like to receive emails." };
  }
  return null;
}

function showError(el, text) {
  if (el) el.textContent = text;
}

function swapForConfirmation(form, confirmHTML) {
  const confirm = document.createElement('div');
  confirm.className = 'lead-confirm';
  confirm.innerHTML = confirmHTML;
  form.replaceWith(confirm);
}

export function initLeadMagnetForm() {
  bindOptInForm(document.querySelector('[data-form="lead-magnet"]'), {
    endpoint: '/api/subscribe-otw',
    gaEvent: 'lead_magnet_submit',
    metaName: 'stage_fright',
    confirmHTML:
      '<strong>You’re in.</strong>Check your email for the 5 Steps to Overcoming Stage Fright worksheet.',
    requireConsent: false,
  });
}

export function initWaitlistForm() {
  bindOptInForm(document.querySelector('[data-form="waitlist"]'), {
    endpoint: '/api/waitlist-otw',
    gaEvent: 'waitlist_submit',
    metaName: 'waitlist',
    confirmHTML:
      '<strong>You’re on the list.</strong>We’ll email you the moment registration reopens.',
    requireConsent: true,
  });
}
