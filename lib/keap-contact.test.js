import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findContactByEmail, upsertContact, applyTag, addNote } from './keap-contact.js';
import { KeapThrottleError, KeapTimeoutError } from './keap-api.js';

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});
const timeout = () => Object.assign(new Error('t'), { name: 'TimeoutError' });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.KEAP_API_KEY = 'k';
});

describe('keap-contact', () => {
  it('sends the API key and a timeout signal on every request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ contacts: [] }));
    await findContactByEmail('a@b.co');
    const [url, init] = spy.mock.calls[0];
    expect(url).toContain('email=a%40b.co');
    expect(init.headers['X-Keap-API-Key']).toBe('k');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('upsert creates when not found and passes the opt-in reason', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ contacts: [] }))
      .mockResolvedValueOnce(json({ id: 9 }));
    const id = await upsertContact({ firstName: 'A', lastName: '', email: 'a@b.co', optInReason: 'Why' });
    expect(id).toBe(9);
    expect(JSON.parse(spy.mock.calls[1][1].body).opt_in_reason).toBe('Why');
  });

  it('upsert patches when found', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ contacts: [{ id: 3 }] }))
      .mockResolvedValueOnce(json({}));
    expect(await upsertContact({ firstName: 'A', lastName: '', email: 'a@b.co', optInReason: 'x' })).toBe(3);
    expect(spy.mock.calls[1][1].method).toBe('PATCH');
  });

  it('maps 429 to KeapThrottleError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}, 429));
    await expect(findContactByEmail('a@b.co')).rejects.toBeInstanceOf(KeapThrottleError);
  });

  it('maps an aborted request to KeapTimeoutError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(timeout());
    await expect(findContactByEmail('a@b.co')).rejects.toBeInstanceOf(KeapTimeoutError);
  });

  it('applyTag throws on a per-tag error inside a 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ 77: 'TAG_ID_NOT_FOUND' }));
    await expect(applyTag(1, 77)).rejects.toThrow(/tag\(s\) \[77\]/);
  });

  it('applyTag accepts success metadata objects', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ 77: { date_applied: 'x' } }));
    await expect(applyTag(1, 77)).resolves.toBeUndefined();
  });

  it('addNote returns false and does not throw on HTTP error or timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({}, 500)).mockRejectedValueOnce(timeout());
    expect(await addNote(1, 't', 'b')).toBe(false);
    expect(await addNote(1, 't', 'b')).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe('findOrCreateContact (security H2: never rename an existing contact from an unverified form)', () => {
  it('returns the existing id without PATCHing name or email', async () => {
    const { findOrCreateContact } = await import('./keap-contact.js');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ contacts: [{ id: 3 }] }));
    expect(await findOrCreateContact({ firstName: 'Click evil.example', lastName: '', email: 'a@b.co', optInReason: 'x' })).toBe(3);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('creates when not found', async () => {
    const { findOrCreateContact } = await import('./keap-contact.js');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ contacts: [] })).mockResolvedValueOnce(json({ id: 9 }));
    expect(await findOrCreateContact({ firstName: 'A', lastName: '', email: 'a@b.co', optInReason: 'x' })).toBe(9);
  });
});

describe('error hygiene (security L2)', () => {
  it('truncates Keap error bodies and redacts email addresses', async () => {
    const { createContact } = await import('./keap-contact.js');
    const body = `{"message":"duplicate jane@example.com"} ${'x'.repeat(2000)}`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 400, text: async () => body, json: async () => ({}) });
    const err = await createContact({ firstName: 'J', lastName: '', email: 'jane@example.com', optInReason: 'x' }).catch((e) => e);
    expect(err.message).toContain('Keap create failed: 400');
    expect(err.message).not.toContain('jane@example.com');
    expect(err.message).toContain('[email]');
    expect(err.message.length).toBeLessThan(400);
  });
});
