// The feedback section of /results is the page an operator opens between
// sessions. These tests cover the render itself, not just the maths in
// lib/survey.js: a typo in a template string here would otherwise surface as
// a 502 on the evening of day 1, with nobody able to see the scores.

import { describe, it, expect } from 'vitest';
import { buildFeedbackReport } from './survey.js';
import { renderFeedbackBody, renderFeedbackPanel, renderSurveysPage } from './feedback-render.js';

const responses = [
  {
    day: 'day1',
    respondent: 'a',
    nps: 10,
    dayRating: 9,
    bestThing: 'The story structure exercise',
    improve: 'More breakout time',
    anythingElse: '',
    answers: { teaching: 'Excellent', exercises: 'Good' },
  },
  {
    day: 'day1',
    respondent: 'b',
    nps: 5,
    dayRating: 6,
    bestThing: '',
    improve: 'Slower through the frameworks',
    anythingElse: 'Audio dropped twice',
    answers: { teaching: 'Good', exercises: 'Fair' },
  },
];

const render = (rows) => renderFeedbackBody({ configured: true, report: buildFeedbackReport(rows) });

describe('renderFeedbackBody', () => {
  it('shows the headline NPS and which day it came from', () => {
    const html = render(responses);
    // 1 promoter, 1 detractor of 2 → 0.
    expect(html).toContain('Workshop NPS (Day 1)');
    expect(html).toMatch(/Workshop NPS \(Day 1\)<\/div>\s*<div class="value">0<\/div>/);
  });

  it('signs a positive NPS so it cannot be misread as a percentage', () => {
    const html = render([responses[0]]);
    expect(html).toContain('+100');
  });

  it('says so plainly when a day has no answers', () => {
    const html = render(responses);
    expect(html).toContain('No feedback yet.');
  });

  it('lists every verbatim comment', () => {
    const html = render(responses);
    expect(html).toContain('The story structure exercise');
    expect(html).toContain('Slower through the frameworks');
    expect(html).toContain('Audio dropped twice');
  });

  it('reports the promoter/passive/detractor split', () => {
    const html = render(responses);
    expect(html).toContain('1 promoter ·');
    expect(html).toContain('1 detractor');
  });

  // Attendee comments are arbitrary text typed into a public form and rendered
  // into an admin page. They must never execute there.
  it('escapes HTML in a comment instead of rendering it', () => {
    const html = render([
      { ...responses[0], bestThing: '<img src=x onerror="alert(1)">' },
    ]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('renders an empty workshop without throwing or inventing a score', () => {
    const html = render([]);
    expect(html).not.toContain('NaN');
    expect(html).toContain('no responses yet');
  });

  it('says what to fix when the token is missing, rather than looking broken', () => {
    const html = renderFeedbackBody({ configured: false });
    expect(html).toContain('AIRTABLE_PAT');
  });

  it('degrades to a note when Airtable errors, keeping the page up', () => {
    const html = renderFeedbackBody({ configured: true, error: 'Airtable 429' });
    expect(html).toContain('Airtable 429');
    expect(html).toContain('Nothing else on the site is affected');
  });
});

describe('headline sample size', () => {
  it('states how many responses the headline NPS rests on', () => {
    expect(render([responses[0]])).toContain('from 1 response');
    expect(render(responses)).toContain('from 2 responses');
  });

  it('says so when nothing has come in yet', () => {
    expect(render([])).toContain('no responses yet');
  });
});

describe('renderSurveysPage', () => {
  const page = (rows) =>
    renderSurveysPage({ configured: true, report: buildFeedbackReport(rows) }, { fetchedAt: Date.now() });

  it('is a whole page, titled, and links back to the dashboard', () => {
    const html = page(responses);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Workshop Feedback');
    expect(html).toContain('href="/results"');
  });

  it('stays out of search engines', () => {
    expect(page(responses)).toContain('noindex');
  });
});

describe('renderFeedbackPanel', () => {
  const panel = (rows) =>
    renderFeedbackPanel({ configured: true, report: buildFeedbackReport(rows) });

  it('links to the full survey report and shows the headline figures', () => {
    const html = panel(responses);
    expect(html).toContain('href="/results/surveys"');
    expect(html).toContain('Attendees responding');
    expect(html).toContain('from 2 responses');
  });

  it('still links through when feedback is unconfigured or erroring', () => {
    expect(renderFeedbackPanel({ configured: false })).toContain('href="/results/surveys"');
    expect(renderFeedbackPanel({ configured: true, error: 'Airtable 500' }))
      .toContain('could not be read');
  });
});
