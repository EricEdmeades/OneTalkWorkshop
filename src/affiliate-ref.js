// =============================================================================
// Affiliate ref passthrough
// -----------------------------------------------------------------------------
// Reads ?ref= from the landing URL and persists it in localStorage for 30
// days. register.js reads it back via getStoredRef() and forwards it to
// /api/create-checkout as client_reference_id, so AffiliateWP can attribute
// the sale once Stripe's webhook fires.
// =============================================================================

const STORAGE_KEY = 'otw_affiliate_ref';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function getStoredRef() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { value, ts } = JSON.parse(raw);
    if (!value || typeof ts !== 'number') return null;
    if (Date.now() - ts > MAX_AGE_MS) return null;
    return value;
  } catch {
    return null;
  }
}

function writeStoredRef(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ value, ts: Date.now() }));
  } catch {
    // Storage unavailable (private mode, quota) — ref still applies to this page load.
  }
}

export function initAffiliateRef() {
  const urlRef = new URLSearchParams(window.location.search).get('ref');
  if (urlRef) writeStoredRef(urlRef);
}
