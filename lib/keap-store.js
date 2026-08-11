// lib/keap-store.js — the durable home of the Keap snapshot, on Vercel Blob.
//
// Module scope is NOT durable here: Fluid Compute gives a cold instance its own
// empty module state, so the previous in-memory cache died with every new
// instance and each cold start went back to Keap — straight into the shared
// 240/min bucket. Blob is cross-instance and outlives deploys, so ONE lucky
// fetch serves every request and every instance until the next refresh.
//
// The snapshot holds revenue figures, so it is written with `access: 'private'`
// and is never publicly addressable.

import { put, get } from '@vercel/blob';
import { parseSnapshot } from './keap-snapshot.js';

const SNAPSHOT_PATH = 'keap/snapshot.json';
const ATTEMPT_PATH = 'keap/last-attempt.json';

// Blob refuses a cache lifetime under a minute. Every read passes
// `useCache: false` anyway — a CDN-cached copy of a blob we rewrite every few
// minutes would silently re-introduce the staleness this module exists to fix.
const CACHE_MAX_AGE_S = 60;

// A Blob store can be linked in either of two ways, and this must accept BOTH.
// Connecting a store in the dashboard today provisions `BLOB_STORE_ID` and
// authenticates per-invocation with the runtime OIDC token — it does NOT
// necessarily set `BLOB_READ_WRITE_TOKEN`. Checking only for the read-write
// token reported "not configured" against a store that was in fact connected
// and correctly set up, which would have left this whole feature inert while
// looking like a configuration mistake on the operator's side.
//
// Mirrors the SDK's own resolution order (see getBlobCredentials in
// @vercel/blob): OIDC token + store id first, static read-write token second.
// If a credential is present but unusable at runtime, the call throws and is
// logged — a loud failure, rather than this silently answering "false".
export function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

async function readJson(pathname) {
  // `get` resolves to null when the blob does not exist yet, which is the
  // ordinary state before the first successful refresh.
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).text();
}

async function writeJson(pathname, value) {
  await put(pathname, JSON.stringify(value), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: CACHE_MAX_AGE_S,
  });
}

// Returns a validated snapshot, or null when there is none to show. A read
// failure is logged and treated as "no snapshot" rather than thrown: the
// report must still render its Stripe channel if Blob is having a bad day.
export async function readSnapshot() {
  if (!isBlobConfigured()) return null;
  try {
    return parseSnapshot(await readJson(SNAPSHOT_PATH));
  } catch (err) {
    console.error('[keap-store] could not read snapshot:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function writeSnapshot(snapshot) {
  await writeJson(SNAPSHOT_PATH, snapshot);
}

// The timestamp of the last refresh ATTEMPT, successful or not. The snapshot's
// own `fetchedAt` only records successes, so it cannot stop a failing refresh
// from being retried on every page load — which is precisely the storm that
// pinned the key before. This is what paces the retries.
export async function readLastAttemptAt() {
  if (!isBlobConfigured()) return 0;
  try {
    const raw = await readJson(ATTEMPT_PATH);
    const parsed = raw ? JSON.parse(raw) : null;
    return Number.isFinite(parsed?.at) ? parsed.at : 0;
  } catch (_) {
    // An unreadable or malformed marker must not block a refresh; the worst
    // case is one extra Keap attempt.
    return 0;
  }
}

export async function writeLastAttemptAt(at) {
  try {
    await writeJson(ATTEMPT_PATH, { at });
  } catch (err) {
    // Losing the marker costs pacing, not correctness — never fail a refresh
    // over it.
    console.error('[keap-store] could not record attempt time:', err instanceof Error ? err.message : err);
  }
}

// Best-effort pacing gate. Blob has no compare-and-set, so two instances that
// read the marker in the same instant can both proceed. The consequence is a
// handful of extra Keap calls, not a storm — and the cron path is single-writer
// anyway. Anything stronger would need a real lock service for no real gain.
export async function shouldAttempt(minIntervalMs, now = Date.now()) {
  const last = await readLastAttemptAt();
  return now - last >= minIntervalMs;
}
