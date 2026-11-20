// Points both bots at a deployed app, e.g. after a deploy:
//   node --env-file=server/.env server/src/scripts/setWebhooks.js https://sochitieu-btl.vercel.app
// Reads TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET and ZALO_BOT_TOKEN + ZALO_WEBHOOK_SECRET from the
// environment and prints only each platform's answer, never a token or secret. A platform whose
// variables are missing is skipped.
import { pathToFileURL } from 'node:url';

const PLATFORMS = [
  {
    name: 'telegram',
    api: 'https://api.telegram.org/bot',
    vars: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'],
    extra: { allowed_updates: ['message', 'callback_query'] }, // text, photos and ✅/❌ presses
  },
  { name: 'zalo', api: 'https://bot-api.zaloplatforms.com/bot', vars: ['ZALO_BOT_TOKEN', 'ZALO_WEBHOOK_SECRET'], extra: {} },
];

// → { telegram: 'ok' | 'failed: <reason>' | 'skipped: …', zalo: … }
export async function setWebhooks(baseUrl, vars = process.env) {
  const origin = new URL(baseUrl).origin; // "https://x.app/" and "https://x.app" give the same URL
  const results = {};
  for (const { name, api, vars: [tokenVar, secretVar], extra } of PLATFORMS) {
    const token = vars[tokenVar];
    const secret = vars[secretVar];
    if (!token || !secret) {
      results[name] = `skipped: ${tokenVar} or ${secretVar} not set`;
      continue;
    }
    const res = await fetch(`${api}${token}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${origin}/api/webhooks/${name}`, secret_token: secret, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    results[name] = data.ok ? 'ok' : `failed: ${data.description ?? `HTTP ${res.status}`}`;
  }
  return results;
}

// Run from the command line (not when a test imports it).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    console.error('Usage: node --env-file=server/.env server/src/scripts/setWebhooks.js <https://app-url>');
    process.exit(1);
  }
  const results = await setWebhooks(baseUrl);
  for (const [name, result] of Object.entries(results)) console.info(`${name}: ${result}`);
  if (Object.values(results).some((result) => result.startsWith('failed'))) process.exitCode = 1;
}
