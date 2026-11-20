import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import fixtures from './fixtures/telegram-updates.json' with { type: 'json' };
import { registerUser } from './helpers/auth.js';
import { startTestDb, stopTestDb } from './helpers/db.js';

// TC-F12-02, bot half: the language picked on the website (PATCH /users/me) is the language the bot replies in.
// The web half (UI strings, money format) is in client/e2e/settings.spec.ts.

// The webhook answers 200 first and does the work in waitUntil(); collect that work so the test can wait for it.
const background = vi.hoisted(() => []);
vi.mock('@vercel/functions', async (importOriginal) => ({
  ...(await importOriginal()),
  waitUntil: (promise) => {
    background.push(promise);
  },
}));

// Every sendMessage the bot makes, answered the way Telegram answers.
const sent = [];
const telegram = setupServer(
  http.post('https://api.telegram.org/:bot/:method', async ({ params, request: call }) => {
    if (params.method === 'sendMessage') sent.push(await call.json());
    return HttpResponse.json({ ok: true, result: { message_id: 1 } });
  }),
);

beforeAll(async () => {
  await startTestDb();
  telegram.listen({ onUnhandledRequest: 'bypass' }); // supertest's own requests to 127.0.0.1 pass through
});
afterEach(() => {
  sent.length = 0;
});
afterAll(async () => {
  telegram.close();
  await stopTestDb();
});

const CHAT = 5550003333;
let messageId = 0;

// A private chat message in the recorded Telegram shape; returns the text of the bot's reply.
async function say(text) {
  messageId += 1;
  const update = structuredClone(fixtures.text);
  update.update_id += messageId;
  Object.assign(update.message, { message_id: messageId, text });
  update.message.from.id = CHAT;
  update.message.chat.id = CHAT;
  const res = await request(app).post('/api/webhooks/telegram').set('X-Telegram-Bot-Api-Secret-Token', 'test-telegram-secret').send(update);
  expect(res.status).toBe(200);
  await Promise.all(background.splice(0));
  return sent.at(-1);
}

test('TC-F12-02 after the language is switched to English on the website, the Telegram bot replies in English', async () => {
  const { accessToken } = await registerUser({ language: 'vi' });
  const web = (method, path, body) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${accessToken}`).send(body);
  const { body: link } = await web('post', '/chat-links/code');
  await say(`/start ${link.code}`);

  const before = await say('phở 45k');
  expect(before.text).toMatch(/45\.000/);
  expect(before.reply_markup.inline_keyboard[0][0].text).toBe('✅ Lưu');

  // The same call the Settings page and the app bar language button make.
  expect((await web('patch', '/users/me', { language: 'en' })).body.user.language).toBe('en');

  const after = await say('grab 32k');
  expect(after.text).toMatch(/₫32,000/);
  expect(after.reply_markup.inline_keyboard[0][0].text).toBe('✅ Save');
});
