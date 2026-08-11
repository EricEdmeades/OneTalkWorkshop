import { describe, it, expect } from 'vitest';
import { renderRegistrationsPage } from './registrations-render.js';

// A combined report shaped like combineChannels() output.
function combined(over = {}) {
  const webAug = { date: 'august', label: 'August 7–9, 2026', registrations: 3, collectedCents: 372100, contractedCents: 454800, rows: [] };
  const webSep = { date: 'september', label: 'September 18–20, 2026', registrations: 0, collectedCents: 0, contractedCents: 0, rows: [] };
  return {
    events: [
      { date: 'august', label: 'August 7–9, 2026', registrations: 211, web: webAug, keapNetCents: 688200, keapGrossCents: 688200, keapRefundCents: 0, collectedCents: 372100 + 688200, contractedCents: 454800 + 688200 },
      { date: 'september', label: 'September 18–20, 2026', registrations: 130, web: webSep, keapNetCents: 817900, keapGrossCents: 900000, keapRefundCents: 82100, collectedCents: 817900, contractedCents: 817900 },
    ],
    totals: {
      registrations: 341,
      collectedCents: 372100 + 688200 + 817900,
      contractedCents: 454800 + 688200 + 817900,
      webCollectedCents: 372100,
      webContractedCents: 454800,
      keapNetCents: 1506100,
      keapGrossCents: 1588200,
      keapRefundCents: 82100,
      refundedCents: 0,
      refundedCount: 0,
      planRegistrations: 0,
      overlapCount: 0,
      ...over,
    },
  };
}

const opts = (over = {}) => ({ truncated: false, fetchedAt: Date.now(), maxSessions: 25000, unattributedRefundedCents: 0, ...over });

describe('renderRegistrationsPage — two channels', () => {
  it('shows the Keap tag headcount as Registrations', () => {
    const html = renderRegistrationsPage(combined(), opts());
    expect(html).toContain('341');
  });

  it('shows combined revenue and a per-channel split', () => {
    const html = renderRegistrationsPage(combined(), opts());
    // combined collected total = 3721+6882+8179 = $18,782
    expect(html).toContain('$18,782');
    expect(html).toContain('Web'); // channel labels present
    expect(html).toContain('Keap');
  });

  it('renders the de-dup note only when overlap > 0', () => {
    expect(renderRegistrationsPage(combined(), opts())).not.toContain('appear in both channels');
    expect(renderRegistrationsPage(combined({ overlapCount: 2 }), opts())).toContain('appear in both channels');
  });

  it('shows the Stripe refund line when refunds were netted', () => {
    const html = renderRegistrationsPage(combined({ refundedCents: 623350, refundedCount: 6 }), opts());
    expect(html).toContain('Net of refunds');
    expect(html).toContain('$6,233.50');
  });

  it('keeps the web per-code detail table', () => {
    const html = renderRegistrationsPage(combined(), opts());
    expect(html).toContain('Web checkout by code');
  });

  it('shows the Keap/Woo refund line when Keap refunds were netted', () => {
    // default fixture has keapRefundCents 82100
    expect(renderRegistrationsPage(combined(), opts())).toContain('refunded and netted');
  });

  it('omits the Keap/Woo refund line when there were no Keap refunds', () => {
    expect(renderRegistrationsPage(combined({ keapRefundCents: 0 }), opts())).not.toContain('refunded and netted');
  });

  it('shows the orphan line only when a plan exists and refunds are unmatched', () => {
    const html = renderRegistrationsPage(combined({ planRegistrations: 1 }), opts({ unattributedRefundedCents: 190800 }));
    expect(html).toContain("weren't matched");
    expect(html).toContain('$1,908');
  });

  it('omits the orphan line when there is no payment plan', () => {
    expect(renderRegistrationsPage(combined(), opts({ unattributedRefundedCents: 190800 }))).not.toContain("weren't matched");
  });

  it('omits the orphan line when nothing is unmatched', () => {
    expect(renderRegistrationsPage(combined({ planRegistrations: 1 }), opts({ unattributedRefundedCents: 0 }))).not.toContain("weren't matched");
  });
});
