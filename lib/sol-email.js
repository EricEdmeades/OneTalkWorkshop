// lib/sol-email.js — the Said Out Loud delivery email. Copy is verbatim from
// the spec (§4.4). Plain single column, one bulletproof button, full text part,
// no attachments (attachments hurt inbox placement).

export const SUBJECT = 'Your copy of Said Out Loud';
export const PREVIEW_TEXT = 'The field guide is inside. One link, no strings.';

const INK = '#141824';
const AMBER = '#E9A13B';
const TEXT = '#1C2128';
const MUTED = '#5C6470';
const PAPER = '#F8F5F0';

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildText({ firstName, link }) {
  return [
    `Hi ${firstName},`,
    '',
    "Here's your copy of Said Out Loud.",
    '',
    `Download the book: ${link}`,
    '',
    'Start with the AI tells chapter. Then read one of your own scripts out loud and see how many you catch.',
    '',
    'The whole book follows its own rules. If you catch me breaking one, reply and tell me.',
    '',
    'Eric',
    '',
    'This link is yours for 30 days. After that, visit onetalkworkshop.com/said-out-loud for a fresh one.',
  ].join('\n');
}

const para = (inner, extra = '') =>
  `<p style="margin:0 0 18px;font:16px/1.7 Inter,Helvetica,Arial,sans-serif;color:${TEXT};${extra}">${inner}</p>`;

function button(href) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 26px"><tr>
<td style="border-radius:9999px;background:${AMBER}">
<a href="${href}" style="display:inline-block;padding:14px 30px;font:600 16px Inter,Helvetica,Arial,sans-serif;color:${INK};text-decoration:none;border-radius:9999px">Download the book</a>
</td></tr></table>`;
}

function buildHtml({ firstName, link }) {
  return `<!doctype html><html><body style="margin:0;background:${PAPER}">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(PREVIEW_TEXT)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px"><tr><td style="padding:36px 32px">
${para(`Hi ${escapeHtml(firstName)},`)}
${para("Here's your copy of <em>Said Out Loud</em>.")}
${button(escapeHtml(link))}
${para('Start with the AI tells chapter. Then read one of your own scripts out loud and see how many you catch.')}
${para('The whole book follows its own rules. If you catch me breaking one, reply and tell me.')}
${para('Eric', 'font-weight:600')}
${para('<em>This link is yours for 30 days. After that, visit onetalkworkshop.com/said-out-loud for a fresh one.</em>', `font-size:13px;color:${MUTED};margin:24px 0 0`)}
</td></tr></table></td></tr></table></body></html>`;
}

export function buildDeliveryEmail({ firstName, link }) {
  return { subject: SUBJECT, html: buildHtml({ firstName, link }), text: buildText({ firstName, link }) };
}
