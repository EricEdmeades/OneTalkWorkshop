import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./sol-resend-client.js', () => ({ sendEmail: vi.fn(async () => 'msg_1') }));
vi.mock('./sol-store.js', () => ({
  writeRate: vi.fn(async () => {}),
  writeOptin: vi.fn(async () => {}),
  writePending: vi.fn(async () => 'sol/pending/x.json'),
}));
vi.mock('./sol-keap.js', () => ({ syncContactToKeap: vi.fn(async () => 42) }));

const svc = await import('./sol-service.js');
const { sendEmail } = await import('./sol-resend-client.js');
const store = await import('./sol-store.js');
const { syncContactToKeap } = await import('./sol-keap.js');
const { verifyToken } = await import('./sol-token.js');
const { KeapThrottleError } = await import('./keap-api.js');

const NOW = 1_800_000_000_000;
const ENV = { RESEND_API_KEY: 'r', SOL_LINK_SECRET: 's'.repeat(40), KEAP_API_KEY: 'k', KEAP_TAG_ID_SAID_OUT_LOUD: '555', BLOB_STORE_ID: 'st' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(process.env, ENV);
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_BRANCH_URL;
  delete process.env.SOL_PUBLIC_BASE_URL;
});

describe('publicBaseUrl', () => {
  it('uses the override first', () => expect(svc.publicBaseUrl({ SOL_PUBLIC_BASE_URL: 'https://x.example/' })).toBe('https://x.example'));
  it('production → onetalkworkshop.com', () => expect(svc.publicBaseUrl({ VERCEL_ENV: 'production' })).toBe('https://onetalkworkshop.com'));
  it('preview → branch url', () => expect(svc.publicBaseUrl({ VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'otw-git-x.vercel.app' })).toBe('https://otw-git-x.vercel.app'));
  it('local fallback', () => expect(svc.publicBaseUrl({})).toBe('http://localhost:3000'));
});

describe('missingConfig', () => {
  it('is empty when all set', () => expect(svc.missingConfig()).toEqual([]));
  it('names missing vars and Blob', () => {
    delete process.env.SOL_LINK_SECRET;
    delete process.env.BLOB_STORE_ID;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(svc.missingConfig()).toEqual(['SOL_LINK_SECRET', 'BLOB']);
  });
});

describe('sendDelivery', () => {
  it('emails a link whose token verifies for this email for 30 days', async () => {
    await svc.sendDelivery({ email: 'jane@example.com', firstName: 'Jane', now: NOW });
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toBe('jane@example.com');
    const t = new URL(msg.text.match(/https?:\/\/\S+/)[0]).searchParams.get('t');
    expect(verifyToken(t, ENV.SOL_LINK_SECRET, NOW + 1).email).toBe('jane@example.com');
    expect(verifyToken(t, ENV.SOL_LINK_SECRET, NOW + 31 * 86_400_000)).toBeNull();
  });

  it('link points at the branded download page', async () => {
    await svc.sendDelivery({ email: 'a@b.co', firstName: 'A', now: NOW });
    expect(sendEmail.mock.calls[0][0].text).toContain('http://localhost:3000/said-out-loud/download?t=');
  });
});

describe('recordSend', () => {
  it('writes rate (and optin when asked)', async () => {
    await svc.recordSend('a@b.co', 'A', [1], NOW, { withOptin: true });
    expect(store.writeRate).toHaveBeenCalledWith('a@b.co', [1, NOW]);
    expect(store.writeOptin).toHaveBeenCalledWith('a@b.co', { firstName: 'A', now: NOW });
  });

  it('never throws on Blob failure (Review Focus #4)', async () => {
    store.writeRate.mockRejectedValueOnce(new Error('blob down'));
    await expect(svc.recordSend('a@b.co', 'A', [], NOW, { withOptin: true })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('syncOrQueue', () => {
  const input = { email: 'a@b.co', firstName: 'A', speakAbout: '', ref: null, now: NOW };

  it('syncs when Keap is healthy', async () => {
    expect(await svc.syncOrQueue(input)).toBe('synced');
    expect(syncContactToKeap.mock.calls[0][1]).toBe(555);
    expect(store.writePending).not.toHaveBeenCalled();
  });

  it('queues on throttle', async () => {
    syncContactToKeap.mockRejectedValueOnce(new KeapThrottleError('x'));
    expect(await svc.syncOrQueue(input)).toBe('queued');
    expect(store.writePending.mock.calls[0][0]).toMatchObject({ email: 'a@b.co', attempts: 0 });
  });

  it('returns lost and logs LOST when even the queue write fails', async () => {
    syncContactToKeap.mockRejectedValueOnce(new Error('keap 500'));
    store.writePending.mockRejectedValueOnce(new Error('blob down'));
    expect(await svc.syncOrQueue(input)).toBe('lost');
    expect(console.error.mock.calls.flat().join(' ')).toMatch(/LOST/);
  });
});

describe('sendDelivery idempotency (security M1)', () => {
  it('keys on the email hash and the minute, so a burst collapses and no raw email reaches Resend headers', async () => {
    await svc.sendDelivery({ email: 'jane@example.com', firstName: 'J', now: NOW });
    await svc.sendDelivery({ email: 'jane@example.com', firstName: 'J', now: NOW + 30_000 });
    const [a, b] = sendEmail.mock.calls.map((c) => c[0].idempotencyKey);
    expect(a).toBe(b);
    expect(a).not.toContain('@');
    await svc.sendDelivery({ email: 'jane@example.com', firstName: 'J', now: NOW + 61_000 });
    expect(sendEmail.mock.calls[2][0].idempotencyKey).not.toBe(a);
  });
});
