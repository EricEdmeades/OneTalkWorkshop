# HANDOFF — /results Keap channel is 429-throttled in production

**Date:** 2026-08-11 · **Status:** UNRESOLVED (feature works except the Keap channel)

## One-paragraph summary

The two-channel `/results` feature (Stripe + Keap) is built, merged to `main`, and
deployed. The **Stripe (web) channel works**. The **Keap channel is down in
production** because every Keap call from prod gets **HTTP 429**. The report
degrades gracefully (shows the web channel + a banner, roster "—"). The code is
now correct and gentle. The blocker is external: **the Keap API key prod uses is
pinned at its per-minute rate limit by something other than this report.**

## What is DEFINITIVELY known (from prod logs + curl)

- Prod runs with the **intended key** — logged fingerprint `sha256(key)[:12] =
  e62560002f28`, keylen 57, which **matches** the key the user tested. So the
  Vercel `KEAP_API_KEY` env value is correct. Not an env/scope problem.
- Keap limits (from `x-keap-*` response headers) are **per-key (product)** 240/min
  + 30k/day, and **per-account (tenant)** 10,417/min + 250k/day.
- On every prod 429: `x-keap-product-throttle-used: 240/240` (this key maxed),
  while `x-keap-tenant-throttle-used: ~241/10417` (account nearly idle). So
  **~all account traffic is on THIS key**, and this key alone is at 240/min.
- The user curled the **same** key from their machine and got **200, used 1/240**
  (idle). So the key oscillates: idle when they curl, maxed when prod runs.
- The user loads `/results` **once every 10–15 min** and all tabs are closed — so
  the user's own loads are NOT the 240/min source.

## The open question

**What is consuming key `e62560002f28` at ~240 requests/minute?** It is not the
OTW report's user-driven loads (rare) and not the current report code (now makes
~1 call per load, no retry). Candidates to investigate NEXT session:

1. **The key is not truly dedicated** — some OTHER Speaker Nation app / Vercel
   project / Keap integration is configured with this same key value and hammers
   it. Audit where this exact key is used (Keap → the integration/app that owns
   it; other Vercel projects' `KEAP_API_KEY`). Fix: issue a key used ONLY by
   `onetalk-landing`.
2. **A Keap-side automation / WooCommerce→Keap sync / cron** using this key.
3. Confirm no OLD `onetalk-landing` deployment (with the earlier retry code) is
   still receiving traffic (prod alias should point only to newest — verify).

## Recommended robust fix regardless of the above

Make the report **not depend on hitting Keap live per request**: fetch the Keap
data on a **schedule / background** and persist it in a **durable, cross-instance
store** (Airtable is already used here for the survey; or Vercel KV/Edge Config).
Then `/results` reads the persisted snapshot and only refreshes it occasionally —
so a single successful fetch (grabbed whenever the key has a free slot) serves all
requests for a long time, and the report never races the 240/min limit. This
sidesteps "who is hammering the key" entirely.

## State of the code (all on `main`, deployed)

`/results` is two-channel: headcount from Keap Aug/Sep tags (2008/1825), revenue =
Stripe Checkout net + Keap order net. Keap orders fetched via server-side filter
`GET /orders?product_id=49` (one page). `api/results.js` `loadKeap()` has a 30-min
cache, serve-stale, and 60s failure backoff; `keapFetch()` does NOT retry 429s.

**Cleanup owed:** `keapFetch()` in `api/results.js` still has TEMPORARY diagnostic
logging — it logs the 429 rate-limit headers AND a one-way key fingerprint
(`keyfp`) + key length. Remove that once the throttling is resolved.

## Verified numbers (for when Keap comes back / to reconcile the sheet)

- Keap roster (headcount): **Aug tag 2008 = 211, Sep tag 1825 = 130/131** (≈342).
- Keap OTW orders (product 49), current cohort by tag: ~**7 Aug ($6,882 gross) +
  11 Sep ($8,179 gross)**; net = `total + refund_total` (refund_total is negative).
- Stripe web channel (net of refunds): **$7,442 collected / $9,096 contracted**.
- Original ask: reconcile combined vs the admin sheet (Aug $7,839 / Sep $9,776).
  The admin sheet is Keap-tag-derived and internally inconsistent; `/results` is
  intended to be the source of truth, not to match the sheet exactly.

## How to observe prod without touching Keap

Vercel MCP (project `prj_3TISES2wjyVLaHooZgrQZdqb9Pvi`, team
`team_gTIDxZoMuLWEumXxWbs0NqZv`): `get_runtime_logs` on the newest READY
production deployment, query `Keap`. A `[results] Keap 429 keyfp …` line = still
throttled and shows the headers + which key. Absence of any `[results]` error
line on a real `200 [error/serverless]` `/results` load = success. Do NOT call the
Keap API directly while diagnosing (adds to the very throttle we're chasing);
read logs instead. A working Keap key sits in local `.env.local` for read-only
checks if truly needed — use sparingly and pace calls.
