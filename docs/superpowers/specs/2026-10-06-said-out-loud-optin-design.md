# Said Out Loud — ebook opt-in funnel (design)

**Date:** 2026-10-06
**Status:** Approved in brainstorming, pending written-spec review
**Repo:** OneTalkWorkshop (onetalkworkshop.com)
**Branch / worktree:** `feature/said-out-loud` at `~/Code/OneTalkWorkshop-said-out-loud`

## 1. Goal

Give away the Speaker Nation ebook **Said Out Loud** (Eric Edmeades) in exchange for an email address. The visitor opts in, receives the book **by email only** (no instant download on the thank-you page), and downloads it from a branded page reached through a signed link.

Delivering by email is deliberate: it confirms the address is real and gets people who land in spam to rescue the message and whitelist `support@speakernation.com`, which helps every later Speaker Nation email.

**Hosting:** speakernation.com is being rebuilt and is not live, so the funnel lives on onetalkworkshop.com (a Speaker Nation property).

### Success criteria

- A visitor can go opt-in → email → download in under two minutes on desktop and mobile.
- Every opt-in ends up in Keap with the Said Out Loud tag and a note, even when Keap is throttled at submit time.
- The delivery email comes from and replies to `support@speakernation.com`.
- No existing OneTalkWorkshop page changes visually or behaviorally.

## 2. Decisions (locked)

| Topic | Decision |
|---|---|
| Host | New pages inside the OneTalkWorkshop repo (option A) |
| Design system | **C**: the Claude Design "Speaker Nation Design System" bundle in `~/Code/355-SN.SpeakingAcademyLandingPage/Speaker Nation Design System/` (ink `#141824`, amber `#E9A13B`, Anton / Manrope / Inter / JetBrains Mono, pill buttons, 8px spacing unit) |
| Delivery | Resend sends the delivery email. Keap stores contact + tag + note only; Keap does **not** send the delivery email |
| Access | Email-only delivery via a signed link (30-day expiry). Thank-you page does not offer the file |
| From / Reply-To | `Speaker Nation <support@speakernation.com>` / `support@speakernation.com` |
| Form fields | First name (required), email (required), "What do you do, or what might you speak about?" (optional) |
| Optional field storage | Keap contact note (no custom field) |
| PDF storage | Vercel Blob, uploaded once by script; not committed to git |

## 3. Architecture

### 3.1 Pages (new Vite entrypoints)

All three pages load a new scoped stylesheet `src/said-out-loud.css` carrying design system C tokens (copied from the bundle's `tokens/*.css`, prefixed `--site-*` as in the bundle). They do **not** load `src/styles.css`, so existing OTW pages are untouched.

| Path | File | Purpose |
|---|---|---|
| `/said-out-loud` | `said-out-loud.html` + `src/sol-optin.js` | Opt-in page, cover image, Eric's copy, form |
| `/said-out-loud/thanks` | `said-out-loud/thanks.html` + `src/sol-thanks.js` | "Check your inbox", spam-rescue help, **Send it again** |
| `/said-out-loud/download` | `said-out-loud/download.html` + `src/sol-download.js` | Download button (valid link) or "get a fresh link" form (expired / invalid) |

`vite.config.js` gains the three inputs. Exact file layout follows whatever Vite + `cleanUrls` produces to serve those paths. The plan verifies this against `npm run build` output.

Cover image: page 1 of the PDF rendered to WebP/PNG at build-asset time (one-off script), with explicit width/height, `fetchpriority="high"`.

Analytics: reuse `src/analytics.js`. Events: `sol_optin` (+ Meta `Lead`) on successful submit, `sol_resend` on resend, `sol_download` on download click.

### 3.2 Functions (`api/`)

**`api/sol-optin.js`** — `POST {firstName, email, speakAbout?, website, formStartedAt}`
1. Anti-spam gates identical to `subscribe-otw.js` (origin allow-list, honeypot `website`, `formStartedAt` between 3s and 24h). Rejections return a **silent `200 {success:true}`**.
2. Validate (`lib/sol-validate.js`). Invalid → `400` with a user-safe message.
3. Sign a download token (`lib/sol-token.js`) and **send the delivery email via Resend**. Resend failure → `502`, the form shows "Something went wrong on our side. Try again in a minute."
4. Keap: find-or-create contact, apply `KEAP_TAG_ID_SAID_OUT_LOUD`, add note (title "Said Out Loud opt-in", body = speak-about answer + source + ref). Any Keap failure (throttle, timeout, tag error in a 200 body) → write a pending record (`lib/sol-pending.js`) to Blob, `console.error` with context, still return `200`. The visitor has the book; the CRM catches up.
5. Record the send in the rate-limit store (counts toward resend limits).

**`api/sol-resend.js`** — `POST {email}` (used by the thank-you page and the expired-link form)
- Same origin gate. Rate limit per email hash: **1 per minute, 3 per 24h** (`lib/sol-ratelimit.js`, state in Blob `sol/rate/<hash>.json`). Over limit → `429` with a friendly message.
- Sends only to emails that previously opted in (an `sol/optins/<hash>.json` marker, holding `{firstName, createdAt}`, is written by `sol-optin`). Unknown email → silent `200` so the endpoint can't be used to probe or to mail strangers. It does **not** create Keap records.
- The thank-you page gets the email from `sessionStorage`, set by the opt-in page on success.

**`api/sol-download.js`** — `GET ?t=<token>`
- Valid token → `302` to a **presigned Blob URL** for the private PDF (`issueSignedToken` + `presignUrl`, valid 5 minutes). Pathname `said-out-loud/Said-Out-Loud-Eric-Edmeades.pdf`.
- Invalid / expired → `302` to `/said-out-loud/download?expired=1`.
- Redirect instead of streaming because Vercel Function responses cap at ~4.5 MB and the PDF is 18.6 MB. The project's Blob store is private (store-level access), so the PDF stays private too. Leakage trade-off accepted: a forwarded email link works until it expires (30 days); the presigned URL itself dies after 5 minutes.

The download page's button points at `/api/sol-download?t=…`. The emailed link points at the download page (`/said-out-loud/download?t=…`), so the visitor lands on a branded page first.

**`api/sol-sync-keap.js`** — Vercel Cron `*/10 * * * *`, `Authorization: Bearer CRON_SECRET`, fails closed if unset (same as `refresh-keap.js`)
- Drains `sol/pending/*` oldest-first, paced (sequential, small gap between contacts, stop after ~75s, `maxDuration: 120`), deletes each record on success, increments `attempts` on failure. After 20 attempts the record moves to `sol/dead/` and logs an error.
- A throttled run returns `200 {ok:false, reason}`, not 500.

### 3.3 Libraries (`lib/`)

| Module | Responsibility |
|---|---|
| `keap-contact.js` | **Extracted** from `api/subscribe-otw.js`: `findContactByEmail`, `createContact`, `updateContact`, `applyTag` (inspects body for per-tag errors), `addNote`. Built on the existing `keapFetch` in `lib/keap-api.js` (12s `AbortSignal.timeout`, typed `KeapThrottleError` / `KeapTimeoutError`, no in-request retry) if its interface fits; otherwise same timeout semantics. `subscribe-otw.js` and `sol-optin.js` import it; stage-fright behavior and responses unchanged |
| `sol-token.js` | `signToken({email, exp}, secret)` / `verifyToken(token, secret, now)`. Payload base64url JSON + HMAC-SHA256, constant-time compare, rejects malformed / expired / tampered |
| `sol-validate.js` | Trim, required checks, email format, length caps (name 100, speakAbout 500) |
| `sol-ratelimit.js` | Pure decision `check(history, now) → {allowed, retryAfter}` plus Blob read/write wrapper |
| `sol-pending.js` | Pending-record shape, `parse` with version check, retry bookkeeping |
| `sol-email.js` | Builds subject / HTML / text for the delivery email from `{firstName, link}`; escapes first name |
| `sol-resend-client.js` | Thin Resend send wrapper (from, reply-to, timeout), raises on non-2xx |

Keys in Blob use a one-way hash of the lower-cased email (reuse `lib/email-hash.js`), so no plain emails sit in Blob paths. Pending records do contain the email and name (needed to write Keap); all `sol/*` blobs are `access: 'private'`.

Pending record shape (synthetic example):

```json
{
  "version": 1,
  "email": "jane@example.com",
  "firstName": "Jane",
  "speakAbout": "Leadership talks for nurses",
  "ref": null,
  "createdAt": "2026-10-06T14:03:00.000Z",
  "attempts": 0,
  "lastError": null
}
```

### 3.4 Environment variables

| Var | Notes |
|---|---|
| `RESEND_API_KEY` | From the speakernation project's Resend account (speakernation.com domain) |
| `SOL_LINK_SECRET` | New, 32+ random bytes |
| `SOL_PUBLIC_BASE_URL` | Optional override for links in the email. Default: `https://onetalkworkshop.com` in production, `https://$VERCEL_BRANCH_URL` on previews, `http://localhost:3000` locally |
| `KEAP_TAG_ID_SAID_OUT_LOUD` | Eric creates tag "Said Out Loud – ebook" in Keap |
| `KEAP_API_KEY`, `CRON_SECRET`, Blob credentials | Already present. Blob may be `BLOB_STORE_ID` + OIDC **or** `BLOB_READ_WRITE_TOKEN`; reuse `isBlobConfigured()` from `lib/keap-store.js`, which accepts both |

`.env.example` documents all of them. Endpoints fail with a logged config error (not a silent success) if a required var is missing.

### 3.5 PDF handling

- Source: `OneTalkWorkshop/SaidOutLoud/Book.SaidOutLoud.EricEdmeades` (PDF 1.4, 18.6 MB, no extension). Add `SaidOutLoud/` to `.gitignore`.
- `scripts/upload-sol-pdf.mjs <path>`: uploads to Blob as `said-out-loud/Said-Out-Loud-Eric-Edmeades.pdf` with `access: 'private'`, `addRandomSuffix: false`, `allowOverwrite: true`, `contentType: application/pdf`. The pathname is a constant in `lib/sol-pdf.js`, so no env var. Re-run to replace the book later.
- The opt-in endpoint applies the same per-email rate limit before sending, so the form can't be used to flood someone's inbox; a rate-limited opt-in returns a silent success and skips Keap.
- Optional later: compressed export (3–6 MB) for mobile. Not blocking.

## 4. Copy

### 4.1 Opt-in page (Eric's copy, verbatim)

**Headline:** Your Audience Can Hear the AI in Your Script

**Subheadline:** Said Out Loud is a free field guide to the rhetorical devices that move a room, and to the patterns that quietly give you away.

**Opening:**
I recently watched a speaker open his talk with "the velvet hush before dawn" and "the cathedral of your heart," then say "believe" four times in a row. Part of the room loved it. Part of the room rolled its eyes.

Even the people who loved it didn't buy his book. They didn't come back to see him again. It was like a tanning salon: it looks a bit like sun, but you didn't get any.

AI writing tools have filled the world with scripts that use the same handful of rhetorical moves at the same steady rate. Audiences have learned to spot them, often without knowing why. And speakers who lean on those scripts are starting to sound like them, even when they're talking off the cuff.

The fix isn't to stop using rhetoric. The great speeches of history are full of it. The fix is to know the tools well enough to use them on purpose.

**What's inside** — In Said Out Loud, you'll get:
- **The working toolkit.** The fifty or so devices that do nearly all the work in modern speaking, in six families, with examples you can use in your next talk.
- **The dosage.** How much of each device a page or a stage can take, and where to spend it. Most rhetoric books never tell you this.
- **The AI tells.** The ten patterns audiences now flag on sight, with the human version of each.
- **A line-by-line teardown.** The "cathedral of your heart" opening, taken apart device by device, so you can hear what went wrong.
- **The colour audit.** A ten-minute exercise that shows at a glance whether your writing spends its devices well or feels performed all the way through.
- **A one-page cheat sheet** to keep beside your desk when you write and rehearse.

**Who it's for:** This book is for anyone who speaks for a living, or wants to: keynote speakers, coaches, leaders, trainers, and anyone who's ever read a script back and thought, "That doesn't sound like me."

**Hook above form:** The whole book is written by its own rules. If you catch me breaking one, tell me.

**Button:** Send Me the Book

**Under button:** Free. Delivered to your inbox. No spam, ever.

**Author bio:** Eric Edmeades is an international speaker, entrepreneur and the founder of Speaker Nation. He created the Speech Map™ method, which replaces scripts with a visual map of your talk so the words arrive in your own voice. He is the author of The Evolution Gap and The WildFit Way.

### 4.2 Form

Labels: **First name** · **Email** · **What do you do, or what might you speak about?** *(optional)*

Errors: "We need a valid email to send the book." / "Something went wrong on our side. Try again in a minute."

### 4.3 Thank-you page

> **Check your inbox.**
> *Said Out Loud* is on its way from **support@speakernation.com**. It usually arrives within a minute.
>
> **Can't find it?** Look in Spam or Promotions. If it landed there, drag it into your inbox and add support@speakernation.com to your contacts, so the next one arrives where you'll see it.
>
> Still nothing after five minutes? **[Send it again]**

Resend states: sent → "Sent again. Give it a minute." · rate-limited → "We've just sent it. Try again in a minute." · daily cap → "We've sent it a few times now. Write to support@speakernation.com and we'll sort it out." · no stored email → button hidden, show the support address.

### 4.4 Delivery email

- **From:** Speaker Nation <support@speakernation.com> · **Reply-To:** support@speakernation.com
- **Subject:** Your copy of Said Out Loud
- **Preview text:** The field guide is inside. One link, no strings.

> Hi {first name},
>
> Here's your copy of *Said Out Loud*.
>
> **[Download the book]**
>
> Start with the AI tells chapter. Then read one of your own scripts out loud and see how many you catch.
>
> The whole book follows its own rules. If you catch me breaking one, reply and tell me.
>
> Eric
>
> *This link is yours for 30 days. After that, visit onetalkworkshop.com/said-out-loud for a fresh one.*

HTML email: plain, single column, design-system ink/amber, button as a bulletproof table link, plus a full plain-text part. No attachments.

### 4.5 Download page

Valid link:
> **Said Out Loud is yours.**
> **[Download the PDF]**
> Keep the one-page cheat sheet at the back of the book near your desk.

Expired / invalid (`?expired=1`, or no `t` param):
> This link has expired. Enter your email and we'll send a fresh one.
> [email] **[Send a fresh link]**

## 5. Error handling summary

| Failure | Visitor sees | System does |
|---|---|---|
| Spam gate trips | Normal success | Nothing sent, nothing stored |
| Invalid input | Inline field error | `400` |
| Missing env var | "Something went wrong…" | `500`, `console.error` naming the var |
| Resend fails | "Something went wrong… try again" | `502`, logged |
| Keap fails / throttled | Normal success | Pending record in Blob, cron retries, logged |
| Pending record fails 20× | — | Moved to `sol/dead/`, error logged |
| Resend rate limit | Friendly retry message | `429` |
| Expired / bad token | Fresh-link form | `302` to expired state |

No error path is silently swallowed: every non-success branch either reaches the visitor or is logged with context.

## 6. Testing

TDD: tests written before each module.

- **Unit (vitest):** `sol-token`, `sol-validate`, `sol-ratelimit`, `sol-pending`, `sol-email` (escaping, link present, text part), `keap-contact` (pinned against current `subscribe-otw.js` behavior **before** extraction, including tag-error-in-200).
- **Endpoint tests:** handlers called with mocked `fetch` (Resend, Keap) and mocked Blob. Cover spam gates → silent 200, Resend failure → 502, Keap failure → 200 + pending written, resend to unknown email → silent 200, rate limits, token redirect paths, cron auth fail-closed.
- **Coverage:** ≥80% on new `lib/` and `api/sol-*` code.
- **Real browser on the Vercel preview:** full loop with a real inbox (from/reply-to verified), expired link, resend + limit, 320/768/1024/1440 widths, keyboard-only form, amber CTA contrast, no console errors. Review Mode on the preview for Eric's markup.
- **Regression:** existing `npm test` suite green; stage-fright opt-in on `/` still works on the preview.

## 7. Launch checklist

1. Eric creates Keap tag "Said Out Loud – ebook" and sends the ID.
2. Confirm speakernation.com is verified in Resend; get `RESEND_API_KEY`.
3. Run `scripts/upload-sol-pdf.mjs` against the production Blob store.
4. Set `SOL_LINK_SECRET`, `KEAP_TAG_ID_SAID_OUT_LOUD`, `RESEND_API_KEY` in Vercel (Preview + Production).
5. Preview QA (section 6) + Eric's review.
6. Merge `feature/said-out-loud` → `main` → live at `onetalkworkshop.com/said-out-loud`.

Also update `CLAUDE.md` (architecture section: new entrypoints, `sol-*` endpoints, the second cron, Resend now in the stack) and `.env.example`.

## 8. Out of scope

- Keap nurture sequence (Eric builds it off the tag).
- Compressed PDF export.
- A speakernation.com version of the funnel.
- Changes to existing OTW pages or the stage-fright lead magnet beyond the helper extraction.
