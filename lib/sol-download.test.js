import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./sol-pdf.js', () => ({ presignPdfUrl: vi.fn(async () => 'https://store.private.blob.vercel-storage.com/said-out-loud/x.pdf?sig=1') }));
const { default: handler } = await import('../api/sol-download.js');
const pdf = await import('./sol-pdf.js');
const { signToken } = await import('./sol-token.js');

const SECRET = 's'.repeat(40);
const mockRes = () => ({
  statusCode: null, headers: {}, body: null,
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  status(c) { this.statusCode = c; return this; },
  send(b) { this.body = b; return this; },
  end() { return this; },
});
const get = (t) => ({ method: 'GET', query: t === undefined ? {} : { t }, headers: {} });
const fresh = () => signToken({ email: 'a@b.co', exp: Date.now() + 60_000 }, SECRET);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.SOL_LINK_SECRET = SECRET;
});

describe('GET /api/sol-download', () => {
  it('valid token → 302 to presigned URL, no-store', async () => {
    const res = mockRes();
    await handler(get(fresh()), res);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/store\.private\.blob/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([undefined, '', 'garbage'])('missing/invalid token %p → expired state', async (t) => {
    const res = mockRes();
    await handler(get(t), res);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/said-out-loud/download?expired=1');
    expect(pdf.presignPdfUrl).not.toHaveBeenCalled();
  });

  it('mangled token redirects to expired state (Review Focus #5)', async () => {
    const t = fresh();
    for (const bad of [`${t}.`, `${t}%2E`, `${t}>`]) {
      const res = mockRes();
      await handler(get(bad), res);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/said-out-loud/download?expired=1');
    }
  });

  it('expired token → expired state', async () => {
    const t = signToken({ email: 'a@b.co', exp: Date.now() - 1 }, SECRET);
    const res = mockRes();
    await handler(get(t), res);
    expect(res.headers.location).toBe('/said-out-loud/download?expired=1');
  });

  it('presign failure → error state, logged', async () => {
    pdf.presignPdfUrl.mockRejectedValueOnce(new Error('blob down'));
    const t = fresh();
    const res = mockRes();
    await handler(get(t), res);
    expect(res.headers.location).toBe(`/said-out-loud/download?error=1&t=${encodeURIComponent(t)}`);
    expect(console.error).toHaveBeenCalled();
  });

  it('500 when the secret is missing', async () => {
    delete process.env.SOL_LINK_SECRET;
    const res = mockRes();
    await handler(get('x.y'), res);
    expect(res.statusCode).toBe(500);
  });
});
