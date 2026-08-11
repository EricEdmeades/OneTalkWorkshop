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

// Four tries, fifteen seconds apart: at most ~4 Keap calls spread over 45s,
// which is a rounding error against the 240/min bucket but four separate
// chances to land in a quiet window. Well inside the function time limit.
const ATTEMPTS = 4;
const SPACING_MS = 15_000;

// Guards against a double-fired cron doing the work twice. Comfortably below
// the 10-minute schedule.
const MIN_INTERVAL_MS = 60_000;

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
    reason: 'cron',
  });

  return res.status(200).json({
    ok: result.ok,
    reason: result.reason ?? null,
    fetchedAt: result.snapshot?.fetchedAt ?? null,
  });
}
