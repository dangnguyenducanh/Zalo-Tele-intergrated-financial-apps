import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { telegram } from '../src/bot/telegram.js';
import { whatsapp } from '../src/bot/whatsapp.js';
import { zalo } from '../src/bot/zalo.js';
import { ChannelUsage } from '../src/models/ChannelUsage.js';
import telegramUpdates from './fixtures/telegram-updates.json' with { type: 'json' };
import whatsappWebhooks from './fixtures/whatsapp-webhooks.json' with { type: 'json' };
import zaloEvents from './fixtures/zalo-events.json' with { type: 'json' };
import { agentModeFile, botCalls, stubOutboundHttp } from './helpers/bot-api-stub.js';
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

// The agent service of the E2E server (docs/07 §7.9.5 *drawer E2E*): canned answers, its own agentTurns rows, switchable to 503 with a file.
// The shell holds a real-looking AGENT_URL and secret on purpose: the server must still talk to the stub, never to that host.
test('TC-F14-115 the E2E server answers the drawer from the agent stub: canned answers, rows, ask-back, "Xoá", DUPLICATE, and 503 by the switch file', async () => {
  const freePort = createServer().listen(0);
  await once(freePort, 'listening');
  const { port } = freePort.address();
  freePort.close();
  const agent = { AGENT_URL: 'https://real-agent.example.com', AGENT_SECRET: 'real-looking-agent-secret' };
  const server = spawn(process.execPath, ['test/helpers/e2e-server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, ...agent, NODE_ENV: 'test', PORT: String(port), MONGODB_URI: '' },
  });
  let output = '';
  server.stdout.on('data', (chunk) => (output += chunk));
  server.stderr.on('data', (chunk) => (output += chunk));
  const previousPort = process.env.PORT;
  process.env.PORT = String(port); // agentModeFile() is named after the API port
  try {
    await vi.waitFor(() => expect(output).toMatch(/API listening/), { timeout: 60_000, interval: 100 });
    const call = async (method, path, body, token) => {
      const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
        body: body && JSON.stringify(body),
      });
      return { status: res.status, body: res.status === 204 ? null : await res.json() };
    };

    const email = 'drawer.stub@example.com';
    const pending = await call('POST', '/auth/register', { name: 'Lan', email, password: 'correct-horse-1', language: 'vi' });
    const code = readFileSync(mailFile(port), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).at(-1).code;
    const { accessToken } = (await call('POST', '/auth/register/verify', { email, code, signupToken: pending.body.signupToken })).body;
    const chat = (message, requestId) => call('POST', '/assistant/chat', { message, requestId }, accessToken);

    const first = await chat('tháng 10 thu bao nhiêu', 'r1');
    expect(first).toMatchObject({ status: 200, body: { route: 'rules', text: 'Tháng 10 bạn thu 15.000.000 ₫.', followups: ['Còn tháng 9?', 'Chi tiêu tháng 10?'], remainingToday: 29 } });
    expect((await chat('tháng 10 thu bao nhiêu', 'r1')).status).toBe(409); // the same requestId: the agent's row remembers it
    expect((await call('POST', '/assistant/chat', { message: 'x', requestId: 'r0' })).status).toBe(401);

    const asked = await chat('chi tiêu', 'r2');
    expect(asked.body.card).toEqual({ kind: 'ask_back', options: [{ n: 1, label: 'Thu chi theo kỳ · tháng này' }, { n: 2, label: 'Chi theo danh mục · Ăn uống' }] });
    expect((await chat('2', 'r3')).body.text).toBe('Bạn chọn ý 2: Ăn uống tháng này 45.000 ₫.'); // a live ask-back: the digit goes to the agent as a question
    await chat('chi tiêu hết hạn', 'r4'); // its ten minutes are over
    expect((await chat('2', 'r5')).body).toMatchObject({ route: 'rules', text: 'Câu hỏi đã hết hạn, hãy hỏi lại' }); // Express answers, no capture, no agent call

    const thread = await call('GET', '/assistant/thread', undefined, accessToken);
    expect(thread.body.turns.map((turn) => turn.question)).toEqual(['tháng 10 thu bao nhiêu', 'chi tiêu', '2', 'chi tiêu hết hạn']);
    expect(thread.body.ai.remainingToday).toBe(26);
    expect((await call('DELETE', '/assistant/thread', undefined, accessToken)).status).toBe(204);
    expect((await call('GET', '/assistant/thread', undefined, accessToken)).body).toEqual({ turns: [], ai: { remainingToday: 26 } }); // "Xoá" keeps the count

    // The switch: the same file a Playwright spec writes. A failed turn leaves no row, so Thử lại with the same requestId works.
    writeFileSync(agentModeFile(), 'down');
    expect(await chat('số dư các ví', 'r6')).toMatchObject({ status: 503, body: { error: { code: 'AGENT_UNAVAILABLE' } } });
    writeFileSync(agentModeFile(), 'busy');
    expect(await chat('số dư các ví', 'r6')).toMatchObject({ status: 503, body: { error: { code: 'AGENT_BUSY' } } });
    rmSync(agentModeFile());
    expect((await chat('số dư các ví', 'r6')).status).toBe(200);

    expect(output).not.toMatch(/blocked outbound request|real-agent\.example\.com/);
    for (const secret of [agent.AGENT_SECRET, 'số dư các ví', 'tháng 10 thu bao nhiêu']) expect(output).not.toContain(secret);
  } finally {
    rmSync(agentModeFile(), { force: true }); // while PORT is still this server's
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    server.kill();
  }
}, 120_000);
