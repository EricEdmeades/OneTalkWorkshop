// =============================================================================
// Testimonial carousel — touch toggle + arrow scrolling
// -----------------------------------------------------------------------------
// Hover behaviour is pure CSS. This module adds:
//   * Tap-to-toggle for touch devices (no hover available)
//   * Prev/Next arrow buttons that scroll one viewport-worth of cards
// =============================================================================

export function initTestimonialCarousel() {
  const carousel = document.querySelector('.testi-carousel');
  if (!carousel) return;

  const cards = Array.from(carousel.querySelectorAll('.testi-card'));
  if (cards.length === 0) return;

  // Touch: tap toggles .is-active; tap outside dismisses.
  const isTouch = matchMedia('(hover: none)').matches || 'ontouchstart' in window;
  if (isTouch) {
    cards.forEach((card) => {
      card.addEventListener('click', (e) => {
        // Don't intercept if the user clicked an actual link/button inside.
        if (e.target.closest('a, button')) return;
        const wasActive = card.classList.contains('is-active');
        cards.forEach((c) => c.classList.remove('is-active'));
        if (!wasActive) card.classList.add('is-active');
      });
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.testi-card')) {
        cards.forEach((c) => c.classList.remove('is-active'));
      }
    });
  }

  // Prev / Next arrow buttons.
  const prev = document.querySelector('.testi-arrow-prev');
  const next = document.querySelector('.testi-arrow-next');
  function scrollByCards(direction) {
    const card = cards[0];
    if (!card) return;
    const step = card.getBoundingClientRect().width + 16; // gap
    carousel.scrollBy({ left: step * 2 * direction, behavior: 'smooth' });
  }
  if (prev) prev.addEventListener('click', () => scrollByCards(-1));
  if (next) next.addEventListener('click', () => scrollByCards(1));
}
