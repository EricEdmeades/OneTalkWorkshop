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
  reason = 'manual',
} = {}) {
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

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const { tagCounts, orders } = await fetchKeapChannel(tagIds());
      const snapshot = buildSnapshot({ tagCounts, orders, fetchedAt: Date.now() });
      await writeSnapshot(snapshot);
      console.log(
        `[refresh-keap] stored snapshot (${reason}): aug=${snapshot.tagCounts.august} sep=${snapshot.tagCounts.september} orders=${snapshot.orders.length} attempt=${attempt}/${attempts}`
      );
      return { ok: true, snapshot, attempts: attempt };
    } catch (err) {
      if (err?.throttled) {
        throttledCount += 1;
        if (attempt < attempts) {
          await sleep(spacingMs);
          continue;
        }
        console.warn(
          `[refresh-keap] Keap throttled all ${attempts} attempt(s) (${reason}); keeping the stored snapshot`
        );
        return { ok: false, reason: 'throttled', throttledCount };
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
