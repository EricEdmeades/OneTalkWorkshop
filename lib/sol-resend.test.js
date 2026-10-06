import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./sol-store.js', () => ({
  readOptin: vi.fn(async () => ({ firstName: 'Jane', createdAt: '2026-10-06T00:00:00.000Z' })),
  readRate: vi.fn(async () => []),
  writeRate: vi.fn(async () => {}),
  writeOptin: vi.fn(async () => {}),
  writePending: vi.fn(async () => 'sol/pending/x.json'),
}));
vi.mock('./sol-service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendDelivery: vi.fn(async () => {}),
  recordSend: vi.fn(async () => {}),
}));

const { default: handler } = await import('../api/sol-resend.js');
const store = await import('./sol-store.js');
const svc = await import('./sol-service.js');

const mockRes = () => ({
  statusCode: null, body: null, headers: {},
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});
const post = (email, origin = 'https://onetalkworkshop.com') => ({ method: 'POST', headers: { origin }, body: { email } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(process.env, { RESEND_API_KEY: 'r', SOL_LINK_SECRET: 's'.repeat(40), KEAP_API_KEY: 'k', KEAP_TAG_ID_SAID_OUT_LOUD: '555', BLOB_STORE_ID: 'st' });
});

describe('POST /api/sol-resend', () => {
  it('resend finds an opt-in made with different casing (Review Focus #3)', async () => {
    const res = mockRes();
    await handler(post('  JANE@example.com '), res);
    expect(store.readOptin).toHaveBeenCalledWith('jane@example.com');
    expect(svc.sendDelivery).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@example.com', firstName: 'Jane' }));
    expect(svc.recordSend).toHaveBeenCalledWith('jane@example.com', 'Jane', [], expect.any(Number), { withOptin: false });
    expect(res.statusCode).toBe(200);
  });

  it('silent 200 for an unknown email, sends nothing', async () => {
    store.readOptin.mockResolvedValueOnce(null);
    const res = mockRes();
    await handler(post('stranger@example.com'), res);
    expect(res.statusCode).toBe(200);
    expect(svc.sendDelivery).not.toHaveBeenCalled();
  });

  it('silent 200 for a bad origin, reads nothing', async () => {
    const res = mockRes();
    await handler(post('jane@example.com', 'https://evil.example'), res);
    expect(res.statusCode).toBe(200);
    expect(store.readOptin).not.toHaveBeenCalled();
  });

  it('400 on invalid email', async () => {
    const res = mockRes();
    await handler(post('nope'), res);
    expect(res.statusCode).toBe(400);
  });

  it('429 too_soon with spec copy', async () => {
    store.readRate.mockResolvedValueOnce([Date.now() - 1000]);
    const res = mockRes();
    await handler(post('jane@example.com'), res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ success: false, reason: 'too_soon', error: "We've just sent it. Try again in a minute." });
  });

  it('429 daily_cap with spec copy', async () => {
    const n = Date.now();
    store.readRate.mockResolvedValueOnce([n - 3 * 3600_000, n - 2 * 3600_000, n - 3600_000]);
    const res = mockRes();
    await handler(post('jane@example.com'), res);
    expect(res.body.error).toBe("We've sent it a few times now. Write to support@speakernation.com and we'll sort it out.");
  });

  it('502 when Resend fails', async () => {
    svc.sendDelivery.mockRejectedValueOnce(new Error('down'));
    const res = mockRes();
    await handler(post('jane@example.com'), res);
    expect(res.statusCode).toBe(502);
  });
});
