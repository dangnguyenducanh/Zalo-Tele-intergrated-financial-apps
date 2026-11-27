// A7 (docs/02 §2.11.2): a Khác/Other draft offers the user's top categories, and one choice teaches the keyword. Both chats are
// driven through their real webhooks; the Bot APIs are mocked.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import enText from '../src/bot/messages.en.js';
import viText from '../src/bot/messages.vi.js';
import { Category } from '../src/models/Category.js';
import { ChatLink } from '../src/models/ChatLink.js';
import { LinkCode } from '../src/models/LinkCode.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import { topExpenseCategories } from '../src/services/categories.js';
import telegramFixtures from './fixtures/telegram-updates.json' with { type: 'json' };
import zaloFixtures from './fixtures/zalo-events.json' with { type: 'json' };
import { registerUser, resetLoginLimit } from './helpers/auth.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';

const background = vi.hoisted(() => []);
vi.mock('@vercel/functions', async (importOriginal) => ({
  ...(await importOriginal()),
  waitUntil: (promise) => {
    background.push(promise);
  },
}));

const tgCalls = [];
const zaloCalls = [];
const outbound = setupServer(
  http.post('https://api.telegram.org/:bot/:method', async ({ params, request }) => {
    tgCalls.push({ method: params.method, body: await request.json() });
    return HttpResponse.json({ ok: true, result: { message_id: 1000 + tgCalls.length } });
  }),
  http.post('https://bot-api.zaloplatforms.com/:bot/:method', async ({ params, request }) => {
    zaloCalls.push({ method: params.method, body: await request.json() });
    return HttpResponse.json({ ok: true, result: { message_id: `sent${zaloCalls.length}`, date: Date.now() } });
  }),
);

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), ChatLink.init(), LinkCode.init(), Transaction.init()]);
  outbound.listen({
    onUnhandledFrame: ({ frame }) => {
      const { hostname } = new URL(frame.data.request.url);
      if (hostname !== '127.0.0.1' && hostname !== 'localhost') throw new Error(`unmocked request to ${hostname}`);
    },
  });
});
let errorLog;
beforeEach(() => {
  errorLog = vi.spyOn(console, 'error');
});
afterEach(async () => {
  expect(errorLog).not.toHaveBeenCalled();
  errorLog.mockRestore();
  outbound.resetHandlers();
  tgCalls.length = 0;
  zaloCalls.length = 0;
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(async () => {
  outbound.close();
  await stopTestDb();
});

const TG_CHAT = 5550001111;
const textOf = (call) => call.body.text;
const api = (accessToken) => {
  const call = (method) => (path, body) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${accessToken}`).send(body);
  return { get: call('get'), post: call('post'), patch: call('patch') };
};

let nextId = 100;
async function deliverTelegram(update) {
  const from = tgCalls.length;
  await request(app).post('/api/webhooks/telegram').set('X-Telegram-Bot-Api-Secret-Token', 'test-telegram-secret').send(update);
  await Promise.all(background.splice(0));
  return tgCalls.slice(from);
}
function tgSay(text) {
  const update = structuredClone(telegramFixtures.text);
  nextId += 1;
  Object.assign(update.message, { message_id: nextId, text });
  update.update_id += nextId;
  update.message.from.id = TG_CHAT;
  update.message.chat.id = TG_CHAT;
  return deliverTelegram(update);
}
function tgPress(data) {
  const update = structuredClone(telegramFixtures.callback);
  update.callback_query.data = data;
  update.callback_query.from.id = TG_CHAT;
  update.callback_query.message.chat.id = TG_CHAT;
  return deliverTelegram(update);
}
async function zaloSay(text) {
  const body = structuredClone(zaloFixtures.text);
  nextId += 1;
  Object.assign(body.message, { message_id: `zmsg${nextId}`, text });
  const from = zaloCalls.length;
  await request(app).post('/api/webhooks/zalo').set('X-Bot-Api-Secret-Token', 'test-zalo-secret').send(body);
  await Promise.all(background.splice(0));
  return zaloCalls.slice(from);
}

// A registered user linked on Telegram (and Zalo when asked), with the ids of some default categories.
async function setup({ zalo = false } = {}) {
  const { accessToken, user } = await registerUser();
  const me = api(accessToken);
  await tgSay(`/start ${(await me.post('/chat-links/code')).body.code}`);
  if (zalo) await zaloSay(`/link ${(await me.post('/chat-links/code')).body.code}`);
  const { body: categories } = await me.get('/categories');
  const named = (name) => categories.find((c) => c.names?.vi === name);
  tgCalls.length = 0;
  zaloCalls.length = 0;
  return { me, user, categories, food: named('Ăn uống'), transport: named('Đi lại'), other: named('Khác') };
}

const keywordsOf = async (id) => (await Category.findById(id).lean()).keywords;
const buttonsOf = (call) => call.body.reply_markup.inline_keyboard.flat();

test('TC-F14-85 a Khác draft on Telegram offers 3 category buttons "k:<draft>:<category>" within 64 bytes; a tap moves the draft and teaches "lau"', async () => {
  const { food, other } = await setup();
  const [draftReply] = await tgSay('lẩu 300k');
  const [draft] = await Transaction.find().lean();
  expect(String(draft.categoryId)).toBe(other.id); // the parser had no word for it
  expect(textOf(draftReply)).toContain(viText.offerTap);
  const offers = buttonsOf(draftReply).filter((b) => b.callback_data.startsWith('k:'));
  expect(offers).toHaveLength(3);
  for (const { callback_data: data } of offers) expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
  expect(buttonsOf(draftReply).slice(0, 2).map((b) => b.callback_data)).toEqual([`c:${draft._id}`, `x:${draft._id}`]); // ✅ / ❌ stay

  const tap = offers.find((b) => b.callback_data === `k:${draft._id}:${food.id}`);
  expect(tap).toBeDefined(); // Ăn uống is among the first three created
  const calls = await tgPress(tap.callback_data);
  expect(calls.map((c) => c.method)).toEqual(['editMessageText', 'answerCallbackQuery']);
  expect(textOf(calls[0])).toContain(viText.learned({ name: 'Ăn uống', word: 'lau' }));
  expect(buttonsOf(calls[0]).map((b) => b.callback_data)).toEqual([`c:${draft._id}`, `x:${draft._id}`]); // still a draft: ✅ / ❌ back, no offers
  expect(await Transaction.find().lean()).toMatchObject([{ _id: draft._id, status: 'draft', categoryId: expect.anything() }]);
  expect(String((await Transaction.findById(draft._id).lean()).categoryId)).toBe(food.id);
  expect(await keywordsOf(food.id)).toContain('lau');
});

test('TC-F14-85 after the tap the next "lẩu 50k" is filed under Ăn uống with no offer, in English too', async () => {
  const { me, food } = await setup();
  await me.patch('/users/me', { language: 'en' });
  const [first] = await tgSay('lẩu 300k');
  expect(textOf(first)).toContain(enText.offerTap);
  const [draft] = await Transaction.find().lean();
  const calls = await tgPress(`k:${draft._id}:${food.id}`);
  expect(textOf(calls[0])).toContain(enText.learned({ name: 'Food & drinks', word: 'lau' }));

  const [second] = await tgSay('lẩu 50k');
  expect(textOf(second)).not.toContain(enText.offerTap);
  expect(buttonsOf(second).filter((b) => b.callback_data.startsWith('k:'))).toEqual([]);
  const latest = await Transaction.findOne().sort({ _id: -1 }).lean();
  expect([latest.amount, String(latest.categoryId)]).toEqual([50_000, food.id]);
});

test('TC-F14-86 on Zalo the draft names the offered categories and typing one (any case or accents) moves the draft and teaches the word, before classify and the help reply', async () => {
  const { food, other } = await setup({ zalo: true });
  const [draftReply] = await zaloSay('lẩu 300k');
  expect(textOf(draftReply)).toMatch(/Ăn uống/);
  expect(textOf(draftReply)).toContain(viText.offerType('').split(':')[0]);
  const [draft] = await Transaction.find().lean();
  expect(String(draft.categoryId)).toBe(other.id);

  const [answer] = await zaloSay('  AN uong ');
  expect(textOf(answer)).toContain(viText.learned({ name: 'Ăn uống', word: 'lau' }));
  expect(textOf(answer)).not.toContain(viText.help);
  expect(String((await Transaction.findById(draft._id).lean()).categoryId)).toBe(food.id);
  expect(await keywordsOf(food.id)).toContain('lau');

  // The draft is still waiting: "ok" saves it; the next "lẩu" is filed correctly.
  expect(textOf((await zaloSay('ok'))[0])).toMatch(/Đã lưu.*Ăn uống/);
  const [next] = await zaloSay('lẩu 50k');
  expect(textOf(next)).toMatch(/Ăn uống/);
  expect(textOf(next)).not.toContain(viText.offerType('').split(':')[0]);
});

test('TC-F14-86 typing a category name with no fallback draft waiting, or a name that is not a category, changes nothing', async () => {
  const { food } = await setup({ zalo: true });
  const [noDraft] = await zaloSay('Ăn uống');
  expect(textOf(noDraft)).toBe(viText.help); // no draft: the usual reply, nothing learned
  expect(await keywordsOf(food.id)).not.toContain('lau');

  await zaloSay('lẩu 300k');
  const [unknown] = await zaloSay('mèo con');
  expect(textOf(unknown)).toBe(viText.help);
  expect(await Transaction.countDocuments({ status: 'draft' })).toBe(1);

  await zaloSay('phở 45k'); // a draft the parser filed itself waits now: the type-a-name rule is off
  const [typed] = await zaloSay('Đi lại');
  expect(textOf(typed)).toBe(viText.help);
});

test('TC-F14-87 a word another of the user\'s categories owns is not learned, but the draft still moves', async () => {
  const { me, food, transport } = await setup();
  const [reply] = await tgSay('lẩu 300k');
  const [draft] = await Transaction.find().lean();
  expect(textOf(reply)).toBeDefined();
  await me.patch(`/categories/${transport.id}`, { keywords: [...transport.keywords, 'lau'] }); // taken between the offer and the tap

  const calls = await tgPress(`k:${draft._id}:${food.id}`);
  expect(textOf(calls[0])).toContain(viText.moved({ name: 'Ăn uống' }));
  expect(textOf(calls[0])).not.toContain('ghi nhớ');
  expect(String((await Transaction.findById(draft._id).lean()).categoryId)).toBe(food.id);
  expect(await keywordsOf(food.id)).not.toContain('lau');
  expect(await keywordsOf(transport.id)).toContain('lau');
});

test('TC-F14-88 a category id that is not the tapper\'s own (another user\'s, an income one, the fallback, a deleted one) is refused and nothing changes', async () => {
  const { me, other, transport } = await setup();
  const { accessToken, user: strangerUser } = await registerUser();
  const stranger = (await api(accessToken).get('/categories')).body.find((c) => c.names?.vi === 'Ăn uống');
  const income = (await me.get('/categories')).body.find((c) => c.type === 'income' && !c.isFallback);
  const deleted = (await me.post('/categories', { type: 'expense', name: 'Tạm' })).body;
  await Category.updateOne({ _id: deleted.id }, { deletedAt: new Date() });
  await tgSay('lẩu 300k');
  const [draft] = await Transaction.find().lean();

  for (const id of [stranger.id, income.id, other.id, deleted.id, '0'.repeat(24)]) {
    const calls = await tgPress(`k:${draft._id}:${id}`);
    expect([id, calls.map((c) => c.method)]).toEqual([id, ['answerCallbackQuery']]); // the old message is not edited
    expect(calls[0].body.text).toBe(viText.notFound);
  }
  expect(String((await Transaction.findById(draft._id).lean()).categoryId)).toBe(other.id);
  expect(await keywordsOf(stranger.id)).not.toContain('lau');

  // A draft that is not the tapper's, or a malformed tap, is just as dead.
  const someoneElse = await Transaction.create({ userId: strangerUser.id, walletId: strangerUser.defaultWalletId, categoryId: stranger.id, type: 'expense', amount: 1000, status: 'draft', occurredAt: new Date() });
  expect((await tgPress(`k:${someoneElse._id}:${transport.id}`))[0].body.text).toBe(viText.notFound);
  expect(await tgPress('k:nope:nope')).toEqual([{ method: 'answerCallbackQuery', body: expect.not.objectContaining({ text: expect.anything() }) }]);
});

test('TC-F14-88 a second tap after the draft already has a category is refused, and nothing more is learned', async () => {
  const { food, transport } = await setup();
  await tgSay('lẩu 300k');
  const [draft] = await Transaction.find().lean();
  await tgPress(`k:${draft._id}:${food.id}`);
  const calls = await tgPress(`k:${draft._id}:${transport.id}`);
  expect(calls[0].body.text).toBe(viText.hasCategory);
  expect(String((await Transaction.findById(draft._id).lean()).categoryId)).toBe(food.id);
  expect(await keywordsOf(transport.id)).not.toContain('lau');
});

test('TC-F14-89 the offer is the 3 most used expense categories of the last 90 days, fallback and deleted ones left out, filled in creation order', async () => {
  const { user, categories } = await setup();
  const expenses = categories.filter((c) => c.type === 'expense' && !c.isFallback);
  const [a, b, c, d] = expenses; // creation order
  const NOW = new Date('2026-11-20T05:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const spend = (category, times, daysAgo = 1, fields = {}) =>
    Transaction.insertMany(Array.from({ length: times }, () => ({ userId: user.id, walletId: user.defaultWalletId, categoryId: category.id, type: 'expense', amount: 10_000, status: 'confirmed', occurredAt: new Date(NOW.getTime() - daysAgo * day), ...fields })));

  const ids = async () => (await topExpenseCategories(user.id, { now: NOW })).map((x) => String(x._id));
  expect(await ids()).toEqual([a.id, b.id, c.id]); // nothing yet: creation order
  await spend(d, 3);
  await spend(c, 2);
  await spend(b, 1);
  await spend(a, 5, 100); // older than 90 days: ignored
  await spend(a, 9, 1, { status: 'draft' }); // not money that moved
  await spend(a, 9, 1, { deletedAt: NOW });
  await spend({ id: (await Category.findOne({ userId: user.id, isFallback: true, type: 'expense' }))._id }, 20); // the fallback is never offered
  expect(await ids()).toEqual([d.id, c.id, b.id]);

  await Category.updateOne({ _id: d.id }, { deletedAt: NOW });
  expect(await ids()).toEqual([c.id, b.id, a.id]); // filled up with the first created
  const other = await registerUser();
  expect(await topExpenseCategories(other.user.id, { now: NOW })).toHaveLength(3); // nobody else's spending counts
});

test('TC-F14-89 only an expense draft in Khác is offered categories: not one the parser filed, not an income draft', async () => {
  await setup();
  const [filed] = await tgSay('phở 45k');
  expect(buttonsOf(filed).filter((b) => b.callback_data.startsWith('k:'))).toEqual([]);
  const [income] = await tgSay('+nhận 100k');
  expect(buttonsOf(income).filter((b) => b.callback_data.startsWith('k:'))).toEqual([]);
  expect(textOf(income)).not.toContain(viText.offerTap);
});
