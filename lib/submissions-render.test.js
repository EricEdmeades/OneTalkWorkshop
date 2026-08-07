// The submissions table is the only page in the admin area that destroys
// data, so these tests care about two things: that the rows are readable, and
// that nothing reaches a delete call unless it looks like an Airtable id.

import { describe, it, expect } from 'vitest';
import { renderSubmissionsPage, isRecordId } from './submissions-render.js';

const rows = [
  {
    id: 'recAAAAAAAAAAAAAA',
    submittedAt: '2026-08-07T18:30:00.000Z',
    day: 'day1',
    respondent: '0c1510980a99b4d7e5f61234567890ab',
    nps: 9,
    dayRating: 8,
    bestThing: 'The story structure exercise',
    improve: '',
    anythingElse: '',
    contactEmail: '',
  },
  {
    id: 'recBBBBBBBBBBBBBB',
    submittedAt: '2026-08-08T18:30:00.000Z',
    day: 'day2',
    respondent: 'ff2211aabbccddeeff00112233445566',
    nps: 4,
    dayRating: 5,
    bestThing: '',
    improve: 'Too fast',
    anythingElse: '',
    contactEmail: 'someone@example.com',
  },
];

const page = (data = rows, opts = {}) =>
  renderSubmissionsPage(data, { fetchedAt: Date.parse('2026-08-08T20:00:00.000Z'), ...opts });

describe('isRecordId', () => {
  it('accepts an Airtable record id', () => {
    expect(isRecordId('recAAAAAAAAAAAAAA')).toBe(true);
  });

  // These are the values that must never reach a DELETE call.
  it('rejects anything else', () => {
    expect(isRecordId('')).toBe(false);
    expect(isRecordId('tblIaTmblcwfvDGrY')).toBe(false);
    expect(isRecordId('rec')).toBe(false);
    expect(isRecordId('recAAAA')).toBe(false);
    expect(isRecordId('../../etc/passwd')).toBe(false);
    expect(isRecordId('recAAAAAAAAAAAAAA&records[]=recCCCCCCCCCCCCCC')).toBe(false);
    expect(isRecordId(undefined)).toBe(false);
    expect(isRecordId(null)).toBe(false);
  });
});

describe('renderSubmissionsPage', () => {
  it('lists a checkbox per row carrying its record id', () => {
    const html = page();
    expect(html).toContain('value="recAAAAAAAAAAAAAA"');
    expect(html).toContain('value="recBBBBBBBBBBBBBB"');
  });

  it('posts deletions back to itself, so the Origin check applies', () => {
    const html = page();
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/results/submissions"');
  });

  it('asks for confirmation before destroying anything', () => {
    expect(page()).toContain('confirm(');
  });

  it('orders newest first', () => {
    const html = page();
    expect(html.indexOf('recBBBBBBBBBBBBBB')).toBeLessThan(html.indexOf('recAAAAAAAAAAAAAA'));
  });

  // A bare 8-character string reads like a whole identifier; the ellipsis is
  // what marks it as an abbreviation.
  it('shows the respondent hash abbreviated, never as a bare id', () => {
    const html = page();
    expect(html).toContain('0c151098…');
    expect(html).not.toContain('0c1510980a99b4d7e5f61234567890ab');
  });

  it('shows an opt-in contact address only where one was given', () => {
    const html = page();
    expect(html).toContain('someone@example.com');
    expect(html).toContain('Contact (opt-in)');
  });

  it('escapes comment text rather than rendering it', () => {
    const html = page([{ ...rows[0], bestThing: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('confirms how many rows were removed', () => {
    expect(page(rows, { deleted: 2 })).toContain('Deleted 2 submissions.');
    expect(page(rows, { deleted: 1 })).toContain('Deleted 1 submission.');
  });

  it('surfaces a failure instead of implying the delete worked', () => {
    expect(page(rows, { error: 'Could not delete those rows (Airtable 429).' })).toContain(
      'Airtable 429',
    );
  });

  it('handles an empty table without offering a delete button', () => {
    const html = page([]);
    expect(html).toContain('No submissions yet.');
    expect(html).not.toContain('Delete selected');
  });
});
