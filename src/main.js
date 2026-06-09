import { initAnalytics } from './analytics.js';
import { wrapHeadingWords } from './word-hover.js';
import { initLeadMagnetForm, initWaitlistForm } from './form.js';
import { initTestimonialCarousel } from './testimonials.js';
import { initAffiliateRef } from './affiliate-ref.js';

function boot() {
  wrapHeadingWords();
  initAnalytics();
  initAffiliateRef();
  initLeadMagnetForm();
  initWaitlistForm();
  initTestimonialCarousel();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
