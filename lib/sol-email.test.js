import { describe, it, expect } from 'vitest';
import { buildDeliveryEmail, escapeHtml, SUBJECT, PREVIEW_TEXT } from './sol-email.js';

const link = 'https://onetalkworkshop.com/said-out-loud/download?t=abc.def';

describe('sol-email', () => {
  it('uses the spec subject', () => {
    expect(SUBJECT).toBe('Your copy of Said Out Loud');
    expect(buildDeliveryEmail({ firstName: 'Jane', link }).subject).toBe(SUBJECT);
  });

  it('includes preview text, greeting, link, copy and sign-off in HTML', () => {
    const { html } = buildDeliveryEmail({ firstName: 'Jane', link });
    expect(html).toContain(PREVIEW_TEXT);
    expect(html).toContain('Hi Jane,');
    expect(html).toContain(`href="${link}"`);
    expect(html).toContain('Download the book');
    expect(html).toContain('If you catch me breaking one, reply and tell me.');
    expect(html).toContain('This link is yours for 30 days.');
  });

  it('escapes first name in HTML (Review Focus #2) but keeps it raw in text', () => {
    const { html, text } = buildDeliveryEmail({ firstName: '<b>Jo</b> "x"', link });
    expect(html).toContain('Hi &lt;b&gt;Jo&lt;/b&gt; &quot;x&quot;,');
    expect(html).not.toContain('<b>Jo</b>');
    expect(text).toContain('Hi <b>Jo</b> "x",');
  });

  it('has a full plain-text part with the bare link', () => {
    const { text } = buildDeliveryEmail({ firstName: 'Jane', link });
    expect(text).toContain(`Download the book: ${link}`);
    expect(text).toContain('Start with the AI tells chapter.');
    expect(text).toContain('onetalkworkshop.com/said-out-loud');
  });

  it('escapeHtml covers the five characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
