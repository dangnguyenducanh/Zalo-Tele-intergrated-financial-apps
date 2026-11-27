import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import enText from '../src/bot/messages.en.js';
import viText from '../src/bot/messages.vi.js';
import { Budget } from '../src/models/Budget.js';
import { Category } from '../src/models/Category.js';
import { ChannelUsage } from '../src/models/ChannelUsage.js';
import { ChatLink } from '../src/models/ChatLink.js';
import { LinkCode } from '../src/models/LinkCode.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { monthKey } from '../src/utils/vnTime.js';
import recorded from './fixtures/kie-analyze.json' with { type: 'json' };
import fixtures from './fixtures/zalo-events.json' with { type: 'json' };
import { registerUser, resetLoginLimit } from './helpers/auth.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { A2_DUBAO_VI, novemberDay, plain, seedPaceMonth } from './helpers/pace.js';

// KIE is mocked at a made-up host. (The NODE_ENV=test default KIE_URL uses port 9, which fetch refuses outright.)
vi.hoisted(() => {
  process.env.KIE_URL = 'http://kie.test';
});

// The webhook answers 200 first and hands the real work to waitUntil(). Collect that work so a test can wait for it.
const background = vi.hoisted(() => []);
vi.mock('@vercel/functions', async (importOriginal) => ({
  ...(await importOriginal()),
  waitUntil: (promise) => {
    background.push(promise);
  },
}));

const PHOTO = await readFile(new URL('./fixtures/receipts/mcocr_public_145014khrvg.jpg', import.meta.url));
const PHOTO_URL = fixtures.image.message.photo_url;

// Every Zalo Bot API call the server makes, as { bot, method, body }, answered the way Zalo answers.
// The photo URL serves the receipt photo, and KIE answers with its recorded reading of that photo.
const calls = [];
const outbound = setupServer(
  http.post('https://bot-api.zaloplatforms.com/:bot/:method', async ({ params, request }) => {
    calls.push({ bot: params.bot, method: params.method, body: await request.json() });
    return HttpResponse.json({ ok: true, result: { message_id: `sent${calls.length}`, date: Date.now() } });
  }),
  http.get(PHOTO_URL, () => new HttpResponse(PHOTO, { headers: { 'content-type': 'image/jpeg' } })),
  http.post('http://kie.test/analyze', () => HttpResponse.json(recorded)),
);

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), ChatLink.init(), LinkCode.init(), Transaction.init(), ChannelUsage.init()]); // unique indexes first
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
  vi.useRealTimers(); // the pace test pins the clock
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
  delete process.env.KIE_URL;
});

const SECRET = 'test-zalo-secret'; // ZALO_WEBHOOK_SECRET under NODE_ENV=test (config/env.js)
const USER_A = fixtures.text.message.from.id; // in a private chat, chat.id is the sender's id
const USER_B = 'a1b2c3d4e5f6a7b8c9d0';
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const textOf = (call) => call.body.text;

// A recorded event, copied with a fresh message_id and pointed at another user, text or field.
let nextMessageId = 0;
function event(name, fields, user = USER_A) {
  const body = structuredClone(fixtures[name]);
  nextMessageId += 1;
  Object.assign(body.message, { message_id: `zmsg${nextMessageId}`, ...fields });
  body.message.from.id = user;
  body.message.chat.id = user;
  return body;
}
const textEvent = (text, user = USER_A) => event('text', { text }, user);

// POSTs an event the way Zalo does, then waits for the work the webhook handed to waitUntil().
async function deliver(body, secret = SECRET) {
  const res = await request(app).post('/api/webhooks/zalo').set('X-Bot-Api-Secret-Token', secret).send(body);
  await Promise.all(background.splice(0));
  return res;
}

// Sends an event and returns the Bot API calls the server made in answer.
async function send(body) {
  const from = calls.length;
  await deliver(body);
  return calls.slice(from);
}
const say = (text, user = USER_A) => send(textEvent(text, user));

// A registered user whose Zalo account is linked with "/link CODE".
async function linkedUser(user = USER_A) {
  const { accessToken, user: owner } = await registerUser();
  const { body } = await request(app).post('/api/chat-links/code').set('Authorization', `Bearer ${accessToken}`);
  await say(`/link ${body.code}`, user);
  return owner;
}

test('TC-F8-03 the Zalo webhook rejects a missing or wrong secret header with 401', async () => {
  await linkedUser();
  calls.length = 0;
  for (const secret of [undefined, '', 'wrong-secret', `${SECRET}x`, SECRET.slice(0, -1), 'test-telegram-secret']) {
    const post = request(app).post('/api/webhooks/zalo');
    if (secret !== undefined) post.set('X-Bot-Api-Secret-Token', secret);
    const res = await post.send(textEvent('grab 32k'));
    expect([res.status, res.body.error.code]).toEqual([401, 'UNAUTHENTICATED']);
  }
  expect(background).toEqual([]); // nothing was started
  expect(calls).toEqual([]); // no message sent
  expect(await Transaction.countDocuments()).toBe(0);
});

// docs/02 §2.10.3: the only way to link Zalo without typing anything.
test('TC-F7-16 TC-F7-18 an unlinked Zalo chat gets a claim link; claiming it links the chat and Zalo gets the success text', async () => {
  const replies = await say('xin chào');
  expect(replies.map((c) => c.method)).toEqual(['sendMessage']);
  const [, token] = /http:\/\/localhost:5300\/link\?t=([A-Za-z0-9_-]{32})/.exec(textOf(replies[0]));
  expect(await LinkCode.find().lean()).toMatchObject([{ chat: { platform: 'zalo', platformUserId: USER_A, chatId: USER_A, displayName: 'Anh Nguyen' } }]);

  const { accessToken, user } = await registerUser({ name: 'Lan' });
  const post = (path) => request(app).post(`/api/chat-links/${path}`).set('Authorization', `Bearer ${accessToken}`).send({ token });
  expect((await post('claim/preview')).body).toEqual({ platform: 'zalo', displayName: 'Anh Nguyen' });
  calls.length = 0;
  expect((await post('claim')).status).toBe(201);
  await Promise.all(background.splice(0));
  expect(calls).toEqual([{ bot: 'bottest-zalo-token', method: 'sendMessage', body: { chat_id: USER_A, text: viText.linked('Lan') } }]);
  expect(await ChatLink.find().lean()).toMatchObject([{ userId: oid(user.id), platform: 'zalo', viaClaim: true }]);
});

test('TC-F8-07 Zalo "grab 32k" → reply "ok" saves the draft; a second draft → "huy" discards it', async () => {
  // Not linked yet: link instructions, nothing stored.
  const unlinked = await say('grab 32k');
  expect(textOf(unlinked[0])).toContain('Vui lòng liên kết');
  expect(await Transaction.countDocuments()).toBe(0);

  // "/link CODE" links the Zalo account, with the sender's display name.
  const owner = await linkedUser();
  expect(await ChatLink.find().lean()).toMatchObject([
    { userId: oid(owner.id), platform: 'zalo', platformUserId: USER_A, chatId: USER_A, displayName: 'Anh Nguyen' },
  ]);

  // The text becomes a draft; the reply is plain text (Zalo has no buttons) ending with the "ok / huy" hint.
  const body = textEvent('grab 32k');
  const res = await request(app).post('/api/webhooks/zalo').set('X-Bot-Api-Secret-Token', SECRET).send(body);
  expect(res.status).toBe(200);
  await Promise.all(background.splice(0));
  const first = await Transaction.findOne().lean();
  expect(first).toMatchObject({
    userId: oid(owner.id),
    type: 'expense',
    amount: 32_000,
    status: 'draft',
    source: 'zalo',
    chatRef: { platform: 'zalo', chatId: USER_A, messageId: `${body.message.message_id}:1` },
  });
  const draftReply = calls.at(-1);
  expect(draftReply).toEqual({
    bot: 'bottest-zalo-token',
    method: 'sendMessage',
    body: { chat_id: USER_A, text: expect.stringMatching(/32\.000.*Đi lại/) },
  });
  expect(textOf(draftReply).endsWith(`\n${viText.replyHint}`)).toBe(true);
  expect((await ChatLink.findOne()).pendingTransactionId).toEqual(first._id);

  // "ok" confirms the pending draft.
  const saved = await say('ok');
  expect(saved.map((c) => c.method)).toEqual(['sendMessage']);
  expect(textOf(saved[0])).toMatch(/Đã lưu.*32\.000/);
  expect((await Transaction.findById(first._id)).status).toBe('confirmed');

  // A second draft, then "huy": soft-deleted, and nothing is left pending.
  await say('phở 45k');
  const second = await Transaction.findOne({ amount: 45_000 });
  expect((await ChatLink.findOne()).pendingTransactionId).toEqual(second._id);
  expect(textOf((await say('huy'))[0])).toMatch(/Đã huỷ.*45\.000/);
  expect(await Transaction.findById(second._id)).toMatchObject({ status: 'draft', deletedAt: expect.any(Date) });
  expect(textOf((await say('ok'))[0])).toBe(viText.nothingPending);
  expect((await ChatLink.findOne()).pendingTransactionId).toBeNull();
});

test('TC-F8-07 Zalo payload shapes: wrapped { ok, result } body, ignored events and group chats, duplicate delivery', async () => {
  await linkedUser();

  // Some Zalo docs show the event wrapped in { ok, result }; it is read the same way.
  const wrapped = await send({ ok: true, result: textEvent('grab 32k') });
  expect(textOf(wrapped[0])).toMatch(/32\.000/);

  // Stickers, voice, unsupported messages and group chats get no reply and store nothing.
  const voice = { ...event('text', { text: undefined, voice_url: 'https://voice.zalo.example/v.aac' }), event_name: 'message.voice.received' };
  const unsupported = { event_name: 'message.unsupported.received', message: event('text', { text: undefined }).message };
  const group = event('text', { text: 'phở 45k' });
  group.message.chat = { id: 'group-77', chat_type: 'GROUP' };
  for (const body of [event('sticker'), voice, unsupported, group, {}, { event_name: 'message.text.received' }]) {
    expect((await deliver(body)).status).toBe(200);
  }
  expect(calls.slice(-1)).toEqual(wrapped); // nothing sent since the wrapped one
  expect(await Transaction.countDocuments()).toBe(1);

  // Zalo delivers the same message twice: one draft, one reply.
  const twice = textEvent('cafe 20k');
  const from = calls.length;
  await deliver(twice);
  await deliver(twice);
  expect(calls.slice(from).map((c) => c.method)).toEqual(['sendMessage']);
  expect(await Transaction.countDocuments({ amount: 20_000 })).toBe(1);

  // Another user's "ok" never touches A's pending draft.
  await linkedUser(USER_B);
  expect(textOf((await say('ok', USER_B))[0])).toBe(viText.nothingPending);
  expect(await Transaction.countDocuments({ status: 'confirmed' })).toBe(0);
});

test('TC-F8-08 a Zalo photo_url is downloaded and read by KIE into a draft that "ok" saves', async () => {
  const owner = await linkedUser();
  const photo = event('image');
  const sent = await send(photo);

  expect(sent.map(textOf)).toEqual([viText.readingReceipt, expect.stringContaining('116.000')]);
  expect(textOf(sent[1])).toContain(viText.receiptItems({ count: 6, reconciled: true }));
  expect(textOf(sent[1]).endsWith(`\n${viText.replyHint}`)).toBe(true);
  const draft = await Transaction.findOne().lean();
  expect(draft).toMatchObject({
    userId: oid(owner.id),
    amount: 116_000,
    status: 'draft',
    source: 'zalo',
    chatRef: { platform: 'zalo', chatId: USER_A, messageId: `${photo.message.message_id}:1` },
    receipt: { fileRef: PHOTO_URL },
  });

  expect(textOf((await say('ok'))[0])).toMatch(/Đã lưu.*116\.000/);
  expect((await Transaction.findById(draft._id)).status).toBe('confirmed');

  // Older payloads named the field `photo` instead of `photo_url`.
  const older = event('image', { photo_url: undefined, photo: PHOTO_URL });
  expect((await send(older)).map(textOf)).toEqual([viText.readingReceipt, expect.stringContaining('116.000')]);
  expect(await Transaction.countDocuments({ status: 'draft' })).toBe(1);
});

test('TC-F8-19 every line of a message becomes a draft even when the bot cannot reply (BUG-026)', async () => {
  await linkedUser();
  // Zalo refuses every reply, as with a made-up chat id, a used-up free quota or a timeout.
  outbound.use(
    http.post('https://bot-api.zaloplatforms.com/:bot/sendMessage', () => HttpResponse.json({ ok: false, error_code: 403, description: 'Forbidden' })),
  );
  errorLog.mockImplementation(() => {});
  await say('cafe 21k\nbánh mì 22k\ntaxi 23k');

  const drafts = await Transaction.find({ status: 'draft' }).sort({ _id: 1 }).lean();
  expect(drafts.map((d) => d.amount)).toEqual([21_000, 22_000, 23_000]);
  expect((await ChatLink.findOne()).pendingTransactionId).toEqual(drafts[2]._id);
  expect(errorLog).toHaveBeenCalledTimes(1); // the failed replies are still logged by the webhook
  errorLog.mockClear();
});

test('TC-F8-20 Zalo: a reply with only an amount ("55k") corrects the pending draft instead of making a new one (BUG-027)', async () => {
  await linkedUser();
  await say('grab 32k');
  const draft = await Transaction.findOne().lean();

  const corrected = await say('55k');
  expect(textOf(corrected[0])).toMatch(/55\.000.*Đi lại.*grab/);
  expect(textOf(corrected[0]).endsWith(`\n${viText.replyHint}`)).toBe(true);
  expect(await Transaction.find().lean()).toMatchObject([{ _id: draft._id, amount: 55_000, note: 'grab', categoryId: draft.categoryId, status: 'draft' }]);
  expect((await ChatLink.findOne()).pendingTransactionId).toEqual(draft._id);

  await say('ok');
  expect(await Transaction.find().lean()).toMatchObject([{ amount: 55_000, note: 'grab', status: 'confirmed' }]);

  // With nothing pending, an amount alone is a new draft, as before.
  await say('40k');
  expect(await Transaction.countDocuments({ amount: 40_000, status: 'draft' })).toBe(1);
});

test('TC-F14-51 Zalo: "chia 3" after a draft divides it, and the reply still ends with the "ok / huy / amount" hint', async () => {
  await linkedUser();
  await say('cơm nhà hàng 1tr2');
  const draft = await Transaction.findOne().lean();

  const split = await say('chia 4');
  expect(split).toHaveLength(1);
  expect(textOf(split[0])).toMatch(/300\.000.*cơm nhà hàng \(1\.200\.000 ₫ ÷ 4\)/);
  expect(textOf(split[0]).endsWith(`\n${viText.replyHint}`)).toBe(true);
  expect(await Transaction.find().lean()).toMatchObject([{ _id: draft._id, amount: 300_000, status: 'draft' }]);
  expect((await ChatLink.findOne()).pendingTransactionId).toEqual(draft._id);

  // With the draft saved, nothing waits: the same text says so and a "ok" has nothing to do either.
  await say('ok');
  expect(textOf((await say('chia 3'))[0])).toBe(viText.nothingToSplit);
  expect(await Transaction.countDocuments({ amount: 100_000 })).toBe(0); // "chia 3" was not turned into a 3.000 ₫ draft
  expect((await Transaction.findOne().lean()).amount).toBe(300_000);
});

test('TC-F14-55 Zalo: the check line sits between the draft and the reply hint, and a corrected amount ("300k") is checked again', async () => {
  const owner = await linkedUser();
  const transport = (await Category.findOne({ userId: owner.id, 'names.vi': 'Đi lại' }))._id;
  await Transaction.insertMany(
    [30_000, 30_000, 30_000, 30_000, 30_000].map((amount) => ({
      userId: owner.id, walletId: owner.defaultWalletId, categoryId: transport, type: 'expense', amount, occurredAt: new Date(Date.now() - 24 * 60 * 60 * 1000), status: 'confirmed',
    })),
  );

  const first = textOf((await say('grab 32k'))[0]).split('\n');
  expect(first).toHaveLength(2); // the draft, then the reply hint: nothing to warn about
  expect(first[1]).toBe(viText.replyHint);

  const corrected = textOf((await say('300k'))[0]).split('\n');
  expect(corrected).toHaveLength(3);
  expect(corrected[1]).toMatch(/gấp 10 lần.*Đi lại/);
  expect(corrected[2]).toBe(viText.replyHint);
});

test('TC-F8-21 Zalo: after a multi-line message, each "ok"/"huy" reaches the next waiting draft, newest first (BUG-028)', async () => {
  await linkedUser();
  await say('an sang 30k\ntra sua 40k');

  // "ok" saves the newest draft and says which one the next answer will act on.
  const first = textOf((await say('ok'))[0]);
  expect(first).toMatch(/^✅ Đã lưu: .*40\.000.*\n⏭️ .*30\.000/);

  const second = textOf((await say('huy'))[0]);
  expect(second).toMatch(/^❌ Đã huỷ: .*30\.000[^\n]*$/); // nothing else waits
  expect(textOf((await say('ok'))[0])).toBe(viText.nothingPending);
  expect(await Transaction.find({ deletedAt: null }).lean()).toMatchObject([{ amount: 40_000, status: 'confirmed' }]);
});

const nfd = (text) => text.normalize('NFD'); // a decomposing keyboard or a paste: "o" + hook-above mark, not the one letter "ỏ"

test('TC-F14-27 a question typed in a Zalo chat gets the help text and makes no draft; a capture and the amount-only correction still work (docs/02 §2.11.1)', async () => {
  await linkedUser();
  const questions = ['tháng 10 thu bao nhiêu', 'tháng 3 năm 2025 tiêu bao nhiêu', '7 ngày qua tiêu bao nhiêu', '?phở 45k', '5 khoản chi lớn nhất tuần trước', 'top 3 cafe', '/hoi tháng này ăn uống hết bao nhiêu', '/hoi', '/hỏi phở 45k', '/Hỏi', nfd('/hỏi phở 45k'), nfd('/Hỏi')];

  for (const text of questions) {
    const replies = await say(text);
    expect([text, replies.map((c) => c.method), textOf(replies[0])]).toEqual([text, ['sendMessage'], viText.help]);
  }
  expect(viText.help).toContain('/hoi');
  expect(await Transaction.countDocuments()).toBe(0);
  expect(textOf((await say('ok'))[0])).toBe(viText.nothingPending);
  for (const text of ['chi tiêu 7 ngày qua', 'đã chi gì tháng 9', 'chi tiêu năm 2025']) expect(textOf((await say(text))[0])).toBe(viText.help);
  expect(await Transaction.countDocuments()).toBe(0);

  // A capture is a draft; a reply with only an amount ("55k") still corrects the newest one (TC-F8-20).
  for (const text of ['grab 32k', 'cà phê không đường 25', 'ăn tối tháng 10 50']) await say(text);
  expect((await Transaction.find().sort({ _id: 1 }).lean()).map((t) => [t.amount, t.status])).toEqual([[32_000, 'draft'], [25_000, 'draft'], [50_000, 'draft']]);
  await say('55k');
  expect((await Transaction.find().sort({ _id: 1 }).lean()).map((t) => t.amount)).toEqual([32_000, 25_000, 55_000]); // the newest draft was corrected, no new one
});

test('TC-F14-27 every existing command is read without case or accents in either Unicode form on Zalo: /Today, /tôday, /MONTH and /Lang vi run as the plain command (docs/02 §2.11.1)', async () => {
  const user = await linkedUser();
  const reply = async (text) => textOf((await say(text))[0]);
  const plain = { today: await reply('/today'), month: await reply('/month') };
  expect(plain.today).toMatch(/^📅 Hôm nay/);
  expect(plain.month).toMatch(/^📅 Tháng/);
  for (const [text, command] of [['/Today', 'today'], ['/tôday', 'today'], [nfd('/tôday'), 'today'], ['/MONTH', 'month'], ['/Mônth', 'month'], [nfd('/Mônth'), 'month']]) {
    expect([text, await reply(text)]).toEqual([text, plain[command]]);
  }
  // /lang switches the language whatever the case or accents; each variant starts again from English.
  for (const text of ['/Lang vi', '/LANG vi', '/Lâng vi', nfd('/Lâng vi')]) {
    await say('/lang en');
    expect((await User.findById(user.id)).language).toBe('en');
    await say(text);
    expect([text, (await User.findById(user.id)).language]).toEqual([text, 'vi']);
  }
  expect(await Transaction.countDocuments()).toBe(0); // a command is never a capture
});

// ---- Zalo's monthly quota (docs/02 §2.11.6, card T49): every send is counted, and from 2,850 only capture and linking replies go out ----

const thisMonth = () => monthKey(new Date());
const zaloSent = async (month = thisMonth()) => (await ChannelUsage.findOne({ platform: 'zalo', month }))?.sent ?? 0;
const setZaloSent = (sent, month = thisMonth()) => ChannelUsage.updateOne({ platform: 'zalo', month }, { sent }, { upsert: true });
const kieDown = () => outbound.use(http.post('http://kie.test/analyze', () => new HttpResponse(null, { status: 503 })));

test('TC-F14-20 every Zalo message the platform accepts adds 1 to channelUsage, once; a refused one adds nothing', async () => {
  await linkedUser(); // the "linked" reply is the first message
  expect(await zaloSent()).toBe(calls.length);

  // Replies, drafts and notes: each step's count equals the messages Zalo accepted so far.
  for (const text of ['grab 32k', 'ok', '/today', 'xin chào', 'cafe 21k\nbánh mì 22k\nxyz', '/lang en', '/lang vi']) {
    await say(text);
    expect(await zaloSent()).toBe(calls.length);
  }
  await send(event('image')); // "Reading receipt…", then the draft
  expect(await zaloSent()).toBe(calls.length);

  // The claim success message of the website is a send as well.
  const [, token] = /\/link\?t=([A-Za-z0-9_-]{32})/.exec(textOf((await say('hi', USER_B))[0]));
  const { accessToken } = await registerUser({ name: 'Lan' });
  await request(app).post('/api/chat-links/claim').set('Authorization', `Bearer ${accessToken}`).send({ token });
  await Promise.all(background.splice(0));
  expect(textOf(calls.at(-1))).toBe(viText.linked('Lan'));
  expect(await zaloSent()).toBe(calls.length);
  expect(await ChannelUsage.find().lean()).toMatchObject([{ platform: 'zalo', month: thisMonth(), sent: calls.length }]); // one row
});

test('TC-F14-20 a message Zalo refuses is not counted; a counter that fails loses neither the drafts nor the replies', async () => {
  await linkedUser();
  const before = await zaloSent();
  // Zalo accepts every reply except the one that mentions 22.000.
  outbound.use(
    http.post('https://bot-api.zaloplatforms.com/:bot/sendMessage', async ({ params, request }) => {
      const body = await request.json();
      if (body.text.includes('22.000')) return HttpResponse.json({ ok: false, error_code: 403, description: 'Forbidden' });
      calls.push({ bot: params.bot, method: 'sendMessage', body });
      return HttpResponse.json({ ok: true, result: { message_id: 'x' } });
    }),
  );
  errorLog.mockImplementation(() => {});
  await say('cafe 21k\nbánh mì 22k\ntaxi 23k');
  expect(await Transaction.countDocuments({ status: 'draft' })).toBe(3);
  expect(calls.length - 1).toBe(2); // the link reply, then the 21.000 and 23.000 drafts
  expect(await zaloSent()).toBe(before + 2);
  expect(errorLog).toHaveBeenCalledTimes(1); // the refused reply, logged by the webhook
  errorLog.mockClear();
  outbound.resetHandlers();

  // The counter itself fails: both replies still go out, every draft is saved, each failed count is logged.
  const count = vi.spyOn(ChannelUsage, 'updateOne').mockRejectedValue(new Error('db down'));
  const sent = await say('phở 45k\nbún 40k');
  count.mockRestore();
  expect(sent.map(textOf)).toEqual([expect.stringContaining('45.000'), expect.stringContaining('40.000')]);
  expect(await Transaction.countDocuments({ status: 'draft' })).toBe(5);
  expect(errorLog).toHaveBeenCalledTimes(2);
  expect(await zaloSent()).toBe(before + 2); // those two were not counted
  errorLog.mockClear();
  expect(textOf((await say('ok'))[0])).toMatch(/Đã lưu/); // and the next message is counted again
  expect(await zaloSent()).toBe(before + 3);
});

test('TC-F14-21 from 2,850 Zalo messages only capture and linking replies are sent; a command still does its work', async () => {
  const owner = await linkedUser();
  await say('grab 32k'); // a draft is waiting

  // The 2,850th message is still sent: /today at 2,849.
  await setZaloSent(2849);
  expect(textOf((await say('/today'))[0])).toMatch(/^📅 Hôm nay/);
  expect(await zaloSent()).toBe(2850);

  // Commands, help and a message with no amount are not sent, and nothing is counted. /lang still switches the language.
  for (const text of ['/today', '/month', '/help', '/start', '/hoi gì đó', 'xin chào', 'cảm ơn bot']) expect(await say(text)).toEqual([]);
  expect(await say('/lang en')).toEqual([]);
  expect((await User.findById(owner.id)).language).toBe('en');
  expect(await say('/lang vi')).toEqual([]);
  expect((await User.findById(owner.id)).language).toBe('vi');
  expect(await zaloSent()).toBe(2850);

  // Capture replies keep going: an amount correction, drafts, a note about a line with no amount, ok and huy.
  let expected = 2850;
  const corrected = await say('55k');
  expect(textOf(corrected[0])).toMatch(/55\.000.*Đi lại.*grab/);
  const drafts = await say('cafe 21k\nbánh mì 22k');
  expect(drafts.map(textOf)).toEqual([expect.stringContaining('21.000'), expect.stringContaining('22.000')]);
  const note = await say('taxi 23k\nxyz');
  expect(note.map(textOf)).toEqual([expect.stringContaining('23.000'), expect.stringContaining('Chưa ghi dòng 2')]);
  expect(textOf((await say('ok'))[0])).toMatch(/^✅ Đã lưu: .*23\.000/);
  expect(textOf((await say('huy'))[0])).toMatch(/^❌ Đã huỷ: .*22\.000/);
  expected += corrected.length + drafts.length + note.length + 2;
  expect(await zaloSent()).toBe(expected);
  expect(await Transaction.countDocuments({ status: 'confirmed' })).toBe(1);

  // A receipt: "Reading receipt…" and the draft, and when the reader is down its failure message.
  const receipt = await send(event('image'));
  expect(receipt.map(textOf)).toEqual([viText.readingReceipt, expect.stringContaining('116.000')]);
  kieDown();
  const failed = await send(event('image'));
  expect(failed.map(textOf)).toEqual([viText.readingReceipt, viText.receiptUnavailable]);
  expect(await zaloSent()).toBe(expected + receipt.length + failed.length);
});

test('TC-F14-21 from 2,850 the linking replies are still sent: the link prompt, /link and /start answers, the claim message (D20)', async () => {
  await setZaloSent(2850);
  const before = await zaloSent();

  // A chat that is not linked: the please-link prompt with its claim link, for any message, even a command.
  const [prompt] = await say('/help', USER_B);
  expect(textOf(prompt)).toMatch(/Vui lòng liên kết.*\/link\?t=[A-Za-z0-9_-]{32}/s);
  expect(textOf((await say('/link ZZZZZZ', USER_B))[0])).toContain(viText.invalidCode);
  expect(textOf((await say('/start ZZZZZZ', USER_B))[0])).toContain(viText.invalidCode);

  // The right code links the chat; the same chat sending another code is told it is linked already.
  const { accessToken, user } = await registerUser({ name: 'Lan' });
  const code = async () => (await request(app).post('/api/chat-links/code').set('Authorization', `Bearer ${accessToken}`)).body.code;
  expect(textOf((await say(`/link ${await code()}`, USER_B))[0])).toBe(viText.linked('Lan'));
  expect(textOf((await say(`/start ${await code()}`, USER_B))[0])).toBe(viText.alreadyLinked);
  expect(await ChatLink.countDocuments({ userId: oid(user.id) })).toBe(1);

  // A claim made on the website tells the chat that it is linked (another, unlinked chat).
  const claimToken = /\/link\?t=([A-Za-z0-9_-]{32})/.exec(textOf((await say('hi', 'c3d4e5f6a7b8c9d0a1b2'))[0]))[1];
  const other = await registerUser({ name: 'Minh' });
  const from = calls.length;
  await request(app).post('/api/chat-links/claim').set('Authorization', `Bearer ${other.accessToken}`).send({ token: claimToken });
  await Promise.all(background.splice(0));
  expect(calls.slice(from).map(textOf)).toEqual([viText.linked('Minh')]);
  expect(await zaloSent()).toBe(before + calls.length);

  // The linked chat, now over the line, gets a draft but no help.
  expect(await say('/help', USER_B)).toEqual([]);
  expect(textOf((await say('grab 32k', USER_B))[0])).toMatch(/32\.000/);
});

test('TC-F14-21 a locked account is told so only below 2,850 (its reply is not capture or linking)', async () => {
  const owner = await linkedUser();
  await User.updateOne({ _id: owner.id }, { status: 'locked' });
  await setZaloSent(2849);
  expect(textOf((await say('grab 32k'))[0])).toBe(viText.locked);
  expect(await say('grab 32k')).toEqual([]);
  expect(await Transaction.countDocuments()).toBe(0); // locked: nothing is recorded either way
});

test('TC-F14-22 the Zalo count is per Vietnam month: 23:59 on the 30th is November, 00:00 on the 1st starts December', async () => {
  await linkedUser();
  await ChannelUsage.deleteMany({});
  vi.useFakeTimers({ toFake: ['Date'] }); // only the clock: the database and the mocked network keep working
  try {
    vi.setSystemTime(new Date('2026-11-30T16:59:30Z')); // Mon 30/11 23:59:30 +07
    await setZaloSent(2849, '2026-11');
    expect(await say('/help')).toHaveLength(1); // the 2,850th of November
    expect(await say('/help')).toEqual([]);
    expect(await zaloSent('2026-11')).toBe(2850);

    vi.setSystemTime(new Date('2026-11-30T17:00:00Z')); // Tue 01/12 00:00:00 +07
    expect(await say('/help')).toHaveLength(1); // December has its own count, from 0
    expect(await zaloSent('2026-11')).toBe(2850);
    expect(await zaloSent('2026-12')).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F14-30 /dubao and /month give a Zalo chat the same pace as Telegram, in one reply each', async () => {
  novemberDay(25);
  const owner = await linkedUser();
  await seedPaceMonth({ userId: owner.id, walletId: owner.defaultWalletId });

  const dubao = await say('/dubao');
  expect(dubao).toHaveLength(1);
  expect(plain(textOf(dubao[0]))).toBe(A2_DUBAO_VI);
  expect(plain(textOf((await say('/month'))[0]))).toContain('Ngân sách: 89% (7.100.000 ₫ / 8.000.000 ₫) · tối đa 150.000 ₫/ngày');
  expect(textOf((await say('/help'))[0])).toContain('/dubao');
  expect(await Transaction.countDocuments()).toBe(2); // only the two spendings seedPaceMonth() wrote: a forecast is not a draft
});

// docs/02 §2.11.2 A4. The bot's "now" is the real clock, so a test that waits 10 or 20 minutes moves only Date.
const MINUTE = 60 * 1000;
const inMinutes = (start, minutes) => vi.setSystemTime(new Date(start.getTime() + minutes * MINUTE));
const confirmedGrab = async () => {
  await say('grab 32k');
  await say('ok');
  return Transaction.findOne({ status: 'confirmed' });
};

test('TC-F14-80 /sua changes the waiting draft: amount, wallet alias, date and category keyword together; a text with none of them changes nothing', async () => {
  const owner = await linkedUser();
  const momo = await Wallet.create({ userId: owner.id, name: 'MoMo', type: 'ewallet', aliases: ['mm'] });
  const fun = await Category.findOne({ userId: owner.id, 'names.vi': 'Giải trí' });
  await say('grab 32k');
  const draft = await Transaction.findOne();

  const fixed = await say('/sua mm hôm qua 50k phim');
  expect(fixed).toHaveLength(1);
  expect(textOf(fixed[0])).toMatch(/50\.000.*Giải trí.*MoMo/); // the draft again, so "ok" / "huy" still act on it
  expect(textOf(fixed[0]).endsWith(`\n${viText.replyHint}`)).toBe(true);
  const after = await Transaction.findById(draft._id).lean();
  expect(after).toMatchObject({ amount: 50_000, status: 'draft', walletId: momo._id, categoryId: fun._id });
  const days = (Date.now() - after.occurredAt.getTime()) / (24 * 60 * MINUTE);
  expect(days).toBeGreaterThan(0.99);
  expect(days).toBeLessThan(1.01);
  expect(after.note).toBe(draft.note); // the note stays

  // Each part alone, in any case: "/SUA 70K", a wallet alone, a date alone.
  await say('/SUA 70K');
  expect((await Transaction.findById(draft._id)).amount).toBe(70_000);
  await say('/sua tm');
  expect((await Transaction.findById(draft._id)).walletId).toEqual(oid(owner.defaultWalletId));
  await say('/sua 20/11');
  expect((await Transaction.findById(draft._id)).occurredAt.toISOString()).toMatch(/^2026-11-(19|20)T/); // 20/11 in Vietnam time

  // Nothing recognised (or nothing at all) is the help text and no change.
  const before = await Transaction.findById(draft._id).lean();
  for (const text of ['/sua xin chào', '/sua']) expect(textOf((await say(text))[0])).toBe(viText.help);
  expect(await Transaction.findById(draft._id).lean()).toEqual(before);
  expect(await Transaction.countDocuments()).toBe(1); // never a second draft
});

test('TC-F14-81 /sua with no draft waiting edits the transaction this chat confirmed 10 minutes ago, not 20; a waiting draft comes first; a budget warning follows an amount change', async () => {
  const owner = await linkedUser();
  const transport = await Category.findOne({ userId: owner.id, 'names.vi': 'Đi lại' });
  await Budget.create({ userId: owner.id, month: monthKey(new Date()), categoryId: transport._id, limit: 100_000 });
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date());
    const start = new Date();
    const saved = await confirmedGrab();
    expect(await ChatLink.findOne()).toMatchObject({ lastConfirmedId: saved._id, lastConfirmedAt: start });

    inMinutes(start, 10);
    const fixed = textOf((await say('/sua 90k'))[0]);
    expect(fixed).toMatch(/^✏️ Đã sửa: Chi 90\.000.*Đi lại/);
    expect(fixed).toContain('Ngân sách "Đi lại" đã dùng 90%'); // the budget warning runs again after an amount change
    expect(await Transaction.findById(saved._id)).toMatchObject({ amount: 90_000, status: 'confirmed' });
    expect(textOf((await say('/sua hôm qua'))[0])).not.toContain('Ngân sách'); // only an amount change warns

    inMinutes(start, 20);
    expect(textOf((await say('/sua 10k'))[0])).toBe(viText.nothingToFix);
    expect((await Transaction.findById(saved._id)).amount).toBe(90_000);

    // A waiting draft is the target, whatever was confirmed before.
    await say('phở 45k');
    await say('/sua 50k');
    expect(await Transaction.findOne({ status: 'draft' })).toMatchObject({ amount: 50_000 });
    expect((await Transaction.findById(saved._id)).amount).toBe(90_000);
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F14-82 "hoàn tác" (or "undo") soft-deletes the last confirmed, "khôi phục" brings it back; with nothing to act on each says so', async () => {
  await linkedUser();
  expect(textOf((await say('hoàn tác'))[0])).toBe(viText.nothingToUndo);
  expect(textOf((await say('khôi phục'))[0])).toBe(viText.nothingToRestore);

  const saved = await confirmedGrab();
  const undone = textOf((await say('Hoàn Tác'))[0]);
  expect(undone).toMatch(/Đã xoá.*32\.000.*khôi phục/);
  expect((await Transaction.findById(saved._id)).deletedAt).toBeInstanceOf(Date);
  expect(await Transaction.countDocuments()).toBe(1); // never read as a capture, a question or a new draft
  expect(textOf((await say('undo'))[0])).toBe(viText.nothingToUndo); // it is already deleted

  expect(textOf((await say('khôi phục'))[0])).toMatch(/Đã khôi phục.*32\.000/);
  expect((await Transaction.findById(saved._id)).deletedAt).toBeNull();
  expect(textOf((await say('khoi phuc'))[0])).toBe(viText.nothingToRestore); // already back

  await say('undo'); // the English alias, and in English
  expect((await Transaction.findById(saved._id)).deletedAt).toBeInstanceOf(Date);
  await say('/lang en');
  expect(textOf((await say('undo'))[0])).toBe(enText.nothingToUndo);
  expect(textOf((await say('khôi phục'))[0])).toMatch(/^♻️ Restored: Expense/);
  expect((await Transaction.findById(saved._id)).deletedAt).toBeNull();

  // A real expense that starts with the same word is still a capture.
  expect(textOf((await say('sửa xe 150k'))[0])).toMatch(/150,000/); // a draft, in English now
  expect(await Transaction.findOne({ status: 'draft' })).toMatchObject({ amount: 150_000, note: 'sửa xe' });
  expect(await Transaction.countDocuments()).toBe(2);
});

test("TC-F14-83 another chat's or another user's transactions are never fixed, undone or restored", async () => {
  const owner = await linkedUser();
  const other = await linkedUser(USER_B);
  const mine = await confirmedGrab();
  await say('cafe 20k', USER_B);
  await say('ok', USER_B);
  const theirs = await Transaction.findOne({ userId: other.id });

  // B has a confirmed one and no draft: "/sua" and "hoàn tác" reach B's, never A's.
  await say('/sua 99k', USER_B);
  await say('hoàn tác', USER_B);
  expect(await Transaction.findById(mine._id)).toMatchObject({ amount: 32_000, deletedAt: null, userId: oid(owner.id) });
  expect(await Transaction.findById(theirs._id)).toMatchObject({ amount: 99_000 });
  expect((await Transaction.findById(theirs._id)).deletedAt).toBeInstanceOf(Date);

  // A second chat of A's own that confirmed nothing has nothing to fix or undo, though A's first chat did.
  const second = await ChatLink.create({ userId: owner.id, platform: 'zalo', platformUserId: 'second', chatId: 'second' });
  expect(second.lastConfirmedId).toBeNull();
  expect(textOf((await say('hoàn tác', 'second'))[0])).toBe(viText.nothingToUndo);
  expect(textOf((await say('/sua 1k', 'second'))[0])).toBe(viText.nothingToFix);
  expect((await Transaction.findById(mine._id)).deletedAt).toBeNull();
  expect((await Transaction.findById(mine._id)).amount).toBe(32_000);

  // A pointer to someone else's transaction (a stale or tampered row) is not followed either.
  await ChatLink.updateOne({ platformUserId: USER_B }, { lastConfirmedId: mine._id, lastConfirmedAt: new Date() });
  await say('/sua 1k', USER_B);
  await say('hoàn tác', USER_B);
  expect(await Transaction.findById(mine._id)).toMatchObject({ amount: 32_000, deletedAt: null });
});

test('TC-F14-84 /help lists /sua, "hoàn tác" and "khôi phục" in both languages', async () => {
  await linkedUser();
  for (const text of [viText.help, enText.help]) {
    expect(text).toContain('/sua');
    expect(text).toContain('hoàn tác');
    expect(text).toContain('khôi phục');
  }
  expect(enText.help).toContain('undo');
  expect(textOf((await say('/help'))[0])).toBe(viText.help);
  await say('/lang en');
  expect(textOf((await say('/help'))[0])).toBe(enText.help);
});
