import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import enText from '../src/bot/messages.en.js';
import viText from '../src/bot/messages.vi.js';
import { env } from '../src/config/env.js';
import { ChannelUsage } from '../src/models/ChannelUsage.js';
import { ChatLink } from '../src/models/ChatLink.js';
import { LinkCode } from '../src/models/LinkCode.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import { createClaimToken } from '../src/services/chatLinks.js';
import { setWebhooks } from '../src/scripts/setWebhooks.js';
import { monthKey, vnDate, vnParts } from '../src/utils/vnTime.js';
import fixtures from './fixtures/telegram-updates.json' with { type: 'json' };
import { registerUser, resetLoginLimit } from './helpers/auth.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';

// The webhook answers 200 first and hands the real work to waitUntil(). Collect that work so a test can wait for it.
const background = vi.hoisted(() => []);
vi.mock('@vercel/functions', async (importOriginal) => ({
  ...(await importOriginal()),
  waitUntil: (promise) => {
    background.push(promise);
  },
}));

// Every Bot API call the server makes, as { method, body }, answered the way Telegram answers.
// While `hold` is set, sendMessage waits for it, so a test can look at the webhook response before the bot replies.
const calls = [];
let hold = null;
const outbound = setupServer(
  http.post('https://api.telegram.org/:bot/:method', async ({ params, request }) => {
    calls.push({ method: params.method, body: await request.json() });
    if (params.method === 'sendMessage') await hold;
    return HttpResponse.json({ ok: true, result: { message_id: 1000 + calls.length } });
  }),
);

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), ChatLink.init(), LinkCode.init(), Transaction.init()]); // unique indexes first
  // Supertest talks to the app on 127.0.0.1; any other unmocked host is a test bug.
  outbound.listen({
    onUnhandledFrame: ({ frame }) => {
      const { hostname } = new URL(frame.data.request.url);
      if (hostname !== '127.0.0.1' && hostname !== 'localhost') throw new Error(`unmocked request to ${hostname}`);
    },
  });
});
// The webhook only logs a failed update (the platform already has its 200), so a logged error fails the test.
let errorLog;
beforeEach(() => {
  errorLog = vi.spyOn(console, 'error');
});
afterEach(async () => {
  expect(errorLog).not.toHaveBeenCalled();
  errorLog.mockRestore();
  outbound.resetHandlers();
  calls.length = 0;
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(async () => {
  outbound.close();
  await stopTestDb();
});

const SECRET = 'test-telegram-secret'; // TELEGRAM_WEBHOOK_SECRET under NODE_ENV=test (config/env.js)
const CHAT_A = 5550001111; // the private chat in the recorded fixtures
const CHAT_B = 5550002222;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const textOf = (call) => call.body.text;

// Calls the REST API as one logged-in user: api(token).get('/chat-links') …
const api = (accessToken) => {
  const call = (method) => (path, body) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${accessToken}`).send(body);
  return { get: call('get'), post: call('post'), patch: call('patch'), delete: call('delete') };
};

// Recorded updates, copied and pointed at another chat, text or button.
let nextMessageId = 100;
function textUpdate(text, chat = CHAT_A) {
  const update = structuredClone(fixtures.text);
  nextMessageId += 1;
  update.update_id += nextMessageId;
  Object.assign(update.message, { message_id: nextMessageId, text });
  update.message.from.id = chat;
  update.message.chat.id = chat;
  return update;
}
function buttonUpdate(data, chat = CHAT_A) {
  const update = structuredClone(fixtures.callback);
  update.callback_query.data = data;
  update.callback_query.from.id = chat;
  update.callback_query.message.chat.id = chat;
  return update;
}

// POSTs an update the way Telegram does, then waits for the work the webhook handed to waitUntil().
async function deliver(update, secret = SECRET) {
  const res = await request(app).post('/api/webhooks/telegram').set('X-Telegram-Bot-Api-Secret-Token', secret).send(update);
  await Promise.all(background.splice(0));
  return res;
}

// Sends a chat message (or presses a button) and returns the Bot API calls the server made in answer.
async function say(text, chat = CHAT_A) {
  const from = calls.length;
  await deliver(textUpdate(text, chat));
  return calls.slice(from);
}
async function press(data, chat = CHAT_A) {
  const from = calls.length;
  await deliver(buttonUpdate(data, chat));
  return calls.slice(from);
}

// A registered user whose Telegram chat is linked through the deep link, with the ids of some default categories.
async function linkedUser(chat = CHAT_A, overrides = {}) {
  const { accessToken, user } = await registerUser(overrides);
  const me = api(accessToken);
  const { body } = await me.post('/chat-links/code');
  await say(`/start ${body.code}`, chat);
  const { body: categories } = await me.get('/categories');
  const byName = (name) => categories.find((c) => c.names?.vi === name).id;
  return { me, user, food: byName('Ăn uống'), transport: byName('Đi lại'), salary: byName('Lương') };
}

test('TC-F7-01 POST /chat-links/code returns a 6-char code valid for 10 minutes and stores only its hash', async () => {
  const { accessToken, user } = await registerUser();
  const me = api(accessToken);
  const before = Date.now();
  const res = await me.post('/chat-links/code');
  expect(res.status).toBe(201);

  const { code, expiresAt, links } = res.body;
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); // no I/O/0/1 look-alikes
  // The link card assumes this lifetime too (CODE_LIFETIME_MS in client/src/features/bot/LinkCard.tsx): change both.
  const ttl = new Date(expiresAt).getTime() - before;
  expect(ttl).toBeGreaterThanOrEqual(10 * 60 * 1000);
  expect(ttl).toBeLessThan(10 * 60 * 1000 + 5000);
  expect(links.telegram).toBe(`https://t.me/test_bot?start=${code}`);

  // The database has the SHA-256 of the code and no field with the code itself.
  const rows = await LinkCode.find().lean();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ userId: oid(user.id), codeHash: sha256(code), usedAt: null });
  expect(Object.keys(rows[0]).sort()).toEqual(['__v', '_id', 'codeHash', 'createdAt', 'expiresAt', 'updatedAt', 'usedAt', 'userId']);

  // Login required; at most 5 codes per user in 10 minutes.
  expect((await request(app).post('/api/chat-links/code')).status).toBe(401);
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await me.post('/chat-links/code')).status);
  expect(statuses).toEqual([201, 201, 201, 201, 429]);
});

test('TC-F7-10 the code comes with one link per chat app: Telegram start, WhatsApp prefilled "/link CODE", the Zalo bot', async () => {
  const { accessToken } = await registerUser();
  const res = await api(accessToken).post('/chat-links/code');
  expect(res.status).toBe(201);

  const { code, links } = res.body;
  expect(res.body).not.toHaveProperty('telegramDeepLink'); // replaced by links (docs/02 §2.10.2)
  expect(links).toEqual({
    telegram: `https://t.me/test_bot?start=${code}`,
    whatsapp: `https://wa.me/${env.WHATSAPP_NUMBER}?text=%2Flink%20${code}`,
    zalo: env.ZALO_BOT_URL, // Zalo links carry no payload: the user pastes "/link CODE"
  });
  expect(new URL(links.whatsapp).searchParams.get('text')).toBe(`/link ${code}`); // what WhatsApp types for the user
});

test('TC-F7-11 each missing setting makes only that app\'s link null', async () => {
  const { accessToken } = await registerUser();
  const settings = { telegram: 'TELEGRAM_BOT_USERNAME', whatsapp: 'WHATSAPP_NUMBER', zalo: 'ZALO_BOT_URL' };
  for (const [app, key] of Object.entries(settings)) {
    const saved = env[key];
    env[key] = undefined;
    try {
      const { body } = await api(accessToken).post('/chat-links/code');
      expect(Object.keys(settings).filter((other) => body.links[other] === null), key).toEqual([app]);
    } finally {
      env[key] = saved;
    }
  }
});

test('TC-F7-11 an app whose setting is missing gets a null link, so the card hides it', async () => {
  const { accessToken } = await registerUser();
  const saved = { ...env };
  try {
    for (const key of ['TELEGRAM_BOT_USERNAME', 'WHATSAPP_NUMBER', 'ZALO_BOT_URL']) env[key] = undefined;
    const res = await api(accessToken).post('/chat-links/code');
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/); // "/link CODE" still works in any chat
    expect(res.body.links).toEqual({ telegram: null, whatsapp: null, zalo: null });
  } finally {
    Object.assign(env, saved);
  }
});

test('TC-F7-02 a link code links one chat, once, before it expires', async () => {
  const { accessToken, user } = await registerUser({ name: 'Lan' });
  const me = api(accessToken);
  const { body: first } = await me.post('/chat-links/code');

  // The deep link arrives as "/start CODE".
  const linked = await say(`/start ${first.code}`);
  expect(linked.map((c) => c.method)).toEqual(['sendMessage']);
  expect(textOf(linked[0])).toContain('Đã liên kết');
  expect(textOf(linked[0])).toContain('Lan');
  expect(await ChatLink.find().lean()).toMatchObject([
    { userId: oid(user.id), platform: 'telegram', platformUserId: String(CHAT_A), chatId: String(CHAT_A), displayName: 'Anh Nguyen' },
  ]);

  // The same code from another chat is refused, in both languages (that chat has no language yet).
  const reused = await say(`/link ${first.code}`, CHAT_B);
  expect(textOf(reused[0])).toContain(viText.invalidCode);
  expect(textOf(reused[0])).toContain(enText.invalidCode);

  // So is an expired code.
  const { body: second } = await me.post('/chat-links/code');
  await LinkCode.updateOne({ codeHash: sha256(second.code) }, { expiresAt: new Date(Date.now() - 1000) });
  expect(textOf((await say(`/link ${second.code}`, CHAT_B))[0])).toContain(viText.invalidCode);
  expect(await ChatLink.countDocuments()).toBe(1);

  // A fresh code typed in lower case links the second chat.
  const { body: third } = await me.post('/chat-links/code');
  expect(textOf((await say(`/link ${third.code.toLowerCase()}`, CHAT_B))[0])).toContain('Đã liên kết');
  expect(await ChatLink.countDocuments({ userId: user.id })).toBe(2);
});

test('TC-F7-03 a chat already linked to user A cannot be linked to user B', async () => {
  const a = await linkedUser(CHAT_A);
  const b = await registerUser();
  const { body } = await api(b.accessToken).post('/chat-links/code');

  const reply = await say(`/link ${body.code}`);
  expect(textOf(reply[0])).toContain(viText.alreadyLinked);
  expect(await ChatLink.find().lean()).toMatchObject([{ userId: oid(a.user.id) }]);
  expect(await ChatLink.countDocuments()).toBe(1);
  expect((await LinkCode.findOne({ codeHash: sha256(body.code) })).usedAt).toBeNull(); // B's code was not used up
});

test('TC-F7-04 GET /chat-links lists linked chats; DELETE unlinks and the bot then asks to link again', async () => {
  const a = await linkedUser();
  const b = await registerUser();
  const asB = api(b.accessToken);

  const { body: links } = await a.me.get('/chat-links');
  expect(links).toEqual([
    { id: expect.any(String), platform: 'telegram', displayName: 'Anh Nguyen', createdAt: expect.any(String), viaClaim: false, claimNoticeDismissedAt: null },
  ]);
  expect((await asB.get('/chat-links')).body).toEqual([]); // only your own
  expect((await asB.delete(`/chat-links/${links[0].id}`)).status).toBe(404); // not B's to remove
  expect((await a.me.delete('/chat-links/not-an-id')).status).toBe(400);

  expect((await a.me.delete(`/chat-links/${links[0].id}`)).status).toBe(204);
  expect((await a.me.get('/chat-links')).body).toEqual([]);
  expect((await a.me.delete(`/chat-links/${links[0].id}`)).status).toBe(404);

  const reply = await say('phở 45k');
  expect(textOf(reply[0])).toContain('/link');
  expect(await Transaction.countDocuments()).toBe(0);
});

test('TC-F8-03 the Telegram webhook rejects a missing or wrong secret header with 401', async () => {
  await linkedUser();
  calls.length = 0;
  for (const secret of [undefined, '', 'wrong-secret', `${SECRET}x`, SECRET.slice(0, -1)]) {
    const post = request(app).post('/api/webhooks/telegram');
    if (secret !== undefined) post.set('X-Telegram-Bot-Api-Secret-Token', secret);
    const res = await post.send(textUpdate('phở 45k'));
    expect([res.status, res.body.error.code]).toEqual([401, 'UNAUTHENTICATED']);
  }
  expect(background).toEqual([]); // nothing was started
  expect(calls).toEqual([]); // no message sent
  expect(await Transaction.countDocuments()).toBe(0);
});

test('TC-F8-04 "phở 45k" from a linked chat answers 200 at once and becomes a draft with ✅/❌ buttons', async () => {
  const a = await linkedUser();
  const update = textUpdate('phở 45k');

  // sendMessage is held back, yet the webhook has already answered: the work runs after the 200.
  const release = Promise.withResolvers();
  hold = release.promise;
  const res = await request(app).post('/api/webhooks/telegram').set('X-Telegram-Bot-Api-Secret-Token', SECRET).send(update);
  expect(res.status).toBe(200);
  expect(background).toHaveLength(1);
  release.resolve();
  hold = null;
  await Promise.all(background.splice(0));

  const drafts = await Transaction.find().lean();
  expect(drafts).toMatchObject([
    {
      userId: oid(a.user.id),
      type: 'expense',
      amount: 45_000,
      categoryId: oid(a.food),
      walletId: oid(a.user.defaultWalletId),
      note: 'phở',
      status: 'draft',
      source: 'telegram',
      chatRef: { platform: 'telegram', chatId: String(CHAT_A), messageId: `${update.message.message_id}:1` },
    },
  ]);
  const id = String(drafts[0]._id);
  const sent = calls.filter((c) => c.method === 'sendMessage').at(-1);
  expect(sent.body).toEqual({
    chat_id: String(CHAT_A),
    text: expect.stringMatching(/45\.000.*Ăn uống.*Tiền mặt.*phở/),
    reply_markup: { inline_keyboard: [[{ text: '✅ Lưu', callback_data: `c:${id}` }, { text: '❌ Huỷ', callback_data: `x:${id}` }]] },
  });
  expect((await ChatLink.findOne()).pendingTransactionId).toEqual(drafts[0]._id); // what a typed "ok" would confirm

  // One draft per line; a message with no amount at all gets the help text and stores nothing.
  const two = await say('grab 32k hôm qua\n+lương 15tr');
  expect(two.map((c) => c.method)).toEqual(['sendMessage', 'sendMessage']);
  expect((await Transaction.find().sort({ _id: 1 }).lean()).slice(1)).toMatchObject([
    { type: 'expense', amount: 32_000, categoryId: oid(a.transport), status: 'draft' },
    { type: 'income', amount: 15_000_000, categoryId: oid(a.salary), status: 'draft' },
  ]);
  const help = await say('hello bot');
  expect(textOf(help[0])).toBe(viText.help);
  expect(await Transaction.countDocuments()).toBe(3);
});

test('TC-F8-05 the same update delivered twice makes one draft per line and one reply each', async () => {
  await linkedUser();
  const update = textUpdate('grab 32k\nphở 45k');
  const from = calls.length;
  expect((await deliver(update)).status).toBe(200);
  expect((await deliver(update)).status).toBe(200); // Telegram retried
  expect(await Transaction.countDocuments()).toBe(2);
  expect(calls.slice(from).map((c) => c.method)).toEqual(['sendMessage', 'sendMessage']);
});

test('TC-F8-23 a line over the 10^13 ₫ ceiling makes no draft and is named; the good line still becomes a draft (BUG-033)', async () => {
  await linkedUser();
  const replies = await say('cafe 20000000000000\ncafe 45k');
  expect(await Transaction.find().lean()).toMatchObject([{ amount: 45_000, note: 'cafe', status: 'draft' }]);
  expect(replies.map((c) => c.method)).toEqual(['sendMessage', 'sendMessage']);
  expect(textOf(replies[1])).toMatch(/^⚠️ Chưa ghi dòng 1: không đọc được số tiền \(tối đa 10\.000\.000\.000\.000\s₫\)/);
  expect(textOf((await say('cafe 10000000000001'))[0])).toBe(viText.help); // only that line: the help text, as for "cafe"
  expect(await Transaction.countDocuments()).toBe(1);
});

test('TC-F8-25 a year or month before the amount is a date: the draft keeps the real amount, a date-only line makes no draft (BUG-039)', async () => {
  await linkedUser();
  const replies = await say('thuê nhà năm 2026 36tr\nthue nha nam 2025 12.000.000\nan toi thang 10 50\ntiền nhà tháng 10');
  expect((await Transaction.find().sort({ _id: 1 }).lean()).map((t) => [t.amount, t.status])).toEqual([
    [36_000_000, 'draft'],
    [12_000_000, 'draft'],
    [50_000, 'draft'],
  ]);
  expect(textOf(replies.at(-1))).toMatch(/^⚠️ Chưa ghi dòng 4: không đọc được số tiền/); // named, like any line with no amount
  expect(textOf((await say('năm 2025'))[0])).toBe(viText.help); // only a date: the help text, as for "cafe"
  expect(await Transaction.countDocuments()).toBe(3);
});

test('TC-F14-27 a question typed in a Telegram chat gets the help text and makes no draft; a capture still does (docs/02 §2.11.1)', async () => {
  await linkedUser();
  const questions = ['tháng 10 thu bao nhiêu', 'tháng 3 năm 2025 tiêu bao nhiêu', '7 ngày qua tiêu bao nhiêu', '?phở 45k', 'hôm nay ăn gì?', '5 khoản chi lớn nhất tuần trước', 'top 3 cafe', '/hoi tháng này ăn uống hết bao nhiêu', '/hoi', '/hỏi phở 45k', '/Hỏi'];

  for (const text of questions) {
    const replies = await say(text);
    expect([text, replies.map((c) => c.method), textOf(replies[0])]).toEqual([text, ['sendMessage'], viText.help]);
    expect(replies[0].body.reply_markup).toBeUndefined(); // no ✅ / ❌: there is no draft
  }
  expect(viText.help).toContain('/hoi');
  expect(await Transaction.countDocuments()).toBe(0);
  expect(await ChatLink.findOne()).toMatchObject({ pendingTransactionId: null });
  expect(textOf((await say('ok'))[0])).toBe(viText.nothingPending); // nothing was offered

  // What is no question and has no amount is answered like any line with no number, and a day count is no amount.
  for (const text of ['chi tiêu 7 ngày qua', 'đã chi gì tháng 9', 'chi tiêu năm 2025', 'hello bot']) expect(textOf((await say(text))[0])).toBe(viText.help);
  expect(await Transaction.countDocuments()).toBe(0);

  // Captures still become drafts: with a unit, a bare number, an amount word that looks like a question, a date word.
  for (const text of ['phở 45k', 'phở 45', 'cà phê không đường 25', 'sửa xe 150k', 'tim heo 50', 'crop top 120', 'ăn tối tháng 10 50', 'thuê nhà năm 2026 36tr']) {
    const replies = await say(text);
    expect([text, replies.map((c) => c.method)]).toEqual([text, ['sendMessage']]);
    expect(replies[0].body.reply_markup).toBeDefined(); // ✅ / ❌
  }
  expect((await Transaction.find().sort({ _id: 1 }).lean()).map((t) => [t.amount, t.status])).toEqual([
    [45_000, 'draft'], [45_000, 'draft'], [25_000, 'draft'], [150_000, 'draft'], [50_000, 'draft'], [120_000, 'draft'], [50_000, 'draft'], [36_000_000, 'draft'],
  ]);
});

test('TC-F14-27 the help text lists /hoi, in both languages, and a question in English gets the English one', async () => {
  await linkedUser();
  expect(viText.help).toMatch(/\/hoi/);
  expect(enText.help).toMatch(/\/hoi/);
  expect(textOf((await say('/lang en'))[0])).toBe(enText.languageSet);
  expect(textOf((await say('how much did I spend this month?'))[0])).toBe(enText.help);
  expect(textOf((await say('/hoi tháng này ăn uống hết bao nhiêu'))[0])).toBe(enText.help);
  expect(await Transaction.countDocuments()).toBe(0);
});

test("TC-F8-06 ✅ confirms and ❌ discards, only on the presser's own drafts", async () => {
  const a = await linkedUser(CHAT_A);
  const b = await linkedUser(CHAT_B);
  await say('phở 45k');
  await say('grab 32k');
  await say('cafe 20k', CHAT_B);
  const [first, second] = await Transaction.find({ userId: a.user.id }).sort({ _id: 1 });
  const ofB = await Transaction.findOne({ userId: b.user.id });

  const saved = await press(`c:${first.id}`);
  expect(saved.map((c) => c.method)).toEqual(['editMessageText', 'answerCallbackQuery']);
  expect(saved[0].body).toEqual({ chat_id: CHAT_A, message_id: 8, text: expect.stringMatching(/Đã lưu.*45\.000/) });
  expect(saved[1].body).toEqual({ callback_query_id: fixtures.callback.callback_query.id });
  expect((await Transaction.findById(first.id)).status).toBe('confirmed');

  const discarded = await press(`x:${second.id}`);
  expect(textOf(discarded[0])).toMatch(/Đã huỷ.*32\.000/);
  expect(await Transaction.findById(second.id)).toMatchObject({ status: 'draft', deletedAt: expect.any(Date) });

  // B's draft pressed from A's chat: untouched, and the button only says "not found".
  for (const data of [`c:${ofB.id}`, `x:${ofB.id}`]) {
    expect(await press(data)).toEqual([
      { method: 'answerCallbackQuery', body: { callback_query_id: fixtures.callback.callback_query.id, text: viText.notFound } },
    ]);
  }
  expect(await Transaction.findById(ofB.id)).toMatchObject({ status: 'draft', deletedAt: null });

  // Pressing again does nothing twice; garbage callback data is only acknowledged.
  expect(textOf((await press(`c:${first.id}`))[0])).toBe(viText.alreadyConfirmed);
  expect(textOf((await press(`c:${second.id}`))[0])).toBe(viText.notFound);
  expect(await press('c:nope')).toEqual([{ method: 'answerCallbackQuery', body: { callback_query_id: fixtures.callback.callback_query.id } }]);
  expect((await a.me.get(`/wallets/${a.user.defaultWalletId}`)).body.balance).toBe(-45_000);
});

test('TC-F8-06 replying "ok" or "huỷ" confirms or discards the latest draft (the Zalo way, same core)', async () => {
  await linkedUser();
  await say('phở 45k');
  expect(textOf((await say('ok'))[0])).toMatch(/Đã lưu.*45\.000/);
  await say('grab 32k');
  expect(textOf((await say('Huỷ'))[0])).toMatch(/Đã huỷ.*32\.000/);
  expect(textOf((await say('ok'))[0])).toBe(viText.nothingPending);

  expect(await Transaction.find().sort({ _id: 1 }).lean()).toMatchObject([
    { amount: 45_000, status: 'confirmed', deletedAt: null },
    { amount: 32_000, status: 'draft', deletedAt: expect.any(Date) },
  ]);
  expect((await ChatLink.findOne()).pendingTransactionId).toBeNull();
});

test('TC-F8-10 an unlinked chat gets link instructions in both languages and nothing is stored', async () => {
  for (const text of ['phở 45k', '/today', '/start', '/link']) {
    const reply = await say(text);
    expect(reply.map((c) => c.method)).toEqual(['sendMessage']);
    expect(textOf(reply[0])).toContain('http://localhost:5300/bot'); // APP_URL under NODE_ENV=test
    expect(textOf(reply[0])).toContain('Vui lòng liên kết');
    expect(textOf(reply[0])).toContain('Please link');
  }
  expect(await press('c:000000000000000000000000')).toMatchObject([{ method: 'answerCallbackQuery', body: { text: expect.stringContaining('/link') } }]);
  expect(await Transaction.countDocuments()).toBe(0);
  expect(await ChatLink.countDocuments()).toBe(0);
  expect(await LinkCode.find().lean()).toMatchObject([{ chat: { platform: 'telegram', platformUserId: String(CHAT_A) } }]); // one claim link
});

test('TC-F8-11 /today and /month match the statistics API, in the language chosen with /lang', async () => {
  const a = await linkedUser();
  const now = new Date();
  const month = monthKey(now);
  const { year, month: mm, day } = vnParts(now);
  const otherDay = new Date(vnDate(year, mm, day === 1 ? 2 : 1).getTime() + 12 * 3600 * 1000); // same month, not today
  const add = (type, amount, categoryId, occurredAt) =>
    a.me.post('/transactions', { type, amount, categoryId, walletId: a.user.defaultWalletId, occurredAt: occurredAt.toISOString() });
  await add('expense', 45_000, a.food, now);
  await add('expense', 32_000, a.transport, now);
  await add('income', 15_000_000, a.salary, now);
  await add('expense', 100_000, a.food, otherDay);
  await add('expense', 999_000, a.food, new Date(now.getTime() - 40 * 24 * 3600 * 1000)); // another month
  await say('phở 50k'); // a draft does not count
  await a.me.post('/budgets', { month, categoryId: null, limit: 354_000 });

  const summary = (await a.me.get(`/stats/summary?month=${month}`)).body;
  expect(summary).toMatchObject({ expense: 177_000, income: 15_000_000, budget: { limit: 354_000, spent: 177_000 } });

  const today = textOf((await say('/today'))[0]);
  expect(today).toContain('Hôm nay');
  expect(today).toMatch(/Chi: 77\.000/);
  expect(today).toMatch(/Thu: 15\.000\.000/);
  const monthText = textOf((await say('/month'))[0]);
  expect(monthText).toMatch(/Chi: 177\.000/);
  expect(monthText).toMatch(/Thu: 15\.000\.000/);
  expect(monthText).toContain('50%');

  expect(textOf((await say('/lang en'))[0])).toBe(enText.languageSet);
  expect((await User.findById(a.user.id)).language).toBe('en');
  expect(textOf((await say('/today'))[0])).toMatch(/Today[\s\S]*Spent: ₫77,000[\s\S]*Received: ₫15,000,000/);
  expect(textOf((await say('/month'))[0])).toMatch(/Spent: ₫177,000[\s\S]*50%/);
  expect(textOf((await say('/lang fr'))[0])).toBe(enText.help); // unknown language: show how to use the bot
  expect(textOf((await say('/lang vi'))[0])).toBe(viText.languageSet);

  // Both message files have the same keys, so no reply is missing in either language.
  expect(Object.keys(enText).sort()).toEqual(Object.keys(viText).sort());
});

test('TC-F8-22 /month lists the category budgets with their usage, also without an overall budget (BUG-029)', async () => {
  const a = await linkedUser();
  const month = monthKey(new Date());
  const add = (amount, categoryId) =>
    a.me.post('/transactions', { type: 'expense', amount, categoryId, walletId: a.user.defaultWalletId, occurredAt: new Date().toISOString() });
  await add(135_000, a.food);
  await add(64_000, a.transport);
  await a.me.post('/budgets', { month, categoryId: a.transport, limit: 320_000 });
  await a.me.post('/budgets', { month, categoryId: a.food, limit: 150_000 });

  // Fullest first, each with its own usage; no overall line, since there is no overall budget.
  const text = textOf((await say('/month'))[0]);
  expect(text).toMatch(/Chi: 199\.000/);
  expect(text).toMatch(/\nNgân sách "Ăn uống": 90% \(135\.000\s₫ \/ 150\.000\s₫\)\nNgân sách "Đi lại": 20% \(64\.000\s₫ \/ 320\.000\s₫\)$/);
  expect(text).not.toContain('Ngân sách:');

  // GET /stats/summary keeps its contract: budget is the overall budget only.
  expect((await a.me.get(`/stats/summary?month=${month}`)).body.budget).toBeNull();
});

test('TC-F5-03 confirming an expense past 80 % / 100 % of its budget warns on the web and in the chat', async () => {
  const a = await linkedUser();
  await a.me.post('/budgets', { month: monthKey(new Date()), categoryId: a.food, limit: 100_000 });
  const draftOf = (amount) => Transaction.findOne({ amount, status: 'draft' });

  // Bot ✅ at 85 %: a warning line under "Đã lưu".
  await say('phở 85k');
  const saved = await press(`c:${(await draftOf(85_000)).id}`);
  expect(textOf(saved[0])).toMatch(/Đã lưu[^\n]*\n⚠️[^\n]*Ăn uống[^\n]*85%/);

  // Web /confirm at 105 %: the response carries budgetWarning.
  await say('bún 20k');
  const web = await a.me.post(`/transactions/${(await draftOf(20_000)).id}/confirm`);
  expect(web.status).toBe(200);
  expect(web.body.budgetWarning).toMatchObject({ categoryId: a.food, limit: 100_000, spent: 105_000, percent: 105, threshold: 100 });

  // In English after /lang en; an income never warns.
  await say('/lang en');
  await say('coffee 10k');
  expect(textOf((await press(`c:${(await draftOf(10_000)).id}`))[0])).toMatch(/Saved[^\n]*\n🚨[^\n]*Food & drinks[^\n]*115%/);
  await say('+lương 1tr');
  const income = await a.me.post(`/transactions/${(await draftOf(1_000_000)).id}/confirm`);
  expect(income.status).toBe(200);
  expect(income.body).not.toHaveProperty('budgetWarning');
});

test('TC-F8-15 a locked account cannot record or confirm anything through its linked chat', async () => {
  const a = await linkedUser();
  await say('phở 45k');
  const draft = await Transaction.findOne();
  await User.updateOne({ _id: a.user.id }, { status: 'locked' }); // what the admin lock does (docs/04 §4.3)

  expect(textOf((await say('grab 32k'))[0])).toBe(viText.locked);
  expect(textOf((await say('ok'))[0])).toBe(viText.locked);
  expect(await press(`c:${draft.id}`)).toEqual([
    { method: 'answerCallbackQuery', body: { callback_query_id: fixtures.callback.callback_query.id, text: viText.locked } },
  ]);
  expect(await Transaction.find().lean()).toMatchObject([{ amount: 45_000, status: 'draft', deletedAt: null }]);
});

test('TC-F8-14 setWebhooks registers both bots for a base URL, each with its own secret', async () => {
  const zalo = [];
  const tokens = [];
  outbound.use(
    http.post('https://api.telegram.org/:bot/setWebhook', async ({ params, request }) => {
      tokens.push(params.bot);
      calls.push({ method: 'setWebhook', body: await request.json() });
      return params.bot === 'botbad'
        ? HttpResponse.json({ ok: false, error_code: 401, description: 'Unauthorized' }, { status: 401 })
        : HttpResponse.json({ ok: true, result: true });
    }),
    http.post('https://bot-api.zaloplatforms.com/:bot/setWebhook', async ({ params, request }) => {
      zalo.push({ bot: params.bot, body: await request.json() });
      return HttpResponse.json({ ok: true, result: {} });
    }),
  );
  const vars = { TELEGRAM_BOT_TOKEN: 'tg-token', TELEGRAM_WEBHOOK_SECRET: 'tg-secret', ZALO_BOT_TOKEN: 'zl-token', ZALO_WEBHOOK_SECRET: 'zalo-secret' };

  // WhatsApp has no setWebhook call: Meta takes the callback URL in its app dashboard (docs/06 §6.12), so without its settings it is skipped.
  expect(await setWebhooks('https://demo.example.app/', vars)).toEqual({
    telegram: 'ok',
    zalo: 'ok',
    whatsapp: expect.stringMatching(/^skipped: .*WHATSAPP_VERIFY_TOKEN/),
  });
  expect(tokens).toEqual(['bottg-token']);
  expect(calls).toEqual([
    { method: 'setWebhook', body: { url: 'https://demo.example.app/api/webhooks/telegram', secret_token: 'tg-secret', allowed_updates: ['message', 'callback_query'] } },
  ]);
  expect(zalo).toEqual([{ bot: 'botzl-token', body: { url: 'https://demo.example.app/api/webhooks/zalo', secret_token: 'zalo-secret' } }]);

  // A platform without its variables is skipped; a refusal is reported without the token.
  expect(await setWebhooks('https://demo.example.app', { TELEGRAM_BOT_TOKEN: 'bad', TELEGRAM_WEBHOOK_SECRET: 'tg-secret' })).toEqual({
    telegram: 'failed: Unauthorized',
    zalo: 'skipped: ZALO_BOT_TOKEN or ZALO_WEBHOOK_SECRET not set',
    whatsapp: expect.stringMatching(/^skipped: /),
  });

  // With the WhatsApp settings the script says what to enter in Meta's dashboard; it calls no Graph API
  // (an unmocked host fails this test) and never prints the verify token.
  const whatsapp = { WHATSAPP_ACCESS_TOKEN: 'wa-token', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_APP_SECRET: 'wa-secret', WHATSAPP_VERIFY_TOKEN: 'wa-verify' };
  const { whatsapp: advice } = await setWebhooks('https://demo.example.app/', whatsapp);
  expect(advice).toMatch(/^manual: .*https:\/\/demo\.example\.app\/api\/webhooks\/whatsapp/);
  for (const secret of Object.values(whatsapp)) expect(advice).not.toContain(secret);
  expect((await setWebhooks('https://demo.example.app', { ...whatsapp, WHATSAPP_APP_SECRET: '' })).whatsapp).toMatch(/^skipped: /);
});

// ---------- Linking from the chat: the claim link (docs/02 §2.10.3) ----------
const claimUrl = (token) => `http://localhost:5300/link?t=${token}`; // APP_URL under NODE_ENV=test
const claimTokenIn = (text) => /http:\/\/localhost:5300\/link\?t=([A-Za-z0-9_-]+)/.exec(text)?.[1];
// What an unlinked chat sends → the token in the bot's one reply.
const askClaimLink = async (text = 'xin chào', chat = CHAT_A) => claimTokenIn(textOf((await say(text, chat))[0]));
const preview = (me, token) => me.post('/chat-links/claim/preview', { token });
// A claim answers first and tells the chat afterwards (waitUntil), like a webhook.
async function claim(me, token) {
  const res = await me.post('/chat-links/claim', { token });
  await Promise.all(background.splice(0));
  return res;
}
const outcome = (res) => [res.status, res.body.error?.code];
const someChat = { platform: 'telegram', platformUserId: '999', chatId: '999', displayName: 'Someone' };

test('TC-F7-16 an unlinked chat gets a one-time claim link, stored as a hash only; its next message replaces it', async () => {
  const before = Date.now();
  const replies = await say('xin chào');
  expect(replies.map((c) => c.method)).toEqual(['sendMessage']);
  const first = claimTokenIn(textOf(replies[0]));
  expect(first).toHaveLength(32); // 24 random bytes as base64url
  // Both languages: today's "please link" text, then the tap-to-link line.
  expect(textOf(replies[0])).toBe(
    `${viText.pleaseLink('http://localhost:5300')}\n${viText.tapToLink(claimUrl(first))}\n\n${enText.pleaseLink('http://localhost:5300')}\n${enText.tapToLink(claimUrl(first))}`,
  );
  expect(viText.tapToLink('URL')).toContain('10 phút');
  expect(enText.tapToLink('URL')).toContain('10 minutes');

  const rows = await LinkCode.find().lean();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    codeHash: sha256(first),
    usedAt: null,
    chat: { platform: 'telegram', platformUserId: String(CHAT_A), chatId: String(CHAT_A), displayName: 'Anh Nguyen' },
  });
  expect(rows[0]).not.toHaveProperty('userId');
  expect(JSON.stringify(rows)).not.toContain(first); // only the hash is stored
  expect(rows[0].expiresAt.getTime() - before).toBeGreaterThanOrEqual(10 * 60 * 1000);
  expect(rows[0].expiresAt.getTime() - before).toBeLessThan(10 * 60 * 1000 + 5000);
  expect(await Transaction.countDocuments()).toBe(0);

  const second = await askClaimLink('phở 45k');
  expect(second).not.toBe(first);
  expect((await LinkCode.find().lean()).map((row) => row.codeHash)).toEqual([sha256(second)]);
  const me = api((await registerUser()).accessToken);
  expect(outcome(await preview(me, first))).toEqual([404, 'LINK_TOKEN_INVALID']);
  expect((await preview(me, second)).status).toBe(200);
});

test('TC-F7-16 messages arriving at the same moment leave one live claim link per chat', async () => {
  await say('hi', CHAT_B);
  const chat = { platform: 'telegram', platformUserId: String(CHAT_A), chatId: String(CHAT_A), displayName: 'Anh Nguyen' };
  const rowsOfChat = () => LinkCode.find({ 'chat.platformUserId': chat.platformUserId }).lean();
  // createClaimToken itself, not the webhook: HTTP delivery staggers the writes. Only two inserts can make a second
  // row, so every round starts with none. Without `unique: true` on the partial index this fails.
  for (let round = 0; round < 10; round++) {
    await LinkCode.deleteMany({ 'chat.platformUserId': chat.platformUserId });
    const tokens = await Promise.all(Array.from({ length: 4 }, () => createClaimToken(chat)));
    const rows = await rowsOfChat();
    expect(rows).toHaveLength(1);
    expect(tokens.map(sha256)).toContain(rows[0].codeHash);
  }

  // Through the webhook: every message is answered, and the one live token is among the links sent.
  const from = calls.length;
  await Promise.all(['một', 'hai', 'ba', 'bốn'].map((text) => deliver(textUpdate(text))));
  const tokens = calls.slice(from).map((c) => claimTokenIn(textOf(c)));
  expect(tokens).toHaveLength(4);
  const rows = await rowsOfChat();
  expect(rows).toHaveLength(1);
  expect(tokens.map(sha256)).toContain(rows[0].codeHash);
  expect(await LinkCode.countDocuments()).toBe(2); // the other chat's link is untouched
});

test('TC-F7-16 a linkCodes row has exactly one of userId and chat; without APP_URL no claim link is made', async () => {
  const row = { codeHash: 'a-hash', expiresAt: new Date(Date.now() + 60_000) };
  await expect(LinkCode.create(row)).rejects.toThrow(/exactly one of userId and chat/);
  await expect(LinkCode.create({ ...row, userId: new mongoose.Types.ObjectId(), chat: someChat })).rejects.toThrow(/exactly one of userId and chat/);
  expect(await LinkCode.countDocuments()).toBe(0);

  // A link to nowhere would be useless, so nothing is stored for it either.
  const saved = env.APP_URL;
  env.APP_URL = undefined;
  try {
    const [reply] = await say('xin chào');
    expect(textOf(reply)).toContain('Vui lòng liên kết');
    expect(textOf(reply)).not.toContain('/link?t=');
    expect(await LinkCode.countDocuments()).toBe(0);
  } finally {
    env.APP_URL = saved;
  }
});

test("TC-F7-17 codes and claim links never work in each other's place; a wrong or expired code gets a claim link", async () => {
  const { accessToken, user } = await registerUser({ name: 'Lan' });
  const me = api(accessToken);
  const { body: used } = await me.post('/chat-links/code');
  await say(`/link ${used.code}`, CHAT_B);
  const { body: expired } = await me.post('/chat-links/code');
  await LinkCode.updateOne({ codeHash: sha256(expired.code) }, { expiresAt: new Date(Date.now() - 1000) });

  let token = await askClaimLink();
  for (const arg of ['WRONG2', used.code, expired.code, 'the live claim token']) {
    const [reply] = await say(`/link ${arg === 'the live claim token' ? token : arg}`);
    expect(textOf(reply), arg).toContain(viText.invalidCode);
    expect(textOf(reply), arg).toContain(enText.invalidCode);
    token = claimTokenIn(textOf(reply));
    expect(token, arg).toHaveLength(32);
  }
  expect(await ChatLink.countDocuments({ platformUserId: String(CHAT_A) })).toBe(0);

  // Even a claim row stored under exactly the hash "/link ABC234" looks up is not a code.
  await LinkCode.create({ chat: someChat, codeHash: sha256('ABC234'), expiresAt: new Date(Date.now() + 60_000) });
  expect(textOf((await say('/link ABC234'))[0])).toContain(viText.invalidCode);
  expect((await ChatLink.find().lean()).map((link) => link.platformUserId)).toEqual([String(CHAT_B)]); // only the used code's chat
  expect((await LinkCode.findOne({ codeHash: sha256('ABC234') })).usedAt).toBeNull();

  // A website code links as before and makes no claim link; the linked chat gets its usual replies.
  const { body: live } = await me.post('/chat-links/code');
  const claimRowsBefore = (await LinkCode.find().lean()).filter((row) => row.chat).map((row) => row.codeHash).sort();
  expect(textOf((await say(`/start ${live.code}`))[0])).toBe(viText.linked('Lan'));
  expect(textOf((await say('xin chào'))[0])).toBe(viText.help);
  expect((await LinkCode.find().lean()).filter((row) => row.chat).map((row) => row.codeHash).sort()).toEqual(claimRowsBefore);
  expect(await ChatLink.findOne({ platformUserId: String(CHAT_A) }).lean()).toMatchObject({ userId: oid(user.id), viaClaim: false });
});

test('TC-F7-18 claim API: login, single use, 10 minutes, claim links only; the chat gets the /link success text', async () => {
  const token = await askClaimLink();
  for (const path of ['/api/chat-links/claim/preview', '/api/chat-links/claim']) {
    expect(outcome(await request(app).post(path).send({ token }))).toEqual([401, 'UNAUTHENTICATED']);
  }
  const lan = await registerUser({ name: 'Lan' });
  const me = api(lan.accessToken);
  expect((await me.patch('/users/me', { language: 'en' })).status).toBe(200);
  for (let i = 0; i < 2; i++) {
    const res = await preview(me, token); // previewing does not spend the token
    expect([res.status, res.body]).toEqual([200, { platform: 'telegram', displayName: 'Anh Nguyen' }]);
  }

  calls.length = 0;
  const res = await claim(me, token);
  expect(res.status).toBe(201);
  expect(res.body).toEqual({ id: expect.any(String), platform: 'telegram', displayName: 'Anh Nguyen', createdAt: expect.any(String), viaClaim: true });
  expect(await ChatLink.find().lean()).toMatchObject([
    {
      userId: oid(lan.user.id),
      platform: 'telegram',
      platformUserId: String(CHAT_A),
      chatId: String(CHAT_A),
      displayName: 'Anh Nguyen',
      viaClaim: true,
      claimNoticeDismissedAt: null,
    },
  ]);
  expect((await LinkCode.findOne({ codeHash: sha256(token) })).usedAt).toBeInstanceOf(Date);
  expect(calls).toEqual([{ method: 'sendMessage', body: { chat_id: String(CHAT_A), text: enText.linked('Lan') } }]);

  // Spent, unknown, expired and website codes: 404 from both endpoints, and the website code is not spent.
  const expired = await askClaimLink('hi', CHAT_B);
  await LinkCode.updateOne({ codeHash: sha256(expired) }, { expiresAt: new Date(Date.now() - 1000) });
  const { body: code } = await me.post('/chat-links/code');
  calls.length = 0;
  for (const bad of [token, 'A'.repeat(32), expired, code.code]) {
    for (const call of [preview, claim]) {
      expect(outcome(await call(me, bad)), `${call.name} ${bad.length}`).toEqual([404, 'LINK_TOKEN_INVALID']);
    }
  }
  expect((await LinkCode.findOne({ codeHash: sha256(code.code) })).usedAt).toBeNull();
  for (const body of [{}, { token: '' }, { token: { $ne: null } }, { token: 'x'.repeat(101) }]) {
    for (const path of ['/chat-links/claim/preview', '/chat-links/claim']) {
      expect(outcome(await me.post(path, body))).toEqual([400, 'VALIDATION_ERROR']);
    }
  }
  expect(calls).toEqual([]);
  expect(await ChatLink.countDocuments()).toBe(1);
});

test('TC-F7-18 a success message the chat app refuses does not undo the claim; the failure is logged', async () => {
  const token = await askClaimLink();
  const me = api((await registerUser()).accessToken);
  outbound.use(http.post('https://api.telegram.org/:bot/sendMessage', () => HttpResponse.json({ ok: false, error_code: 403, description: 'bot was blocked' }, { status: 403 })));
  errorLog.mockImplementation(() => {});
  expect((await claim(me, token)).status).toBe(201);
  expect(await ChatLink.countDocuments()).toBe(1);
  expect(errorLog).toHaveBeenCalledTimes(1);
  expect(String(errorLog.mock.calls[0])).not.toContain(token);
  errorLog.mockClear();
});

test('TC-F7-19 a chat linked meanwhile answers 409 and spends the token; a token claimed twice at once links once', async () => {
  const token = await askClaimLink();
  const b = await registerUser();
  const { body } = await api(b.accessToken).post('/chat-links/code');
  await say(`/link ${body.code}`);
  const a = api((await registerUser()).accessToken);

  calls.length = 0;
  expect(outcome(await claim(a, token))).toEqual([409, 'CHAT_ALREADY_LINKED']);
  expect(await ChatLink.find().lean()).toMatchObject([{ userId: oid(b.user.id), viaClaim: false }]);
  expect(outcome(await claim(a, token))).toEqual([404, 'LINK_TOKEN_INVALID']); // spent anyway
  expect(calls).toEqual([]); // no "linked" message for a claim that did not link

  const other = await askClaimLink('hi', CHAT_B);
  const c = api((await registerUser()).accessToken);
  calls.length = 0;
  const results = await Promise.all([claim(a, other), claim(c, other)]);
  expect(results.map((res) => res.status).sort()).toEqual([201, 404]);
  expect(await ChatLink.countDocuments({ platformUserId: String(CHAT_B) })).toBe(1);
  expect(calls).toHaveLength(1);
});

// A claim link for chat A, then chat A is linked to user B with a website code, which leaves that link unused.
async function claimLinkThenCode() {
  const token = await askClaimLink();
  const b = api((await registerUser()).accessToken);
  await say(`/link ${(await b.post('/chat-links/code')).body.code}`);
  const [link] = (await b.get('/chat-links')).body;
  const a = api((await registerUser()).accessToken);
  return { token, a, unlink: (who = b) => who.delete(`/chat-links/${link.id}`) }; // unlinked by B unless told otherwise
}

test('TC-F7-19 unlinking a chat kills the claim link it got before it was linked', async () => {
  const otherChats = await askClaimLink('hi', CHAT_B);
  const { token, a, unlink } = await claimLinkThenCode();

  expect((await unlink(a)).status).toBe(404); // not A's link: nothing is removed
  expect(await LinkCode.countDocuments({ 'chat.platformUserId': String(CHAT_A) })).toBe(1);

  expect((await unlink()).status).toBe(204);
  calls.length = 0;
  for (const call of [preview, claim]) expect(outcome(await call(a, token)), call.name).toEqual([404, 'LINK_TOKEN_INVALID']);
  expect(await ChatLink.countDocuments()).toBe(0);
  expect(calls).toEqual([]);
  expect((await preview(a, otherChats)).status).toBe(200); // another chat's link is untouched
});

test('TC-F7-19 an unlink while Confirm is running wins: the claim links nothing', async () => {
  const { token, a, unlink } = await claimLinkThenCode();
  // Hold the claim after it has spent the token and before it writes the chatLinks row.
  let resume;
  const paused = new Promise((resolve) => {
    resume = resolve;
  });
  const create = ChatLink.create.bind(ChatLink);
  const spy = vi.spyOn(ChatLink, 'create').mockImplementationOnce(async (doc) => {
    await paused;
    return create(doc);
  });
  try {
    calls.length = 0;
    const claiming = claim(a, token);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect((await unlink()).status).toBe(204);
    resume();
    expect(outcome(await claiming)).toEqual([404, 'LINK_TOKEN_INVALID']);
    expect(await ChatLink.countDocuments()).toBe(0);
    expect(calls).toEqual([]);
  } finally {
    resume();
    spy.mockRestore();
  }
});

test('TC-F7-21 only claim-made links carry the "Not you?" notice, and only their owner can dismiss it', async () => {
  const lan = await linkedUser(CHAT_A); // by code
  const me = lan.me;
  const claimed = (await claim(me, await askClaimLink('hi', CHAT_B))).body;

  const list = async () => (await me.get('/chat-links')).body;
  expect(await list()).toMatchObject([
    { viaClaim: false, claimNoticeDismissedAt: null },
    { id: claimed.id, viaClaim: true, claimNoticeDismissedAt: null },
  ]);

  const other = api((await registerUser()).accessToken);
  const path = `/chat-links/${claimed.id}/claim-notice`;
  expect(outcome(await other.patch(path))).toEqual([404, 'NOT_FOUND']);
  expect(outcome(await me.patch(`/chat-links/${new mongoose.Types.ObjectId()}/claim-notice`))).toEqual([404, 'NOT_FOUND']);
  expect((await request(app).patch(`/api${path}`)).status).toBe(401);
  expect((await me.patch('/chat-links/not-an-id/claim-notice')).status).toBe(400);
  expect((await list())[1].claimNoticeDismissedAt).toBeNull();

  expect((await me.patch(path)).status).toBe(204);
  expect((await me.patch(path)).status).toBe(204); // twice is fine
  const [byCode, byClaim] = await list();
  expect(Date.parse(byClaim.claimNoticeDismissedAt)).toBeGreaterThan(0);
  expect(byCode.claimNoticeDismissedAt).toBeNull();
});

// docs/02 §2.11.6: only Zalo (and later WhatsApp) has a monthly quota. Telegram answers everything, whatever Zalo's count is.
test('TC-F14-23 Telegram is not counted and never silenced by the quota guard, even when Zalo is over its quota', async () => {
  await linkedUser();
  await ChannelUsage.updateOne({ platform: 'zalo', month: monthKey(new Date()) }, { sent: 3000 }, { upsert: true });
  calls.length = 0;

  expect(textOf((await say('/help'))[0])).toBe(viText.help);
  expect(textOf((await say('/today'))[0])).toMatch(/^📅 Hôm nay/);
  expect(textOf((await say('xin chào'))[0])).toBe(viText.help); // a message with no amount
  expect((await say('phở 45k'))[0].body.reply_markup.inline_keyboard[0]).toHaveLength(2); // the draft, with ✅ / ❌ (no ✏️ over http)
  expect(textOf((await say('ok'))[0])).toMatch(/Đã lưu.*45\.000/);
  expect(await ChannelUsage.find().lean()).toMatchObject([{ platform: 'zalo', sent: 3000 }]); // nothing counted for Telegram
});
