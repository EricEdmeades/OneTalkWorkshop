import { initAnalytics } from './analytics.js';
import { wrapHeadingWords } from './word-hover.js';
import { initLeadMagnetForm } from './form.js';
import { initTestimonialCarousel } from './testimonials.js';

function boot() {
  wrapHeadingWords();
  initAnalytics();
  initLeadMagnetForm();
  initTestimonialCarousel();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
