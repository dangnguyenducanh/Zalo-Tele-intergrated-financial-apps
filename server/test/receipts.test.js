import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import { handleMessage } from '../src/bot/core.js';
import viText from '../src/bot/messages.vi.js';
import { ChatLink } from '../src/models/ChatLink.js';
import { LinkCode } from '../src/models/LinkCode.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import { vnParts } from '../src/utils/vnTime.js';
import recorded from './fixtures/kie-analyze.json' with { type: 'json' };
import telegramFixtures from './fixtures/telegram-updates.json' with { type: 'json' };
import { registerUser, resetLoginLimit } from './helpers/auth.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';

// KIE is mocked at a made-up host. (The NODE_ENV=test default KIE_URL uses port 9, which fetch refuses outright.)
vi.hoisted(() => {
  process.env.KIE_URL = 'http://kie.test';
});
const KIE = 'http://kie.test/analyze';

// The webhook answers 200 first and hands the real work to waitUntil(). Collect that work so a test can wait for it.
const background = vi.hoisted(() => []);
vi.mock('@vercel/functions', async (importOriginal) => ({
  ...(await importOriginal()),
  waitUntil: (promise) => {
    background.push(promise);
  },
}));

// The receipt photo KIE read for the recorded answer in fixtures/kie-analyze.json.
const PHOTO = await readFile(new URL('./fixtures/receipts/mcocr_public_145014khrvg.jpg', import.meta.url));
const ZALO_PHOTO_URL = 'https://photo.zalo.example/receipt-42.jpg';
const TELEGRAM_FILE_PATH = 'photos/file_42.jpg';

// Every outbound call: Telegram Bot API methods, photo downloads and KIE /analyze, answered like the real services.
const telegramCalls = [];
const kieRequests = [];
const outbound = setupServer(
  http.post('https://api.telegram.org/:bot/:method', async ({ params, request }) => {
    const body = await request.json();
    telegramCalls.push({ method: params.method, body });
    if (params.method === 'getFile') return HttpResponse.json({ ok: true, result: { file_id: body.file_id, file_path: TELEGRAM_FILE_PATH } });
    return HttpResponse.json({ ok: true, result: { message_id: 1000 + telegramCalls.length } });
  }),
  http.get(`https://api.telegram.org/file/:bot/${TELEGRAM_FILE_PATH}`, () => new HttpResponse(PHOTO, { headers: { 'content-type': 'image/jpeg' } })),
  http.get(ZALO_PHOTO_URL, () => new HttpResponse(PHOTO, { headers: { 'content-type': 'image/jpeg' } })),
  http.post(KIE, async ({ request }) => {
    const image = (await request.formData()).get('image');
    kieRequests.push({ key: request.headers.get('x-kie-key'), type: image.type, bytes: Buffer.from(await image.arrayBuffer()) });
    return HttpResponse.json(recorded);
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
// A failed bot update is only logged (the platform already has its 200), so a logged error fails the test.
let errorLog;
beforeEach(() => {
  errorLog = vi.spyOn(console, 'error');
});
afterEach(async () => {
  expect(errorLog).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  outbound.resetHandlers();
  telegramCalls.length = 0;
  kieRequests.length = 0;
  zaloSent.length = 0;
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(async () => {
  outbound.close();
  await stopTestDb();
  delete process.env.KIE_URL;
});

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const api = (accessToken) => ({
  get: (path) => request(app).get(`/api${path}`).set('Authorization', `Bearer ${accessToken}`),
  post: (path) => request(app).post(`/api${path}`).set('Authorization', `Bearer ${accessToken}`),
});
const upload = (accessToken, bytes, filename, contentType) =>
  api(accessToken).post('/receipts').attach('image', bytes, { filename, contentType });

// A registered user and the id of their "Ăn uống" category (the receipt's "bánh mì" item matches its keywords).
async function newUser() {
  const { accessToken, user } = await registerUser();
  const { body: categories } = await api(accessToken).get('/categories');
  return { accessToken, user, food: categories.find((c) => c.names?.vi === 'Ăn uống').id };
}

// --- Zalo ---------------------------------------------------------------------------------------------------
// Zalo sends a photo as event "message.image.received" with message.photo_url (docs/04 §4.6). The Zalo adapter
// (server/src/bot/zalo.js, task T12) maps that event to the bot core; this stand-in does the same mapping and
// downloads the photo_url, so the core's photo path is tested the way Zalo will drive it.
const zaloSent = [];
const zalo = {
  platform: 'zalo',
  sendText: async (chatId, text) => zaloSent.push(text),
  sendDraft: async (chatId, draft) => zaloSent.push(draft.text),
  downloadPhoto: async (url) => Buffer.from(await (await fetch(url)).arrayBuffer()),
};
let zaloMessageId = 0;
function zaloEvent(eventName, fields) {
  zaloMessageId += 1;
  const message = {
    from: { id: 'f1a2b3c4d5e6', display_name: 'Anh Nguyen', is_bot: false },
    chat: { id: 'f1a2b3c4d5e6', chat_type: 'PRIVATE' },
    message_id: `zmsg${zaloMessageId}`,
    date: 1763620200000,
    ...fields,
  };
  return handleMessage(zalo, {
    platformUserId: message.from.id,
    chatId: message.chat.id,
    messageId: message.message_id,
    displayName: message.from.display_name,
    text: message.text ?? '',
    photo: eventName === 'message.image.received' ? message.photo_url : undefined,
  });
}
const zaloText = (text) => zaloEvent('message.text.received', { text });
const zaloPhoto = () => zaloEvent('message.image.received', { photo_url: ZALO_PHOTO_URL });

async function linkedZaloUser() {
  const owner = await newUser();
  const { body } = await api(owner.accessToken).post('/chat-links/code');
  await zaloText(`/link ${body.code}`);
  zaloSent.length = 0;
  return owner;
}

// --- Telegram -----------------------------------------------------------------------------------------------
const CHAT = telegramFixtures.text.message.chat.id;
let telegramMessageId = 500;
function telegramMessage(fields) {
  const update = structuredClone(telegramFixtures.text);
  telegramMessageId += 1;
  update.update_id += telegramMessageId;
  delete update.message.text;
  Object.assign(update.message, { message_id: telegramMessageId, ...fields });
  return update;
}
// A photo as Telegram sends it: the same image in several sizes, the largest last.
const photoUpdate = () =>
  telegramMessage({
    photo: [
      { file_id: 'AgACAgUAAxkBAAIBsmall', file_unique_id: 'AQADs', file_size: 1342, width: 67, height: 90 },
      { file_id: 'AgACAgUAAxkBAAIBmedium', file_unique_id: 'AQADm', file_size: 18810, width: 240, height: 320 },
      { file_id: 'AgACAgUAAxkBAAIBlarge', file_unique_id: 'AQADl', file_size: 92311, width: 960, height: 1280 },
    ],
  });
async function deliver(update) {
  const res = await request(app).post('/api/webhooks/telegram').set('X-Telegram-Bot-Api-Secret-Token', 'test-telegram-secret').send(update);
  await Promise.all(background.splice(0));
  return res;
}

test('TC-F8-08 a Zalo photo is read by KIE into a receipt draft: amount = total digits, line items saved, no base64 stored', async () => {
  const { user, food } = await linkedZaloUser();
  await zaloPhoto();

  // "Reading receipt…" first, then KIE gets the downloaded photo with the shared key.
  expect(zaloSent[0]).toBe(viText.readingReceipt);
  expect(kieRequests).toHaveLength(1);
  expect(kieRequests[0]).toMatchObject({ key: 'test-kie-key', type: 'image/jpeg' });
  expect(kieRequests[0].bytes.equals(PHOTO)).toBe(true);

  const drafts = await Transaction.find().lean();
  expect(drafts).toHaveLength(1);
  const [draft] = drafts;
  expect(draft).toMatchObject({
    userId: oid(user.id),
    walletId: oid(user.defaultWalletId),
    categoryId: oid(food), // "bánh mì bò kd NT" matches the keyword "banh mi"
    type: 'expense',
    amount: 116000, // fields.total "116000"
    note: 'HÓA ĐON BÁN HANG', // fields.merchant
    status: 'draft',
    source: 'zalo',
    chatRef: { platform: 'zalo', chatId: 'f1a2b3c4d5e6', messageId: `zmsg${zaloMessageId}:1` },
  });
  expect(vnParts(draft.occurredAt)).toEqual({ year: 2020, month: 8, day: 13 }); // fields.date "13/08/2020"

  // Exactly these receipt fields are stored: no base64 images, boxes, lines or full text.
  expect(draft.receipt).toEqual({
    merchant: 'HÓA ĐON BÁN HANG',
    address: recorded.fields.address,
    date: '13/08/2020',
    total: 116000,
    items: recorded.line_items.map((item) => ({ name: item.name, quantity: item.quantity, unitPrice: item.unit_price, amount: item.amount })),
    reconciled: true,
    kieMs: 7466, // 24.17 + 7428.3 + 13.5 from timings_ms
    fileRef: ZALO_PHOTO_URL,
  });
  expect(draft.receipt.items[0]).toEqual({ name: 'mì omachi 102 bò nu dua ch N0', quantity: 1, unitPrice: 10000, amount: 10000 });
  expect(JSON.stringify(draft)).not.toContain(recorded.images.annotated_jpeg_base64.slice(0, 40));

  // The draft reply: merchant · total · category, the line count and that the items add up.
  expect(zaloSent).toHaveLength(2);
  expect(zaloSent[1]).toContain('116.000');
  expect(zaloSent[1]).toContain('Ăn uống');
  expect(zaloSent[1]).toContain('HÓA ĐON BÁN HANG');
  expect(zaloSent[1]).toContain(viText.receiptItems({ count: 6, reconciled: true }));

  // It is the chat's pending draft, so Zalo's "ok" saves it.
  await zaloText('ok');
  expect(zaloSent.at(-1)).toContain('✅ Đã lưu');
  expect((await Transaction.findById(draft._id)).status).toBe('confirmed');
});

test('TC-F8-08 a Telegram photo goes through getFile and KIE to a draft with ✅/❌ buttons, once even if delivered twice', async () => {
  const owner = await newUser();
  const { body } = await api(owner.accessToken).post('/chat-links/code');
  await deliver(telegramMessage({ text: `/start ${body.code}` }));
  telegramCalls.length = 0;

  const update = photoUpdate();
  expect((await deliver(update)).status).toBe(200);
  expect((await deliver(update)).status).toBe(200); // Telegram delivers it again

  // The largest size is downloaded, read once, and becomes one draft.
  expect(telegramCalls.find((c) => c.method === 'getFile').body).toEqual({ file_id: 'AgACAgUAAxkBAAIBlarge' });
  expect(kieRequests).toHaveLength(1);
  const [draft] = await Transaction.find().lean();
  expect(await Transaction.countDocuments()).toBe(1);
  expect(draft).toMatchObject({ amount: 116000, categoryId: oid(owner.food), status: 'draft', source: 'telegram' });
  expect(draft.chatRef).toEqual({ platform: 'telegram', chatId: String(CHAT), messageId: `${update.message.message_id}:1` });
  expect(draft.receipt.fileRef).toBe('AgACAgUAAxkBAAIBlarge');

  const sent = telegramCalls.filter((c) => c.method === 'sendMessage');
  expect(sent.map((c) => c.body.text)).toEqual([viText.readingReceipt, expect.stringContaining('116.000')]);
  const id = String(draft._id);
  expect(sent[1].body.reply_markup.inline_keyboard[0].map((b) => b.callback_data)).toEqual([`c:${id}`, `x:${id}`]);
});

test('TC-F8-09 KIE unreachable, or no total on the photo: the chat is asked to type the amount and no draft is made', async () => {
  await linkedZaloUser();
  outbound.use(http.post(KIE, () => HttpResponse.error())); // network error
  await zaloPhoto();
  outbound.use(http.post(KIE, () => HttpResponse.json({ ...recorded, fields: { ...recorded.fields, total: '' } })));
  await zaloPhoto();

  expect(zaloSent).toEqual([viText.readingReceipt, viText.receiptUnavailable, viText.readingReceipt, viText.receiptUnreadable]);
  expect(viText.receiptUnavailable).toContain('Hãy gõ số tiền');
  expect(await Transaction.countDocuments()).toBe(0);
});

test('TC-F8-09 KIE slower than 120 s: the request is given up and the chat is asked to type the amount', async () => {
  await linkedZaloUser();
  let reachedKie;
  const atKie = new Promise((resolve) => {
    reachedKie = resolve;
  });
  outbound.use(
    http.post(KIE, async () => {
      reachedKie();
      await delay(130_000);
      return HttpResponse.json(recorded);
    }),
  );
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  // AbortSignal.timeout runs on Node's internal timers, which fake timers don't reach, so it is rebuilt on setTimeout.
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('The operation timed out', 'TimeoutError')), ms);
    return controller.signal;
  });

  const reading = zaloPhoto();
  await atKie;
  await vi.advanceTimersByTimeAsync(119_000);
  expect(zaloSent).toEqual([viText.readingReceipt]); // still waiting at 119 s
  await vi.advanceTimersByTimeAsync(11_000);
  await reading;

  expect(timeout).toHaveBeenCalledWith(120_000);
  expect(zaloSent).toEqual([viText.readingReceipt, viText.receiptUnavailable]);
  vi.useRealTimers();
  expect(await Transaction.countDocuments()).toBe(0);
});

test('TC-F10-02 POST /api/receipts answers 415 for a PDF and 413 for a 6 MB image, without calling KIE', async () => {
  const { accessToken } = await newUser();
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');

  const asPdf = await upload(accessToken, pdf, 'receipt.pdf', 'application/pdf');
  expect(asPdf.status).toBe(415);
  expect(asPdf.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  // Renaming it does not help: the file's first bytes decide.
  expect((await upload(accessToken, pdf, 'receipt.jpg', 'image/jpeg')).status).toBe(415);

  const big = await upload(accessToken, Buffer.concat([PHOTO, Buffer.alloc(6 * 1024 * 1024)]), 'big.jpg', 'image/jpeg');
  expect(big.status).toBe(413);
  expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');

  expect(kieRequests).toHaveLength(0);
  expect(await Transaction.countDocuments()).toBe(0);
});

test('TC-F10-04 POST /api/receipts turns a photo into a receipt draft; KIE failures answer 502, 504 or 422', async () => {
  const { accessToken, user, food } = await newUser();
  expect((await request(app).post('/api/receipts').attach('image', PHOTO, 'r.jpg')).status).toBe(401);
  const missing = await api(accessToken).post('/receipts').field('note', 'no image');
  expect(missing.status).toBe(400);
  expect(missing.body.error.details).toEqual([{ path: 'image', issue: 'required' }]);

  const res = await upload(accessToken, PHOTO, 'receipt.jpg', 'image/jpeg');
  expect(res.status).toBe(201);
  expect(res.body.transaction).toMatchObject({
    type: 'expense',
    amount: 116000,
    walletId: user.defaultWalletId,
    categoryId: food,
    note: 'HÓA ĐON BÁN HANG',
    status: 'draft',
    source: 'receipt',
    receipt: { total: 116000, reconciled: true, date: '13/08/2020' },
  });
  expect(res.body.transaction.receipt.items).toHaveLength(6);
  expect(res.body.transaction.chatRef).toBeUndefined();
  expect(kieRequests).toMatchObject([{ key: 'test-kie-key', type: 'image/jpeg' }]);

  errorLog.mockImplementation(() => {}); // 5xx answers are logged with their request id; counted below
  const failures = [
    [() => HttpResponse.error(), 502, 'KIE_UNAVAILABLE'], // tunnel down
    [() => HttpResponse.json({ detail: 'Missing or invalid X-KIE-Key header.' }, { status: 401 }), 502, 'KIE_UNAVAILABLE'],
    [() => HttpResponse.json({ ...recorded, fields: { ...recorded.fields, total: '' } }), 422, 'RECEIPT_UNREADABLE'],
    [() => HttpResponse.json({ detail: 'The uploaded file is not a valid image.' }, { status: 400 }), 422, 'RECEIPT_UNREADABLE'],
  ];
  for (const [answer, status, code] of failures) {
    outbound.use(http.post(KIE, answer));
    const failed = await upload(accessToken, PHOTO, 'receipt.jpg', 'image/jpeg');
    expect([failed.status, failed.body.error.code]).toEqual([status, code]);
  }
  // A timed-out request (TC-F8-09 waits the real 120 s on fake timers) answers 504.
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('The operation timed out', 'TimeoutError')));
  const slow = await upload(accessToken, PHOTO, 'receipt.jpg', 'image/jpeg');
  expect([slow.status, slow.body.error.code]).toEqual([504, 'KIE_TIMEOUT']);

  expect(await Transaction.countDocuments()).toBe(1);
  expect(errorLog).toHaveBeenCalledTimes(3); // the two 502s and the 504
  errorLog.mockClear();
});
