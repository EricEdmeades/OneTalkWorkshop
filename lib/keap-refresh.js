// lib/keap-refresh.js — the one place a Keap read is turned into a stored
// snapshot. Called from api/refresh-keap.js (the cron) and, in a deliberately
// weaker form, from api/results.js when the stored snapshot has gone stale.
//
// The whole design exists to win a race this project cannot win head-on: the
// Keap 240/min bucket is account-wide and something outside this codebase
// saturates it in bursts, so a single attempt at an arbitrary moment succeeds
// only some of the time. Rather than retry harder — which is what pinned the
// key before — this takes many cheap, well-spaced shots over time and keeps the
// first one that lands.

import { fetchKeapChannel } from './keap-api.js';
import { buildSnapshot } from './keap-snapshot.js';
import { writeSnapshot, writeLastAttemptAt, shouldAttempt, isBlobConfigured } from './keap-store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tagIds() {
  return {
    tagAugust: process.env.KEAP_TAG_ID_AUGUST || '2008',
    tagSeptember: process.env.KEAP_TAG_ID_SEPTEMBER || '1825',
  };
}

// Retrying a throttled read is safe HERE and was not safe on the request path.
// The difference is not the retry count, it is who is waiting: this runs in the
// background, one caller at a time, with seconds between tries. The old code
// retried inside the request, on every concurrent cold instance at once, inside
// the same throttled minute — so the retries became the load.
export async function refreshKeapSnapshot({
  attempts = 1,
  spacingMs = 15_000,
  minIntervalMs = 0,
  // Belt and braces alongside the per-request timeout in lib/keap-api.js. The
  // first production cron run died at the platform's 300s ceiling, so the job
  // now stops starting new attempts once it has spent this long — it gives up
  // and lets the next scheduled run try, rather than being killed mid-flight.
  deadlineMs = 120_000,
  reason = 'manual',
} = {}) {
  const startedAt = Date.now();
  if (!isBlobConfigured()) {
    return { ok: false, reason: 'blob-not-configured' };
  }
  if (!process.env.KEAP_API_KEY) {
    return { ok: false, reason: 'keap-key-missing' };
  }
  if (minIntervalMs > 0 && !(await shouldAttempt(minIntervalMs))) {
    return { ok: false, reason: 'backed-off' };
  }

  // Record the attempt BEFORE making it. A crash mid-fetch must still cost the
  // caller its pacing interval, or a failing refresh becomes a hot loop.
  await writeLastAttemptAt(Date.now());

  let throttledCount = 0;
  const outOfTime = () => Date.now() - startedAt >= deadlineMs;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 && outOfTime()) {
      console.warn(
        `[refresh-keap] out of time after ${attempt - 1} attempt(s) (${reason}); leaving it to the next run`
      );
      return { ok: false, reason: 'deadline', throttledCount };
    }
    try {
      const { tagCounts, orders } = await fetchKeapChannel(tagIds());
      const snapshot = buildSnapshot({ tagCounts, orders, fetchedAt: Date.now() });
      await writeSnapshot(snapshot);
      console.log(
        `[refresh-keap] stored snapshot (${reason}): aug=${snapshot.tagCounts.august} sep=${snapshot.tagCounts.september} orders=${snapshot.orders.length} attempt=${attempt}/${attempts}`
      );
      return { ok: true, snapshot, attempts: attempt };
    } catch (err) {
      // Throttles AND timeouts both mean "Keap is busy right now"; only these
      // are worth waiting out. See lib/keap-api.js.
      if (err?.retryable) {
        throttledCount += 1;
        const timeUp = outOfTime();
        if (attempt < attempts && !timeUp) {
          await sleep(spacingMs);
          continue;
        }
        // Distinguish "Keap was busy for every try we were allowed" from "we
        // ran out of time with tries to spare". They call for different fixes —
        // the first is normal and self-healing, the second means the budget is
        // too tight — and conflating them is how the 300s timeout stayed
        // invisible behind a generic "throttled".
        const stoppedEarly = timeUp && attempt < attempts;
        console.warn(
          `[refresh-keap] Keap unavailable after ${attempt} attempt(s) (${reason}${
            stoppedEarly ? ', out of time' : ''
          }): ${err.message}. The previous snapshot, if any, still serves.`
        );
        return { ok: false, reason: stoppedEarly ? 'deadline' : 'throttled', throttledCount };
      }
      // A non-throttle failure (bad key, Keap 500, malformed payload) will not
      // fix itself by waiting, so it stops here and is surfaced in the logs.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[refresh-keap] failed (${reason}):`, message);
      return { ok: false, reason: message };
    }
  }

  return { ok: false, reason: 'throttled', throttledCount };
}
