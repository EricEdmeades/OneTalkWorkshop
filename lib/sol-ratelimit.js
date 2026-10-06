// lib/sol-ratelimit.js — per-email send limit for the Said Out Loud delivery
// email. Pure: the caller loads and stores the history (lib/sol-store.js).
// The opt-in send counts, so a person gets the first email plus two resends a day.

export const MIN_GAP_MS = 60_000;
export const DAY_MS = 86_400_000;
export const MAX_PER_DAY = 3;

export function checkRate(sentAt, now) {
  const history = Array.isArray(sentAt) ? sentAt : [];
  const recent = history.filter((t) => Number.isFinite(t) && now - t < DAY_MS);
  const last = recent.length ? Math.max(...recent) : -Infinity;
  if (now - last < MIN_GAP_MS) {
    return { allowed: false, reason: 'too_soon', retryAfterMs: MIN_GAP_MS - (now - last), recent };
  }
  if (recent.length >= MAX_PER_DAY) return { allowed: false, reason: 'daily_cap', recent };
  return { allowed: true, recent };
}

export function recordSend(recent, now) {
  return [...recent, now];
}
