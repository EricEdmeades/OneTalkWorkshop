// The dashboard is the page an operator lands on, so its job is narrow: show
// each report's headline figures and link through. These tests hold it to
// that, and to not falling over when one of the two sources is unavailable.

import { describe, it, expect } from 'vitest';
import { renderDashboard } from './dashboard-render.js';
import { buildFeedbackReport } from './survey.js';

const report = {
  totals: { registrations: 238, collectedCents: 184500, contractedCents: 231000 },
  events: [],
};

const feedback = {
  configured: true,
  report: buildFeedbackReport([
    { day: 'day1', respondent: 'a', nps: 10, dayRating: 9, answers: {} },
    { day: 'day1', respondent: 'b', nps: 9, dayRating: 8, answers: {} },
  ]),
};

const dashboard = (overrides = {}) =>
  renderDashboard({
    report,
    feedback,
    fetchedAt: Date.now(),
    truncated: false,
    maxSessions: 25000,
    ...overrides,
  });

describe('renderDashboard', () => {
  it('links to both full reports', () => {
    const html = dashboard();
    expect(html).toContain('href="/results/registrations"');
    expect(html).toContain('href="/results/surveys"');
  });

  it('carries the headline figures, so the common question needs no extra click', () => {
    const html = dashboard();
    expect(html).toContain('238'); // registrations
    expect(html).toContain('+100'); // NPS from two promoters
    expect(html).toContain('$1,845'); // collected
  });

  it('renders when feedback is unavailable, rather than dropping the whole page', () => {
    const html = dashboard({ feedback: { configured: true, error: 'Airtable 429' } });
    expect(html).toContain('href="/results/registrations"');
    expect(html).toContain('could not be read');
    expect(html).toContain('238');
  });

  it('surfaces a truncated Stripe scan instead of quietly under-reporting', () => {
    expect(dashboard({ truncated: true })).toContain('25,000');
  });

  it('stays out of search engines', () => {
    expect(dashboard()).toContain('noindex');
  });
});
