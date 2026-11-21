import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import viText from '../src/bot/messages.vi.js';
import { ChatLink } from '../src/models/ChatLink.js';
import { LinkCode } from '../src/models/LinkCode.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import recorded from './fixtures/kie-analyze.json' with { type: 'json' };
import fixtures from './fixtures/zalo-events.json' with { type: 'json' };
import { registerUser, resetLoginLimit } from './helpers/auth.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';

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
