# Waitlist Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch onetalkworkshop.com from Stripe registration to a waitlist opt-in (Keap tag 1948, explicit consent), redirect the checkout page to the waitlist, and leave all Stripe code/subscriptions untouched.

**Architecture:** Static HTML + vanilla JS modules built by Vite; Vercel serverless functions for the API. Add one new serverless function (`api/waitlist-otw.js`) cloned from the proven `api/subscribe-otw.js`, refactor the form handler into a shared binder used by both the existing lead-magnet form and the new waitlist form, rewrite the CTAs/dates block/FAQ/final-CTA copy in `index.html`, and add an edge redirect for `register.html`.

**Tech Stack:** Vanilla JS (ES modules), Vite, Vercel serverless functions, Keap REST API (v1/v2). Per project convention, `/api/*` and DOM-glue modules are verified manually — no unit tests added (no `lib/` changes here).

**Spec:** `docs/superpowers/specs/2026-09-21-waitlist-mode-design.md`

---

## File Structure

- **Create:** `api/waitlist-otw.js` — waitlist Keap opt-in endpoint (tag 1948, requires consent).
- **Modify:** `src/form.js` — extract `bindOptInForm()`, keep `initLeadMagnetForm()` behavior, add `initWaitlistForm()`.
- **Modify:** `src/main.js` — call `initWaitlistForm()` in `boot()`.
- **Modify:** `index.html` — nav/hero/hero-meta CTAs, replace dates block with `#waitlist` form, FAQ pruning, lead-magnet eyebrow, final CTA.
- **Modify:** `src/styles.css` — add `.lead-consent` rule.
- **Modify:** `vercel.json` — add `redirects` for `/register` and `/register.html`.

---

## Task 1: Waitlist API endpoint

**Files:**
- Create: `api/waitlist-otw.js`
- Reference: `api/subscribe-otw.js` (source pattern)

- [ ] **Step 1: Create `api/waitlist-otw.js` with the full content below**

```js
// =============================================================================
// /api/waitlist-otw — Keap integration for the One Talk Workshop waitlist.
// -----------------------------------------------------------------------------
// When registration is closed, the landing page collects waitlist opt-ins.
// On submit we:
//   1. Require an explicit consent checkbox (compliance — tag 1948 triggers a
//      Keap automation that emails the contact).
//   2. Look up the contact in Keap by email; create if new, PATCH if existing.
//   3. Apply tag 1948 (hardwired) — triggers the waitlist Keap automation.
//   4. Add a contact-timeline note recording the opt-in and consent.
//
// We do NOT send emails ourselves — Keap's automation handles delivery once
// the tag is applied. Mirrors api/subscribe-otw.js verbatim except for the
// hardwired tag, the consent gate, and the opt-in copy.
// =============================================================================

const KEAP_BASE_V1 = 'https://api.infusionsoft.com/crm/rest/v1';
const KEAP_BASE_V2 = 'https://api.infusionsoft.com/crm/rest/v2';
// Hardwired per decision — no env var. Applying this tag triggers the Keap
// waitlist automation that actually emails people.
const TAG_ID = 1948;

const MIN_FORM_FILL_MS = 3000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

const ALLOWED_HOST_SUFFIXES = ['onetalkworkshop.com', 'onetalk.ericedmeades.com', '.vercel.app'];
const ALLOWED_HOSTS_EXACT = ['localhost', '127.0.0.1'];

function isAllowedOrigin(originOrReferer) {
  if (!originOrReferer) return false;
  let host;
  try {
    host = new URL(originOrReferer).hostname;
  } catch (_) {
    return false;
  }
  if (ALLOWED_HOSTS_EXACT.includes(host)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix,
  );
}

function keapHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Keap-API-Key': process.env.KEAP_API_KEY,
  };
}

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hasConsent(value) {
  return value === true || trim(value).toLowerCase() === 'yes';
}

async function findContactByEmail(email) {
  const url = `${KEAP_BASE_V1}/contacts?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: keapHeaders() });
  if (!res.ok) throw new Error(`Keap search failed: ${res.status}`);
  const data = await res.json();
  return (data.contacts && data.contacts[0]) || null;
}

async function createContact({ firstName, lastName, email }) {
  const res = await fetch(`${KEAP_BASE_V1}/contacts`, {
    method: 'POST',
    headers: keapHeaders(),
    body: JSON.stringify({
      given_name: firstName,
      family_name: lastName,
      email_addresses: [{ email, field: 'EMAIL1' }],
      opt_in_reason: 'One Talk Workshop landing page — waitlist opt-in (explicit consent)',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keap create failed: ${res.status} ${text}`);
  }
  const created = await res.json();
  return created.id;
}

async function updateContact(contactId, { firstName, lastName, email }) {
  const res = await fetch(`${KEAP_BASE_V1}/contacts/${contactId}`, {
    method: 'PATCH',
    headers: keapHeaders(),
    body: JSON.stringify({
      given_name: firstName,
      family_name: lastName,
      email_addresses: [{ email, field: 'EMAIL1' }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Keap update failed: ${res.status} ${text}`);
  }
}

// Keap returns HTTP 200 even when a tag ID is unknown, signaling per-tag
// failure inside the response body (e.g. {"1948":"TAG_ID_NOT_FOUND"}).
function isTagFailureValue(v) {
  if (v == null) return false;
  if (typeof v !== 'string') return false;
  const upper = v.toUpperCase();
  return upper.includes('ERROR') || upper.includes('NOT_FOUND');
}

async function applyTag(contactId, tagId) {
  const res = await fetch(`${KEAP_BASE_V1}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: keapHeaders(),
    body: JSON.stringify({ tagIds: [tagId] }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Keap tag apply HTTP ${res.status} for contact ${contactId} tag ${tagId}: ${text}`,
    );
  }

  let body;
  try {
    body = await res.json();
  } catch (_) {
    body = {};
  }

  const failures = Object.entries(body).filter(([_, v]) => isTagFailureValue(v));
  if (failures.length > 0) {
    const failedIds = failures.map(([id]) => id).join(', ');
    throw new Error(
      `Keap tag apply rejected for contact ${contactId} tag(s) [${failedIds}]: ${JSON.stringify(body)}`,
    );
  }
}

async function addNote(contactId, title, body) {
  const res = await fetch(`${KEAP_BASE_V2}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: keapHeaders(),
    body: JSON.stringify({ title, text: body }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[waitlist-otw] Note add failed: ${res.status} ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!process.env.KEAP_API_KEY) {
    console.error('[waitlist-otw] KEAP_API_KEY is not set');
    return res.status(500).json({ success: false, error: 'Server is not configured.' });
  }

  const body = req.body || {};
  const firstName = trim(body.firstName);
  const lastName = trim(body.lastName);
  const email = trim(body.email).toLowerCase();
  const honeypot = trim(body.website);
  const formStartedAt = Number(body.formStartedAt);

  // -- Anti-spam gates (return silent success so bots think they got through) -
  const origin = req.headers.origin || req.headers.referer || '';
  if (!isAllowedOrigin(origin)) {
    console.warn(`[waitlist-otw] Blocked: bad origin "${origin}"`);
    return res.status(200).json({ success: true });
  }
  if (honeypot) {
    console.warn(`[waitlist-otw] Blocked: honeypot filled ("${honeypot}")`);
    return res.status(200).json({ success: true });
  }
  if (!Number.isFinite(formStartedAt)) {
    console.warn('[waitlist-otw] Blocked: missing/invalid formStartedAt');
    return res.status(200).json({ success: true });
  }
  const elapsed = Date.now() - formStartedAt;
  if (elapsed < MIN_FORM_FILL_MS || elapsed > MAX_FORM_AGE_MS) {
    console.warn(`[waitlist-otw] Blocked: form age ${elapsed}ms out of range`);
    return res.status(200).json({ success: true });
  }
  // ---------------------------------------------------------------------------

  if (!firstName) {
    return res.status(400).json({ success: false, error: 'Please enter your first name.' });
  }
  if (!lastName) {
    return res.status(400).json({ success: false, error: 'Please enter your last name.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
  }
  // Consent is a real validation error the user must see — NOT a silent-spam 200.
  if (!hasConsent(body.consent)) {
    return res.status(400).json({
      success: false,
      error: "Please confirm you'd like to receive emails.",
    });
  }

  try {
    const existing = await findContactByEmail(email);
    let contactId;
    if (existing) {
      contactId = existing.id;
      await updateContact(contactId, { firstName, lastName, email });
    } else {
      contactId = await createContact({ firstName, lastName, email });
    }

    try {
      await applyTag(contactId, TAG_ID);
    } catch (tagErr) {
      const message = tagErr instanceof Error ? tagErr.message : String(tagErr);
      console.error(
        `[waitlist-otw] Tag apply failed (contact ${contactId} tag ${TAG_ID}): ${message}`,
      );
      return res.status(500).json({
        success: false,
        error: 'Waitlist signup partially failed. Please contact support.',
      });
    }

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    await addNote(
      contactId,
      `OneTalk — Waitlist opt-in (${today})`,
      [
        'Source: onetalkworkshop.com',
        'Form: Join the Waitlist',
        `Tag applied: ${TAG_ID}`,
        `Consent: yes — checkbox, ${now.toISOString()}`,
        `Name: ${firstName} ${lastName}`,
        `Email: ${email}`,
      ].join('\n'),
    );

    return res.status(200).json({ success: true, contactId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[waitlist-otw]', message);
    return res.status(500).json({
      success: false,
      error: "We couldn't process your request. Please try again.",
    });
  }
}
```

- [ ] **Step 2: Syntax-check the new file**

Run: `node --check api/waitlist-otw.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add api/waitlist-otw.js
git commit -m "feat: add /api/waitlist-otw Keap endpoint (tag 1948, consent-gated)"
```

---

## Task 2: Refactor `src/form.js` into a shared binder

**Files:**
- Modify: `src/form.js` (replace whole file)

- [ ] **Step 1: Replace `src/form.js` with the full content below**

```js
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
```

> Note: the GA4 event payload changes from `{ lead_magnet: 'stage_fright' }` to
> `{ form: 'stage_fright' }` for the lead magnet. This is an intentional
> simplification so both forms share one binder; the event name
> (`lead_magnet_submit`) is unchanged, so existing GA4 event-name reporting is
> unaffected.

- [ ] **Step 2: Syntax-check**

Run: `node --check src/form.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/form.js
git commit -m "refactor: share one opt-in binder for lead-magnet + waitlist forms"
```

---

## Task 3: Wire the waitlist form in `src/main.js`

**Files:**
- Modify: `src/main.js:3`, `src/main.js:12`

- [ ] **Step 1: Update the import on line 3**

Change:
```js
import { initLeadMagnetForm } from './form.js';
```
to:
```js
import { initLeadMagnetForm, initWaitlistForm } from './form.js';
```

- [ ] **Step 2: Call it in `boot()` after `initLeadMagnetForm()`**

Change:
```js
  initLeadMagnetForm();
```
to:
```js
  initLeadMagnetForm();
  initWaitlistForm();
```

- [ ] **Step 3: Syntax-check**

Run: `node --check src/main.js`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat: initialize the waitlist form on the landing page"
```

---

## Task 4: `index.html` — nav, hero button, hero meta

**Files:**
- Modify: `index.html:45`, `index.html:64–83`

- [ ] **Step 1: Nav CTA (line 45)**

Replace:
```html
    <a href="/register.html" class="nav-cta" data-cta="nav"><span class="nav-cta-full">Register Now</span><span class="nav-cta-short">Register</span></a>
```
with:
```html
    <a href="#waitlist" class="nav-cta" data-cta="nav"><span class="nav-cta-full">Join the Waitlist</span><span class="nav-cta-short">Waitlist</span></a>
```

- [ ] **Step 2: Hero button + remove money-back line (lines 64–70)**

Replace:
```html
        <div>
          <a href="/register.html" class="btn-primary" data-cta="hero">
            Reserve My Seat
            <span class="arrow">→</span>
          </a>
          <p class="micro-assure"><strong>100% money-back guarantee.</strong> Attend all 3 days — if you don't leave with a complete framework for your signature talk, we refund you in full.</p>
        </div>
```
with:
```html
        <div>
          <a href="#waitlist" class="btn-primary" data-cta="hero">
            Join the Waitlist
            <span class="arrow">→</span>
          </a>
        </div>
```

- [ ] **Step 3: Hero meta — drop the two date bullets (lines 72–83)**

Replace:
```html
        <div class="hero-meta">
          <div class="hero-meta-item" data-date="august"><span class="dot">●</span> Aug 7–9, 2026<!--
            August is sold out, so the stamp is static and no longer links to
            registration — there is nothing left to buy. The live seat ticker
            (src/date-cards.js, [data-seat-stamp]) no longer applies here. The
            hero lists dates you can still attend, so this bullet is removed
            once the workshop is over; the Dates section keeps the greyed card.
          --><span class="hero-seat-stamp is-sold-out">Sold out</span></div>
          <div class="hero-meta-item" data-date="september"><span class="dot">●</span> Sep 18–20, 2026</div>
          <div class="hero-meta-item"><span class="dot">●</span> 10am–2pm Eastern each day</div>
          <div class="hero-meta-item"><span class="dot">●</span> Live online — join from anywhere</div>
        </div>
```
with:
```html
        <div class="hero-meta">
          <div class="hero-meta-item"><span class="dot">●</span> 3 days · 10am–2pm Eastern each day</div>
          <div class="hero-meta-item"><span class="dot">●</span> Live online — join from anywhere</div>
        </div>
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: waitlist CTAs in nav + hero, drop past-date hero bullets"
```

---

## Task 5: `index.html` — replace the dates block with the waitlist section

**Files:**
- Modify: `index.html:516–545`

- [ ] **Step 1: Replace the entire DATES section (lines 516–545)**

Replace:
```html
<!-- ================= DATES ================= -->
<section class="offer sect-pad" id="dates">
  <div class="wrap">
    <div class="offer-inner">
      <span class="eyebrow">Choose Your Date</span>
      <h2>Two dates. One workshop. Pick what works for you.</h2>
    </div>
    <div class="date-cards" style="margin-top:40px;">
      <!-- August is sold out (lib/seats.js FORCED_SOLD_OUT_DATES). Rendered
           sold-out in the markup so it never flashes as available before
           src/date-cards.js runs; that module greys the card once the
           workshop has finished and leaves it on the page. -->
      <div class="day-card is-sold-out" data-date="august" style="align-items:center; text-align:center; padding:32px;">
        <h3 style="margin-top:0;">August 7–9, 2026</h3>
        <p style="opacity:0.75; margin-bottom:24px;">Live online · 10am–2pm Eastern each day</p>
        <p class="seat-notice">Sold out</p>
        <span class="btn-primary is-disabled" aria-disabled="true">Sold Out</span>
      </div>
      <div class="day-card" data-date="september" style="align-items:center; text-align:center; padding:32px;">
        <h3 style="margin-top:0;">September 18–20, 2026</h3>
        <p style="opacity:0.75; margin-bottom:24px;">Live online · 10am–2pm Eastern each day</p>
        <a href="/register.html#september" class="btn-primary" data-cta="dates_september">
          Reserve My Seat
          <span class="arrow">→</span>
        </a>
      </div>
    </div>
    <p class="lead-micro" style="text-align:center; margin-top:2rem;">Full pricing and payment-plan details are on the registration page.</p>
  </div>
</section>
```
with:
```html
<!-- ================= WAITLIST ================= -->
<section class="offer sect-pad" id="waitlist">
  <div class="wrap-narrow">
    <div class="sect-head">
      <span class="eyebrow">The Next Cohort</span>
      <h2>New dates are coming. Be first in line.</h2>
      <p class="lead">Registration for the next One Talk Workshop isn't open yet. Join the waitlist and we'll email you the moment it is — before it goes public.</p>
    </div>
    <form class="lead-form" data-form="waitlist" action="/api/waitlist-otw" method="post" novalidate>
      <div class="lead-row">
        <div class="lead-field">
          <label for="wl-firstname" class="sr-only">First name</label>
          <input id="wl-firstname" name="firstName" type="text" required placeholder="First name" autocomplete="given-name">
        </div>
        <div class="lead-field">
          <label for="wl-lastname" class="sr-only">Last name</label>
          <input id="wl-lastname" name="lastName" type="text" required placeholder="Last name" autocomplete="family-name">
        </div>
      </div>
      <div class="lead-field lead-field-full">
        <label for="wl-email" class="sr-only">Email address</label>
        <input id="wl-email" name="email" type="email" required placeholder="your@email.com" autocomplete="email">
      </div>
      <label class="lead-consent">
        <input id="wl-consent" name="consent" type="checkbox" value="yes" required>
        <span>Yes, email me when registration opens and about The One Talk Workshop. I can unsubscribe at any time.</span>
      </label>
      <div class="lead-hp" aria-hidden="true">
        <label for="wl-website">Website (leave blank)</label>
        <input id="wl-website" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>
      <input type="hidden" name="formStartedAt" value="">
      <button type="submit" class="btn-primary lead-submit">
        Join the Waitlist
        <span class="arrow">→</span>
      </button>
      <p class="lead-error" role="alert" aria-live="polite"></p>
    </form>
    <p class="lead-micro" style="text-align:center;">We'll only email you about registration. Unsubscribe anytime.</p>
  </div>
</section>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: replace dates block with the waitlist opt-in form"
```

---

## Task 6: `index.html` — FAQ, lead-magnet eyebrow, final CTA

**Files:**
- Modify: `index.html` FAQ items (`:590–609`, `:633`), lead-magnet eyebrow (`:669`), final CTA (`:704–716`)

- [ ] **Step 1: Remove the three purchase-specific FAQ items**

Delete these three `<details class="faq-item">` blocks in full:

The "$1,297" item:
```html
      <details class="faq-item">
        <summary>"$1,297 is a real commitment. Is it worth it right now?"</summary>
        <div class="faq-answer">
          Fair question. Here's the math: Eric's keynote fee starts at $50,000/hour. His Speaking Academy is $15,000. The workshop is three full days of direct instruction with him for $1,297 during Early Registration (retail is $1,597). If the talk you leave with leads to one paid booking, one client from a stage, one podcast invitation that changes your business — the workshop has paid for itself. And if it doesn't work for you, the guarantee refunds every dollar.
        </div>
      </details>
```
The payment-plan item:
```html
      <details class="faq-item">
        <summary>"Is there a payment plan?"</summary>
        <div class="faq-answer">
          Yes. At checkout you can choose to split your investment into 2 payments, charged 14 days apart, instead of paying in full — handled securely through Stripe. Full workshop access is unlocked as soon as your first payment processes.
        </div>
      </details>
```
The "What happens after I sign up?" item:
```html
      <details class="faq-item">
        <summary>"What happens after I sign up?"</summary>
        <div class="faq-answer">
          You'll receive a confirmation email immediately with your access details, how to prepare for Day 1, and how to join the live sessions each day.
        </div>
      </details>
```

- [ ] **Step 2: Neutralize the "hosted" FAQ answer (line 635)**

Replace:
```html
          The event is live online, accessible from anywhere. You'll get access details after you register.
```
with:
```html
          The event is live online, accessible from anywhere. You'll get access details after you join.
```

- [ ] **Step 3: Retitle the lead-magnet eyebrow (line 669)**

Replace:
```html
      <span class="eyebrow">Not Ready To Register Today?</span>
```
with:
```html
      <span class="eyebrow">Want To Get Started Now?</span>
```

- [ ] **Step 4: Rewrite the final CTA (lines 704–716)**

Replace:
```html
<section class="final-cta">
  <div class="wrap">
    <div class="final-cta-inner">
      <div class="seat-count"><span class="live-dot"></span> Limited availability</div>
      <h2>There's a talk inside you.<br><em>In three days, it will exist.</em></h2>
      <p class="lead">
        The book deal, the podcast invitation, the paid speaking gig, the client — they all start with one talk. Two dates to choose from in 2026 — pick yours.
      </p>
      <a href="/register.html" class="btn-primary btn-hero" data-cta="final_cta">
        Reserve My Seat
        <span class="arrow">→</span>
      </a>
      <p style="margin-top: 24px; font-size: 0.82rem; opacity: 0.6; letter-spacing: 0.04em;">100% money-back guarantee</p>
    </div>
  </div>
</section>
```
with:
```html
<section class="final-cta">
  <div class="wrap">
    <div class="final-cta-inner">
      <div class="seat-count"><span class="live-dot"></span> Doors reopen soon</div>
      <h2>There's a talk inside you.<br><em>In three days, it will exist.</em></h2>
      <p class="lead">
        The book deal, the podcast invitation, the paid speaking gig, the client — they all start with one talk. New dates are coming; join the waitlist to be first to know when registration opens.
      </p>
      <a href="#waitlist" class="btn-primary btn-hero" data-cta="final_cta">
        Join the Waitlist
        <span class="arrow">→</span>
      </a>
      <p style="margin-top: 24px; font-size: 0.82rem; opacity: 0.6; letter-spacing: 0.04em;">Be the first to know when registration opens.</p>
    </div>
  </div>
</section>
```

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: prune purchase FAQ/copy, point final CTA at the waitlist"
```

---

## Task 7: `.lead-consent` style in `src/styles.css`

**Files:**
- Modify: `src/styles.css` (append near the other `.lead-*` form rules)

- [ ] **Step 1: Find the lead-form styles to anchor the addition**

Run: `grep -n '\.lead-hp\|\.lead-field-full\|\.lead-error' src/styles.css`
Expected: line numbers for the existing lead-form rules (add the new rule adjacent to them).

- [ ] **Step 2: Add the `.lead-consent` rule**

Append this block immediately after the `.lead-field-full` rule (keep it grouped with the other `.lead-*` form styles):

```css
.lead-consent {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 16px;
  text-align: left;
  font-size: 0.9rem;
  line-height: 1.4;
  opacity: 0.85;
}
.lead-consent input[type="checkbox"] {
  margin-top: 3px;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  accent-color: var(--brand-orange, #E26320);
  cursor: pointer;
}
.lead-consent span {
  cursor: pointer;
}
.lead-consent input[aria-invalid="true"] {
  outline: 2px solid #c0392b;
  outline-offset: 2px;
}
```

> If `grep` in Step 1 shows the codebase uses a different brand-colour variable
> name than `--brand-orange`, use that variable in `accent-color` instead; the
> `#E26320` fallback matches the site `theme-color`.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "style: add .lead-consent checkbox row for the waitlist form"
```

---

## Task 8: `vercel.json` — registration-closed redirect

**Files:**
- Modify: `vercel.json:6` (add a `redirects` array after `trailingSlash`)

- [ ] **Step 1: Add the `redirects` array**

Replace:
```json
  "cleanUrls": true,
  "trailingSlash": false,
  "rewrites": [
```
with:
```json
  "cleanUrls": true,
  "trailingSlash": false,
  "redirects": [
    { "source": "/register", "destination": "/#waitlist", "permanent": false },
    { "source": "/register.html", "destination": "/#waitlist", "permanent": false }
  ],
  "rewrites": [
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat: 302 /register(.html) to the waitlist (registration closed)"
```

---

## Task 9: Build + verification pass

**Files:** none (verification only)

- [ ] **Step 1: Unit tests still pass**

Run: `npm test`
Expected: pricing + results suites PASS (unchanged by this work).

- [ ] **Step 2: Production build succeeds**

Run: `npm run build`
Expected: Vite build completes, `dist/` written, no errors.

- [ ] **Step 3: Preview the prod bundle and smoke-test the page**

Run: `npm run preview` (serves `dist/` at http://localhost:4173)
Verify in the browser / via the preview tools:
- Nav, hero, and final-CTA buttons all read "Join the Waitlist" and scroll to `#waitlist`.
- The waitlist form renders with the consent checkbox; submitting with the box
  unchecked shows the inline "Please confirm…" error and does not POST.
- No console errors on load (the removed dates block leaves `initDateCards()` a no-op).
- The three purchase FAQ items are gone; remaining FAQ intact.

> Note: `npm run preview` serves static files only — the `/api/waitlist-otw`
> POST and the `/register` redirect are exercised in Step 4 (they need the
> Vercel runtime), not here.

- [ ] **Step 4: Exercise the API + redirect with the Vercel runtime**

Run: `vercel dev`
Verify:
- Valid waitlist submit (fill fields, wait >3s, check consent) → `200 {success:true}`
  and, against a real `KEAP_API_KEY`, tag 1948 applied to the contact.
- Submit with `consent` omitted → `400` with the "Please confirm…" message.
- Honeypot filled or sub-3s submit → silent `200 {success:true}`.
- `curl -sI http://localhost:3000/register` and `.../register.html` → `302` to `/#waitlist`.

> Requires `KEAP_API_KEY` in `.env.local` for the live Keap path; without it the
> endpoint returns the configured `500` and only the validation/redirect checks apply.

- [ ] **Step 5: Final review of the working tree**

Run: `git status && git log --oneline feature/waitlist-mode -12`
Expected: clean tree, one commit per task above.

---

## Notes for the implementer

- **Do not touch** `register.html`, `src/register.js`, `api/create-checkout.js`,
  `api/stripe-webhook.js`, `api/seats.js`, `lib/pricing.js`, or `lib/seats.js`.
  In-flight Stripe payment plans depend on those staying exactly as they are.
- The waitlist form field IDs are `wl-*` (not `lead-*`) so they never collide
  with the still-present 5-Steps lead-magnet form.
- `date-cards.js` remains imported by `main.js`; with no `.day-card[data-date]`
  or hero date bullets left, `initDateCards()` simply finds nothing and returns.
```
