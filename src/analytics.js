// =============================================================================
// Analytics & conversion tracking
// -----------------------------------------------------------------------------
// All third-party tracking for the One Talk Workshop landing page lives here.
//
// Providers:
//   1. Google Analytics 4  — gated by VITE_GA_MEASUREMENT_ID   (e.g. "G-XXXXXXX")
//   2. Meta (Facebook) Pixel — gated by VITE_META_PIXEL_ID     (e.g. "5158...")
//
// Nothing loads unless the corresponding env var is set in Vercel / .env.local,
// so preview and local dev stay quiet by default.
//
// Events fired:
//   - Automatic PageView on load (GA4 + Meta Pixel)
//   - Custom `cta_click` event on every Reserve-My-Seat button, labeled with
//     the section the click came from (nav | hero | offer | final_cta | ...).
//     The label is read from the element's `data-cta` attribute.
// =============================================================================

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;
const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID;

// -----------------------------------------------------------------------------
// Google Analytics 4
// -----------------------------------------------------------------------------
function loadGA4(id) {
  // Standard gtag.js bootstrap — https://developers.google.com/analytics/devguides/collection/ga4
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id);
}

// -----------------------------------------------------------------------------
// Meta (Facebook) Pixel
// -----------------------------------------------------------------------------
function loadMetaPixel(id) {
  // Standard fbq bootstrap — https://developers.facebook.com/docs/meta-pixel/get-started
  /* eslint-disable */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */

  window.fbq('init', id);
  window.fbq('track', 'PageView');
}

// -----------------------------------------------------------------------------
// Custom events
// -----------------------------------------------------------------------------
export function trackCtaClick(label) {
  // Fire to every provider that is configured. Silently no-op otherwise.
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'cta_click', { cta_location: label });
  }
  if (typeof window.fbq === 'function') {
    window.fbq('trackCustom', 'CtaClick', { cta_location: label });
  }
}

function wireCtaClicks() {
  // Any element with `data-cta="<label>"` will emit a cta_click event on click.
  const nodes = document.querySelectorAll('[data-cta]');
  nodes.forEach((el) => {
    el.addEventListener('click', () => {
      const label = el.getAttribute('data-cta') || 'unknown';
      trackCtaClick(label);
    });
  });
}

// Lead-magnet form handling lives in form.js — it posts to /api/subscribe-otw
// and applies tag 1831 in Keap, which triggers the delivery automation.

// -----------------------------------------------------------------------------
// Public entrypoint
// -----------------------------------------------------------------------------
export function initAnalytics() {
  if (GA_ID) loadGA4(GA_ID);
  if (META_PIXEL_ID) loadMetaPixel(META_PIXEL_ID);
  wireCtaClicks();
}
