import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { telegram } from '../src/bot/telegram.js';
import { whatsapp } from '../src/bot/whatsapp.js';
import { zalo } from '../src/bot/zalo.js';
import { ChannelUsage } from '../src/models/ChannelUsage.js';
import telegramUpdates from './fixtures/telegram-updates.json' with { type: 'json' };
import whatsappWebhooks from './fixtures/whatsapp-webhooks.json' with { type: 'json' };
import zaloEvents from './fixtures/zalo-events.json' with { type: 'json' };
import { botCalls, stubOutboundHttp } from './helpers/bot-api-stub.js';
import { startTestDb, stopTestDb } from './helpers/db.js';
import { mailFile } from './helpers/mail-stub.js';

// BUG-002: the E2E API server (helpers/e2e-server.js) must never call the real Telegram or Zalo Bot API.

let log;
let outbound;
// The Zalo adapter counts every message it sends (docs/02 §2.11.6), so calling it needs a database.
beforeAll(startTestDb);
afterAll(stopTestDb);
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

test('TC-NF-11 the stub answers Telegram, Zalo and WhatsApp (Graph API) calls like the real APIs and records method + chat id, never the token', async () => {
  outbound = stubOutboundHttp();

  const sent = await telegram.sendText('5550001111', 'xin chào'); // the production adapters, unchanged
  await zalo.sendText('6ede9afa66b88fe6d6a9', 'xin chào');
  await whatsapp.sendText('VN.13491208655302741918', 'xin chào'); // to the BSUID: WhatsApp has no chat id of its own

  expect(sent).toMatchObject({ message_id: 1, chat: { id: '5550001111' }, text: 'xin chào' });
  expect(await ChannelUsage.find().lean()).toMatchObject([{ platform: 'zalo', sent: 1 }]); // only the Zalo message is counted
  expect(botCalls).toEqual([
    { platform: 'telegram', method: 'sendMessage', chatId: '5550001111' },
    { platform: 'zalo', method: 'sendMessage', chatId: '6ede9afa66b88fe6d6a9' },
    { platform: 'whatsapp', method: 'messages', chatId: 'VN.13491208655302741918' },
  ]);
  expect(logged()).toContain('[bot-api-stub] telegram sendMessage chat=5550001111');
  // The test-mode tokens (config/env.js) are in the request URLs, but never in the record or the log.
  expect(logged()).toContain('[bot-api-stub] whatsapp messages chat=VN.13491208655302741918');
  for (const token of ['test-telegram-token', 'test-zalo-token', 'test-whatsapp-token']) {
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
    // Likewise a WhatsApp photo: the Graph API's media lookup is not stubbed either.
    await expect(whatsapp.downloadPhoto('1104938573226018')).rejects.toThrow('fetch failed');
    expect(logged()).toContain('[bot-api-stub] blocked outbound request to graph.facebook.com');

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
  const tokens = {
    TELEGRAM_BOT_TOKEN: '7000000001:AAreal-looking-telegram-token',
    ZALO_BOT_TOKEN: '3000000001:real-looking-zalo-token',
    WHATSAPP_ACCESS_TOKEN: 'EAAJBreal-looking-whatsapp-token',
  };
  const secrets = { TELEGRAM_WEBHOOK_SECRET: 'test-telegram-secret', ZALO_WEBHOOK_SECRET: 'test-zalo-secret', WHATSAPP_APP_SECRET: 'test-whatsapp-secret' };
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
  const whatsappBody = JSON.stringify(whatsappWebhooks.text);
  const signature = `sha256=${createHmac('sha256', secrets.WHATSAPP_APP_SECRET).update(whatsappBody).digest('hex')}`;
  expect((await post('telegram', { 'X-Telegram-Bot-Api-Secret-Token': secrets.TELEGRAM_WEBHOOK_SECRET }, telegramUpdates.text)).status).toBe(200);
  expect((await post('zalo', { 'X-Bot-Api-Secret-Token': secrets.ZALO_WEBHOOK_SECRET }, zaloEvents.text)).status).toBe(200);
  // WhatsApp: signed over the bytes sent, so the body goes out as the string that was signed.
  const whatsappPost = await fetch(`http://127.0.0.1:${port}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body: whatsappBody,
  });
  expect(whatsappPost.status).toBe(200);

  await vi.waitFor(
    () => {
      expect(output).toContain(`[bot-api-stub] telegram sendMessage chat=${telegramUpdates.text.message.chat.id}`);
      expect(output).toContain(`[bot-api-stub] zalo sendMessage chat=${zaloEvents.text.message.chat.id}`);
      expect(output).toContain('[bot-api-stub] whatsapp messages chat=VN.13491208655302741918');
    },
    { timeout: 10_000, interval: 100 },
  );
  expect(output).not.toMatch(/webhook update failed|blocked outbound request/);
  for (const token of Object.values(tokens)) expect(output).not.toContain(token);
}, 90_000);

// TC-NF-11 extended for mail (docs/07 §7.10.1, §7.10.5): SMTP is not HTTP, so the stub above cannot see a real send.
test('TC-NF-25 the E2E server with realistic GMAIL_* settings records a sign-up code and never opens SMTP', async () => {
  const freePort = createServer().listen(0);
  await once(freePort, 'listening');
  const { port } = freePort.address();
  freePort.close();
  const gmail = { GMAIL_USER: 'real.sender@gmail.com', GMAIL_APP_PASSWORD: 'abcdefghijklmnop' };
  const server = spawn(process.execPath, ['test/helpers/e2e-server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, ...gmail, NODE_ENV: 'test', PORT: String(port), MONGODB_URI: '' },
  });
  let output = '';
  server.stdout.on('data', (chunk) => (output += chunk));
  server.stderr.on('data', (chunk) => (output += chunk));
  try {
    await vi.waitFor(() => expect(output).toMatch(/API listening/), { timeout: 60_000, interval: 100 });

    const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Lan', email: 'Lan.Stub@Example.com', password: 'correct-horse-1' }),
    });

    // Real SMTP with a made-up app password could not have answered 202: the code went to the stub, not to Gmail.
    expect(res.status).toBe(202);
    const lines = readFileSync(mailFile(port), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0]).toEqual({ stub: true, pid: server.pid }); // the marker a Playwright helper looks for
    expect(lines.slice(1)).toEqual([{ to: 'lan.stub@example.com', purpose: 'signup', code: expect.stringMatching(/^\d{6}$/), language: 'vi' }]);
    expect(output).toContain('[mail-stub] signup code recorded');
    expect(output).not.toMatch(/send failed|smtp\.gmail\.com/);
    for (const secret of [...Object.values(gmail), lines[1].code, 'lan.stub@example.com']) expect(output).not.toContain(secret);
  } finally {
    server.kill();
  }
}, 90_000);
