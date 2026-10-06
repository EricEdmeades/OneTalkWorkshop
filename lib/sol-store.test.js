import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map();
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (pathname, body) => { store.set(pathname, body); return { pathname }; }),
  get: vi.fn(async (pathname) => (store.has(pathname)
    ? { statusCode: 200, stream: new Response(store.get(pathname)).body }
    : null)),
  list: vi.fn(async ({ prefix }) => ({ blobs: [...store.keys()].filter((k) => k.startsWith(prefix)).map((pathname) => ({ pathname })) })),
  del: vi.fn(async (pathname) => { store.delete(pathname); }),
}));

const s = await import('./sol-store.js');
const { put } = await import('@vercel/blob');
const { makePending } = await import('./sol-pending.js');
const { emailHash } = await import('./email-hash.js');

beforeEach(() => { store.clear(); vi.clearAllMocks(); });

describe('sol-store', () => {
  it('writes every blob private, json, overwritable, no random suffix', async () => {
    await s.writeOptin('jane@example.com', { firstName: 'Jane', now: 0 });
    expect(put.mock.calls[0][2]).toMatchObject({
      access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true,
    });
  });

  it('keys by email hash, never the raw email', async () => {
    await s.writeOptin('Jane@Example.com', { firstName: 'Jane', now: 0 });
    const [path] = [...store.keys()];
    expect(path).toMatch(/^sol\/optins\/[0-9a-f]{64}\.json$/);
    expect(path).not.toBe(`sol/optins/${emailHash('jane@example.com')}.json`);
    expect(path).not.toContain('@');
  });

  it('round-trips the opt-in marker regardless of email casing', async () => {
    await s.writeOptin('jane@example.com', { firstName: 'Jane', now: Date.UTC(2026, 0, 1) });
    expect(await s.readOptin(' JANE@example.com ')).toEqual({ firstName: 'Jane', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(await s.readOptin('nobody@example.com')).toBeNull();
  });

  it('round-trips rate history and defaults to []', async () => {
    expect(await s.readRate('a@b.co')).toEqual([]);
    await s.writeRate('a@b.co', [1, 2]);
    expect(await s.readRate('a@b.co')).toEqual([1, 2]);
  });

  it('lists pending oldest first and reads them back', async () => {
    const later = makePending({ email: 'b@b.co', firstName: 'B', now: 2_000_000_000_000 });
    const earlier = makePending({ email: 'a@b.co', firstName: 'A', now: 1_000_000_000_000 });
    await s.writePending(later);
    await s.writePending(earlier);
    const paths = await s.listPending();
    expect(paths[0]).toMatch(/^sol\/pending\/1000000000000-/);
    expect(await s.readPending(paths[0])).toEqual(earlier);
  });

  it('moveToDead copies then deletes', async () => {
    const r = makePending({ email: 'a@b.co', firstName: 'A', now: 1_000_000_000_000 });
    const path = await s.writePending(r);
    await s.moveToDead(path, r);
    expect(store.has(path)).toBe(false);
    expect([...store.keys()].some((k) => k.startsWith('sol/dead/'))).toBe(true);
  });
});

// Blob keys are an HMAC keyed by SOL_LINK_SECRET, not a bare SHA-256 that anyone
// with a candidate email list could reverse (security L3).
process.env.SOL_LINK_SECRET = 'k'.repeat(40);
describe('blob key hashing', () => {
  it('is stable per email and changes with the secret', async () => {
    await s.writeRate('a@b.co', [1]);
    const first = [...store.keys()][0];
    store.clear();
    process.env.SOL_LINK_SECRET = 'z'.repeat(40);
    await s.writeRate('a@b.co', [1]);
    expect([...store.keys()][0]).not.toBe(first);
    process.env.SOL_LINK_SECRET = 'k'.repeat(40);
  });

  it('refuses to key without a secret', async () => {
    delete process.env.SOL_LINK_SECRET;
    await expect(s.writeRate('a@b.co', [1])).rejects.toThrow('SOL_LINK_SECRET is required');
    process.env.SOL_LINK_SECRET = 'k'.repeat(40);
  });
});
