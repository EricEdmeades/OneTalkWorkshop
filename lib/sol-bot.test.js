import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('botid/server', () => ({ checkBotId: vi.fn(async () => ({ isBot: false })) }));
const { checkBotId } = await import('botid/server');
const { isBotRequest } = await import('./sol-bot.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('isBotRequest', () => {
  it('passes the request headers to BotID (plain Node function, not Next)', async () => {
    const headers = { 'x-is-human': 'abc' };
    expect(await isBotRequest({ headers })).toBe(false);
    expect(checkBotId).toHaveBeenCalledWith({ advancedOptions: { headers } });
  });

  it('reports a bot', async () => {
    checkBotId.mockResolvedValueOnce({ isBot: true });
    expect(await isBotRequest({ headers: {} })).toBe(true);
  });

  it('fails open and logs when BotID itself errors, so delivery never depends on it', async () => {
    checkBotId.mockRejectedValueOnce(new Error('botid down'));
    expect(await isBotRequest({ headers: {} })).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});
