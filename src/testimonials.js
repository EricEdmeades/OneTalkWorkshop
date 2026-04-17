// =============================================================================
// Testimonial carousel
// -----------------------------------------------------------------------------
// Behaviors:
//   * Slow continuous auto-scroll (rAF, ~30 px/sec) with a seamless loop —
//     achieved by cloning the cards so scrollLeft can reset to 0 invisibly
//     once the original set has fully scrolled past.
//   * Pauses while the user is hovering, touching, focusing inside the
//     carousel, or has manually scrolled in the last few seconds.
//   * Respects prefers-reduced-motion (no auto-scroll for those users).
//   * Tap-to-toggle quote overlay on touch devices (no hover available).
//   * Prev / Next arrow buttons scroll one viewport-worth of cards.
// =============================================================================

const SCROLL_SPEED = 0.5;       // px per animation frame (~30 px/sec @ 60fps)
const RESUME_DELAY_MS = 4000;   // resume auto-scroll N ms after a user interaction

export function initTestimonialCarousel() {
  const carousel = document.querySelector('.testi-carousel');
  if (!carousel) return;

  const cards = Array.from(carousel.children);
  if (cards.length === 0) return;

  // ---------------------------------------------------------------------------
  // Touch tap-to-toggle (no hover on touch devices)
  // ---------------------------------------------------------------------------
  const isTouch = matchMedia('(hover: none)').matches || 'ontouchstart' in window;
  if (isTouch) {
    carousel.addEventListener('click', (e) => {
      const card = e.target.closest('.testi-card');
      if (!card) return;
      if (e.target.closest('a, button')) return;
      const wasActive = card.classList.contains('is-active');
      carousel.querySelectorAll('.testi-card.is-active').forEach((c) => c.classList.remove('is-active'));
      if (!wasActive) card.classList.add('is-active');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.testi-card')) {
        carousel.querySelectorAll('.testi-card.is-active').forEach((c) => c.classList.remove('is-active'));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Prev / Next arrow buttons
  // ---------------------------------------------------------------------------
  const prev = document.querySelector('.testi-arrow-prev');
  const next = document.querySelector('.testi-arrow-next');
  function scrollByCards(direction) {
    const step = (cards[0]?.getBoundingClientRect().width || 0) + 16;
    carousel.scrollBy({ left: step * 2 * direction, behavior: 'smooth' });
    bumpUserActivity();
  }
  if (prev) prev.addEventListener('click', () => scrollByCards(-1));
  if (next) next.addEventListener('click', () => scrollByCards(1));

  // ---------------------------------------------------------------------------
  // Auto-scroll (seamless loop)
  // ---------------------------------------------------------------------------
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) return;

  // Clone every original card and append. The clones provide the runway so
  // when scrollLeft passes the end of the originals we can snap back to 0
  // without the user noticing.
  const originalWidth = () => {
    let total = 0;
    cards.forEach((c) => { total += c.getBoundingClientRect().width + 16; });
    return total;
  };
  cards.forEach((card) => {
    const clone = card.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    clone.removeAttribute('tabindex');
    carousel.appendChild(clone);
  });

  let isPaused = false;
  let lastUserActivity = 0;
  let isProgrammaticScroll = false;

  function bumpUserActivity() { lastUserActivity = Date.now(); }

  // Pause / resume signals
  carousel.addEventListener('mouseenter', () => { isPaused = true; });
  carousel.addEventListener('mouseleave', () => { isPaused = false; });
  carousel.addEventListener('focusin', () => { isPaused = true; });
  carousel.addEventListener('focusout', () => { isPaused = false; });
  carousel.addEventListener('touchstart', () => { isPaused = true; bumpUserActivity(); }, { passive: true });
  carousel.addEventListener('touchend', () => { isPaused = false; bumpUserActivity(); });
  carousel.addEventListener('scroll', () => {
    if (!isProgrammaticScroll) bumpUserActivity();
    isProgrammaticScroll = false;
  });

  function loopWidth() { return originalWidth(); } // width of original 12 cards including gap

  function tick() {
    const idleEnough = Date.now() - lastUserActivity > RESUME_DELAY_MS;
    if (!isPaused && idleEnough) {
      isProgrammaticScroll = true;
      const max = loopWidth();
      // Reset invisibly when we've passed the original set into the clones
      if (carousel.scrollLeft >= max) {
        carousel.scrollLeft = carousel.scrollLeft - max;
      } else {
        carousel.scrollLeft += SCROLL_SPEED;
      }
    }
    requestAnimationFrame(tick);
  }
  // Wait a beat for layout, then start
  setTimeout(() => requestAnimationFrame(tick), 800);
}
