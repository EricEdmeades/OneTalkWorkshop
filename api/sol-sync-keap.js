// /api/sol-sync-keap — Vercel Cron. Drains Said Out Loud opt-ins whose Keap
// write failed at submit time. Same discipline as api/refresh-keap.js: fails
// closed without CRON_SECRET, one record at a time with a gap, stops on the
// first throttle (Keap's 240/min bucket is account-wide), and a busy Keap
// returns 200 {ok:false} rather than paging anyone.
import { listPending, readPending, writePending, deletePending, moveToDead } from '../lib/sol-store.js';
import { syncContactToKeap } from '../lib/sol-keap.js';
import { withFailure, isDead } from '../lib/sol-pending.js';
import { missingConfig } from '../lib/sol-service.js';

export const config = { maxDuration: 120 };

// Keap's 240/min bucket is shared account-wide; each record costs ~4 calls, so a
// run is kept small and slow: 8 records, 2s apart, ~16 calls a minute at most.
export const BATCH_SIZE = 8;
export const DEFAULT_GAP_MS = 2000;
// 60s + one worst-case record (4 x 12s timeouts) stays under maxDuration 120s.
export const DEFAULT_DEADLINE_MS = 60_000;

let gapMs = DEFAULT_GAP_MS;
let deadlineMs = DEFAULT_DEADLINE_MS;
// Test seams — production never calls these.
export const __setGapMs = (ms) => { gapMs = ms; };
export const __setDeadlineMs = (ms) => { deadlineMs = ms; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recordFailure(pathname, record, err) {
  const next = withFailure(record, err);
  if (!isDead(next)) {
    await writePending(next, pathname);
    return 'failed';
  }
  console.error(`[sol-sync-keap] Giving up on ${pathname} after ${next.attempts} attempts: ${next.lastError}`);
  await moveToDead(pathname, next);
  return 'dead';
}

async function processOne(pathname, tagId) {
  const record = await readPending(pathname);
  if (!record) {
    console.error(`[sol-sync-keap] Unreadable pending record ${pathname}; moved to dead`);
    await moveToDead(pathname, null);
    return 'dead';
  }
  try {
    await syncContactToKeap(record, tagId);
    await deletePending(pathname);
    return 'synced';
  } catch (err) {
    // Only a 429 stops the run uncounted. A timeout counts as an attempt so a
    // record that always hangs ages out instead of blocking the queue forever.
    if (err?.throttled) return 'throttled';
    return recordFailure(pathname, record, err);
  }
}

async function drain(tagId) {
  const started = Date.now();
  const counts = { synced: 0, failed: 0, dead: 0 };
  for (const pathname of await listPending(BATCH_SIZE)) {
    if (Date.now() - started > deadlineMs) return { counts, reason: 'deadline' };
    const outcome = await processOne(pathname, tagId);
    if (outcome === 'throttled') return { counts, reason: 'throttled' };
    counts[outcome] += 1;
    await sleep(gapMs);
  }
  return { counts, reason: null };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[sol-sync-keap] CRON_SECRET is not set; refusing to run');
    return res.status(500).json({ ok: false, reason: 'not_configured' });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false, reason: 'unauthorized' });
  const missing = missingConfig(['KEAP_API_KEY', 'KEAP_TAG_ID_SAID_OUT_LOUD']);
  if (missing.length) {
    console.error(`[sol-sync-keap] Missing config: ${missing.join(', ')}`);
    return res.status(500).json({ ok: false, reason: 'not_configured' });
  }
  try {
    const { counts, reason } = await drain(Number(process.env.KEAP_TAG_ID_SAID_OUT_LOUD));
    if (reason) console.warn(`[sol-sync-keap] Stopped early: ${reason}`);
    return res.status(200).json({ ok: !reason, ...counts, reason });
  } catch (err) {
    console.error(`[sol-sync-keap] Run failed: ${err?.message || err}`);
    return res.status(500).json({ ok: false, reason: 'error' });
  }
}
