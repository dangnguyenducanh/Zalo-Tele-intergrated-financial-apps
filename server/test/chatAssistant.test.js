import { readFile } from 'node:fs/promises';
import request from 'supertest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import { handleMessage } from '../src/bot/core.js';
import enText from '../src/bot/messages.en.js';
import viText from '../src/bot/messages.vi.js';
import { env } from '../src/config/env.js';
import { AgentTurn } from '../src/models/AgentTurn.js';
import { Category } from '../src/models/Category.js';
import { ChannelUsage } from '../src/models/ChannelUsage.js';
import { ChatLink } from '../src/models/ChatLink.js';
import { LinkCode } from '../src/models/LinkCode.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import recorded from './fixtures/kie-analyze.json' with { type: 'json' };
import { AGENT_SECRET, AGENT_URL, createAgentStub, turnAnswer } from './helpers/agent-stub.js';
import { registerUser, resetLoginLimit } from './helpers/auth.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';

// Questions in Telegram and Zalo chats are answered by the agent service (docs/02 §2.11.1, §2.11.3, §2.11.6; docs/04 §4.6, §4.11).
// Telegram, Zalo and the agent are three MSW stubs in one server: every Bot API call is recorded as { platform, method, body },
// every /v1/turn call by the agent stub. Time is frozen (Date only) so the 10-minute, 24-hour and quota windows are exact.
vi.hoisted(() => {
  process.env.KIE_URL = 'http://kie.test'; // the receipt reader, a made-up host (the NODE_ENV=test default points at a port fetch refuses)
});
const background = vi.hoisted(() => []);
vi.mock('@vercel/functions', async (importOriginal) => ({
  ...(await importOriginal()),
  waitUntil: (promise) => {
    background.push(promise);
  },
}));

const PHOTO = await readFile(new URL('./fixtures/receipts/mcocr_public_145014khrvg.jpg', import.meta.url));
const PHOTO_URL = 'https://photo.zalo.example/receipt-42.jpg';
const stub = createAgentStub();
const sent = [];
const botApi = (platform) => async ({ params, request }) => {
  sent.push({ platform, method: params.method, body: await request.json() });
  return HttpResponse.json({ ok: true, result: { message_id: `sent${sent.length}`, date: Date.now() } });
};
const outbound = setupServer(
  http.post('https://api.telegram.org/:bot/:method', botApi('telegram')),
  http.post('https://bot-api.zaloplatforms.com/:bot/:method', botApi('zalo')),
  http.get(PHOTO_URL, () => new HttpResponse(PHOTO, { headers: { 'content-type': 'image/jpeg' } })),
  http.post('http://kie.test/analyze', () => HttpResponse.json(recorded)),
  stub.route,
);

const NOW = new Date('2026-11-26T05:00:00Z'); // 12:00 in Vietnam
const at = (minutes) => vi.setSystemTime(new Date(NOW.getTime() + minutes * 60_000));
let errorLog;
beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), ChatLink.init(), LinkCode.init(), Transaction.init(), ChannelUsage.init()]); // unique indexes first
  outbound.listen({
    onUnhandledFrame: ({ frame }) => {
      const { hostname } = new URL(frame.data.request.url);
      if (hostname !== '127.0.0.1' && hostname !== 'localhost') throw new Error(`unmocked request to ${hostname}`);
    },
  });
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  errorLog = vi.spyOn(console, 'error'); // the webhook only logs a failed update, so a logged error fails the test
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // "[agent] turn failed": the one line when the agent is down
});
afterEach(async () => {
  vi.useRealTimers();
  expect(errorLog).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  outbound.resetHandlers();
  stub.reset();
  sent.length = 0;
  env.AGENT_URL = AGENT_URL;
  env.AGENT_SECRET = AGENT_SECRET;
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(async () => {
  outbound.close();
  await stopTestDb();
});

// ---- the two chat apps, as the webhook receives them ----
let nextId = 1000;
const telegram = {
  name: 'telegram',
  chat: '5550001111',
  other: '5550002222',
  secret: ['X-Telegram-Bot-Api-Secret-Token', 'test-telegram-secret'],
  link: (code) => `/start ${code}`,
  text: (text, chat, id = ++nextId) => ({
    update_id: ++nextId,
    message: { message_id: id, from: { id: Number(chat), is_bot: false, first_name: 'Anh' }, chat: { id: Number(chat), type: 'private' }, text },
  }),
  button: (data, chat, id = ++nextId) => ({
    update_id: ++nextId,
    callback_query: { id: String(id), from: { id: Number(chat), is_bot: false, first_name: 'Anh' }, message: { message_id: 8, chat: { id: Number(chat), type: 'private' } }, data },
  }),
};
const zalo = {
  name: 'zalo',
  chat: '6ede9afa66b88fe6d6a9',
  other: 'a1b2c3d4e5f6a7b8c9d0',
  secret: ['X-Bot-Api-Secret-Token', 'test-zalo-secret'],
  link: (code) => `/link ${code}`,
  text: (text, chat, id = `zmsg${++nextId}`) => ({
    event_name: 'message.text.received',
    message: { message_id: id, date: Date.now(), message_type: 'CHAT_TEXT', from: { id: chat, display_name: 'Anh', is_bot: false }, chat: { id: chat, chat_type: 'PRIVATE' }, text },
  }),
  photo: (chat) => ({
    event_name: 'message.image.received',
    message: { message_id: `zmsg${++nextId}`, date: Date.now(), message_type: 'CHAT_PHOTO', from: { id: chat, display_name: 'Anh', is_bot: false }, chat: { id: chat, chat_type: 'PRIVATE' }, photo_url: PHOTO_URL },
  }),
};
const platforms = [telegram, zalo];
const messageIdOf = (body) => String(body.message.message_id);

// POSTs a webhook body and returns the response; the work it handed to waitUntil() runs on (see `settle`).
const post = (p, body) => request(app).post(`/api/webhooks/${p.name}`).set(...p.secret).send(body);
const settle = () => Promise.all(background.splice(0));
const outgoing = (from) => sent.slice(from).filter((c) => c.method !== 'sendChatAction' && c.method !== 'answerCallbackQuery');

// Sends text (or a ready body) and returns the Bot API calls the server made in answer (typing and callback answers left out).
async function say(p, text, chat = p.chat) {
  const from = sent.length;
  const body = typeof text === 'string' ? p.text(text, chat) : text;
  await post(p, body);
  await settle();
  return outgoing(from);
}
const press = (p, data, chat = p.chat) => say(p, p.button(data, chat), chat);
const textOf = (call) => call.body.text;

// A registered user whose chat on `p` is linked; `chat` is the chat account id (a second user needs another one).
async function linkedUser(p, chat = p.chat, overrides = {}) {
  const { accessToken, user } = await registerUser(overrides);
  const { body } = await request(app).post('/api/chat-links/code').set('Authorization', `Bearer ${accessToken}`);
  await say(p, p.link(body.code), chat);
  sent.length = 0;
  return user;
}

// What the real agent does on every turn: it writes one agentTurns row (docs/03 §3.7) and answers. `reply` is the answer's
// fields, or a function of the request; `askBack` goes on the row only, as in the agent.
const ANSWER = 'Chi tiêu tháng này: 1.000.000 ₫\nNguồn: Tổng thu chi 11/2026';
function agent(reply = {}) {
  stub.handler = async (body) => {
    const { askBack, ...fields } = typeof reply === 'function' ? reply(body) : reply;
    const answer = turnAnswer({ text: ANSWER, sources: ['Tổng thu chi 11/2026'], ...fields });
    await AgentTurn.create({
      userId: body.userId, channel: body.channel, threadKey: body.threadKey, requestId: body.requestId, trigger: 'chat', command: false,
      question: body.text, answer: answer.text, route: answer.route, facts: answer.facts, sources: answer.sources, followups: [],
      card: answer.card ?? null, askBack: askBack ?? null, clearedAt: null, createdAt: new Date(),
    });
    return answer;
  };
}
// The answer of a `choose` turn with the model off: a numbered question, and the ask-back kept on its row for ten minutes.
const OPTIONS = [
  { n: 1, label: 'Chi tiêu · tháng này' },
  { n: 2, label: 'Số dư ví · tháng này' },
  { n: 3, label: 'Ngân sách còn lại · tháng này' },
];
const askBackAnswer = () => ({
  text: ['Bạn muốn hỏi ý nào?', ...OPTIONS.map((o) => `${o.n}. ${o.label}`), 'Trả lời 1-3 trong 10 phút.'].join('\n'),
  sources: [],
  card: { kind: 'ask_back', options: OPTIONS },
  askBack: { question: 'Bạn muốn hỏi ý nào?', options: OPTIONS.map((o) => ({ ...o, skill: 'thu_chi_ky' })), expiresAt: new Date(Date.now() + 10 * 60_000) },
});
// One agentTurns row put in the database by the test (another user's, another chat's, an older answer).
const seedTurn = (userId, p, chat, over = {}) =>
  AgentTurn.create({
    userId, channel: p.name, threadKey: chat, requestId: `seed-${++nextId}`, trigger: 'chat', command: false, question: 'tháng này bao nhiêu?', answer: 'đã trả lời',
    route: 'rules', facts: [], sources: [], followups: [], card: null, askBack: null, clearedAt: null, createdAt: new Date(), ...over,
  });
const drafts = () => Transaction.find({ status: 'draft', deletedAt: null }).sort({ _id: 1 }).lean(); // the ones that still wait
const nfd = (text) => text.normalize('NFD');

// ---- docs/07 §7.9.4 "questions in chat" (R3) ----

for (const p of platforms) {
  test(`TC-F14-100 ${p.name}: /hoi and a classified question call the agent once with the chat's request id and thread, send its answer as one message and save nothing; captures never call it`, async () => {
    const user = await linkedUser(p);
    agent();
    const asked = [
      ['/hoi tháng này ăn uống hết bao nhiêu', 'tháng này ăn uống hết bao nhiêu'],
      ['/Hỏi tháng 10 thu bao nhiêu', 'tháng 10 thu bao nhiêu'],
      [nfd('/hỏi hôm nay tiêu bao nhiêu'), nfd('hôm nay tiêu bao nhiêu')], // as typed: the agent makes it NFC itself
      ['tháng 3 năm 2025 tiêu bao nhiêu', 'tháng 3 năm 2025 tiêu bao nhiêu'],
      ['7 ngày qua tiêu bao nhiêu', '7 ngày qua tiêu bao nhiêu'],
      ['hôm nay ăn gì?', 'hôm nay ăn gì?'],
      ['top 3 cafe', 'top 3 cafe'],
    ];
    for (const [typed, forAgent] of asked) {
      const before = stub.calls.length;
      const body = p.text(typed, p.chat);
      const replies = await say(p, body);
      expect([typed, stub.calls.length - before]).toEqual([typed, 1]);
      const { authorization, body: turn } = stub.calls.at(-1);
      expect(authorization).toBe(`Bearer ${AGENT_SECRET}`);
      expect(turn).toMatchObject({
        trigger: 'chat', userId: user.id, channel: p.name, threadKey: p.chat, requestId: `${p.name}:${p.chat}:${messageIdOf(body)}`,
        text: forAgent, language: 'vi', allowLlm: false,
      });
      expect(turn.today).toBe('2026-11-26');
      expect([typed, replies.map((c) => [c.method, c.body.chat_id.toString(), textOf(c)])]).toEqual([typed, [['sendMessage', p.chat, ANSWER]]]);
      expect(replies[0].body.reply_markup).toBeUndefined(); // an answer has no ✅ / ❌ and no choices
    }
    expect(await Transaction.countDocuments()).toBe(0);
    expect((await ChatLink.findOne()).pendingTransactionId).toBeNull();

    // A capture, ok and huy never reach the agent, and the question before them changed nothing.
    const calls = stub.calls.length;
    await say(p, 'phở 45k');
    await say(p, 'ok');
    await say(p, 'grab 32k');
    await say(p, 'huy');
    expect(stub.calls.length).toBe(calls);
    expect((await Transaction.find().sort({ _id: 1 }).lean()).map((t) => [t.amount, t.status, t.deletedAt === null])).toEqual([[45_000, 'confirmed', true], [32_000, 'draft', false]]);
  });

  test(`TC-F14-100 ${p.name}: a bare /hoi gets the help text without calling the agent, and an English user's question goes with language en`, async () => {
    await linkedUser(p);
    agent();
    expect((await say(p, '/hoi')).map(textOf)).toEqual([viText.help]);
    expect(stub.calls.length).toBe(0);

    await say(p, '/lang en');
    await say(p, 'how much did I spend this month?');
    expect(stub.calls.at(-1).body).toMatchObject({ language: 'en', text: 'how much did I spend this month?' });
  });
}

// ---- webhook idempotency ----

for (const p of platforms) {
  test(`TC-F14-101 ${p.name}: the same question delivered twice in a row, or twice at once, is answered once; DUPLICATE sends nothing`, async () => {
    await linkedUser(p);
    agent();

    // In a row: the agent says 409 DUPLICATE the second time, and the chat gets no second message.
    const body = p.text('tháng này tiêu bao nhiêu', p.chat);
    expect((await say(p, body)).map(textOf)).toEqual([ANSWER]);
    expect(await say(p, body)).toEqual([]);
    expect(stub.calls.map((c) => c.body.requestId)).toEqual([`${p.name}:${p.chat}:${messageIdOf(body)}`, `${p.name}:${p.chat}:${messageIdOf(body)}`]);

    // At once: one reply and one agentTurns row; how many deliveries reached the agent is not asserted.
    const again = p.text('tuần trước tiêu bao nhiêu', p.chat);
    const from = sent.length;
    await Promise.all([post(p, again), post(p, again)]);
    await settle();
    expect(outgoing(from).map(textOf)).toEqual([ANSWER]);
    expect(await AgentTurn.countDocuments({ question: 'tuần trước tiêu bao nhiêu' })).toBe(1);
    expect(await Transaction.countDocuments()).toBe(0);
  });
}

// ---- ask-back ----

test('TC-F14-102 Telegram: an ask-back is sent with one q:<n> button per option (callback data well under 64 bytes); a tap sends that number to the agent, and a typed 1-3 does the same', async () => {
  const user = await linkedUser(telegram);
  agent(askBackAnswer);
  const [asked] = await say(telegram, 'còn bao nhiêu');
  expect(textOf(asked)).toContain('1. Chi tiêu · tháng này');
  const keyboard = asked.body.reply_markup.inline_keyboard;
  expect(keyboard.map((row) => row.map((b) => [b.text, b.callback_data]))).toEqual(OPTIONS.map((o) => [[`${o.n}. ${o.label}`, `q:${o.n}`]]));
  for (const button of keyboard.flat()) expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);

  // The tap: the number goes to the agent as the chat's next message (the agent reads its own ask-back), under a request id of its own.
  agent({ text: 'Số dư ví: 500.000 ₫\nNguồn: Số dư ví' });
  const from = sent.length;
  await post(telegram, telegram.button('q:2', telegram.chat, 77));
  await settle();
  expect(stub.calls.at(-1).body).toMatchObject({ userId: user.id, channel: 'telegram', threadKey: telegram.chat, requestId: `telegram:${telegram.chat}:cb77`, text: '2' });
  expect(sent.slice(from).map((c) => [c.method, c.body.text])).toEqual([
    ['answerCallbackQuery', undefined], // the spinner stops first
    ['sendChatAction', undefined], // "typing" while the agent works
    ['sendMessage', 'Số dư ví: 500.000 ₫\nNguồn: Số dư ví'],
  ]);

  // A typed digit does the same, and a double delivery of the tap answers once.
  at(3);
  expect((await say(telegram, '3')).map(textOf)).toEqual(['Số dư ví: 500.000 ₫\nNguồn: Số dư ví']);
  expect(stub.calls.at(-1).body.text).toBe('3');
  expect(await Transaction.countDocuments()).toBe(0);
  const calls = stub.calls.length;
  await post(telegram, telegram.button('q:2', telegram.chat, 77));
  await settle();
  expect(outgoing(0).filter((c) => textOf(c) === 'Số dư ví: 500.000 ₫\nNguồn: Số dư ví')).toHaveLength(2); // the tap and the typed 3, not a third
  expect(stub.calls.length).toBe(calls + 1); // it reached the agent, which answered 409
});

test('TC-F14-102 Zalo: an ask-back is a numbered list with no buttons; a typed 2 within 10 minutes selects option 2, with no draft and no amount correction', async () => {
  const user = await linkedUser(zalo);
  await say(zalo, 'grab 32k'); // a draft is waiting: "2" must not become 2.000 ₫ on it
  agent(askBackAnswer);
  const [asked] = await say(zalo, 'còn bao nhiêu');
  expect(textOf(asked)).toContain('2. Số dư ví · tháng này');
  expect(textOf(asked)).toContain('Trả lời 1-3');
  expect(asked.body.reply_markup).toBeUndefined();

  agent({ text: 'Số dư ví: 500.000 ₫\nNguồn: Số dư ví' });
  at(9);
  expect((await say(zalo, '2')).map(textOf)).toEqual(['Số dư ví: 500.000 ₫\nNguồn: Số dư ví']);
  expect(stub.calls.at(-1).body).toMatchObject({ userId: user.id, channel: 'zalo', threadKey: zalo.chat, text: '2' });
  expect(await drafts()).toMatchObject([{ amount: 32_000 }]); // untouched, and no second draft
});

for (const p of platforms) {
  test(`TC-F14-102 ${p.name}: a bare 1-3 after the ask-back ran out (under 24 hours) gets "Câu hỏi đã hết hạn, hãy hỏi lại", never a draft, never the agent; after 25 hours it is handled as before`, async () => {
    await linkedUser(p);
    agent(askBackAnswer);
    await say(p, 'còn bao nhiêu');
    expect(stub.calls.length).toBe(1);

    at(11); // ten minutes are over
    for (const digit of ['1', '2', '3']) expect([digit, (await say(p, digit)).map(textOf)]).toEqual([digit, [viText.askBackExpired]]);
    expect(viText.askBackExpired).toBe('Câu hỏi đã hết hạn, hãy hỏi lại');
    expect(enText.askBackExpired).toBe('That question has expired, please ask it again');
    expect(stub.calls.length).toBe(1);
    expect(await Transaction.countDocuments()).toBe(0);

    // A number with an amount word, or an ordinary text, is not a bare digit: it is a capture, as always.
    await say(p, '2k');
    await say(p, 'phở 45k');
    expect((await drafts()).map((d) => d.amount)).toEqual([2_000, 45_000]);
    await say(p, 'ok');
    await say(p, 'ok');
    expect(await drafts()).toEqual([]);

    // An old button is answered the same way, however old (a button is never a capture).
    if (p === telegram) {
      const expired = await press(p, 'q:1');
      expect(expired.map(textOf)).toEqual([viText.askBackExpired]);
      at(25 * 60);
      expect((await press(p, 'q:2')).map(textOf)).toEqual([viText.askBackExpired]);
    }

    // 25 hours after it lapsed the ask-back is forgotten: a bare number is a capture again, as today.
    at(25 * 60 + 11);
    await say(p, '2');
    expect((await drafts()).map((d) => d.amount)).toEqual([2_000]);
    expect(stub.calls.length).toBe(1);
  });
}

test('TC-F14-102 Zalo: with a draft waiting, a bare 2 after the ask-back ran out gets the expired line and the draft keeps its amount', async () => {
  await linkedUser(zalo);
  await say(zalo, 'grab 32k');
  agent(askBackAnswer);
  await say(zalo, 'còn bao nhiêu');
  at(12);
  expect((await say(zalo, '2')).map(textOf)).toEqual([viText.askBackExpired]);
  expect(await drafts()).toMatchObject([{ amount: 32_000 }]);
  expect(stub.calls.length).toBe(1); // only the question
});

// ---- agent down in chat ----

for (const p of platforms) {
  test(`TC-F14-103 ${p.name}: with the agent down, busy, refusing connections or not configured a question gets the help text with the plain commands; capture, ok and huy work as today`, async () => {
    await linkedUser(p);
    expect(viText.help).toContain('/today');
    expect(viText.help).toContain('/month');
    const modes = [
      ['down', () => stub.down(), 1],
      ['busy', () => stub.busy(), 1],
      ['refused', () => (stub.handler = () => HttpResponse.error()), 1],
      ['not configured', () => { delete env.AGENT_URL; }, 0],
    ];
    for (const [name, apply, calls] of modes) {
      stub.reset();
      env.AGENT_URL = AGENT_URL;
      apply();
      const replies = await say(p, 'tháng này tiêu bao nhiêu');
      expect([name, replies.map((c) => [c.method, textOf(c)])]).toEqual([name, [['sendMessage', viText.help]]]);
      expect([name, stub.calls.length]).toEqual([name, calls]);
      expect(replies[0].body.reply_markup).toBeUndefined();
    }
    expect(await Transaction.countDocuments()).toBe(0);

    // Capture is as before, and ok / huy still answer their drafts.
    env.AGENT_URL = AGENT_URL;
    stub.down();
    await say(p, 'phở 45k');
    expect(textOf((await say(p, 'ok'))[0])).toMatch(/^✅ Đã lưu/);
    await say(p, 'grab 32k');
    expect(textOf((await say(p, 'huy'))[0])).toMatch(/^❌ Đã huỷ/);
    expect((await Transaction.find().sort({ _id: 1 }).lean()).map((t) => [t.amount, t.status, t.deletedAt === null])).toEqual([[45_000, 'confirmed', true], [32_000, 'draft', false]]);

    // A line the parser cannot file stays in Khác, a Zalo receipt photo is read by KIE, and none of it goes near the agent.
    await say(p, 'xyzzy 50k');
    const unfiled = await Transaction.findOne({ note: 'xyzzy' }).lean();
    expect((await Category.findById(unfiled.categoryId)).isFallback).toBe(true);
    if (p === zalo) expect((await say(p, zalo.photo(p.chat))).map(textOf)).toEqual([viText.readingReceipt, expect.stringContaining('116.000')]);
    expect(stub.calls).toEqual([]);
  });
}

test('TC-F14-103 Zalo: from 2,400 messages a month the assistant guard is off: no agent call, the help text instead (an "other" reply, still sent until 2,850); at 2,399 the answer goes out', async () => {
  const set = (sent) => ChannelUsage.updateOne({ platform: 'zalo', month: '2026-11' }, { sent }, { upsert: true });
  const count = async () => (await ChannelUsage.findOne({ platform: 'zalo', month: '2026-11' })).sent;
  await linkedUser(zalo);
  agent();

  await set(2399);
  expect((await say(zalo, 'tháng này tiêu bao nhiêu')).map(textOf)).toEqual([ANSWER]);
  expect([stub.calls.length, await count()]).toEqual([1, 2400]); // the answer was the 2,400th message

  expect((await say(zalo, 'tuần này tiêu bao nhiêu')).map(textOf)).toEqual([viText.help]);
  expect([stub.calls.length, await count()]).toEqual([1, 2401]); // no second call; the help text counts as a message
  expect((await say(zalo, '/hoi tháng trước tiêu bao nhiêu')).map(textOf)).toEqual([viText.help]);
  expect(stub.calls.length).toBe(1);

  await set(2850); // only capture and linking replies from here
  expect(await say(zalo, 'hôm nay tiêu bao nhiêu')).toEqual([]);
  expect(stub.calls.length).toBe(1);
  expect(textOf((await say(zalo, 'phở 45k'))[0])).toMatch(/^📝/);
  expect(await Transaction.countDocuments()).toBe(1); // the capture still lands
});

// ---- channel limits ----

const LONG_BODY = `${'Chi tiêu theo danh mục: ăn uống 1.000.000 ₫. '.repeat(70)}`; // about 3,200 characters
const SOURCES_LINE = 'Nguồn: Tổng thu chi 11/2026';

for (const p of platforms) {
  test(`TC-F14-104 ${p.name}: a long answer is one message of at most 1,500 characters that keeps its sources line; a 1,500-character one is not touched; nothing is ever split`, async () => {
    await linkedUser(p);
    agent({ text: `${LONG_BODY}\n${SOURCES_LINE}` });
    const replies = await say(p, 'tháng này tiêu bao nhiêu');
    expect(replies).toHaveLength(1);
    const text = textOf(replies[0]);
    expect(Array.from(text).length).toBeLessThanOrEqual(1500);
    expect(text.startsWith('Chi tiêu theo danh mục: ăn uống 1.000.000 ₫.')).toBe(true);
    expect(text.endsWith(`…\n${SOURCES_LINE}`)).toBe(true);

    const exact = `${'a'.repeat(1500 - SOURCES_LINE.length - 1)}\n${SOURCES_LINE}`;
    expect(exact.length).toBe(1500);
    agent({ text: exact });
    expect((await say(p, 'tuần này tiêu bao nhiêu')).map(textOf)).toEqual([exact]);

    // No sources line (an answer such as the cap line): cut at the limit with an ellipsis, still one message.
    agent({ text: 'x'.repeat(2500), sources: [] });
    const cut = await say(p, 'tuần trước tiêu bao nhiêu');
    expect(cut).toHaveLength(1);
    expect([Array.from(textOf(cut[0])).length, textOf(cut[0]).endsWith('…')]).toEqual([1500, true]);
  });
}

test('TC-F14-104 Telegram: "typing" is sent when the agent starts and every 4 seconds while it works, and stops when the answer is sent, also when the agent fails', async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); // the 4-second ticks only: the database and the network keep real timers
  vi.setSystemTime(NOW);
  await linkedUser(telegram);
  const typing = () => sent.filter((c) => c.method === 'sendChatAction');
  const until = async (done) => {
    for (let i = 0; i < 300 && !done(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(done()).toBe(true);
  };

  const timers = vi.getTimerCount(); // whatever the database driver keeps running
  let release;
  agent();
  const answer = stub.handler;
  stub.handler = async (body) => {
    await new Promise((resolve) => (release = resolve));
    return answer(body);
  };
  await post(telegram, telegram.text('tháng này tiêu bao nhiêu', telegram.chat));
  await until(() => release && typing().length === 1);
  expect(typing()[0].body).toEqual({ chat_id: telegram.chat, action: 'typing' });
  await vi.advanceTimersByTimeAsync(4000);
  await until(() => typing().length === 2);
  await vi.advanceTimersByTimeAsync(4000);
  await until(() => typing().length === 3);
  release();
  await settle();
  expect(outgoing(0).map(textOf)).toEqual([ANSWER]);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(typing()).toHaveLength(3); // cleared when the answer went out
  expect(vi.getTimerCount()).toBe(timers);

  // The agent fails: the help text goes out and the typing stops as well.
  sent.length = 0;
  stub.down();
  await say(telegram, 'tuần này tiêu bao nhiêu');
  expect(typing()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(typing()).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(timers);
});

test('TC-F14-104 Zalo has no typing indicator: a slow question is only ever followed by its one message', async () => {
  await linkedUser(zalo);
  agent();
  await say(zalo, 'tháng này tiêu bao nhiêu');
  expect(sent.map((c) => c.method)).toEqual(['sendMessage']);
});

// ---- WhatsApp is not on the allowlist ----

test('TC-F14-105 a chat on any other adapter (a fake "whatsapp") keeps the help text for questions and a bare 1-3, and never calls the agent', async () => {
  const { user } = await registerUser();
  await ChatLink.create({ userId: user.id, platform: 'whatsapp', platformUserId: 'bsuid-1', chatId: 'bsuid-1' });
  const said = [];
  const fake = { platform: 'whatsapp', sendText: async (chatId, text) => said.push(text), sendDraft: async (chatId, draft) => said.push(draft.text), downloadPhoto: async () => Buffer.alloc(0) };
  const send = (text, messageId) => handleMessage(fake, { platformUserId: 'bsuid-1', chatId: 'bsuid-1', messageId, displayName: '', text });
  agent();
  await seedTurn(user.id, { name: 'whatsapp' }, 'bsuid-1', { askBack: { question: '?', options: [{ n: 1, label: 'a', skill: 'thu_chi_ky' }], expiresAt: new Date(Date.now() + 5 * 60_000) } }); // even a live ask-back

  for (const [i, text] of ['tháng 10 thu bao nhiêu', '/hoi tháng này ăn uống hết bao nhiêu', 'hôm nay ăn gì?'].entries()) await send(text, `wamid.q${i}`);
  expect(said).toEqual([viText.help, viText.help, viText.help]);
  expect(stub.calls).toEqual([]);

  await send('phở 45', 'wamid.d1'); // follow-up window or not, a capture
  await send('1', 'wamid.d2'); // a bare digit is a capture here: there are no ask-backs on this adapter
  expect(stub.calls).toEqual([]);
  expect((await drafts()).map((d) => d.amount)).toEqual([45_000, 1_000]);
});

// ---- follow-up numbers (D11) ----

for (const p of platforms) {
  test(`TC-F14-106 ${p.name}: for 10 minutes after an assistant answer a bare number is no amount ("còn 3 tháng trước", "phở 45" go to the agent and draft nothing, "phở 45k" drafts); after that they are captures again`, async () => {
    await linkedUser(p);
    agent();
    await say(p, 'tháng này ăn uống hết bao nhiêu');
    expect(stub.calls.length).toBe(1);

    at(9);
    for (const text of ['còn 3 tháng trước', 'phở 45']) {
      const before = stub.calls.length;
      const replies = await say(p, text);
      expect([text, stub.calls.length - before, replies.map(textOf)]).toEqual([text, 1, [ANSWER]]);
      expect(stub.calls.at(-1).body.text).toBe(text);
    }
    expect(await Transaction.countDocuments()).toBe(0);
    const calls = stub.calls.length;
    const [draft] = await say(p, 'phở 45k'); // an explicit amount is a capture in any case
    expect(textOf(draft)).toMatch(/^📝 Chi 45\.000/);
    expect(stub.calls.length).toBe(calls);
    expect((await drafts()).map((d) => d.amount)).toEqual([45_000]);

    // The two follow-up answers renewed the window: 9 minutes after the last of them it still holds.
    at(18);
    await say(p, 'phở 46');
    expect(stub.calls.length).toBe(calls + 1);
    expect(await Transaction.countDocuments()).toBe(1);

    // Eleven minutes after the last answer: captures again, 3.000 ₫ and 47.000 ₫ drafts as today.
    at(30);
    await say(p, 'phở 47');
    await say(p, 'còn 3 tháng trước');
    expect((await drafts()).map((d) => d.amount)).toEqual([45_000, 47_000, 3_000]);
    expect(stub.calls.length).toBe(calls + 1);
  });

  test(`TC-F14-106 ${p.name}: only this user's answers to this chat open the window; another user's row, another chat's and an unanswered turn do not`, async () => {
    const user = await linkedUser(p);
    const other = new mongoose.Types.ObjectId();
    await seedTurn(other, p, p.chat); // another user's answer in the same chat id (the chat was linked to someone else before)
    await seedTurn(user.id, p, p.other); // this user's answer, but in another chat
    await seedTurn(user.id, p, p.chat, { answer: null }); // a turn still running: nothing was sent yet
    await seedTurn(user.id, p, p.chat, { createdAt: new Date(Date.now() - 11 * 60_000) }); // too old
    agent();
    await say(p, 'phở 45');
    expect(stub.calls.length).toBe(0);
    expect((await drafts()).map((d) => d.amount)).toEqual([45_000]);

    await seedTurn(user.id, p, p.chat, { createdAt: new Date(Date.now() - 9 * 60_000) }); // and now a real one
    await say(p, 'phở 46');
    expect(stub.calls.length).toBe(1);
    expect(await Transaction.countDocuments()).toBe(1);
  });
}

// ---- Zalo corrections inside a follow-up window (D11) ----

test('TC-F14-107 Zalo: while an assistant follow-up is open "55k" still corrects the waiting draft, and a bare "55" leaves it unchanged and goes to the agent as a question', async () => {
  await linkedUser(zalo);
  await say(zalo, 'grab 32k');
  agent();
  await say(zalo, 'tháng này ăn uống hết bao nhiêu');
  const calls = stub.calls.length;

  at(5);
  const [corrected] = await say(zalo, '55k');
  expect(textOf(corrected)).toMatch(/55\.000.*grab/);
  expect(await drafts()).toMatchObject([{ amount: 55_000, note: 'grab' }]);
  expect(stub.calls.length).toBe(calls); // a correction is not a question

  const [answered] = await say(zalo, '55');
  expect(textOf(answered)).toBe(ANSWER);
  expect(stub.calls.at(-1).body.text).toBe('55');
  expect(await drafts()).toMatchObject([{ amount: 55_000, note: 'grab' }]); // unchanged, and no second draft

  at(30); // no follow-up any more: a bare amount corrects the draft again, as TC-F8-20
  await say(zalo, '60');
  expect(await drafts()).toMatchObject([{ amount: 60_000, note: 'grab' }]);
});

// ---- reads are scoped to the user ----

for (const p of platforms) {
  test(`TC-F14-108 ${p.name}: an ask-back that belongs to another user in the same chat id is not read: a bare 2 is a capture, never an option or the expired line`, async () => {
    const user = await linkedUser(p);
    const other = new mongoose.Types.ObjectId();
    const askBack = { question: '?', options: [{ n: 2, label: 'b', skill: 'so_du_vi' }], expiresAt: new Date(Date.now() + 5 * 60_000) };
    await seedTurn(other, p, p.chat, { askBack }); // live, but not this user's
    await seedTurn(other, p, p.chat, { askBack: { ...askBack, expiresAt: new Date(Date.now() - 60_000) }, createdAt: new Date(Date.now() - 20 * 60_000) });
    await seedTurn(user.id, p, p.other, { askBack }); // this user's, in another chat
    agent();
    const [reply] = await say(p, '2');
    expect(textOf(reply)).toMatch(/^📝 Chi 2\.000/);
    expect(stub.calls.length).toBe(0);
  });
}

// ---- the Telegram button pattern ----

test('TC-F14-109 Telegram: a q: button that is not q:1-3, or comes from an unlinked or locked chat, is only acknowledged: no agent call, no message', async () => {
  const user = await linkedUser(telegram);
  agent(askBackAnswer);
  await say(telegram, 'còn bao nhiêu');
  sent.length = 0;
  const calls = stub.calls.length;
  for (const data of ['q:4', 'q:0', 'q:', 'q:12', 'q:2:extra', 'q:2x', 'Q:2', 'q:-1']) {
    await post(telegram, telegram.button(data, telegram.chat));
    await settle();
    expect([data, sent.map((c) => c.method)]).toEqual([data, ['answerCallbackQuery']]);
    sent.length = 0;
  }
  await post(telegram, telegram.button('q:1', telegram.other)); // a chat that was never linked
  await settle();
  expect(sent.map((c) => c.method)).toEqual(['answerCallbackQuery']);
  sent.length = 0;
  await User.updateOne({ _id: user.id }, { status: 'locked' });
  await post(telegram, telegram.button('q:1', telegram.chat));
  await settle();
  expect(sent.map((c) => c.method)).toEqual(['answerCallbackQuery']);
  expect(stub.calls.length).toBe(calls);

  // The same press from a chat in good standing does reach the agent: the guards above are not a dead button.
  await User.updateOne({ _id: user.id }, { status: 'active' });
  await post(telegram, telegram.button('q:1', telegram.chat));
  await settle();
  expect(stub.calls.length).toBe(calls + 1);
});
