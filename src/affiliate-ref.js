// =============================================================================
// Affiliate ref passthrough
// -----------------------------------------------------------------------------
// Reads ?ref= from the landing URL, persists it in localStorage for 30 days,
// and applies it to every checkout CTA so AffiliateWP can attribute the sale.
// Lead-magnet form is untouched — ref tracking is checkout-only.
// =============================================================================

const STORAGE_KEY = 'otw_affiliate_ref';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CHECKOUT_BASE = 'https://speakernation.com/flow/one-talk-workshop-may-2026/otw-may-2026-checkout/';

function readStoredRef() {
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

  const ref = urlRef || readStoredRef();
  if (!ref) return;

  const links = document.querySelectorAll(`a[href^="${CHECKOUT_BASE}"]`);
  links.forEach((link) => {
    const url = new URL(link.href);
    url.searchParams.set('ref', ref);
    link.href = url.toString();
  });
}
