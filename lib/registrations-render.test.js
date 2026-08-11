import { describe, it, expect } from 'vitest';
import { renderRegistrationsPage } from './registrations-render.js';

// A report shaped like buildReport output, with the refund fields Task 2 added.
function report({
  registrations = 10,
  collectedCents = 1601800,
  contractedCents = 1601800,
  refundedCents = 0,
  refundedCount = 0,
  planRegistrations = 0,
} = {}) {
  return {
    events: [
      { date: 'august', label: 'August 7–9, 2026', registrations, collectedCents, contractedCents, refundedCents, refundedCount, rows: [] },
      { date: 'september', label: 'September 18–20, 2026', registrations: 0, collectedCents: 0, contractedCents: 0, refundedCents: 0, refundedCount: 0, rows: [] },
    ],
    totals: { registrations, collectedCents, contractedCents, refundedCents, refundedCount, planRegistrations },
  };
}

const opts = (over = {}) => ({ truncated: false, fetchedAt: Date.now(), maxSessions: 25000, unattributedRefundedCents: 0, ...over });

describe('renderRegistrationsPage — refund awareness', () => {
  it('shows the net-of-refunds line when refunds were netted', () => {
    const html = renderRegistrationsPage(report({ refundedCents: 623350, refundedCount: 6 }), opts());
    expect(html).toContain('Net of refunds');
    expect(html).toContain('$6,233.50');
    expect(html).toContain('6 registrations');
  });

  it('omits the net-of-refunds line when there were no refunds', () => {
    const html = renderRegistrationsPage(report(), opts());
    expect(html).not.toContain('Net of refunds');
  });

  it('shows the orphan caveat only when a plan exists and refunds are unmatched', () => {
    const html = renderRegistrationsPage(
      report({ planRegistrations: 1 }),
      opts({ unattributedRefundedCents: 190800 })
    );
    expect(html).toContain("weren't matched");
    expect(html).toContain('$1,908');
  });

  it('omits the orphan caveat when there is no payment plan', () => {
    const html = renderRegistrationsPage(report(), opts({ unattributedRefundedCents: 190800 }));
    expect(html).not.toContain("weren't matched");
  });

  it('omits the orphan caveat when nothing is unmatched', () => {
    const html = renderRegistrationsPage(report({ planRegistrations: 1 }), opts({ unattributedRefundedCents: 0 }));
    expect(html).not.toContain("weren't matched");
  });

  it('renders the net headline figures', () => {
    const html = renderRegistrationsPage(report({ registrations: 4, collectedCents: 1601800, contractedCents: 1601800 }), opts());
    expect(html).toContain('$16,018');
  });

  it('uses the singular "registration" when exactly one was dropped', () => {
    const html = renderRegistrationsPage(report({ refundedCents: 129700, refundedCount: 1 }), opts());
    expect(html).toContain('1 registration fully refunded');
    expect(html).not.toContain('1 registrations');
  });

  it('renders both the net-of-refunds line and the orphan caveat together', () => {
    const html = renderRegistrationsPage(
      report({ refundedCents: 623350, refundedCount: 6, planRegistrations: 1 }),
      opts({ unattributedRefundedCents: 190800 })
    );
    expect(html).toContain('Net of refunds');
    expect(html).toContain("weren't matched");
  });
});
