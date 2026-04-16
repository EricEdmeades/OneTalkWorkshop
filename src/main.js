import { initAnalytics } from './analytics.js';
import { wrapHeadingWords } from './word-hover.js';

function boot() {
  wrapHeadingWords();
  initAnalytics();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
