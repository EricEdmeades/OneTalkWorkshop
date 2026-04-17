import { initAnalytics } from './analytics.js';
import { wrapHeadingWords } from './word-hover.js';
import { initLeadMagnetForm } from './form.js';

function boot() {
  wrapHeadingWords();
  initAnalytics();
  initLeadMagnetForm();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
