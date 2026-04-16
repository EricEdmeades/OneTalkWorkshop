// =============================================================================
// Word-by-word hover on headings
// -----------------------------------------------------------------------------
// Wraps each word inside h1–h4 in a <span class="word"> so each word gets
// its own hover target in CSS. Existing inline elements inside headings
// (.accent / .under / .mark / <em>) are left as-is — they already act as
// single hover targets via the CSS rule.
//
// Skips .day-title (sits on colored card headers where an orange hover
// would blend into the background).
//
// Safe to call once per page load.
// =============================================================================

export function wrapHeadingWords() {
  const headings = document.querySelectorAll('h1, h2, h3, h4');
  headings.forEach((heading) => {
    if (heading.classList.contains('day-title')) return;
    wrapTextNodes(heading);
  });
}

function wrapTextNodes(el) {
  // Only wrap top-level text nodes. Element children (like <span class="accent">
  // or <em>) are left intact so their existing styling stays.
  const children = Array.from(el.childNodes);
  children.forEach((node) => {
    if (node.nodeType !== Node.TEXT_NODE) return;
    if (!node.textContent.trim()) return;

    const frag = document.createDocumentFragment();
    // Split on runs of whitespace so we can preserve original spacing exactly.
    node.textContent.split(/(\s+)/).forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) {
        frag.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = part;
        frag.appendChild(span);
      }
    });
    el.replaceChild(frag, node);
  });
}
