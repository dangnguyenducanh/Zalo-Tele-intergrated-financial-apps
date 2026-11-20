import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { telegram } from '../src/bot/telegram.js';
import { zalo } from '../src/bot/zalo.js';
import telegramUpdates from './fixtures/telegram-updates.json' with { type: 'json' };
import zaloEvents from './fixtures/zalo-events.json' with { type: 'json' };
import { botCalls, stubOutboundHttp } from './helpers/bot-api-stub.js';

// BUG-002: the E2E API server (helpers/e2e-server.js) must never call the real Telegram or Zalo Bot API.

let log;
let outbound;
beforeEach(() => {
  log = [vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
});
afterEach(() => {
  outbound?.close();
  outbound = undefined;
  botCalls.length = 0;
  vi.restoreAllMocks();
});
const logged = () => log.flatMap((spy) => spy.mock.calls.flat()).join('\n');

test('TC-NF-11 the stub answers Telegram and Zalo Bot API calls like the real API and records method + chat id, never the token', async () => {
  outbound = stubOutboundHttp();

  const sent = await telegram.sendText('5550001111', 'xin chào'); // the production adapters, unchanged
  await zalo.sendText('6ede9afa66b88fe6d6a9', 'xin chào');

  expect(sent).toMatchObject({ message_id: 1, chat: { id: '5550001111' }, text: 'xin chào' });
  expect(botCalls).toEqual([
    { platform: 'telegram', method: 'sendMessage', chatId: '5550001111' },
    { platform: 'zalo', method: 'sendMessage', chatId: '6ede9afa66b88fe6d6a9' },
  ]);
  expect(logged()).toContain('[bot-api-stub] telegram sendMessage chat=5550001111');
  // The test-mode tokens (config/env.js) are in the request URLs, but never in the record or the log.
  for (const token of ['test-telegram-token', 'test-zalo-token']) {
    expect(JSON.stringify(botCalls)).not.toContain(token);
    expect(logged()).not.toContain(token);
  }
});

test('TC-NF-11 the stub blocks every other external host and lets localhost through', async () => {
  const local = createServer((req, res) => res.end('local')).listen(0, '127.0.0.1');
  await once(local, 'listening');
  const { port } = local.address();
  outbound = stubOutboundHttp();
  try {
    await expect(fetch('https://example.com/')).rejects.toThrow('fetch failed');
    expect(logged()).toContain('[bot-api-stub] blocked outbound request to example.com');
    // A Zalo photo is downloaded from its own host: not stubbed, so it fails loudly instead of slipping out.
    await expect(zalo.downloadPhoto(zaloEvents.image.message.photo_url)).rejects.toThrow('fetch failed');

    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('local');
    expect(await (await fetch(`http://localhost:${port}/`)).text()).toBe('local');
  } finally {
    local.close();
  }
});

let api;
afterAll(() => api?.kill());

test('TC-NF-11 the E2E server answers bot replies itself, even with real-looking tokens in the environment', async () => {
  const freePort = createServer().listen(0);
  await once(freePort, 'listening');
  const { port } = freePort.address();
  freePort.close();
  const tokens = { TELEGRAM_BOT_TOKEN: '7000000001:AAreal-looking-telegram-token', ZALO_BOT_TOKEN: '3000000001:real-looking-zalo-token' };
  const secrets = { TELEGRAM_WEBHOOK_SECRET: 'test-telegram-secret', ZALO_WEBHOOK_SECRET: 'test-zalo-secret' };
  api = spawn(process.execPath, ['test/helpers/e2e-server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, ...tokens, ...secrets, NODE_ENV: 'test', PORT: String(port), MONGODB_URI: '' }, // '' = in-memory MongoDB
  });
  let output = '';
  api.stdout.on('data', (chunk) => (output += chunk));
  api.stderr.on('data', (chunk) => (output += chunk));
  await vi.waitFor(() => expect(output).toMatch(/API listening/), { timeout: 60_000, interval: 100 });

  // Unlinked chats: each bot answers "please link your account" through its Bot API.
  const post = (path, header, body) =>
    fetch(`http://127.0.0.1:${port}/api/webhooks/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...header }, body: JSON.stringify(body) });
  expect((await post('telegram', { 'X-Telegram-Bot-Api-Secret-Token': secrets.TELEGRAM_WEBHOOK_SECRET }, telegramUpdates.text)).status).toBe(200);
  expect((await post('zalo', { 'X-Bot-Api-Secret-Token': secrets.ZALO_WEBHOOK_SECRET }, zaloEvents.text)).status).toBe(200);

  await vi.waitFor(
    () => {
      expect(output).toContain(`[bot-api-stub] telegram sendMessage chat=${telegramUpdates.text.message.chat.id}`);
      expect(output).toContain(`[bot-api-stub] zalo sendMessage chat=${zaloEvents.text.message.chat.id}`);
    },
    { timeout: 10_000, interval: 100 },
  );
  expect(output).not.toMatch(/webhook update failed|blocked outbound request/);
  for (const token of Object.values(tokens)) expect(output).not.toContain(token);
}, 90_000);
