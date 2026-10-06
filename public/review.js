/* Review mode — drag a box over any part of the page, attach a comment,
   export all comments as markdown to share. Prototype-only tool; remove
   the script tag before production. Storage: localStorage 'sa-review-comments'. */

(function () {
  /* One bucket per page. The landing page keeps the original unsuffixed key so
     any comments already saved there survive; other pages get their own, so
     pins from one page never render over another. */
  const FILE = (window.location.pathname.split('/').pop() || 'index.html');
  /* Keyed by the full path, not the last segment: a shared host serving
     /368/1 and /369/1 must not pool their pins. '/', '/index.html' and a
     trailing slash all collapse to the same bucket. */
  const PATH = window.location.pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  const PAGE = PATH === '' ? '' : ':' + PATH;
  // Keyed per site+page so the same file drops into any project without
  // comment collisions between sites sharing a browser.
  const SITE = window.location.hostname || 'local';
  const KEY = 'review-comments:' + SITE + PAGE;
  /* Pre-full-path keys used the bare filename (':landing.html'). Only flat
     single-segment pages ever had meaningful buckets there; nested paths
     would have collided, so they are not migrated. */
  const FLAT = window.location.pathname.split('/').length === 2;
  const LEGACY_PAGE = FILE === 'index.html' ? '' : ':' + FILE;
  try {
    const old = FLAT && localStorage.getItem('review-comments:' + SITE + LEGACY_PAGE);
    if (old && !localStorage.getItem(KEY)) localStorage.setItem(KEY, old);
  } catch (e) {}
  /* Kaizen integration (optional): set data attributes on the script tag —
     <script src="review.js" data-kaizen-site="SITEKEY"
             data-kaizen-base="https://kaizen.ericedmeades.com"></script>
     Adds a "Send to Kaizen" button that files ALL comments as ONE ticket
     via the kaizen embed-token + ingest flow. Reviewer email is asked once
     and remembered per browser. */
  const SCRIPT = document.currentScript;
  const KZ_SITE = SCRIPT && SCRIPT.dataset ? SCRIPT.dataset.kaizenSite : '';
  const KZ_BASE = (SCRIPT && SCRIPT.dataset && SCRIPT.dataset.kaizenBase) ||
    'https://kaizen.ericedmeades.com';
  const KZ_EMAIL_KEY = 'review-kaizen-email';
  /* Migration: the 355 prototype originally used 'sa-review-comments' keys —
     carry those forward once so saved pins survive the key change. */
  try {
    const legacy = FLAT && localStorage.getItem('sa-review-comments' + LEGACY_PAGE);
    if (legacy && !localStorage.getItem(KEY)) localStorage.setItem(KEY, legacy);
  } catch (e) {}
  const PAGE_LABEL = PATH || '/';
  let active = false;
  let drag = null;

  const css = `
    .rv-toggle { position: fixed; left: 16px; bottom: 16px; z-index: 9000;
      font: 600 13px Manrope, sans-serif; padding: 10px 16px; border-radius: 9999px;
      border: 1px solid rgba(28,33,40,0.25); background: #fff; color: #1C2128;
      cursor: pointer; box-shadow: 0 8px 24px -8px rgba(20,24,36,0.3); }
    .rv-toggle.on { background: #C24A3A; color: #fff; border-color: #C24A3A; }
    body.rv-active { cursor: crosshair; }
    body.rv-active a, body.rv-active button, body.rv-active summary { pointer-events: none; }
    .rv-toggle, .rv-panel, .rv-form, .rv-form * , .rv-panel * { pointer-events: auto !important; }
    .rv-box { position: absolute; z-index: 8900; border: 2px dashed #C24A3A;
      background: rgba(194,74,58,0.12); pointer-events: none; }
    .rv-pin { position: absolute; z-index: 8950; width: 26px; height: 26px;
      border-radius: 50%; background: #C24A3A; color: #fff; font: 700 13px/26px Manrope, sans-serif;
      text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.35); cursor: pointer; }
    .rv-region { position: absolute; z-index: 8890; border: 1.5px solid rgba(194,74,58,0.8);
      background: rgba(194,74,58,0.07); pointer-events: none; }
    .rv-form { position: absolute; z-index: 9100; width: 300px; background: #fff;
      border: 1px solid rgba(92,100,112,0.3); border-radius: 12px; padding: 12px;
      box-shadow: 0 12px 32px -8px rgba(20,24,36,0.35); font-family: Inter, sans-serif; }
    .rv-form textarea { width: 100%; height: 74px; box-sizing: border-box; font: 14px Inter, sans-serif;
      padding: 8px; border: 1px solid rgba(92,100,112,0.3); border-radius: 8px; resize: vertical; }
    .rv-form .rv-row { display: flex; gap: 8px; margin-top: 8px; justify-content: flex-end; }
    .rv-form button { font: 600 12px Manrope, sans-serif; padding: 7px 14px; border-radius: 9999px;
      border: 1px solid rgba(28,33,40,0.2); background: #fff; cursor: pointer; }
    .rv-form button.rv-save { background: #E9A13B; border-color: #E9A13B; }
    .rv-panel { position: fixed; right: 16px; bottom: 16px; z-index: 9000; width: 320px;
      max-height: 55vh; overflow: auto; background: #fff; border: 1px solid rgba(92,100,112,0.3);
      border-radius: 14px; padding: 14px; font-family: Inter, sans-serif; font-size: 13px;
      box-shadow: 0 12px 32px -8px rgba(20,24,36,0.35); display: none; }
    body.rv-active .rv-panel { display: block; }
    .rv-panel h4 { font: 700 14px Manrope, sans-serif; margin: 0 0 10px; }
    .rv-item { border-top: 1px solid rgba(92,100,112,0.18); padding: 8px 0; }
    .rv-item b { color: #C24A3A; cursor: pointer; }
    .rv-item .rv-meta { color: #5C6470; font-size: 11px; }
    .rv-item .rv-del { float: right; border: none; background: none; color: #5C6470;
      cursor: pointer; font-size: 14px; }
    .rv-actions { display: flex; gap: 8px; margin-top: 10px; }
    .rv-actions button { flex: 1; font: 600 12px Manrope, sans-serif; padding: 8px 10px;
      border-radius: 9999px; border: 1px solid rgba(28,33,40,0.2); background: #fff; cursor: pointer; }
    .rv-hint { color: #5C6470; font-size: 12px; margin: 0 0 6px; }
    /* the element this pin was drawn on no longer exists — position is the
       original pixels and may no longer point at anything meaningful */
    .rv-pin.rv-drift { background: #5C6470; }
    .rv-region.rv-drift { border-style: dotted; border-color: rgba(92,100,112,0.8);
      background: rgba(92,100,112,0.07); }
    .rv-item .rv-warn { color: #5C6470; font-style: italic; }
    /* never appears on a saved or printed ticket */
    @media print {
      .rv-toggle, .rv-panel, .rv-form, .rv-pin, .rv-region, .rv-box { display: none !important; }
    }
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const load = () => JSON.parse(localStorage.getItem(KEY) || '[]');
  const save = (items) => localStorage.setItem(KEY, JSON.stringify(items));

  function sectionAt(x, y) {
    const el = elementAt(x, y);
    const sec = el && el.closest('section, header.hero, footer, nav');
    if (!sec) return 'page';
    const h = sec.querySelector('h1, h2, h3');
    return (sec.id ? '#' + sec.id + ' ' : '') + (h ? h.textContent.trim().slice(0, 60) : sec.className);
  }

  /* --- element anchoring -------------------------------------------------
     A box drawn at page pixels is meaningless once the layout moves. So at
     drag time we resolve WHICH ELEMENT was circled and store a selector plus
     the box's position as a FRACTION of that element. Every render then asks
     the live DOM where that element is now and redraws from there — pins
     follow their target through reflow, responsive width changes, and copy
     edits above them. Stored pixels survive only as the fallback for when
     the selector no longer resolves. */

  /* Our own overlays sit above the page; elementsFromPoint lets us look past
     them without hiding and re-showing the UI mid-drag. */
  function elementAt(pageX, pageY) {
    const stack = document.elementsFromPoint(pageX - window.scrollX, pageY - window.scrollY);
    return stack.find((el) =>
      !el.closest('.rv-pin, .rv-panel, .rv-form, .rv-toggle, .rv-box, .rv-region')) || null;
  }

  function pageRect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
  }

  /* A selector unique by construction: an id when one uniquely resolves,
     otherwise an nth-of-type chain rooted at body. Deliberately not capped —
     a long selector is ugly but correct, and only a machine reads it. */
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'));
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      if (node.id && document.querySelectorAll('#' + esc(node.id)).length === 1) {
        parts.unshift('#' + esc(node.id));
        return parts.join(' > ');
      }
      const parent = node.parentElement;
      if (!parent) break;
      const sameTag = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
      const tag = node.tagName.toLowerCase();
      parts.unshift(sameTag.length > 1 ? tag + ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')' : tag);
      node = parent;
    }
    parts.unshift('body');
    return parts.join(' > ');
  }

  function labelFor(el) {
    if (!el) return '';
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const raw = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const text = raw ? ' "' + raw.slice(0, 120) + (raw.length > 120 ? '…' : '') + '"' : '';
    return '<' + tag + (el.id ? '#' + el.id : cls) + '>' + text;
  }

  /* The smallest element that CONTAINS the whole box — i.e. the thing the
     reviewer drew around, not whatever happens to sit under the centre. A
     few px of tolerance so a slightly-loose box around a heading still
     anchors to the heading instead of jumping up to its container. */
  function targetFor(rect) {
    const inner = elementAt(rect.x + rect.w / 2, rect.y + rect.h / 2);
    if (!inner) return null;
    const TOL = 8;
    let el = inner;
    while (el && el !== document.body) {
      const pr = pageRect(el);
      const encloses = pr.w > 0 && pr.h > 0 &&
        pr.x <= rect.x + TOL && pr.y <= rect.y + TOL &&
        pr.x + pr.w >= rect.x + rect.w - TOL && pr.y + pr.h >= rect.y + rect.h - TOL;
      if (encloses) break;
      el = el.parentElement;
    }
    if (!el || el === document.body) el = inner;
    const pr = pageRect(el);
    return {
      selector: cssPath(el),
      label: labelFor(el),
      // what sat under the middle, when it differs — narrows a big box down
      inner: el === inner ? '' : labelFor(inner),
      // fractions, not pixels, so the box tracks an element that reflows
      rel: pr.w > 0 && pr.h > 0 ? {
        fx: (rect.x - pr.x) / pr.w, fy: (rect.y - pr.y) / pr.h,
        fw: rect.w / pr.w, fh: rect.h / pr.h,
      } : null,
    };
  }

  /* Where this comment's box belongs RIGHT NOW. Comments saved before
     anchoring existed have no target and fall back to their stored pixels. */
  function liveRect(c) {
    if (c.target && c.target.selector) {
      let el = null;
      try { el = document.querySelector(c.target.selector); } catch (e) { el = null; }
      if (el) {
        const pr = pageRect(el);
        const rel = c.target.rel;
        if (rel && pr.w > 0 && pr.h > 0) {
          return {
            x: Math.round(pr.x + rel.fx * pr.w), y: Math.round(pr.y + rel.fy * pr.h),
            w: Math.round(rel.fw * pr.w), h: Math.round(rel.fh * pr.h), anchored: true,
          };
        }
        return {
          x: Math.round(pr.x), y: Math.round(pr.y),
          w: Math.round(pr.w), h: Math.round(pr.h), anchored: true,
        };
      }
    }
    return { x: c.rect.x, y: c.rect.y, w: c.rect.w, h: c.rect.h, anchored: false };
  }

  const toggle = document.createElement('button');
  toggle.className = 'rv-toggle';
  toggle.textContent = 'Review mode';
  document.body.appendChild(toggle);

  const panel = document.createElement('div');
  panel.className = 'rv-panel';
  document.body.appendChild(panel);

  function renderRegions() {
    document.querySelectorAll('.rv-pin, .rv-region').forEach((n) => n.remove());
    load().forEach((c) => {
      const r = liveRect(c);
      const region = document.createElement('div');
      region.className = 'rv-region' + (r.anchored ? '' : ' rv-drift');
      Object.assign(region.style, {
        left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px',
      });
      document.body.appendChild(region);
      const pin = document.createElement('div');
      pin.className = 'rv-pin' + (r.anchored ? '' : ' rv-drift');
      pin.textContent = c.n;
      pin.title = (r.anchored ? '' : '(target gone — position may have drifted)\n') + c.text;
      Object.assign(pin.style, { left: (r.x - 13) + 'px', top: (r.y - 13) + 'px' });
      document.body.appendChild(pin);
    });
  }

  function renderPanel() {
    const items = load();
    panel.innerHTML = '<h4>Comments (' + items.length + ')</h4>' +
      '<p class="rv-hint">Drag on the page to add one. Click a number to jump.</p>' +
      items.map((c) =>
        '<div class="rv-item" data-n="' + c.n + '">' +
        '<button class="rv-del" title="Delete">&times;</button>' +
        '<b>#' + c.n + '</b> ' + escapeHtml(c.text) +
        '<div class="rv-meta">' + escapeHtml(c.target && c.target.label ? c.target.label : c.section) +
        (liveRect(c).anchored ? '' : ' <span class="rv-warn">· target gone</span>') +
        '</div></div>'
      ).join('') +
      '<div class="rv-actions"><button class="rv-copy">Copy markdown</button>' +
      (KZ_SITE ? '<button class="rv-kaizen">Send to Kaizen</button>' : '') +
      '<button class="rv-clear">Clear all</button></div>';
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function toMarkdown() {
    const items = load();
    const lines = ['# Review comments — ' + (document.title || PAGE_LABEL), '', 'Page: ' + PAGE_LABEL, ''];
    items.forEach((c) => {
      lines.push('## Comment ' + c.n);
      lines.push('- Page: ' + PAGE_LABEL);
      lines.push('- Section: ' + c.section);
      /* The target is the point of the export: it says WHAT was highlighted,
         so the comment stays actionable after the layout has moved on. */
      if (c.target && c.target.label) lines.push('- Target: ' + c.target.label);
      if (c.target && c.target.inner) lines.push('- Inside it: ' + c.target.inner);
      if (c.target && c.target.selector) lines.push('- Selector: `' + c.target.selector + '`');
      lines.push('- Area: x=' + c.rect.x + ' y=' + c.rect.y + ' w=' + c.rect.w + ' h=' + c.rect.h +
        ' (viewport ' + c.viewport + ')');
      lines.push('- Time: ' + c.ts);
      lines.push('');
      lines.push(c.text);
      lines.push('');
    });
    return lines.join('\n');
  }

  function refresh() { renderRegions(); renderPanel(); }

  toggle.addEventListener('click', () => {
    active = !active;
    toggle.classList.toggle('on', active);
    toggle.textContent = active ? 'Exit review' : 'Review mode';
    document.body.classList.toggle('rv-active', active);
    refresh();
  });

  panel.addEventListener('click', (e) => {
    const item = e.target.closest('.rv-item');
    if (e.target.classList.contains('rv-del') && item) {
      const n = Number(item.dataset.n);
      save(load().filter((c) => c.n !== n));
      refresh();
      return;
    }
    if (e.target.tagName === 'B' && item) {
      const c = load().find((x) => x.n === Number(item.dataset.n));
      if (c) window.scrollTo({ top: liveRect(c).y - 120, behavior: 'smooth' });
      return;
    }
    if (e.target.classList.contains('rv-copy')) {
      const md = toMarkdown();
      navigator.clipboard.writeText(md).then(
        () => { e.target.textContent = 'Copied!'; setTimeout(() => { e.target.textContent = 'Copy markdown'; }, 1500); },
        () => {
          const blob = new Blob([md], { type: 'text/markdown' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'review-comments.md';
          a.click();
        }
      );
      return;
    }
    if (e.target.classList.contains('rv-kaizen')) {
      sendToKaizen(e.target);
      return;
    }
    if (e.target.classList.contains('rv-clear')) {
      if (window.confirm('Delete all comments?')) { save([]); refresh(); }
    }
  });

  let box = null;
  document.addEventListener('mousedown', (e) => {
    if (!active || e.button !== 0) return;
    if (e.target.closest('.rv-panel, .rv-form, .rv-toggle, .rv-pin')) return;
    drag = { x: e.pageX, y: e.pageY };
    box = document.createElement('div');
    box.className = 'rv-box';
    document.body.appendChild(box);
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!drag || !box) return;
    const x = Math.min(drag.x, e.pageX), y = Math.min(drag.y, e.pageY);
    const w = Math.abs(e.pageX - drag.x), h = Math.abs(e.pageY - drag.y);
    Object.assign(box.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  });

  document.addEventListener('mouseup', (e) => {
    if (!drag || !box) return;
    const rect = {
      x: Math.round(Math.min(drag.x, e.pageX)),
      y: Math.round(Math.min(drag.y, e.pageY)),
      w: Math.round(Math.abs(e.pageX - drag.x)),
      h: Math.round(Math.abs(e.pageY - drag.y)),
    };
    drag = null;
    if (rect.w < 12 || rect.h < 12) { box.remove(); box = null; return; }
    openForm(rect, box);
    box = null;
  });

  function openForm(rect, boxEl) {
    const form = document.createElement('div');
    form.className = 'rv-form';
    const belowY = rect.y + rect.h + 10;
    Object.assign(form.style, { left: rect.x + 'px', top: belowY + 'px' });
    form.innerHTML = '<textarea placeholder="What should change here?"></textarea>' +
      '<div class="rv-row"><button class="rv-cancel">Cancel</button>' +
      '<button class="rv-save">Save</button></div>';
    document.body.appendChild(form);
    const ta = form.querySelector('textarea');
    ta.focus();
    form.querySelector('.rv-cancel').addEventListener('click', () => { form.remove(); boxEl.remove(); refresh(); });
    form.querySelector('.rv-save').addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) { form.remove(); boxEl.remove(); refresh(); return; }
      const items = load();
      const n = items.length ? Math.max(...items.map((c) => c.n)) + 1 : 1;
      items.push({
        n, text, rect,
        /* Resolved while the box is still on screen — this is what makes the
           comment survive a layout change. Captured before the form is
           removed so nothing of ours is in the way. */
        target: targetFor(rect),
        section: sectionAt(rect.x + rect.w / 2, rect.y + 12),
        viewport: window.innerWidth + 'x' + window.innerHeight,
        ts: new Date().toISOString(),
      });
      save(items);
      form.remove(); boxEl.remove();
      refresh();
    });
  }

  if (load().length) refresh();

  /* Anchored pins are only as current as the last render, so redraw whenever
     the layout can have moved: window resize, and any DOM mutation that
     shifts things around. Both are coalesced into one rAF so a resize drag
     does not thrash. */
  let pending = false;
  function reanchor() {
    if (pending || !load().length) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; renderRegions(); });
  }
  window.addEventListener('resize', reanchor);
  if (window.ResizeObserver) new ResizeObserver(reanchor).observe(document.body);

  /* Colour mode the page declares it rendered —
     <meta name="kaizen:theme" content="light|dark|mixed"> — read at send time.
     No tag (or an unknown value) sends nothing: Kaizen leaves Theme blank
     rather than guess from CSS or the OS setting. */
  function pageTheme() {
    const m = document.querySelector('meta[name="kaizen:theme"]');
    const v = m ? (m.getAttribute('content') || '').trim().toLowerCase() : '';
    return ['light', 'dark', 'mixed'].includes(v) ? v : undefined;
  }

  async function sendToKaizen(btn) {
    const comments = load();
    if (!comments.length) { btn.textContent = 'Nothing to send'; return; }
    let email = localStorage.getItem(KZ_EMAIL_KEY) || '';
    if (!email) {
      email = window.prompt('Your email (so the team can follow up):') || '';
      if (!email) return;
      localStorage.setItem(KZ_EMAIL_KEY, email);
    }
    btn.textContent = 'Sending…';
    try {
      const cfgRes = await fetch(
        KZ_BASE + '/api/embed/config?site=' + encodeURIComponent(KZ_SITE));
      if (!cfgRes.ok) throw new Error('config ' + cfgRes.status);
      const cfg = await cfgRes.json();
      const res = await fetch(KZ_BASE + '/api/feedback/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site: KZ_SITE,
          token: cfg.token,
          hp: '',
          domain: 'Web/App',
          channel: 'Embed',
          category: 'Comment',
          message: toMarkdown(),
          pageUrl: window.location.href,
          pageTitle: document.title,
          theme: pageTheme(),
          submitter: { email: email },
        }),
      });
      if (!res.ok) throw new Error('ingest ' + res.status);
      btn.textContent = 'Sent ✓';
      /* Clear on SUCCESS only. Send is the export: the comments now live in
         the Kaizen ticket, and keeping the local copy only invites a second
         press filing a duplicate of everything (ingest always sends the whole
         set, not just what is new). Cleared after a beat so the reviewer sees
         the confirmation, and via refresh() because the panel that owns this
         button is re-rendered. Failure paths below clear nothing. */
      setTimeout(() => { save([]); refresh(); }, 1200);
    } catch (err) {
      btn.textContent = 'Failed — try Copy';
      setTimeout(() => { btn.textContent = 'Send to Kaizen'; }, 3000);
    }
  }
})();
