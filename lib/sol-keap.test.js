import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./keap-contact.js', () => ({
  upsertContact: vi.fn(async () => 42),
  applyTag: vi.fn(async () => undefined),
  addNote: vi.fn(async () => true),
}));
const kc = await import('./keap-contact.js');
const { syncContactToKeap, buildNote, OPT_IN_REASON } = await import('./sol-keap.js');
const { makePending } = await import('./sol-pending.js');

const rec = makePending({ email: 'jane@example.com', firstName: 'Jane', speakAbout: 'Nursing leadership', ref: 'pod1', now: Date.UTC(2026, 9, 6) });

beforeEach(() => vi.clearAllMocks());

describe('sol-keap', () => {
  it('upserts with the opt-in reason, tags, notes', async () => {
    expect(await syncContactToKeap(rec, 555)).toBe(42);
    expect(kc.upsertContact).toHaveBeenCalledWith({ firstName: 'Jane', lastName: '', email: 'jane@example.com', optInReason: OPT_IN_REASON });
    expect(kc.applyTag).toHaveBeenCalledWith(42, 555);
    const { title, text } = buildNote(rec, 555);
    expect(kc.addNote).toHaveBeenCalledWith(42, title, text);
  });

  it('note carries the speak-about answer, source, ref and date', () => {
    const { title, text } = buildNote(rec, 555);
    expect(title).toBe('Said Out Loud opt-in (2026-10-06)');
    expect(text).toContain('Speaks about: Nursing leadership');
    expect(text).toContain('Source: onetalkworkshop.com/said-out-loud');
    expect(text).toContain('Ref: pod1');
    expect(text).toContain('Tag applied: 555');
  });

  it('note says (not given) when speakAbout is empty', () => {
    expect(buildNote({ ...rec, speakAbout: '' }, 1).text).toContain('Speaks about: (not given)');
  });

  it('propagates tag failures', async () => {
    kc.applyTag.mockRejectedValueOnce(new Error('tag bad'));
    await expect(syncContactToKeap(rec, 1)).rejects.toThrow('tag bad');
  });
});
