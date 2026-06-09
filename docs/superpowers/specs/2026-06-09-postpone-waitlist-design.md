# OneTalkWorkshop — Postponement / Waitlist Mode

**Date:** 2026-06-09
**Status:** Approved

## Context

The June 12–14 event is postponed. New date is TBD. The page must stop selling and instead collect waitlist opt-ins (name + email) so people can be notified when registration reopens.

Everything being removed is preserved in memory (`onetalk-removed-sections`) for easy restoration.

---

## What Changes

### 1. `index.html`

**`<head>`**
- Remove the early-bird auto-cutoff `<script>` block entirely.
- Strip "June 12–14, 2026" and "Live online June 12–14, 2026" from `<meta name="description">`, `<meta property="og:description">`, and `<meta name="twitter:description">`.
- Title and `<h1>` are date-agnostic — no change needed.

**Announcement strip** → remove entirely.

**Nav CTA**
- Text: "Reserve Seat" / "Reserve" → "Join Waitlist"
- `href`: checkout URL → `#waitlist`
- Remove `rel="noopener"` (no longer an external link)

**Hero section**
- Flag `<span class="hero-flag">`: "Live · 3 Days · June 12–14, 2026" → "Live · 3 Days · Online"
- Buy button → `<a href="#waitlist" class="btn-primary" data-cta="hero">Join the Waitlist <span class="arrow">→</span></a>`
- Remove `<p class="micro-assure">` (money-back guarantee — not relevant without purchase)
- Remove the two `.hero-meta-item` rows for "June 12–14" and "10am–2pm New York time"; keep only "Cohort capped at 100"

**Offer section (`#register`)** → replaced wholesale with:
```
<section class="offer sect-pad" id="waitlist">
  heading + subtext + waitlist form
</section>
```
Form: first name, last name, email (same structure as lead-magnet form). `action="/api/notify-otw"`, `data-form="waitlist"`. Same honeypot + `formStartedAt` anti-spam fields.

**Final CTA section**
- Remove paragraph containing "And on June 12, you can start building yours." Replace with a date-neutral version.
- Replace price button with `<a href="#waitlist" class="btn-primary btn-hero" data-cta="final_cta">Join the Waitlist <span class="arrow">→</span></a>`
- Replace the footnote `<p>` with: `<p style="margin-top: 24px; font-size: 0.82rem; opacity: 0.6; letter-spacing: 0.04em;">Be the first to know when registration opens.</p>`

**FAQ** — remove three items:
- "$1,297 is a real commitment…"
- "Is there a payment plan?"
- "What happens after I sign up?" (purchase-specific)

Update one item:
- "I'm too busy. Can I really commit to 3 days live?" → remove "10am–2pm New York time" reference from the answer, make time-agnostic.
- "What's the schedule each day?" → remove specific times; replace with "Each day runs for approximately 4 hours. You'll have a mix of live training, group exercises, and individual practice."

---

### 2. `api/notify-otw.js` (new file)

Clone of `api/subscribe-otw.js` with:
- `TAG_ID = Number(process.env.KEAP_TAG_ID_WAITLIST || 1948)`
- `opt_in_reason`: "One Talk Workshop landing page — waitlist opt-in"
- Note title: `OneTalk — Waitlist opt-in (${today})`
- Note form field: "Form: Notify Me When Registration Opens"
- Console prefix: `[notify-otw]`

---

### 3. `src/form.js`

Add `initWaitlistForm()` — same structure as `initLeadMagnetForm()` but:
- Selector: `[data-form="waitlist"]`
- Endpoint: `/api/notify-otw`
- Success message: `<strong>You're on the list.</strong> We'll email you as soon as registration opens.`
- GA4 event: `waitlist_submit`
- Meta Pixel: `Lead` with `content_name: 'waitlist'`

Export `initWaitlistForm`.

---

### 4. `src/main.js`

Import and call `initWaitlistForm()` in `boot()`.

---

## What Does NOT Change

- Hero copy, villain, big idea, future, Eric bio, days/workshop, testimonials, guarantee sections — untouched.
- Lead-magnet form (5 Steps to Overcoming Stage Fright) — untouched.
- All CSS classes and styles — no new styles needed; the waitlist form reuses `.lead-form` / `.lead-field` classes.
- FAQ items that are not date/price-specific.

---

## Keap

- New tag: `KEAP_TAG_ID_WAITLIST = 1948`
- Must be added as a Vercel env variable before going live.
- The new endpoint gracefully falls back to `1948` if the env var is missing (same pattern as subscribe-otw).
