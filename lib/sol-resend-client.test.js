import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sendEmail, ResendError, FROM, REPLY_TO } from './sol-resend-client.js';

const msg = { to: 'jane@example.com', subject: 'S', html: '<p>h</p>', text: 't' };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.RESEND_API_KEY = 're_test';
});

describe('sol-resend-client', () => {
  it('posts the message with from, reply_to, auth and a timeout', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'msg_1' }) });
    expect(await sendEmail({ ...msg, idempotencyKey: 'k1' })).toBe('msg_1');
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_test');
    expect(init.headers['Idempotency-Key']).toBe('k1');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      from: FROM, to: ['jane@example.com'], reply_to: REPLY_TO, subject: 'S', html: '<p>h</p>', text: 't',
    });
    expect(FROM).toBe('Speaker Nation <support@speakernation.com>');
    expect(REPLY_TO).toBe('support@speakernation.com');
  });

  it('omits Idempotency-Key when not given', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'x' }) });
    await sendEmail(msg);
    expect(spy.mock.calls[0][1].headers).not.toHaveProperty('Idempotency-Key');
  });

  it('throws ResendError with status and body on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 422, text: async () => '{"message":"bad from"}' });
    const err = await sendEmail(msg).catch((e) => e);
    expect(err).toBeInstanceOf(ResendError);
    expect(err.message).toMatch(/422.*bad from/);
  });

  it('wraps network/timeout failures in ResendError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }));
    await expect(sendEmail(msg)).rejects.toBeInstanceOf(ResendError);
  });

  it('throws when the key is missing', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(sendEmail(msg)).rejects.toThrow('RESEND_API_KEY is not set');
  });
});
