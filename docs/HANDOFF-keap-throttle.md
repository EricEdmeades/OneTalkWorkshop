# /results Keap throttling — diagnosis and resolution

**Opened:** 2026-08-11 · **Status: RESOLVED and verified in production 2026-08-11 18:50 UTC**

```
[refresh-keap] aug tag 2008: 211 contacts (800ms)
[refresh-keap] sep tag 1825: 133 contacts (1498ms)
[refresh-keap] orders: 18 in cohort (1873ms)
[refresh-keap] stored snapshot (cron): aug=211 sep=133 orders=18 attempt=1/4
```

First attempt, 1.9 seconds. Aug 211 and 18 orders match the independently
verified figures below exactly.

**The headline lesson: the throttling was real but it was NOT what broke this.**
The report was broken by an unbounded pagination loop (see "the actual bug"
below). Keap answers in under a second. Four bugs were stacked, each hiding the
next — no request timeout, cron starved by page views, silent early returns, and
finally the non-terminating walk that was doing the real damage all along.

## What was actually wrong

Not an env problem, not a key problem, and not something this project could fix by
being more polite.

**Keap's 240-requests-per-minute "product" throttle is an account-wide bucket shared
by every integration on the Keap account. It is not per-key.**

The proof: a **brand-new key created for this project alone** (fingerprint
`e62560002f28`, keylen 57), making roughly **one request every five minutes**, still
came back with `x-keap-product-throttle-used: 240/240`. A key making one request per
five minutes cannot fill its own 240/min bucket. The tenant counter sat at `241` at
the same instant — essentially all account API traffic lives in that one bucket.

**Why it looked like the key "oscillated".** The 429 headers were only ever logged
*on a 429*, so every sample came from a saturated moment — pure selection bias. The
real shape is bursty: the tenant **day** counter read 8,622 at 17:33 (≈8 req/min
averaged over the day), yet two samples five minutes apart differed by **248
requests**. So a burst of ~250 requests periodically saturates the minute bucket
while the long-run average stays low. Manual curls landed in quiet windows;
`/results` kept landing in bursts.

**Consequence:** any live Keap read on the request path is a coin flip, permanently.
No amount of caching, backoff or key-rotation on this side changes that.

### Ruled out

- **A second key of our own.** Issuing another key cannot help — same shared bucket.
- **S3-LMS.** It uses the same `KEAP_API_KEY` env-var name and `X-Keap-API-Key`
  header, and its Keap code is genuinely inefficient (`hasTag()` in
  `src/lib/keap.ts` does a redundant `GET /contacts/{id}/tags` on every *negative*
  answer, so `/api/progress/sync` costs up to 10 calls per dashboard load, and
  `/api/checkout/keap-status` polls every 2s with no auth gate). **But it is idle in
  production** — 22 requests in 3 hours, `/api/progress/sync` once. Not the source.
  Still worth fixing on its own merits before it gets traffic.
- **Old deployments.** The production alias points at the newest deployment only.

### Still unidentified (and no longer blocking)

Whatever fires ~250 requests in a burst is **outside Vercel**. Most likely the
WooCommerce→Keap sync on speakernation.com, a Keap-side automation/campaign, or a
Zapier integration. Worth finding eventually — Keap has no per-integration usage
breakdown, so it needs checking from the Keap side — but the report no longer
depends on the answer.

## What was built

`/results` no longer calls Keap at all. A cron stores a snapshot; the report reads it.

| File | Role |
|---|---|
| `api/refresh-keap.js` | Cron endpoint (`*/10 * * * *`), `CRON_SECRET`-authenticated, fails closed |
| `lib/keap-refresh.js` | 4 attempts, 15s apart, keeps the first that lands; records the attempt *before* making it |
| `lib/keap-store.js` | Snapshot + pacing marker on **Vercel Blob**, `access: 'private'`, read with `useCache: false` |
| `lib/keap-api.js` | The only Keap caller for the report; raises `KeapThrottleError` on 429, never retries in place |
| `lib/keap-snapshot.js` | Pure shape/validation/staleness; rejects unknown `version` rather than mis-rendering |

Retrying is safe in the refresher and was not safe in the request path — the
difference is that this runs in the background, one caller at a time, seconds apart,
with nobody waiting. The old code retried inside the request across concurrent cold
instances, inside the same throttled minute, so the retries *became* the load.

Also fixed along the way: the dashboard panel showed a structural `0` for the roster
when Keap was unavailable, which reads as "nobody registered". It now shows `—`, the
same as the full report.

The temporary 429/key-fingerprint diagnostics have been removed — `keapFetch` no
longer exists in `api/results.js`.

Tests: 206 passing, including 9 that pin the refresher's **call footprint** (attempt
budget respected, no call at all when backed off, no retry on a non-throttle error).

## Setup (done 2026-08-11)

1. **Blob store** linked to `onetalk-landing`. Note it provisioned
   `BLOB_STORE_ID` + `BLOB_WEBHOOK_PUBLIC_KEY` and **not**
   `BLOB_READ_WRITE_TOKEN` — a dashboard-connected store authenticates with the
   per-invocation runtime **OIDC** token instead of a static one. `@vercel/blob`
   resolves OIDC-token-plus-store-id *before* the read-write token, so this is
   fully supported. `isBlobConfigured()` accepts either shape; an earlier version
   checked only for `BLOB_READ_WRITE_TOKEN` and so reported a correctly connected
   store as "not configured", silently disabling the refresh. `lib/keap-store.test.js`
   guards both paths.
2. **`CRON_SECRET`** set for Production + Preview. `api/refresh-keap.js` returns
   500 without it, by design.

Plan is **Pro**, so the 10-minute cron schedule runs as written. (On Hobby it would
be coerced to daily and the opportunistic path — one gentle attempt per 5 minutes,
triggered by a page view once the snapshot passes 30 minutes old — would become the
primary refresher.)

**Env var changes only take effect on a new deployment**, so these needed a redeploy
to reach the running functions.

## The actual bug: an unbounded pagination walk

`loadTagMembers` walked `while (url) { …; url = body.next }` with **no page
cap**. Keap can return a `next` link on the final page, so its absence is not a
reliable end-of-collection signal and the loop never terminated — it spun until
the platform killed the function. Three runs died this way (300s, 300s, then
120s once `maxDuration` was pinned), each producing **no log output at all**,
because the hang happened before anything could log.

**The silence is what identified it**, and it inverted the working theory: the
runs that timed out were the ones where **Keap answered**, since only a 200
enters the pagination loop. The 18:14 page view logged cleanly and fast
*because* it got a 429 and never reached the loop. Every time Keap actually
worked, the function hung — the opposite of "Keap is unavailable".

Both walks now share one `paginate` helper that stops on four independent
conditions: no next link, a next link identical to the page just fetched, an
empty page regardless of what `next` claims, or a hard page cap (20 pages; the
real answer is 1). `lib/keap-api.test.js` covers all four, including the exact
production shape. `fetchKeapChannel` also logs each stage with elapsed time —
had that existed, this would have been one debugging cycle instead of three.

**Debugging lesson worth keeping:** a function killed at the platform limit with
zero log output means the hang preceded all logging. Reach for the unbounded
loop, not the network call — and log stage transitions in any job whose failure
mode is "killed from outside".

## Also fixed: page views were starving the cron

The Blob pacing marker is shared between the cron and the opportunistic
page-view refresh, and `MIN_INTERVAL_MS` was 60s. A page load at 18:29:36 wrote
the marker, so the cron at 18:30:33 — 57 seconds later — backed off without
calling Keap and returned `200` while logging nothing. Refreshing `/results` to
check for figures was suppressing the job meant to produce them. The marker
paces opportunistic attempts; the schedule paces the cron, so the floor is now
5s. Every cron run logs its outcome, so a deliberate skip can never again look
identical to a cron that never fired.

## Post-deploy fix: the first cron run 504'd at 300s

`keapFetch` had no request timeout. The 18:10 cron met a Keap connection that
never answered, burned the platform's entire 300s budget, returned a 504 and
stored nothing — the retry loop never ran, so the "four chances" design did
nothing at all. Fixed by:

- a **12s `AbortSignal.timeout`** on every Keap request (`KeapTimeoutError`,
  marked `retryable` alongside `KeapThrottleError`);
- **`maxDuration: 120`** on `api/refresh-keap.js` and a **75s deadline** that
  stops new attempts, so a bad run ends cheaply and the next tick retries;
- `reason: 'deadline'` vs `'throttled'` reported honestly, since conflating them
  is what let a 300s hang look like ordinary rate limiting.

Confirmed the same run that the **opportunistic path works end to end**: an
18:14 page view logged `Keap throttled all 1 attempt(s) (page-view)` and served
`200`. That line is only reachable if `isBlobConfigured()` returned true, so
OIDC Blob auth, the read, the write and the graceful degradation are all proven.

## Verified numbers (to reconcile against once the snapshot populates)

- Keap roster: **Aug tag 2008 = 211, Sep tag 1825 = 130/131** (≈342).
- Keap OTW orders (product 49), current cohort: ~**7 Aug ($6,882 gross) + 11 Sep
  ($8,179 gross)**; net = `total + refund_total` (`refund_total` is negative).
- Stripe web channel (net of refunds): **$7,442 collected / $9,096 contracted**.
- The admin sheet (Aug $7,839 / Sep $9,776) is Keap-tag-derived and internally
  inconsistent. `/results` is the source of truth, not something to match exactly.

## Observing this in production

Vercel MCP (project `prj_3TISES2wjyVLaHooZgrQZdqb9Pvi`, team
`team_gTIDxZoMuLWEumXxWbs0NqZv`): `get_runtime_logs`, query `refresh-keap`.

- `[refresh-keap] stored snapshot (cron): aug=… sep=… orders=…` — a refresh landed.
- `[refresh-keap] Keap throttled all 4 attempt(s)` — expected occasionally; harmless,
  the previous snapshot still serves.

**Do not call the Keap API directly while diagnosing** — it adds to the very bucket
being contended. Read logs instead.
