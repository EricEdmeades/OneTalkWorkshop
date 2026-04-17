// =============================================================================
// /stories page — static grid of all testimonials.
// Hover-reveal is pure CSS (same .testi-card / .testi-quote rules from
// styles.css). This module only adds the tap-to-toggle behaviour for touch
// devices that don't have hover.
// =============================================================================

const isTouch = matchMedia('(hover: none)').matches || 'ontouchstart' in window;

function init() {
  const grid = document.querySelector('.stories-grid');
  if (!grid || !isTouch) return;
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.testi-card');
    if (!card) return;
    if (e.target.closest('a, button')) return;
    const wasActive = card.classList.contains('is-active');
    grid.querySelectorAll('.testi-card.is-active').forEach((c) => c.classList.remove('is-active'));
    if (!wasActive) card.classList.add('is-active');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.testi-card')) {
      grid.querySelectorAll('.testi-card.is-active').forEach((c) => c.classList.remove('is-active'));
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
