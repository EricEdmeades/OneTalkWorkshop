// lib/keap-snapshot.js — the shape of the persisted Keap snapshot, and the
// rules for deciding whether a snapshot is usable and how old it is. Pure: no
// network, no Blob, no Keap (mirrors lib/results.js / lib/keap-orders.js), so
// the validation and staleness math are testable without either service.
//
// WHY A SNAPSHOT EXISTS AT ALL: Keap's 240-requests-per-minute limit is an
// ACCOUNT-level bucket shared by every integration on the Keap account, not a
// per-key one — a dedicated key issued for this project alone still reported
// `x-keap-product-throttle-used: 240/240` while making about one request every
// five minutes. Something outside this codebase saturates that bucket in
// bursts, so any Keap call made while rendering a page is a coin flip that this
// project cannot win by being polite. The report therefore reads a snapshot
// that a background job refreshed at some earlier, luckier moment.
//
// PRIVACY: orders carry a one-way `emailHash` and never an email address, the
// same invariant api/results.js applies at the Stripe boundary. The snapshot is
// written to a PRIVATE blob because it also carries revenue figures.

// Bump when the payload shape changes incompatibly. parseSnapshot rejects any
// other version, so a deploy that changes the shape degrades to "no Keap data"
// for one refresh cycle rather than rendering a mis-parsed older blob as if it
// were current — wrong figures on a revenue report are worse than absent ones.
export const SNAPSHOT_VERSION = 1;

const DATES = new Set(['august', 'september']);

const int = (v) => (Number.isFinite(v) ? Math.round(v) : 0);

// Keep only what buildKeapReport and the de-dup actually consume. Anything else
// Keap returned is dropped here rather than persisted — the blob should not
// become an accidental copy of the CRM.
function projectOrder(order) {
  if (!order || !DATES.has(order.date)) return null;
  return {
    date: order.date,
    grossCents: int(order.grossCents),
    refundCents: int(order.refundCents),
    netCents: int(order.netCents),
    // May legitimately be absent: a Keap order whose contact has no email
    // simply cannot be de-duped against the Stripe channel.
    emailHash: typeof order.emailHash === 'string' && order.emailHash ? order.emailHash : null,
  };
}

const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

export function buildSnapshot({ tagCounts, orders, fetchedAt }) {
  return {
    version: SNAPSHOT_VERSION,
    fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : 0,
    tagCounts: {
      august: count(tagCounts?.august),
      september: count(tagCounts?.september),
    },
    orders: (Array.isArray(orders) ? orders : []).map(projectOrder).filter(Boolean),
  };
}

// Returns a validated snapshot, or null if the input is missing, malformed, or
// from an incompatible version. Null means "we have no Keap data", which the
// report renders as an explicit unavailable state — never as zero.
export function parseSnapshot(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  if (data.version !== SNAPSHOT_VERSION) return null;
  if (!Number.isFinite(data.fetchedAt) || data.fetchedAt <= 0) return null;
  if (!data.tagCounts || typeof data.tagCounts !== 'object') return null;
  if (!Array.isArray(data.orders)) return null;

  return buildSnapshot(data);
}

export function snapshotAgeMs(snapshot, now = Date.now()) {
  if (!snapshot || !Number.isFinite(snapshot.fetchedAt)) return Infinity;
  return Math.max(0, now - snapshot.fetchedAt);
}

// "Stale" only drives the quiet age note and whether an opportunistic refresh
// is worth attempting. A stale snapshot is still shown: real figures from
// twenty minutes ago beat an empty panel.
export function isStale(snapshot, ttlMs, now = Date.now()) {
  return snapshotAgeMs(snapshot, now) >= ttlMs;
}

// Human phrasing for the age line on the report ("4 minutes ago").
export function describeAge(ms) {
  if (!Number.isFinite(ms)) return 'unknown';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
