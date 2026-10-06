// lib/sol-bot.js — Vercel BotID check for the Said Out Loud form endpoints.
// The pages call initBotId() (src/sol/*.js) and vercel.json proxies the BotID
// challenge, so a real browser's POST carries the BotID headers checked here.
// Fails open: if BotID itself errors, delivery to a real person must not stop.
import { checkBotId } from 'botid/server';

export async function isBotRequest(req) {
  try {
    const verification = await checkBotId({ advancedOptions: { headers: req.headers } });
    return Boolean(verification?.isBot);
  } catch (err) {
    console.error(`[sol-bot] BotID check failed, allowing request: ${err?.message || err}`);
    return false;
  }
}
