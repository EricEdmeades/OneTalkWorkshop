# Postpone / Waitlist Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the OneTalkWorkshop landing page from "buy now" mode to waitlist mode — removing all event dates and prices, swapping buy buttons for anchor links to a new opt-in form, and wiring up a new Keap API endpoint (tag 1948) for waitlist subscribers.

**Architecture:** Four independent changes — new API endpoint, new form handler, HTML content edits, HTML structural replacement of the offer section. No new CSS needed; the waitlist form reuses existing `.lead-form` / `.lead-field` classes. Everything removed is preserved in memory (`onetalk-removed-sections`) for easy restoration.

**Tech Stack:** Vanilla JS (ES modules), Vite 8, Vercel Serverless Functions (Node.js), Keap REST API v1/v2.

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Create | `api/notify-otw.js` | New waitlist endpoint; mirrors `subscribe-otw.js`, tag ID 1948 |
| Modify | `src/form.js` | Add + export `initWaitlistForm()` |
| Modify | `src/main.js` | Import + call `initWaitlistForm()` |
| Modify | `index.html` | Remove dates/prices/buy buttons; replace offer section; add waitlist form |

---

## Task 1: Create `api/notify-otw.js`

**Files:**
- Create: `api/notify-otw.js`

- [ ] **Step 1: Create the file**

```js
// api/notify-otw.js — Keap waitlist opt-in for the "notify me" form.
// Mirrors api/subscribe-otw.js; applies tag KEAP_TAG_ID_WAITLIST (default 1948).

const KEAP_BASE_V1 = 'https://api.infusionsoft.com/crm/rest/v1';
const KEAP_BASE_V2 = 'https://api.infusionsoft.com/crm/rest/v2';
const TAG_ID = Number(process.env.KEAP_TAG_ID_WAITLIST || 1948);

const MIN_FORM_FILL_MS = 3000;
const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

const ALLOWED_HOST_SUFFIXES = ['onetalk.ericedmeades.com', '.vercel.app'];
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
      opt_in_reason: 'One Talk Workshop landing page — waitlist opt-in',
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
    console.error(`[notify-otw] Note add failed: ${res.status} ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!process.env.KEAP_API_KEY) {
    console.error('[notify-otw] KEAP_API_KEY is not set');
    return res.status(500).json({ success: false, error: 'Server is not configured.' });
  }

  const body = req.body || {};
  const firstName = trim(body.firstName);
  const lastName = trim(body.lastName);
  const email = trim(body.email).toLowerCase();
  const honeypot = trim(body.website);
  const formStartedAt = Number(body.formStartedAt);

  const origin = req.headers.origin || req.headers.referer || '';
  if (!isAllowedOrigin(origin)) {
    console.warn(`[notify-otw] Blocked: bad origin "${origin}"`);
    return res.status(200).json({ success: true });
  }
  if (honeypot) {
    console.warn(`[notify-otw] Blocked: honeypot filled ("${honeypot}")`);
    return res.status(200).json({ success: true });
  }
  if (!Number.isFinite(formStartedAt)) {
    console.warn('[notify-otw] Blocked: missing/invalid formStartedAt');
    return res.status(200).json({ success: true });
  }
  const elapsed = Date.now() - formStartedAt;
  if (elapsed < MIN_FORM_FILL_MS || elapsed > MAX_FORM_AGE_MS) {
    console.warn(`[notify-otw] Blocked: form age ${elapsed}ms out of range`);
    return res.status(200).json({ success: true });
  }

  if (!firstName) {
    return res.status(400).json({ success: false, error: 'Please enter your first name.' });
  }
  if (!lastName) {
    return res.status(400).json({ success: false, error: 'Please enter your last name.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
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
        `[notify-otw] Tag apply failed (contact ${contactId} tag ${TAG_ID}): ${message}`,
      );
      return res.status(500).json({
        success: false,
        error: 'Registration partially failed. Please contact support.',
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    await addNote(
      contactId,
      `OneTalk — Waitlist opt-in (${today})`,
      [
        'Source: onetalk.ericedmeades.com',
        'Form: Notify Me When Registration Opens',
        `Tag applied: ${TAG_ID}`,
        `Name: ${firstName} ${lastName}`,
        `Email: ${email}`,
      ].join('\n'),
    );

    return res.status(200).json({ success: true, contactId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[notify-otw]', message);
    return res.status(500).json({
      success: false,
      error: "We couldn't process your request. Please try again.",
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add api/notify-otw.js
git commit -m "feat: add /api/notify-otw waitlist endpoint (Keap tag 1948)"
```

---

## Task 2: Add `initWaitlistForm()` to `src/form.js` and wire into `src/main.js`

**Files:**
- Modify: `src/form.js` — append `initWaitlistForm` function and add to exports
- Modify: `src/main.js` — import and call `initWaitlistForm`

- [ ] **Step 1: Append `initWaitlistForm` to `src/form.js`**

The existing file ends after `swapForConfirmation`. Add the following **after** that function (at the very bottom of the file):

```js
export function initWaitlistForm() {
  const form = document.querySelector('[data-form="waitlist"]');
  if (!form) return;

  const firstInput = form.querySelector('input[name="firstName"]');
  const lastInput = form.querySelector('input[name="lastName"]');
  const emailInput = form.querySelector('input[name="email"]');
  const websiteInput = form.querySelector('input[name="website"]');
  const startedAtInput = form.querySelector('input[name="formStartedAt"]');
  const submitBtn = form.querySelector('button[type="submit"]');
  const errorEl = form.querySelector('.lead-error');

  if (!firstInput || !lastInput || !emailInput || !submitBtn) return;

  if (startedAtInput) startedAtInput.value = String(Date.now());

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
      const res = await fetch('/api/notify-otw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          website: websiteInput ? websiteInput.value : '',
          formStartedAt: startedAtInput ? startedAtInput.value : '',
        }),
      });

      let data = {};
      try { data = await res.json(); } catch (_) { /* ignore */ }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Submission failed. Please try again.');
      }

      if (typeof window.gtag === 'function') {
        window.gtag('event', 'waitlist_submit', { form: 'waitlist' });
      }
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'Lead', { content_name: 'waitlist' });
      }

      swapForWaitlistConfirmation(form);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
      showError(errorEl, err.message || 'Something went wrong. Please try again.');
    }
  });
}

function swapForWaitlistConfirmation(form) {
  const confirm = document.createElement(‘div’);
  confirm.className = ‘lead-confirm’;
  confirm.innerHTML =
    ‘<strong>You’re on the list.</strong> We’ll email you as soon as registration opens.’;
  form.replaceWith(confirm);
}
```

- [ ] **Step 2: Update `src/main.js` to import and call `initWaitlistForm`**

Replace the existing imports/boot in `src/main.js` with:

```js
import { initAnalytics } from './analytics.js';
import { wrapHeadingWords } from './word-hover.js';
import { initLeadMagnetForm } from './form.js';
import { initWaitlistForm } from './form.js';
import { initTestimonialCarousel } from './testimonials.js';
import { initAffiliateRef } from './affiliate-ref.js';

function boot() {
  wrapHeadingWords();
  initAnalytics();
  initAffiliateRef();
  initLeadMagnetForm();
  initWaitlistForm();
  initTestimonialCarousel();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
```

- [ ] **Step 3: Commit**

```bash
git add src/form.js src/main.js
git commit -m "feat: add initWaitlistForm for waitlist opt-in"
```

---

## Task 3: `index.html` — Remove dates, prices, buy buttons (head through hero + FAQ + final CTA)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Remove early-bird JS block from `<head>` (lines 7–13)**

Delete these lines entirely:
```html
<script>
  // Early-bird auto-cutoff: 2026-06-01 23:59:59 ET (= 2026-06-02 03:59:59 UTC).
  // After this, [data-eb="ended"] hides .eb-only and reveals .eb-ended-only via CSS.
  (function(){
    var deadline = Date.UTC(2026, 5, 2, 3, 59, 59);
    document.documentElement.setAttribute('data-eb', Date.now() < deadline ? 'active' : 'ended');
  })();
</script>
```

- [ ] **Step 2: Update `<meta name="description">`**

Old:
```html
<meta name="description" content="In 3 days with Eric Edmeades, build your signature talk from scratch using The Speech Map™ — and walk away ready to deliver it without notes, slides, or a script. Live online June 12–14, 2026.">
```
New:
```html
<meta name="description" content="In 3 days with Eric Edmeades, build your signature talk from scratch using The Speech Map™ — and walk away ready to deliver it without notes, slides, or a script. Live online.">
```

- [ ] **Step 3: Update OG and Twitter description meta tags**

Old (both `og:description` and `twitter:description`):
```html
<meta property="og:description" content="3 days live with Eric Edmeades. Build your signature talk using The Speech Map™ — no notes, no script. June 12–14, 2026.">
...
<meta name="twitter:description" content="3 days live with Eric Edmeades. Build your signature talk using The Speech Map™ — no notes, no script. June 12–14, 2026.">
```
New (both):
```html
<meta property="og:description" content="3 days live with Eric Edmeades. Build your signature talk using The Speech Map™ — no notes, no script.">
...
<meta name="twitter:description" content="3 days live with Eric Edmeades. Build your signature talk using The Speech Map™ — no notes, no script.">
```

- [ ] **Step 4: Remove the announcement strip**

Delete these lines entirely:
```html
<!-- Announcement strip (auto-hides after early-bird deadline) -->
<div class="announce eb-only">
  <span class="announce-full">Early-bird pricing ends <strong>June 1</strong> — then the seat goes to $1,597.</span>
  <span class="announce-short">Early-bird ends <strong>June 1</strong> · Then $1,597</span>
</div>
```

- [ ] **Step 5: Update the nav CTA**

Old:
```html
<a href="https://speakernation.com/flow/one-talk-workshop-may-2026/otw-may-2026-checkout/" class="nav-cta" data-cta="nav" rel="noopener"><span class="nav-cta-full">Reserve Seat</span><span class="nav-cta-short">Reserve</span></a>
```
New:
```html
<a href="#waitlist" class="nav-cta" data-cta="nav"><span class="nav-cta-full">Join Waitlist</span><span class="nav-cta-short">Waitlist</span></a>
```

- [ ] **Step 6: Update the hero flag**

Old:
```html
<span class="hero-flag">Live · 3 Days · June 12–14, 2026</span>
```
New:
```html
<span class="hero-flag">Live · 3 Days · Online</span>
```

- [ ] **Step 7: Replace the hero buy button and remove micro-assure**

Old:
```html
        <div>
          <a href="https://speakernation.com/flow/one-talk-workshop-may-2026/otw-may-2026-checkout/" class="btn-primary" data-cta="hero" rel="noopener">
            Reserve My Seat · $<span class="eb-only">1,297</span><span class="eb-ended-only">1,597</span>
            <span class="arrow">→</span>
          </a>
          <p class="micro-assure"><strong>100% money-back guarantee.</strong> Attend all 3 days — if you don't leave with a complete framework for your signature talk, we refund you in full.</p>
        </div>
```
New:
```html
        <div>
          <a href="#waitlist" class="btn-primary" data-cta="hero">
            Join the Waitlist
            <span class="arrow">→</span>
          </a>
        </div>
```

- [ ] **Step 8: Remove the date/time hero meta items, keep only "Cohort capped at 100"**

Old:
```html
        <div class="hero-meta">
          <div class="hero-meta-item"><span class="dot">●</span> June 12–14, 2026</div>
          <div class="hero-meta-item"><span class="dot">●</span> 10am–2pm New York time · Live Online</div>
          <div class="hero-meta-item"><span class="dot">●</span> Cohort capped at 100</div>
        </div>
```
New:
```html
        <div class="hero-meta">
          <div class="hero-meta-item"><span class="dot">●</span> Live Online</div>
          <div class="hero-meta-item"><span class="dot">●</span> Cohort capped at 100</div>
        </div>
```

- [ ] **Step 9: Update the final CTA — paragraph and button**

Old paragraph:
```html
      <p class="lead">
        The book deal, the podcast invitation, the paid speaking gig, the client — they all start with one talk. And on June 12, you can start building yours.
      </p>
```
New paragraph:
```html
      <p class="lead">
        The book deal, the podcast invitation, the paid speaking gig, the client — they all start with one talk. Join the waitlist and be first to know when registration opens.
      </p>
```

Old button:
```html
      <a href="https://speakernation.com/flow/one-talk-workshop-may-2026/otw-may-2026-checkout/" class="btn-primary btn-hero" data-cta="final_cta" rel="noopener">
        Reserve My Seat · $<span class="eb-only">1,297</span><span class="eb-ended-only">1,597</span>
        <span class="arrow">→</span>
      </a>
      <p style="margin-top: 24px; font-size: 0.82rem; opacity: 0.6; letter-spacing: 0.04em;"><span class="eb-only">Early-bird pricing ends June 1 · </span>100% money-back guarantee</p>
```
New button + footnote:
```html
      <a href="#waitlist" class="btn-primary btn-hero" data-cta="final_cta">
        Join the Waitlist
        <span class="arrow">→</span>
      </a>
      <p style="margin-top: 24px; font-size: 0.82rem; opacity: 0.6; letter-spacing: 0.04em;">Be the first to know when registration opens.</p>
```

- [ ] **Step 10: Remove the 3 price/purchase FAQ items**

Delete these three `<details>` blocks entirely:

1. The block whose `<summary>` starts with `"$`:
```html
      <details class="faq-item">
        <summary>"$<span class="eb-only">1,297</span><span class="eb-ended-only">1,597</span> is a real commitment. Is it worth it right now?"</summary>
        <div class="faq-answer">
          Fair question. Here's the math: Eric's keynote fee starts at $50,000/hour. His Speaking Academy is $15,000. The workshop is three full days of direct instruction with him for $<span class="eb-only">1,297</span><span class="eb-ended-only">1,597</span>. If the talk you leave with leads to one paid booking, one client from a stage, one podcast invitation that changes your business — the workshop has paid for itself. And if it doesn't work for you, the guarantee refunds every dollar.
        </div>
      </details>
```

2. The block whose `<summary>` is `"Is there a payment plan?"`:
```html
      <details class="faq-item">
        <summary>"Is there a payment plan?"</summary>
        <div class="faq-answer">
          Yes. At checkout you can split your investment into <span class="eb-only">2 payments of $677 (at the early-bird rate) or 2 payments of $827 (at the $1,597 rate)</span><span class="eb-ended-only">2 payments of $827</span>, due two weeks apart. Full workshop access is unlocked as soon as your first payment processes.
        </div>
      </details>
```

3. The block whose `<summary>` is `"What happens after I sign up?"`:
```html
      <details class="faq-item">
        <summary>"What happens after I sign up?"</summary>
        <div class="faq-answer">
          You'll receive a confirmation email immediately with your access details, how to prepare for Day 1, and how to join the live sessions each day.
        </div>
      </details>
```

- [ ] **Step 11: Update the two schedule-referencing FAQ answers**

**"I'm too busy" FAQ** — update only the answer paragraph that references specific times. Old answer:
```html
        <div class="faq-answer">
          The workshop runs 10am–2pm New York time for three days. Four hours a day, live. If you can't protect 12 hours for the thing that will carry your work for the next decade, the issue isn't your calendar — it's your priorities, and we understand if this isn't the right season. But if you can: it is the highest-leverage 12 hours you will spend on your career this year.
        </div>
```
New answer:
```html
        <div class="faq-answer">
          The workshop runs for approximately four hours a day, live, over three days. If you can't protect 12 hours for the thing that will carry your work for the next decade, the issue isn't your calendar — it's your priorities, and we understand if this isn't the right season. But if you can: it is the highest-leverage 12 hours you will spend on your career this year.
        </div>
```

**"What's the schedule each day?" FAQ** — update the answer. Old:
```html
        <div class="faq-answer">
          Each day runs 10am–2pm New York time. You'll have a mix of live training, group exercises, and individual practice — paced to the progress of the cohort. Plan a little extra time outside the live sessions to work on your talk.
        </div>
```
New:
```html
        <div class="faq-answer">
          Each day runs for approximately four hours. You'll have a mix of live training, group exercises, and individual practice — paced to the progress of the cohort. Plan a little extra time outside the live sessions to work on your talk.
        </div>
```

- [ ] **Step 12: Commit**

```bash
git add index.html
git commit -m "chore: remove event dates, prices, and buy buttons for postponement"
```

---

## Task 4: `index.html` — Replace offer section with waitlist form

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace the entire `<section class="offer …" id="register">` block**

Find and delete the entire offer section (from `<!-- ================= OFFER =================` through the closing `</section>`), and replace with:

```html
<!-- ================= WAITLIST ================= -->
<section class="offer sect-pad" id="waitlist">
  <div class="wrap">
    <div class="offer-inner">
      <span class="eyebrow">Stay In The Loop</span>
      <h2>Registration is opening soon.<br>Be the first to know.</h2>
      <p class="lead" style="text-align:center; max-width:520px; margin:0 auto 2rem;">
        Leave your name and email and we'll notify you the moment registration opens — including any early-bird pricing.
      </p>

      <div class="price-frame">
        <form class="lead-form" data-form="waitlist" action="/api/notify-otw" method="post" novalidate>
          <div class="lead-row">
            <div class="lead-field">
              <label for="waitlist-firstname" class="sr-only">First name</label>
              <input id="waitlist-firstname" name="firstName" type="text" required placeholder="First name" autocomplete="given-name">
            </div>
            <div class="lead-field">
              <label for="waitlist-lastname" class="sr-only">Last name</label>
              <input id="waitlist-lastname" name="lastName" type="text" required placeholder="Last name" autocomplete="family-name">
            </div>
          </div>
          <div class="lead-field lead-field-full">
            <label for="waitlist-email" class="sr-only">Email address</label>
            <input id="waitlist-email" name="email" type="email" required placeholder="your@email.com" autocomplete="email">
          </div>
          <div class="lead-hp" aria-hidden="true">
            <label for="waitlist-website">Website (leave blank)</label>
            <input id="waitlist-website" name="website" type="text" tabindex="-1" autocomplete="off">
          </div>
          <input type="hidden" name="formStartedAt" value="">
          <button type="submit" class="btn-primary lead-submit">
            Notify Me When Registration Opens
            <span class="arrow">→</span>
          </button>
          <p class="lead-error" role="alert" aria-live="polite"></p>
        </form>
        <p class="lead-micro" style="text-align:center; margin-top:1rem;">Your information is 100% secure and will never be shared with anyone.</p>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Verify in the browser**

Run the dev server:
```bash
npm run dev
```

Open `http://localhost:5173` and check:
1. No announcement strip at the top.
2. Nav says "Join Waitlist" — clicking it scrolls to the waitlist form.
3. Hero flag says "Live · 3 Days · Online" (no date).
4. Hero CTA says "Join the Waitlist →" — clicking scrolls to `#waitlist`.
5. Hero meta shows only "Live Online" and "Cohort capped at 100".
6. The offer/waitlist section (`#waitlist`) shows the opt-in form with heading "Registration is opening soon."
7. Final CTA button says "Join the Waitlist →" and scrolls to `#waitlist`.
8. FAQ no longer shows price or payment plan items.
9. Lead-magnet section (5 Steps) is unchanged at the bottom.
10. No prices (`$1,297`, `$1,597`, `$3,191`) appear anywhere on the page.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: replace offer section with waitlist opt-in form"
```

---

## Task 5: Add `KEAP_TAG_ID_WAITLIST` env variable in Vercel

**Files:** None (Vercel dashboard / CLI)

- [ ] **Step 1: Add the env var**

Run:
```bash
vercel env add KEAP_TAG_ID_WAITLIST
```
When prompted:
- Value: `1948`
- Environments: Production, Preview, Development

Or add via the Vercel dashboard: Project → Settings → Environment Variables.

- [ ] **Step 2: Redeploy to pick up the new variable**

```bash
vercel --prod
```

- [ ] **Step 3: Smoke-test the waitlist form on production**

Submit the waitlist form with a test email. Verify in Keap that the contact was created/updated and tag 1948 was applied.
