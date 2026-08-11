import { describe, it, expect } from 'vitest';
import { renderRegistrationsPage, renderRegistrationsPanel } from './registrations-render.js';

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

  it('shows a Keap-unavailable banner and dashes the roster when keapError is set', () => {
    const html = renderRegistrationsPage(combined(), opts({ keapError: 'Keap orders: 429' }));
    expect(html).toContain('Keap channel unavailable');
    expect(html).toContain('<div class="value">—</div>');
    expect(html).not.toContain('<div class="value">341</div>');
  });

  it('shows the real roster and no banner when Keap is healthy', () => {
    const html = renderRegistrationsPage(combined(), opts());
    expect(html).not.toContain('Keap channel unavailable');
    expect(html).toContain('<div class="value">341</div>');
  });

  it('shows a muted snapshot-age note (not the banner) when Keap data is stale', () => {
    const html = renderRegistrationsPage(
      combined(),
      opts({ keapStale: true, keapFetchedAt: Date.now() - 45 * 60 * 1000 })
    );
    expect(html).not.toContain('Keap channel unavailable');
    expect(html).toContain('stored snapshot');
    // The operator needs to know HOW stale before trusting the number.
    expect(html).toContain('45 minutes ago');
    expect(html).toContain('<div class="value">341</div>'); // real roster still shown
  });

  it('still renders the stale note when the snapshot has no usable timestamp', () => {
    const html = renderRegistrationsPage(combined(), opts({ keapStale: true, keapFetchedAt: null }));
    expect(html).toContain('stored snapshot');
    expect(html).toContain('unknown');
  });
});

describe('renderRegistrationsPanel — dashboard summary', () => {
  it('shows the roster count when Keap data is present', () => {
    expect(renderRegistrationsPanel(combined())).toContain('<div class="value">341</div>');
  });

  // Without a Keap snapshot the roster total is structurally 0. Showing that 0
  // on the dashboard would read as "nobody registered", so it must dash out the
  // same way the full report does.
  it('dashes the roster rather than showing 0 when there is no Keap data', () => {
    const html = renderRegistrationsPanel(combined({ registrations: 0 }), {
      keapError: 'no snapshot yet',
    });
    expect(html).toContain('<div class="value">—</div>');
    expect(html).not.toContain('<div class="value">0</div>');
  });

  it('still shows the Stripe money figures when Keap is unavailable', () => {
    const html = renderRegistrationsPanel(combined(), { keapError: 'no snapshot yet' });
    expect(html).toContain('Collected');
    expect(html).toContain('Contracted');
  });
});
