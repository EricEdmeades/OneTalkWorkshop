// Publishing permission. These tests exist because the failure they guard
// against is not a broken page — it is quoting someone on a sales page who
// never agreed to it, which no amount of later fixing undoes.
//
// The rule under test everywhere here: consent must be granted explicitly.
// Absent, unrecognised, or predating the question all mean no.

import { describe, it, expect } from 'vitest';
import { normaliseConsent } from '../api/survey.js';
import { buildFeedbackReport, testimonialsWithConsent } from './survey.js';
import { renderTestimonials } from './feedback-render.js';

const say = (text, extra = {}) => ({
  day: 'day3',
  respondent: 'r',
  answers: { testimonial: text },
  ...extra,
});

describe('normaliseConsent', () => {
  it('keeps each of the three answers the form can produce', () => {
    expect(normaliseConsent('Named')).toBe('Named');
    expect(normaliseConsent('Anonymous')).toBe('Anonymous');
    expect(normaliseConsent('Declined')).toBe('Declined');
  });

  it('falls back to Declined for anything else', () => {
    // A hand-rolled POST, a renamed radio value, a half-shipped client —
    // every one of these has to land on "no".
    for (const value of [undefined, null, '', 'named', 'yes', true, 1, {}, ['Named']]) {
      expect(normaliseConsent(value)).toBe('Declined');
    }
  });
});

describe('testimonialsWithConsent', () => {
  it('marks a pre-consent record as never asked, not as permission', () => {
    // Every August 2026 record looks like this: a real quote, no answer to a
    // question that did not exist. It must never read as a yes.
    const [item] = testimonialsWithConsent([say('It changed how I speak.')]);
    expect(item.consent).toBe('unasked');
    expect(item.name).toBe('');
  });

  it('carries the name only when the consent is Named', () => {
    const [named] = testimonialsWithConsent([
      say('Worth every hour.', { marketingConsent: 'Named', displayName: 'Jane Okafor' }),
    ]);
    expect(named).toMatchObject({ consent: 'Named', name: 'Jane Okafor' });
  });

  it('drops a name left behind on a record that is now Anonymous', () => {
    // Someone picks Named, types a name, then changes their mind. The client
    // clears the field, but a resubmission or a hand edit could leave it set.
    const [item] = testimonialsWithConsent([
      say('Best three days of my year.', {
        marketingConsent: 'Anonymous',
        displayName: 'Jane Okafor',
      }),
    ]);
    expect(item.consent).toBe('Anonymous');
    expect(item.name).toBe('');
  });

  it('keeps a declined quote in the report but flagged', () => {
    // Eric still needs to see it — the aggregate is the point — he just
    // cannot publish it.
    const [item] = testimonialsWithConsent([
      say('Good, not for me though.', { marketingConsent: 'Declined' }),
    ]);
    expect(item.consent).toBe('Declined');
  });

  it('ignores responses with no testimonial text', () => {
    expect(testimonialsWithConsent([say('   '), say('')])).toEqual([]);
  });
});

describe('renderTestimonials', () => {
  const report = (rows) => buildFeedbackReport(rows).testimonials;

  it('counts only the cleared quotes as publishable', () => {
    const html = renderTestimonials(
      report([
        say('A.', { marketingConsent: 'Named', displayName: 'Jane' }),
        say('B.', { marketingConsent: 'Anonymous' }),
        say('C.', { marketingConsent: 'Declined' }),
        say('D.'),
      ]),
    );
    expect(html).toContain('2 of 4 cleared for publication');
    expect(html).toContain('1 predates the permission question');
  });

  it('labels each quote in words, not colour alone', () => {
    const html = renderTestimonials(
      report([
        say('A.', { marketingConsent: 'Named', displayName: 'Jane' }),
        say('B.', { marketingConsent: 'Declined' }),
      ]),
    );
    expect(html).toContain('Usable with name');
    expect(html).toContain('Do not publish');
  });

  it('escapes the quote and the name', () => {
    // Both are free text typed into a public form.
    const html = renderTestimonials(
      report([
        say('<script>alert(1)</script>', {
          marketingConsent: 'Named',
          displayName: '<img src=x onerror=alert(1)>',
        }),
      ]),
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders nothing when there are no quotes at all', () => {
    expect(renderTestimonials([])).toBe('');
  });
});
