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
import { DEFAULT_CATEGORIES } from '../src/seed/templates.js';
import { wordsToNumber } from '../src/services/receiptTotal.js';
import { analyzeReceipt, receiptToDraft } from '../src/services/receipts.js';
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
// A photo with nothing usable on it: no total from KIE, and no total or item line in the text it read
// (KIE's fields.total is only one candidate: a total printed in the text is still found, TC-F10-07…10).
const NOTHING_READ = { ...recorded, fields: { ...recorded.fields, total: '' }, line_items: [], full_text: '', lines: [] };
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
  outbound.use(http.post(KIE, () => HttpResponse.json(NOTHING_READ)));
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
    [() => HttpResponse.json(NOTHING_READ), 422, 'RECEIPT_UNREADABLE'],
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

// --- The tester's receipts (BUG-034…037) ---------------------------------------------------------------------
// KIE's answers for synthetic receipts made after the tester's bug sheet, recorded from the KIE service on 2026-11-25
// (fixtures/kie-bugs). *.orient.kie.json: KIE with its page-orientation classifier switched on.
const CATEGORIES = DEFAULT_CATEGORIES.filter((c) => c.type === 'expense').map((c) => ({ ...c, _id: c.names.en }));
const kieAnswer = async (name) => JSON.parse(await readFile(new URL(`./fixtures/kie-bugs/${name}.kie.json`, import.meta.url), 'utf8'));

// KIE answers `answer` → what analyzeReceipt keeps of it → the draft's fields (receiptToDraft).
async function draftFrom(answer) {
  outbound.use(http.post(KIE, () => HttpResponse.json(answer)));
  return receiptToDraft(await analyzeReceipt(PHOTO, 'image/jpeg'), { categories: CATEGORIES });
}
const draftFor = async (name) => draftFrom(await kieAnswer(name));

test('TC-F10-07 a VAT invoice gives the total payable with VAT, not the goods subtotal; a tech invoice is not food or film (BUG-034)', async () => {
  // A: value printed above its label, B: label and value on one line, C: bilingual, where KIE took "Total amount" 6.800.000.
  for (const name of ['bug034-vat-invoice-A', 'bug034-vat-invoice-B', 'bug034-vat-invoice-C']) {
    const draft = await draftFor(name);
    expect(draft.amount, name).toBe(7480000); // "Tổng cộng tiền thanh toán" = 6.800.000 + 680.000 VAT
    expect(draft.receipt, name).toMatchObject({ total: 7480000, reconciled: false }); // the items add up to 6.800.000
    expect(draft.receipt.estimated, name).toBeUndefined();
    expect(draft.categoryId, name).toBe('Other'); // "Bàn phím" (keyboard) is not "phim" (film)
  }
  // OCR often drops the accents: "Ban phim" is still a keyboard.
  const invoice = await kieAnswer('bug034-vat-invoice-A');
  invoice.line_items = invoice.line_items.map((item) => ({ ...item, name: item.name.replace('Bàn phím', 'Ban phim') }));
  expect((await draftFrom(invoice)).categoryId).toBe('Other');
});

test('TC-F10-08 a Phiếu thu gives "Số tiền" 2.500.000, never the year of PT-09/2023 or the account code "Nợ: 1111" (BUG-035)', async () => {
  for (const name of ['bug035-phieu-thu-A', 'bug035-phieu-thu-B']) {
    const draft = await draftFor(name);
    expect([draft.type, draft.amount, draft.receipt.total], name).toEqual(['expense', 2500000, 2500000]);
  }
});

test('TC-F10-08 an amount in words ("Bằng chữ"), accents dropped and as OCR reads it, becomes the number', () => {
  const cases = [
    ['hai trieu nam tram nghin dong chan', 2500000],
    ['bay triu bon tram tam muoi nghin dong', 7480000], // OCR dropped the "ệ" of "triệu"
    ['amount in words chin muoi hai nghin bon tram dong', 92400],
    ['mot tram muoi lam nghin', 115000],
    ['hai muoi mot nghin', 21000],
    ['mot tram linh nam nghin', 105000],
    ['mot ty hai tram trieu', 1200000000],
    ['mot ti hai tram trieu', 1200000000], // "tỉ", the other spelling of "tỷ"
    ['nam muoi nham nghin', 55000], // "nhăm" = 5 after "mươi"
    ['dong chan', 0],
  ];
  for (const [words, number] of cases) expect(wordsToNumber(words), words).toBe(number);
});

test('TC-F10-09 a torn receipt with no total: the sum of its readable item lines, marked as an estimate; nothing readable → 422 (BUG-036)', async () => {
  // A: torn below the items (KIE took the first item), B: KIE took "Số HĐ: 004829" as 4.829.
  for (const name of ['bug036-torn-A', 'bug036-torn-B']) {
    const draft = await draftFor(name);
    expect(draft.amount, name).toBe(53000); // 20.000 + 15.000 + 18.000
    expect(draft.receipt, name).toMatchObject({ total: 53000, estimated: true, reconciled: true });
    expect(draft.receipt.items.map((item) => item.amount), name).toEqual([20000, 15000, 18000]);
  }
  expect((await draftFor('bug036-torn-A')).categoryId).toBe('Food & drinks'); // the item lines it summed: "Bánh mì sandwich"

  // Torn above the items: KIE's 20.000 is not printed anywhere that is left, and there is no item to add up.
  const header = await kieAnswer('bug036-torn-A');
  header.lines = header.lines.slice(0, 6);
  header.full_text = header.lines.join('\n');
  const error = await draftFrom(header).catch((err) => err);
  expect(error).toMatchObject({ status: 422, code: 'RECEIPT_UNREADABLE' });
});

test('TC-F10-10 a sideways WinMart+ photo gives "Tiền cần thanh toán" 92.400, with or without KIE reading it upright (BUG-037)', async () => {
  // KIE with the orientation flag on reads the sideways photos upright, but each value lands one row off its label
  // (A: "Tiền cần thanh toán 100.000", B: "TIỀN CẦN THANH TOÁN: -22.700"). Without the flag (KIE as it runs today) the
  // amounts come out as one column with no labels next to them (A: KIE took 115.100, B: no total). The upright photos
  // are the controls.
  const answers = ['sideways-A', 'sideways-B', 'sideways-A.orient', 'sideways-B.orient', 'unrotated-A.orient', 'unrotated-B.orient'];
  for (const name of answers.map((answer) => `bug037-${answer}`)) {
    const draft = await draftFor(name);
    expect(draft.amount, name).toBe(92400); // "Tổng tiền hàng" 115.100 − 22.700 points, not the subtotal KIE picks
    expect(draft.receipt.estimated, name).toBeUndefined();
    expect(draft.categoryId, name).toBe('Shopping'); // "WinMart+"
  }
});

// Variants found in review (PR #70): KIE's answer as text lines, with KIE's total as `total` and whether KIE's own
// line items add up to it as `consistent` (false on most real photos).
const textAnswer = (lines, total = '', consistent = undefined) => ({
  fields: { total },
  line_items: [],
  reconciliation: consistent === undefined ? {} : { is_math_consistent: consistent },
  full_text: lines.join('\n'),
  lines,
});
const withLines = (answer, lines, total = answer.fields.total) => ({ ...answer, fields: { ...answer.fields, total }, full_text: lines.join('\n'), lines });

test('TC-F10-12 a torn receipt is estimated from its item lines in every layout, never from one price, a list price, a phone number or a code (BUG-036)', async () => {
  // Live KIE, the upright WinMart+ photo cut below its 4 items: a name line, then "1 × 45.900 45.900". KIE took one price.
  const winmart = await kieAnswer('bug036-torn-winmart');
  const items = [6, 8, 10, 12].map((i) => ({ name: winmart.lines[i], amount: Number(winmart.lines[i + 1].split(' ').at(-1).replace('.', '')) }));
  for (const total of ['45900', '18900', '17400']) {
    const draft = await draftFrom({ ...winmart, fields: { ...winmart.fields, total } });
    expect([draft.amount, draft.receipt.estimated], total).toEqual([115100, true]);
    expect(draft.receipt.items, total).toEqual(items);
  }
  // Live KIE, the mcocr minimart receipt cut below its items (KIE took 10.000): 6 products, "Giá đăng ký: 6,500" is a list price.
  const minimart = await draftFor('bug036-torn-minimart');
  expect([minimart.amount, minimart.receipt.estimated, minimart.receipt.items.length]).toEqual([116000, true, 6]);

  // A phone number or a transaction code is never an item; an item discount counts, and never makes a read total.
  const lines = ['CỬA HÀNG TIỆN LỢI', 'ĐT: +84 912.345.678', 'Mã GD: 2.611.240', 'Số HĐ: 004830', 'Cà phê sữa 20.000', 'KM -5.000', 'Bánh mì 15.000', 'Nước cam 18.000', 'TỔNG CỘNG:'];
  const torn = await draftFrom(textAnswer(lines, '004830'));
  expect([torn.amount, torn.receipt.estimated]).toEqual([48000, true]);
  expect(torn.receipt.items.map((item) => item.amount)).toEqual([20000, -5000, 15000, 18000]);
});

test('TC-F10-13 a grand-total label that mentions VAT ("Tổng cộng (đã bao gồm VAT)") is the total, not the VAT line (BUG-034)', async () => {
  // Live KIE, a supermarket receipt with that label, values one row off their labels; KIE took the 22.700 discount.
  const supermarket = await draftFor('bug034-total-incl-vat');
  expect([supermarket.amount, supermarket.receipt.estimated]).toEqual([92400, undefined]);
  // A restaurant bill, KIE took "Tạm tính".
  const bill = ['NHÀ HÀNG SEN', 'Lẩu thái 2 x 250.000 500.000', 'Tạm tính 500.000', 'VAT 8% 40.000', 'Tổng cộng (đã gồm VAT) 540.000', 'Tiền mặt 600.000', 'Tiền thừa 60.000'];
  expect((await draftFrom(textAnswer(bill, '500000'))).amount).toBe(540000);
  // VAT invoice B with "(đã gồm thuế GTGT)" in its total label and no amount in words; KIE took the goods subtotal.
  const invoice = await kieAnswer('bug034-vat-invoice-B');
  const lines = invoice.lines.toSpliced(16, 2, invoice.lines[16].replace(':', ' (đã gồm thuế GTGT):'));
  expect(lines[16]).toMatch(/thanh toán \(đã gồm thuế GTGT\): 7\.480\.000$/);
  expect((await draftFrom(withLines(invoice, lines, '6800000'))).amount).toBe(7480000);
});

test('TC-F10-14 the largest labelled value is not always the total: "Khách cần trả" beats the cash handed over, the total after discounts the one before (BUG-034)', async () => {
  const shop = await draftFor('bug034-tendered-cash'); // live KIE took "Khách thanh toán 50.000"
  expect([shop.amount, shop.receipt.estimated]).toEqual([35000, undefined]);
  const minimart = ['MINIMART', 'Sữa 124.000', 'Tổng thanh toán 124.000', 'Số tiền nhận 200.000', 'Trả lại 76.000'];
  expect((await draftFrom(textAnswer(minimart, '124000'))).amount).toBe(124000);
  const discounted = ['SHOP', 'Áo thun 115.100', 'Tổng cộng 115.100', 'Chiết khấu -22.700', 'Thanh toán 92.400'];
  expect((await draftFrom(textAnswer(discounted, '115100'))).amount).toBe(92400);
});

test('TC-F10-15 a total printed without thousands separators, or with decimals, is still read', async () => {
  // The recorded mcocr receipt (KIE took 116.000 and its items add up), as OCR reads it without separators.
  const noSeparators = (separator) => (line) => line.replace(/(\d),(\d{3})/g, `$1${separator}$2`);
  const totalsBlock = (change) => recorded.lines.map((line, i) => (i >= 19 ? change(line) : line));
  const variants = [totalsBlock(noSeparators('')), totalsBlock(noSeparators(' ')), recorded.lines.map(noSeparators(''))];
  for (const lines of variants) {
    const draft = await draftFrom(withLines(recorded, lines));
    expect([draft.amount, draft.receipt.estimated], lines[20]).toEqual([116000, undefined]);
  }
  expect((await draftFrom(textAnswer(['SHOP', 'Áo thun 92,400.00', 'Tổng cộng: 92,400.00'], '92400.00'))).amount).toBe(92400);
});

// Review round 2 on PR #70: live KIE answers for receipts rendered by the reviewers (fixtures/kie-bugs/review-*), the
// recorded mcocr answers (fixtures/kie-bugs/mcocr-*, photos in fixtures/receipts) and text variants of them.
const read = async (answer) => {
  const draft = await draftFrom(typeof answer === 'string' ? await kieAnswer(answer) : answer);
  return [draft.amount, draft.receipt.estimated ?? false];
};

test('TC-F10-16 a discount printed without a minus, or twice, is taken off: the total after it is read, not the one before (BUG-034)', async () => {
  // Live KIE: "Tổng cộng 115.000", "Chiết khấu 20% 23.000", "Thanh toán 92.000" (KIE right), also as if KIE took 115.000.
  const cafe = await kieAnswer('review-discount-unsigned');
  expect(await read(cafe)).toEqual([92000, false]);
  expect(await read({ ...cafe, fields: { ...cafe.fields, total: '115000' } })).toEqual([92000, false]);
  // Live KIE: "Tổng tiền 115.100", "Giảm giá 22.700", "Tổng cộng 92.400"; KIE took 115.100.
  expect(await read('review-discount-unsigned-B')).toEqual([92400, false]);
  // The same photo turned 2.4°: KIE puts each value one line above its label ("115.100", "Tổng tiền 22.700",
  // "Giảm giá 92.400", "Tổng cộng") and took 22.700.
  expect(await read('review-discount-unsigned-B-shifted')).toEqual([92400, false]);
  // A last label without its value is not always a shifted photo: with no cross-check after shifting, the reading stays.
  expect(await read(textAnswer(['SHOP', 'Nước 10.000', 'Bánh 25.000', 'Tổng cộng 35.000', 'Tiền khách đưa'], '35000', false))).toEqual([35000, false]);
  const items = ['Cà phê sữa đá 2 x 25.000 50.000', 'Bánh mì thịt 30.000', 'Trà đào 35.000'];
  expect(await read(textAnswer([...items, 'Tổng cộng: 115.000', 'Khuyến mãi: 23.000', 'Thanh toán: 92.000'], '115000', true))).toEqual([92000, false]);
  expect(await read(textAnswer([...items, 'Tạm tính: 115.000', 'Giảm giá: 15.000', 'VAT 8%: 8.000', 'Tổng cộng: 108.000'], '108000'))).toEqual([108000, false]);
  // The same 5.000 off twice is 10.000 off; 25.000 − 5.000 is an item's price, not the total.
  const twice = ['Trứng gà 1 20.000 20.000', 'KM -5.000', 'Mì 1 15.000 15.000', 'KM -5.000', 'Tổng tiền hàng 35.000', 'Thanh toán 25.000'];
  expect(await read(textAnswer(twice, '35000', false))).toEqual([25000, false]);
});

test('TC-F10-17 a total under a bare or English label ("Tổng:", "TOTAL", "Thành tiền", "Cộng tiền") is read, not doubled into an estimate', async () => {
  // Live KIE, KIE right each time but its own items do not add up: "Tổng: 115.000"; "TOTAL 115.000", "CASH 200.000",
  // "CHANGE 85.000"; "Subtotal 64.000", "VAT 8% 5.120", "TOTAL 69.120", "Cash 100.000", "Change 30.880".
  expect(await read('review-bare-total')).toEqual([115000, false]);
  expect(await read('review-english-total')).toEqual([115000, false]);
  expect(await read('review-english-vat')).toEqual([69120, false]);
  // Real mcocr text with only its total label changed ("TÖNG TIEN PHÃI T.TOÁN 114.700"), KIE's items not adding up.
  const cftxo = await kieAnswer('mcocr-cftxo');
  for (const name of ['TOTAL', 'TỔNG:', 'THÀNH TIỀN', 'CỘNG TIỀN', 'Tổng thành tiền:']) {
    const lines = cftxo.lines.map((line) => line.replace('TÖNG TIEN PHÃI T.TOÁN', name));
    expect(await read(withLines(cftxo, lines)), name).toEqual([114700, false]);
  }
  // Real mcocr text where OCR cut the labels' first letters ("g công : 124,000", "à lai VND: 76,000"), as if KIE's items
  // did not add up.
  const ykqth = await kieAnswer('mcocr-ykqth');
  expect(await read({ ...ykqth, reconciliation: { ...ykqth.reconciliation, is_math_consistent: false } })).toEqual([124000, false]);
  const shop = ['Trứng gà vỉ 10 1 20.000 20.000', 'Mì Omachi bò 3 5.000 15.000', 'Pepsi lon 2 9.000 18.000'];
  for (const total of ['Thành tiền 53.000', 'Cộng: 53.000', 'TỔNG: 53.000']) {
    expect(await read(textAnswer([...shop, total, 'Tiền khách đưa 100.000', 'Tiền thối lại 47.000'], '53000', false)), total).toEqual([53000, false]);
    expect(await read(textAnswer([...shop, total], '', false)), total).toEqual([53000, false]);
  }
  // A total word that is not a total: "Công ty", and a value-only line above a bare label that belongs to an item name.
  expect(await read(textAnswer(['CÔNG TY TNHH AN', '1.000.000', 'Bánh mì pate', '15.000', 'Tổng cộng', '53.000'], '53000', false))).toEqual([53000, false]);
});

test('TC-F10-18 a grand-total label that mentions VAT in any words is the total, not the VAT line (BUG-034)', async () => {
  // Live KIE: "Tạm tính 500.000", "VAT 8% 40.000", "Tổng cộng (Đã gồm 8% VAT) 540.000"; KIE took one dish, 350.000.
  expect(await read('review-total-mentions-vat')).toEqual([540000, false]);
  // Live KIE: "Tổng tiền hàng 115.100", "Giảm giá -22.700", "Tổng cộng (đã có VAT) 92.400"; KIE took 115.100.
  expect(await read('review-total-mentions-vat-B')).toEqual([92400, false]);
  const labels = ['Tổng cộng (đã bao gồm VAT)', 'Tổng cộng (Đã gồm 8% VAT)', 'Tổng cộng (đã bao gồm 8% VAT)', 'Tổng cộng (bao gồm VAT 8%)', 'Tổng cộng (đã có VAT)', 'Tổng cộng (có VAT)', 'Tổng cộng sau VAT', 'Thành tiền sau VAT', 'Tổng tiền thanh toán (VAT 8%)', 'Tổng cộng (incl. VAT)', 'Tổng thanh toán (đã bao gồm thuế GTGT 8%)'];
  for (const name of labels) {
    const bill = ['NHÀ HÀNG BẾP VIỆT', 'Lẩu thái hải sản 350.000', 'Gà nướng muối ớt 150.000', 'Tạm tính 500.000', 'VAT 8% 40.000', `${name} 540.000`];
    expect(await read(textAnswer(bill, '500000', true)), `${name}, KIE took the subtotal`).toEqual([540000, false]);
    expect(await read(textAnswer(bill, '540000', false)), `${name}, KIE right`).toEqual([540000, false]);
  }
  // A tax line still is one, with or without a total word in front: "Tiền thuế 10%", "Tổng tiền thuế GTGT".
  expect(await read(textAnswer(['CÔNG TY ABC', 'Bàn phím cơ 6.800.000', 'Cộng tiền hàng: 6.800.000', 'Tiền thuế 10%: 680.000', 'Tổng cộng: 7.480.000'], '6800000', true))).toEqual([7480000, false]);
  expect(await read(textAnswer(['CÔNG TY ABC', 'Hàng A 1.000.000', 'Tổng tiền hàng: 1.000.000', 'Tổng tiền thuế GTGT: 100.000', 'Tổng cộng: 1.100.000'], '1000000', true))).toEqual([1100000, false]);
});

test('TC-F10-19 cash handed over under a "thanh toán" label is not the total when the change is printed: cash − change is (BUG-034)', async () => {
  // Live KIE: "Tổng cộng 35.000", "Thanh toán 50.000", "Tiền thừa 15.000"; KIE took 50.000.
  expect(await read('review-cash-then-change')).toEqual([35000, false]);
  for (const [cash, change] of [['Đã thanh toán 50.000', 'Tiền thừa 15.000'], ['Khách hàng thanh toán 50.000', 'Trả lại 15.000']]) {
    expect(await read(textAnswer(['SHOP', 'Nước 10.000', 'Bánh 25.000', 'Tổng cộng 35.000', cash, change], '35000', true)), cash).toEqual([35000, false]);
  }
  // KIE with the orientation flag on, values one row up and no discount (bug037-sideways-A.orient without its points
  // line): "Tiền cần thanh toán 200.000" is the cash, "Tiền khách đưa 84.900" the change.
  const shifted = (await kieAnswer('bug037-sideways-A.orient')).lines.slice(0, 14);
  shifted.push('115.100', 'Tông tiên hàng 115.100', 'Tiên cân thanh toán 200.000', 'Tiên khách đua 84.900', 'Tiên thôi lai');
  expect(await read(textAnswer(shifted, '200000', false))).toEqual([115100, false]);
});

test('TC-F10-20 a sideways WinMart+ photo with no discount gives its total, not the cash, the change or one price (BUG-037)', async () => {
  // Live KIE as it runs today (orientation flag off) on the BUG-037 receipt without its points line: payable 115.100,
  // cash 200.000, change 84.900. Clockwise KIE took 200.000; anticlockwise it read no total. The upright photo is the control.
  for (const name of ['review-sideways-nodiscount-cw', 'review-sideways-nodiscount-ccw', 'review-upright-nodiscount']) {
    expect(await read(name), name).toEqual([115100, false]);
  }
});

test('TC-F10-21 a torn receipt never adds a phone number, a code, points or a list price, wherever they stand on the line (BUG-036)', async () => {
  const items = ['Cà phê 20.000', 'Bánh mì 15.000'];
  for (const line of ['CỬA HÀNG MINH KHANG - ĐT: (+84) 912.345.678', 'ĐC: 12 Lê Lợi - ĐT: (028) 38.221.234', 'Liên hệ: +84 912.345.678', 'Số: 12.345', 'Số dư điểm: 12.500', 'Tích điểm: 1.250 điểm']) {
    expect(await read(textAnswer(['QUÁN ABC', line, ...items])), line).toEqual([35000, true]);
  }
  expect(await read(textAnswer(['QUÁN ABC', 'Cà phê 20.000', 'Giá gốc: 25.000', 'Bánh mì 15.000']))).toEqual([35000, true]);
  // "ĐT" in an item's name without a phone number after it is still an item.
  expect(await read(textAnswer(['PHỤ KIỆN AN', 'Ốp lưng ĐT 50.000', 'Cáp sạc 30.000']))).toEqual([80000, true]);
});

test('TC-F10-22 a total printed without separators is read when KIE or the amount in words says the same number (BUG-035)', async () => {
  const dotted = ['SHOP', 'Nước 10.000', 'Bánh 25.000', 'Tổng cộng 35000'];
  expect(await read(textAnswer(dotted, '35000', false))).toEqual([35000, false]);
  expect(await read(textAnswer(['SHOP', 'Nước 10000', 'Bánh 25000', 'Tổng cộng 35000'], '35000', false))).toEqual([35000, false]);
  const voucher = ['PHIẾU THU', 'Số: PT-09/2023', 'Số tiền: 2500000 đ', 'Bằng chữ: Hai triệu năm trăm nghìn đồng'];
  expect(await read(textAnswer(voucher, '2023'))).toEqual([2500000, false]);
});

test('TC-F8-24 a receipt whose total is torn off: the bot says the amount is an estimate from the item lines (BUG-036)', async () => {
  await linkedZaloUser();
  outbound.use(http.post(KIE, async () => HttpResponse.json(await kieAnswer('bug036-torn-B'))));
  await zaloPhoto();

  const [draft] = await Transaction.find().lean();
  expect(draft).toMatchObject({ amount: 53000, status: 'draft', source: 'zalo', receipt: { total: 53000, estimated: true } });
  expect(zaloSent).toHaveLength(2);
  expect(zaloSent[1]).toContain('53.000');
  expect(zaloSent[1]).toContain(viText.receiptEstimated({ count: 3 }));
  expect(zaloSent[1]).not.toContain('dòng hàng ·'); // the "items add up / do not add up" line is replaced
});
