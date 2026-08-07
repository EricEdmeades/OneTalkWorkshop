// lib/report-chrome.js — shared page furniture for the admin reports at
// /results, /results/registrations and /results/surveys.
//
// Server-only (same as lib/results.js): nothing here is bundled into the
// client. It lives in lib/ rather than api/ because Vercel turns every file
// under api/ into its own endpoint, and this is a module, not a route.

export const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function renderShell(title, inner) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} — The One Talk Workshop</title>
<link rel="icon" type="image/png" href="/assets/favicon-512.png">
<style>${PAGE_CSS}</style>
</head>
<body><div class="wrap">${inner}</div></body>
</html>`;
}

// Shared chrome so an error state is a real page, not a bare string. A 401
// that renders as one line of unstyled text reads as "the site is broken"
// when the browser does not surface its password prompt.
export function renderMessage(title, message) {
  return renderShell(
    title,
    `<span class="eyebrow">The One Talk Workshop</span>
     <h1>${escapeHtml(title)}</h1>
     <p class="msg">${message}</p>`
  );
}

export function formatTimestamp(at) {
  return new Date(at).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Anything under a few seconds is this request's own read, not a cache hit —
// call it live rather than "0 minutes old".
export function describeFreshness(at, source) {
  const ageMs = Date.now() - at;
  return ageMs < 5000
    ? `live from ${source}`
    : `read from ${source} ${Math.round(ageMs / 60000)} min ago`;
}

export function renderBackLink() {
  return '<p class="back"><a href="/results">&larr; All reports</a></p>';
}

export const PAGE_CSS = `
  :root {
    --paper: #FAF7F2; --black: #141210; --charcoal: #3A342E;
    --wine: #E26320; --rule: #E2DACF; --muted: #7A7168;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 24px 80px;
    background: var(--paper); color: var(--black);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .wrap { max-width: 900px; margin: 0 auto; }
  .eyebrow {
    display: inline-block; padding: 7px 14px; margin-bottom: 20px;
    border: 1.5px solid var(--wine); border-radius: 2px;
    font-size: 0.68rem; font-weight: 700;
    letter-spacing: 0.16em; text-transform: uppercase; color: var(--wine);
  }
  h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); margin: 0 0 6px; letter-spacing: -0.02em; }
  .generated { color: var(--muted); font-size: 0.85rem; margin: 0 0 40px; }
  .generated a { color: var(--wine); font-weight: 600; }
  .back { margin: 0 0 26px; font-size: 0.85rem; }
  .back a { color: var(--muted); text-decoration: none; font-weight: 600; }
  .back a:hover { color: var(--wine); }
  .totals { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 48px; }
  .card {
    flex: 1 1 200px; padding: 18px 20px;
    background: #fff; border: 1px solid var(--rule); border-radius: 3px;
  }
  .card .label {
    font-size: 0.68rem; font-weight: 700; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 6px;
  }
  .card .value { font-size: 1.7rem; font-weight: 700; letter-spacing: -0.02em; }
  .card.highlight { border-color: var(--wine); border-width: 2px; }
  .card.highlight .value { color: var(--wine); }
  .card-sub { margin-top: 4px; font-size: 0.75rem; color: var(--muted); }
  .event { margin-bottom: 48px; }
  h2 {
    font-size: 1.15rem; margin: 0 0 14px;
    padding-bottom: 10px; border-bottom: 2px solid var(--black);
  }
  table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  th, td { padding: 11px 12px; text-align: left; border-bottom: 1px solid var(--rule); }
  th {
    font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--muted);
  }
  td.num, th.num { text-align: right; }
  td.code { font-weight: 600; }
  td.share { color: var(--charcoal); }
  td.empty { color: var(--muted); font-style: italic; text-align: center; padding: 22px; }
  tfoot td { font-weight: 700; border-top: 2px solid var(--black); border-bottom: none; }
  .note {
    margin-top: 40px; padding-top: 22px; border-top: 1px solid var(--rule);
    color: var(--muted); font-size: 0.82rem; line-height: 1.65; max-width: 62ch;
  }
  .note strong { color: var(--charcoal); }
  .warn {
    padding: 12px 16px; margin-bottom: 24px; border-radius: 3px;
    background: #FDF0E7; border: 1px solid var(--wine);
    color: var(--charcoal); font-size: 0.85rem;
  }
  .msg {
    font-size: 1rem; line-height: 1.7; color: var(--charcoal);
    max-width: 56ch; margin: 0 0 18px;
  }
  .msg code {
    background: #fff; border: 1px solid var(--rule); border-radius: 3px;
    padding: 2px 7px; font-size: 0.92em;
  }
  .nps-bands { margin: -34px 0 22px; color: var(--muted); font-size: 0.82rem; }
  .empty-day { color: var(--muted); font-style: italic; margin: 0; }
  .verbatims { margin-top: 22px; }
  .verbatims h4 {
    font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--muted); margin: 0 0 10px;
  }
  .verbatims ul { margin: 0; padding: 0; list-style: none; }
  .verbatims li {
    padding: 11px 14px; margin-bottom: 8px;
    background: #fff; border-left: 3px solid var(--rule); border-radius: 0 3px 3px 0;
    font-size: 0.9rem; line-height: 1.55; white-space: pre-wrap;
  }

  /* Dashboard: one panel per report, each a link to the full thing. */
  .panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
  .panel {
    display: block; padding: 24px 24px 20px;
    background: #fff; border: 1px solid var(--rule); border-radius: 3px;
    color: inherit; text-decoration: none;
    transition: border-color 150ms ease, transform 150ms ease;
  }
  .panel:hover { border-color: var(--wine); transform: translateY(-2px); }
  .panel h2 { border: 0; padding: 0; margin: 0 0 16px; font-size: 1rem; }
  .panel-figures { display: flex; flex-wrap: wrap; gap: 20px 28px; margin-bottom: 18px; }
  .panel-figure .label {
    font-size: 0.66rem; font-weight: 700; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 4px;
  }
  .panel-figure .value { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
  .panel-figure .value.accent { color: var(--wine); }
  .panel-cta { font-size: 0.82rem; font-weight: 700; color: var(--wine); }
  .panel-note { margin: 0 0 16px; font-size: 0.8rem; color: var(--muted); line-height: 1.5; }
  @media (max-width: 560px) {
    body { padding: 32px 16px 60px; }
    th, td { padding: 9px 7px; font-size: 0.82rem; }
    .nps-bands { margin-top: -28px; }
  }
`;
