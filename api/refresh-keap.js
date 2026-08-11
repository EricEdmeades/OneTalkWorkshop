// api/refresh-keap.js — the scheduled refresher behind the /results Keap
// channel. Registered as a Vercel Cron in vercel.json.
//
// It exists so that /results never has to reach Keap while someone is waiting
// for a page. Keap's 240/min limit is an account-wide bucket that a consumer
// outside this project saturates in bursts, so any single read is a coin flip.
// This job takes a few well-spaced shots each time it runs and keeps whichever
// one lands; the report then reads the stored result.
//
// A throttled run is NOT an error. It returns 200 with `ok:false`, because the
// previous snapshot is still perfectly serviceable and a 500 here would light
// up deployment alerts for the ordinary case of "Keap was busy this minute".

import { refreshKeapSnapshot } from '../lib/keap-refresh.js';

// Cap the function well below the platform's 300s default. The first
// production run hit that ceiling and returned a 504 — with no per-request
// timeout, one unanswered Keap connection consumed the entire budget and the
// retry loop never ran. Failing at 120s instead means a bad run ends quickly
// and cheaply, and the next tick is only minutes away.
export const config = { maxDuration: 120 };

// Four tries, fifteen seconds apart: at most ~4 Keap calls spread over ~45s,
// which is a rounding error against the 240/min bucket but four separate
// chances to land in a quiet window. With the 12s per-request timeout in
// lib/keap-api.js, the worst realistic case stays inside DEADLINE_MS.
const ATTEMPTS = 4;
const SPACING_MS = 15_000;

// Stop starting new attempts past this, leaving headroom under maxDuration for
// the final attempt to finish and the snapshot to be written.
const DEADLINE_MS = 75_000;

// Only guards against a genuinely double-fired cron; the schedule itself is
// what paces this job.
//
// It must stay SMALL. The pacing marker is shared with the opportunistic
// page-view path in api/results.js, and at 60s an operator refreshing /results
// while waiting for figures would land inside this window and make the cron skip
// entirely — the patient 4-attempt refresher would never run, leaving only the
// single-attempt page-view path, which usually loses. Watching the page stopped
// it from working. The marker exists to pace opportunistic attempts, not to
// second-guess the scheduler.
const MIN_INTERVAL_MS = 5_000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
  // set on the project. Fail closed if it is not configured: an unauthenticated
  // refresh endpoint is a free way for anyone to burn the Keap quota we are
  // trying to protect.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[refresh-keap] CRON_SECRET is not set; refusing to run');
    return res.status(500).json({ ok: false, error: 'Not configured' });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const result = await refreshKeapSnapshot({
    attempts: ATTEMPTS,
    spacingMs: SPACING_MS,
    minIntervalMs: MIN_INTERVAL_MS,
    deadlineMs: DEADLINE_MS,
    reason: 'cron',
  });

  // ALWAYS leave a trace. Several outcomes (backed-off, blob-not-configured,
  // keap-key-missing) return early and used to log nothing, so a run that did
  // no work was indistinguishable in the logs from one that never fired at all
  // — a 200 with total silence. That cost an entire debugging cycle chasing a
  // cron that was in fact running and deliberately skipping.
  console.log(
    `[refresh-keap] cron run: ok=${result.ok} reason=${result.reason ?? 'none'}${
      result.snapshot ? ` aug=${result.snapshot.tagCounts.august} sep=${result.snapshot.tagCounts.september}` : ''
    }`
  );

  return res.status(200).json({
    ok: result.ok,
    reason: result.reason ?? null,
    fetchedAt: result.snapshot?.fetchedAt ?? null,
  });
}
