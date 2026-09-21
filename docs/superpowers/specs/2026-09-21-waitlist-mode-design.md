# OneTalkWorkshop — Waitlist Mode

**Date:** 2026-09-21
**Status:** Approved (pending spec review)

## Context

Both confirmed 2026 cohorts have now run: **August 7–9** and **September 18–20**
(today is 2026-09-21). No new date is announced yet. The page must stop selling and
instead collect **waitlist opt-ins** (first name + last name + email + explicit
consent) so people can be notified when registration reopens.

Registration currently runs through `register.html` → Stripe Checkout →
`api/stripe-webhook.js` (Keap tag per date). This is a **full switch to waitlist
mode**: every "Reserve / Register" CTA becomes "Join the Waitlist," the dates block
becomes a waitlist form, and `register.html` is redirected away.

### Payment plans still in flight — do not disturb

Some 2-pay ("plan") subscriptions are **still actively billing** their second
installment in Stripe, even though the events are past. Those charges are driven
entirely by Stripe against Subscription objects that already exist; the website
never drives recurring charges (`api/create-checkout.js` only *creates new*
checkouts, and `api/stripe-webhook.js` only listens for
`checkout.session.completed`, which already fired for those customers). Their
`cancel_at` is already set to end them after installment 2.

**Therefore this change deletes nothing Stripe-side.** `api/create-checkout.js`,
`api/stripe-webhook.js`, the Stripe env vars, and the registered Stripe webhook
endpoint all stay exactly as they are. We only remove the *links* to checkout and
add an edge redirect so no one can start a *new* purchase of a past event. Existing
subscriptions keep billing on schedule, and `/results` still reports everything.

---

## What Changes

### 1. `index.html`

**`<head>`** — no change. The title, `<h1>`, and all meta descriptions are already
date-agnostic (no dates to strip).

**Nav CTA** (`:45`)
- Text: "Register Now" / "Register" → "Join the Waitlist" / "Waitlist"
- `href`: `/register.html` → `#waitlist`

**Hero** (`:64–70`)
- Button: "Reserve My Seat" → "Join the Waitlist", `href` `/register.html` → `#waitlist`
- Remove the `<p class="micro-assure">` money-back line (nothing is purchased here).

**Hero meta** (`:72–83`)
- Remove the two `data-date` bullets (Aug 7–9, Sep 18–20).
- Keep "10am–2pm Eastern each day" and "Live online — join from anywhere".
- (`date-cards.js` already prunes finished date bullets at runtime; removing them
  from the markup makes the intent explicit and avoids a flash.)

**Dates section** (`:516–545`) — replace the whole `#dates` "Choose Your Date" block
with a `#waitlist` section:

```html
<section class="offer sect-pad" id="waitlist">
  <div class="wrap">
    <div class="offer-inner">
      <span class="eyebrow">The Next Cohort</span>
      <h2>New dates are coming. Be first in line.</h2>
      <p class="lead">Registration for the next One Talk Workshop isn't open yet.
        Join the waitlist and we'll email you the moment it is — before it goes public.</p>
    </div>
    <form class="lead-form" data-form="waitlist" action="/api/waitlist-otw" method="post" novalidate>
      <!-- first name + last name row (reuses .lead-row / .lead-field) -->
      <!-- email (full-width .lead-field-full) -->
      <!-- consent checkbox (required, unticked) -->
      <!-- honeypot (.lead-hp, name="website") -->
      <!-- hidden formStartedAt -->
      <!-- submit: "Join the Waitlist →" -->
      <!-- .lead-error -->
    </form>
    <p class="lead-micro" style="text-align:center;">We'll only email you about
      registration. Unsubscribe anytime.</p>
  </div>
</section>
```

The consent field (new — see §Consent below):

```html
<label class="lead-consent">
  <input type="checkbox" name="consent" value="yes" required>
  <span>Yes, email me when registration opens and about The One Talk Workshop.
    I can unsubscribe at any time.</span>
</label>
```

Reuses existing `.offer`, `.lead-form`, `.lead-field`, `.lead-row`, `.lead-hp`
styles. One small style addition for `.lead-consent` (checkbox + label row).

**FAQ** (`:568–663`) — remove the three purchase-specific items:
- "$1,297 is a real commitment. Is it worth it right now?" (`:590`)
- "Is there a payment plan?" (`:597`)
- "What happens after I sign up?" (`:604`)

And neutralize one line: in "Where will this event be hosted?" (`:633`), change
"You'll get access details after you register." → "You'll get access details after
you join." All other FAQ items stay (times/schedule copy is format info, not a sale).

**Lead-magnet section** (`:665–701`) — form unchanged. Only retitle the eyebrow
"Not Ready To Register Today?" → "Want To Get Started Now?" so it still reads
sensibly with no registration open.

**Final CTA** (`:703–719`)
- Kicker: "Limited availability" → "Doors reopen soon"
- Paragraph (`:709–711`): replace the two-dates line with a date-neutral version,
  e.g. "The book deal, the podcast invitation, the paid speaking gig, the client —
  they all start with one talk. New dates are coming; join the waitlist to be first
  to know when registration opens."
- Button: "Reserve My Seat" `/register.html` → "Join the Waitlist" `#waitlist`
- Footnote (`:716`): "100% money-back guarantee" → "Be the first to know when
  registration opens."

### 2. `api/waitlist-otw.js` (new)

A near-exact clone of `api/subscribe-otw.js`, sharing its structure and safety
properties verbatim:
- Same allowed-origin list, honeypot, and `formStartedAt` (3s–24h) anti-spam gates,
  each returning a **silent `200 {success:true}`** so bots can't distinguish a block.
- Same find-or-create-or-PATCH contact flow.
- Same **tag-apply-failure = hard `500`** rule (`applyTag` inspects the response
  body, not just `res.ok`, because Keap returns 200 with a per-tag error).
- Same note-add-is-best-effort behavior.

Differences:
- `const TAG_ID = 1948;` — **hardwired**, no env var (per decision).
- **Consent is required.** After the anti-spam gates and before the Keap calls,
  validate `body.consent`. Missing/false → real `400`
  `{ success:false, error:'Please confirm you'd like to receive emails.' }`
  (a genuine validation error the user sees — NOT a silent-spam 200).
- `opt_in_reason`: `'One Talk Workshop landing page — waitlist opt-in (explicit consent)'`
- Note: title `OneTalk — Waitlist opt-in (${today})`, body includes
  `Form: Join the Waitlist`, `Tag applied: 1948`, and a
  `Consent: yes — checkbox, ${new Date().toISOString()}` line.
- Console prefix: `[waitlist-otw]`

Endpoint path: `/api/waitlist-otw`.

### 3. `src/form.js` — refactor to a shared binder

Extract the current submit logic into:

```js
function bindOptInForm(form, { endpoint, gaEvent, metaName, confirmHTML, requireConsent })
```

- `initLeadMagnetForm()` calls it with the current values (`/api/subscribe-otw`,
  `lead_magnet_submit`, `stage_fright`, the existing confirm copy,
  `requireConsent: false`) — **behavior unchanged**.
- New `initWaitlistForm()` calls it with `/api/waitlist-otw`, `waitlist_submit`,
  `waitlist`, confirm copy "**You're on the list.** We'll email you the moment
  registration reopens.", `requireConsent: true`.

Consent handling in the binder:
- Read an optional `input[name="consent"]` checkbox.
- When `requireConsent` and the box is unchecked → show the inline error, focus the
  checkbox, and do not submit.
- Include `consent: consentInput?.checked ? 'yes' : ''` in the POST body when a
  consent input is present.

Export `initWaitlistForm`.

### 4. `src/main.js`

Import `initWaitlistForm` and call it in `boot()` alongside `initLeadMagnetForm()`.

### 5. `src/styles.css`

Add a small `.lead-consent` rule: a flex row aligning the checkbox with its label
text, sized/coloured to match the existing `.lead-*` form styling. No other CSS.

### 6. `vercel.json` — registration-closed redirect

Add a `redirects` array so bookmarked checkout URLs bounce to the waitlist:

```json
"redirects": [
  { "source": "/register",      "destination": "/#waitlist", "permanent": false },
  { "source": "/register.html", "destination": "/#waitlist", "permanent": false }
]
```

`permanent: false` (302) because registration will return with the next cohort.
Redirects run before rewrites/filesystem, so `register.html` (still built into
`dist/`) is simply never served. This is purely edge routing — it touches no Stripe
object and no existing subscription.

---

## What Does NOT Change

- `register.html`, `src/register.js`, `api/create-checkout.js`,
  `api/stripe-webhook.js`, `api/seats.js`, `lib/pricing.js`, `lib/seats.js` — dormant,
  just unlinked/redirected. No Stripe object, price, webhook, or env var is touched.
- `/results` report and the entire Keap-snapshot pipeline (`api/refresh-keap.js`,
  `lib/keap-*.js`) — untouched.
- The 5-Steps lead-magnet form and endpoint (`api/subscribe-otw.js`) — untouched
  (no consent checkbox added there; that would be a separate change).
- `date-cards.js` stays imported by `main.js`; with no `.day-card[data-date]` or
  hero date bullets left on the page, `initDateCards()` no-ops harmlessly.
- Testimonials, hero copy, villain, big idea, future, Eric bio, days, proof,
  guarantee sections — untouched.

## Consent (compliance note)

The waitlist tag `1948` triggers a Keap automation that emails people, so the opt-in
must be explicit. We capture it three ways: (1) a **required, unticked-by-default**
consent checkbox in the form, (2) server-side rejection of any submission without
`consent`, and (3) a durable record — the consent text in `opt_in_reason` plus a
timestamped `Consent: yes` line in the contact's Keap timeline note. This mirrors how
`subscribe-otw.js` already relies on `opt_in_reason` to mark the contact opted-in;
the checkbox makes the consent explicit and auditable.

## Keap

- Waitlist tag: **1948** (hardwired in `api/waitlist-otw.js`).
- No new env var. No change to `KEAP_API_KEY` or any Keap config.

## Testing / Verification

- `npm test` (pricing + results unit tests) is unaffected and must still pass.
- `npm run build` must succeed with the new `waitlist-otw` binding.
- Manual: `vercel dev` to exercise `/api/waitlist-otw` (valid submit tags 1948;
  missing consent → 400; honeypot/short-fill → silent 200), and confirm
  `/register` and `/register.html` 302 to `/#waitlist`.
- `/api/*` endpoints have no automated tests by project convention — verified
  manually, same as `subscribe-otw`.

## Deployment

`main` → production, any other branch → preview. Recommend implementing on a feature
branch, eyeballing the Vercel **preview** deploy (waitlist submit + redirect), then
merging to `main`.
