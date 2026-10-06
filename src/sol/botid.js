// Vercel BotID: must run before any fetch to a protected path. Imported first by
// every Said Out Loud page entrypoint; the server side is lib/sol-bot.js and the
// challenge proxy rewrites live in vercel.json.
import { initBotId } from 'botid/client/core';

initBotId({
  protect: [
    { path: '/api/sol-optin', method: 'POST' },
    { path: '/api/sol-resend', method: 'POST' },
  ],
});
