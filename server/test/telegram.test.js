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
import { ChatLink } from '../src/models/ChatLink.js';
import { LinkCode } from '../src/models/LinkCode.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
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
  return { get: call('get'), post: call('post'), delete: call('delete') };
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
  expect(links).toEqual([{ id: expect.any(String), platform: 'telegram', displayName: 'Anh Nguyen', createdAt: expect.any(String) }]);
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

  expect(await setWebhooks('https://demo.example.app/', vars)).toEqual({ telegram: 'ok', zalo: 'ok' });
  expect(tokens).toEqual(['bottg-token']);
  expect(calls).toEqual([
    { method: 'setWebhook', body: { url: 'https://demo.example.app/api/webhooks/telegram', secret_token: 'tg-secret', allowed_updates: ['message', 'callback_query'] } },
  ]);
  expect(zalo).toEqual([{ bot: 'botzl-token', body: { url: 'https://demo.example.app/api/webhooks/zalo', secret_token: 'zalo-secret' } }]);

  // A platform without its variables is skipped; a refusal is reported without the token.
  expect(await setWebhooks('https://demo.example.app', { TELEGRAM_BOT_TOKEN: 'bad', TELEGRAM_WEBHOOK_SECRET: 'tg-secret' })).toEqual({
    telegram: 'failed: Unauthorized',
    zalo: 'skipped: ZALO_BOT_TOKEN or ZALO_WEBHOOK_SECRET not set',
  });
});
