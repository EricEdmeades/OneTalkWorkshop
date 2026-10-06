import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./sol-store.js', () => ({
  readRate: vi.fn(async () => []),
  readOptin: vi.fn(async () => null),
  writeRate: vi.fn(async () => {}),
  writeOptin: vi.fn(async () => {}),
  writePending: vi.fn(async () => 'sol/pending/x.json'),
}));
vi.mock('./sol-service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendDelivery: vi.fn(async () => {}),
  recordSend: vi.fn(async () => {}),
  syncOrQueue: vi.fn(async () => 'synced'),
}));

const { default: handler } = await import('../api/sol-optin.js');
const store = await import('./sol-store.js');
const svc = await import('./sol-service.js');

const mockRes = () => ({
  statusCode: null, body: null, headers: {},
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  status(c) { this.statusCode = c; return this; },
  json(b) { this.body = b; return this; },
});
const body = (o = {}) => ({ firstName: 'Jane', email: ' Jane@Example.com ', speakAbout: 'Nursing', website: '', formStartedAt: Date.now() - 10_000, ref: 'pod1', ...o });
const post = (b, origin = 'https://onetalkworkshop.com') => ({ method: 'POST', headers: { origin }, body: b });
const RETRY = 'Something went wrong on our side. Try again in a minute.';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(process.env, { RESEND_API_KEY: 'r', SOL_LINK_SECRET: 's'.repeat(40), KEAP_API_KEY: 'k', KEAP_TAG_ID_SAID_OUT_LOUD: '555', BLOB_STORE_ID: 'st' });
});

describe('POST /api/sol-optin', () => {
  it('405 on GET', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('500 with visitor-safe copy when config is missing, logs the var', async () => {
    delete process.env.SOL_LINK_SECRET;
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe(RETRY);
    expect(console.error.mock.calls.flat().join(' ')).toContain('SOL_LINK_SECRET');
  });

  it.each([
    ['origin', body(), 'https://evil.example'],
    ['honeypot', body({ website: 'x' }), undefined],
    ['timing', body({ formStartedAt: Date.now() }), undefined],
  ])('silent 200 on spam (%s), sends nothing', async (_, b, origin) => {
    const res = mockRes();
    await handler(post(b, origin), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(svc.sendDelivery).not.toHaveBeenCalled();
  });

  it('400 with field on invalid email', async () => {
    const res = mockRes();
    await handler(post(body({ email: 'nope' })), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, field: 'email', error: 'We need a valid email to send the book.' });
  });

  it('happy path: sends, records with optin, syncs Keap with normalised email and ref', async () => {
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(svc.sendDelivery).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@example.com', firstName: 'Jane' }));
    expect(svc.recordSend).toHaveBeenCalledWith('jane@example.com', 'Jane', [], expect.any(Number), { withOptin: true, skipRate: false });
    expect(svc.syncOrQueue).toHaveBeenCalledWith(expect.objectContaining({ email: 'jane@example.com', speakAbout: 'Nursing', ref: 'pod1' }));
  });

  it('rate-limited opt-in sends nothing and skips Keap (Review Focus #1)', async () => {
    store.readRate.mockResolvedValueOnce([Date.now() - 5_000]);
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(svc.sendDelivery).not.toHaveBeenCalled();
    expect(svc.syncOrQueue).not.toHaveBeenCalled();
  });

  it('502 with retry copy when Resend fails, and skips Keap', async () => {
    svc.sendDelivery.mockRejectedValueOnce(new Error('resend down'));
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe(RETRY);
    expect(svc.syncOrQueue).not.toHaveBeenCalled();
  });

  it('rate read failure fails open (still sends) and logs', async () => {
    store.readRate.mockRejectedValueOnce(new Error('blob down'));
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(200);
    expect(svc.sendDelivery).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('blob failure after send still succeeds (Review Focus #4)', async () => {
    svc.recordSend.mockImplementationOnce(async () => { console.error('[sol] Blob bookkeeping failed'); });
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(200);
  });

  it('truncates an oversized ref to 100 chars', async () => {
    const res = mockRes();
    await handler(post(body({ ref: 'r'.repeat(300) })), res);
    expect(svc.syncOrQueue.mock.calls[0][0].ref).toHaveLength(100);
  });
});

vi.mock('./sol-bot.js', () => ({ isBotRequest: vi.fn(async () => false) }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

describe('BotID, waitUntil, failed rate read', () => {
  it('silent 200 and no send when BotID flags a bot', async () => {
    const { isBotRequest } = await import('./sol-bot.js');
    isBotRequest.mockResolvedValueOnce(true);
    const res = mockRes();
    await handler(post(body()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(svc.sendDelivery).not.toHaveBeenCalled();
  });

  it('hands the Keap write to waitUntil instead of making the visitor wait (review minor 3)', async () => {
    const { waitUntil } = await import('@vercel/functions');
    const res = mockRes();
    await handler(post(body()), res);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    expect(svc.syncOrQueue).toHaveBeenCalled();
  });

  it('does not overwrite rate history after a failed read (review minor 1)', async () => {
    store.readRate.mockRejectedValueOnce(new Error('blob down'));
    const res = mockRes();
    await handler(post(body()), res);
    expect(svc.recordSend).toHaveBeenCalledWith('jane@example.com', 'Jane', [], expect.any(Number), { withOptin: true, skipRate: true });
  });
});
