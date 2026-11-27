import { inspect } from 'node:util';
import { HttpResponse } from 'msw';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import en from '../src/bot/messages.en.js';
import viText from '../src/bot/messages.vi.js';
import { env } from '../src/config/env.js';
import { AgentTurn } from '../src/models/AgentTurn.js';
import { Category } from '../src/models/Category.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { AGENT_SECRET, AGENT_URL, createAgentStub, turnAnswer } from './helpers/agent-stub.js';
import { registerUser, resetLoginLimit } from './helpers/auth.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';

// The drawer's endpoints (docs/02 §2.11.5, docs/04 §4.4 Assistant), on a real in-memory MongoDB and an MSW stub of the agent API.
const stub = createAgentStub();

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Wallet.init(), Category.init(), Transaction.init()]); // unique indexes first (AgentTurn has none: the agent's setup makes them)
  stub.listen();
});
let logs;
beforeEach(() => {
  // 12:00 in Vietnam, frozen: the daily count and the 10-minute and 24-hour windows are worked out from this clock.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-26T05:00:00Z'));
  logs = ['log', 'info', 'warn', 'error', 'debug'].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  stub.reset();
  env.AGENT_URL = AGENT_URL;
  env.AGENT_SECRET = AGENT_SECRET;
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(async () => {
  stub.close();
  await stopTestDb();
});

const as = (token) => ({
  chat: (body) => request(app).post('/api/assistant/chat').set('Authorization', `Bearer ${token}`).send(body),
  thread: () => request(app).get('/api/assistant/thread').set('Authorization', `Bearer ${token}`),
  clear: () => request(app).delete('/api/assistant/thread').set('Authorization', `Bearer ${token}`),
});

let n = 0;
const newUser = async () => {
  const { accessToken, user } = await registerUser();
  return { ...as(accessToken), id: user.id, token: accessToken };
};
const ask = (text, extra = {}) => ({ message: text, requestId: `req-${++n}`, ...extra });

// One agentTurns row as the agent service writes it (docs/03 §3.7), for a test to put in the database.
const row = (userId, over = {}) => ({
  userId,
  channel: 'web',
  threadKey: 'web',
  requestId: `seed-${++n}`,
  trigger: 'chat',
  command: false,
  question: `question ${n}`,
  answer: `answer ${n}`,
  route: 'rules',
  facts: [],
  sources: [],
  followups: [],
  card: null,
  askBack: null,
  clearedAt: null,
  createdAt: new Date(),
  ...over,
});
const seed = (...rows) => AgentTurn.insertMany(rows);
const minutes = (count) => count * 60_000;
const hours = (count) => count * 3_600_000;
const askBack = (expiresAt) => ({
  question: 'Bạn muốn hỏi ý nào?',
  options: [
    { n: 1, label: 'Chi theo danh mục', skill: 'chi_theo_danh_muc', categoryIds: [], walletIds: [], period: {} },
    { n: 2, label: 'Tổng thu chi', skill: 'thu_chi_ky', categoryIds: [], walletIds: [], period: {} },
  ],
  expiresAt,
});

// What the agent does for every turn it runs: it writes the turn's row, which is what the daily count reads.
const agentWritesRows = () => {
  stub.handler = async (body) => {
    await AgentTurn.create(row(body.userId, { requestId: body.requestId, question: body.text, command: Boolean(body.skill) }));
    return turnAnswer();
  };
};

describe('TC-F14-93 POST /assistant/chat: the contract', () => {
  test('TC-F14-93 no login is 401; a bad message, month or requestId is 400 VALIDATION_ERROR; none of them reaches the agent', async () => {
    const u = await newUser();
    const noLogin = await request(app).post('/api/assistant/chat').send(ask('tháng này ăn uống hết bao nhiêu'));
    expect([noLogin.status, noLogin.body.error.code]).toEqual([401, 'UNAUTHENTICATED']);

    for (const bad of [
      { message: '' },
      { message: '   ' },
      { message: 'a'.repeat(501) },
      { message: 12345 },
      { message: undefined },
      { month: '2026-13' },
      { month: '2026-1' },
      { requestId: '' },
      { requestId: undefined },
      { requestId: 'a'.repeat(65) },
      { requestId: 'telegram:1:2' }, // a chat reference's shape is not a drawer id
      { requestId: { $ne: 'x' } },
    ]) {
      const res = await u.chat({ ...ask('tháng này ăn uống hết bao nhiêu'), ...bad });
      expect([res.status, res.body.error?.code], JSON.stringify(bad)).toEqual([400, 'VALIDATION_ERROR']);
    }
    expect(stub.calls).toEqual([]);
  });

  test('TC-F14-93 a question goes to the agent with the user, the web thread, the profile language and the month; the answer comes back with route, text, facts, sources, followups, card and remainingToday', async () => {
    const u = await newUser();
    const card = { kind: 'ask_back', options: [{ n: 1, label: 'Chi theo danh mục' }, { n: 2, label: 'Tổng thu chi' }], more: { nested: [1, 2] } };
    stub.handler = () => turnAnswer({ card });

    const res = await u.chat(ask('tháng này ăn uống hết bao nhiêu', { month: '2026-10', requestId: 'drawer-1' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      route: 'rules',
      text: 'Chi tiêu tháng này: 1.000.000 ₫',
      facts: [{ id: 'f1', label: 'Chi tiêu 11/2026', display: '1.000.000 ₫' }],
      sources: ['Nguồn: Tổng thu chi 11/2026'],
      followups: ['Còn tháng trước?'],
      card, // passed through unchanged
      remainingToday: 30,
    });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].authorization).toBe(`Bearer ${AGENT_SECRET}`);
    expect(stub.calls[0].body).toMatchObject({
      trigger: 'chat',
      userId: u.id,
      channel: 'web',
      threadKey: 'web',
      requestId: 'drawer-1',
      text: 'tháng này ăn uống hết bao nhiêu',
      language: 'vi',
      month: '2026-10',
    });
  });

  test('TC-F14-93 the language sent is the profile\'s, the message is trimmed, and 500 characters are accepted', async () => {
    const u = await newUser();
    await User.updateOne({ _id: u.id }, { language: 'en' });
    const long = `how much did I spend ${'x'.repeat(479)}`;

    const res = await u.chat(ask(`  ${long}  `));

    expect(res.status).toBe(200);
    expect(stub.calls[0].body).toMatchObject({ language: 'en', text: long });
    expect(Object.keys(stub.calls[0].body)).not.toContain('month');
  });

  test('TC-F14-93 without AGENT_URL (or without AGENT_SECRET) a question answers 200 with route off and the help text of the profile\'s language, and the agent is never called', async () => {
    const u = await newUser();
    for (const missing of ['AGENT_URL', 'AGENT_SECRET']) {
      delete env[missing];
      const vietnamese = await u.chat(ask('tháng này ăn uống hết bao nhiêu'));
      expect(vietnamese.status, missing).toBe(200);
      expect(vietnamese.body, missing).toEqual({ route: 'off', text: viText.help, facts: [], sources: [], followups: [], remainingToday: 30 });
      env[missing] = missing === 'AGENT_URL' ? AGENT_URL : AGENT_SECRET;
    }
    await User.updateOne({ _id: u.id }, { language: 'en' });
    delete env.AGENT_URL;
    const english = await u.chat(ask('how much did I spend on food'));
    expect(english.body).toMatchObject({ route: 'off', text: en.help });
    expect(stub.calls).toEqual([]);
  });

  test('TC-F14-93 the agent down (a 500, a refused connection) is 503 AGENT_UNAVAILABLE, a full queue is 503 AGENT_BUSY, and nothing is saved', async () => {
    const u = await newUser();

    stub.down();
    const down = await u.chat(ask('tháng này ăn uống hết bao nhiêu'));
    stub.handler = () => HttpResponse.error();
    const refused = await u.chat(ask('tháng này ăn uống hết bao nhiêu'));
    stub.busy();
    const busy = await u.chat(ask('tháng này ăn uống hết bao nhiêu'));

    expect([down, refused, busy].map((res) => [res.status, res.body.error.code])).toEqual([
      [503, 'AGENT_UNAVAILABLE'],
      [503, 'AGENT_UNAVAILABLE'],
      [503, 'AGENT_BUSY'],
    ]);
    expect(await Transaction.countDocuments()).toBe(0);
    expect(await AgentTurn.countDocuments()).toBe(0); // Express never writes a turn: the agent does
  });

  test('TC-F14-93 one requestId twice is one 200 and one 409 DUPLICATE, also when both arrive at the same moment; another user\'s same id is a different request', async () => {
    const a = await newUser();
    const b = await newUser();

    const first = await a.chat(ask('hôm nay tiêu bao nhiêu', { requestId: 'same' }));
    const second = await a.chat(ask('hôm nay tiêu bao nhiêu', { requestId: 'same' }));
    expect([first.status, second.status, second.body.error.code]).toEqual([200, 409, 'DUPLICATE']);

    const together = await Promise.all([a.chat(ask('hôm nay tiêu bao nhiêu', { requestId: 'both' })), a.chat(ask('hôm nay tiêu bao nhiêu', { requestId: 'both' }))]);
    expect(together.map((res) => res.status).sort()).toEqual([200, 409]); // not the stub's call count: only the agent deduplicates
    expect(together.find((res) => res.status === 409).body.error.code).toBe('DUPLICATE');

    const other = await b.chat(ask('hôm nay tiêu bao nhiêu', { requestId: 'same' }));
    expect(other.status).toBe(200);
  });
});

describe('TC-F14-94 captures and questions in the drawer (follow-up is always true on the web)', () => {
  test('TC-F14-94 "phở 45k" answers with the quick-add preview as `capture`: no agent call, nothing saved, no question counted, the same preview as POST /transactions/parse', async () => {
    const u = await newUser();

    const res = await u.chat(ask('phở 45k'));
    const parsed = await request(app).post('/api/transactions/parse').set('Authorization', `Bearer ${u.token}`).send({ text: 'phở 45k' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ route: 'capture', capture: parsed.body, remainingToday: 30 });
    expect(res.body.capture.drafts).toEqual([expect.objectContaining({ type: 'expense', amount: 45_000 })]);
    expect(stub.calls).toEqual([]);
    expect(await Transaction.countDocuments()).toBe(0);
    expect(await AgentTurn.countDocuments()).toBe(0);
  });

  test('TC-F14-94 two or more lines are a capture, even one that reads like a question; a capture still previews with the agent unset', async () => {
    const u = await newUser();
    const lines = await u.chat(ask('phở 45k\ngrab 32k'));
    expect(lines.body.capture.drafts.map((draft) => draft.amount)).toEqual([45_000, 32_000]);

    const mixed = await u.chat(ask('hôm qua chi bao nhiêu\nphở 45k'));
    expect(mixed.body.capture).toMatchObject({ drafts: [expect.objectContaining({ amount: 45_000 })], noAmountLines: [1] });

    delete env.AGENT_URL;
    const unset = await u.chat(ask('cơm 1tr2'));
    expect(unset.body).toMatchObject({ route: 'capture', capture: { drafts: [expect.objectContaining({ amount: 1_200_000 })] } });
    expect(stub.calls).toEqual([]);
  });

  test('TC-F14-94 several lines with no amount at all answer 422 NO_AMOUNT_FOUND like the quick add, without the agent', async () => {
    const u = await newUser();
    const res = await u.chat(ask('xin chào\nbạn khoẻ không'));
    expect([res.status, res.body.error.code]).toEqual([422, 'NO_AMOUNT_FOUND']);
    expect(stub.calls).toEqual([]);
  });

  test('TC-F14-94 a bare number is not an amount here: "phở 45" and "còn 3 tháng trước" go to the agent (D11), as do "?phở 45k", "/hoi phở 45k" and "45k là nhiều chưa"', async () => {
    const u = await newUser();
    const texts = ['phở 45', 'còn 3 tháng trước', '?phở 45k', '/hoi phở 45k', '45k là nhiều chưa', 'tháng 10 thu bao nhiêu'];

    for (const text of texts) {
      const res = await u.chat(ask(text));
      expect(res.status, text).toBe(200);
      expect(res.body.route, text).toBe('rules');
      expect(res.body, text).not.toHaveProperty('capture');
    }

    expect(stub.calls.map((call) => call.body.text)).toEqual(texts);
    expect(await Transaction.countDocuments()).toBe(0);
  });
});

describe('TC-F14-95 web ask-back: a bare 1, 2 or 3 after the agent asked "which one?"', () => {
  const sendTwo = (u, text = '2') => u.chat(ask(text));
  const expired = { vi: 'Câu hỏi đã hết hạn, hãy hỏi lại', en: 'That question has expired, please ask it again' };

  test('TC-F14-95 a live ask-back: "2" (also " 2 ") goes to the agent as a normal turn and is never a capture', async () => {
    const u = await newUser();
    await seed(row(u.id, { askBack: askBack(new Date(Date.now() + minutes(5))) }));

    const res = await sendTwo(u, ' 2 ');

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('capture');
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].body).toMatchObject({ trigger: 'chat', userId: u.id, channel: 'web', threadKey: 'web', text: '2' });
    expect(await Transaction.countDocuments()).toBe(0);
  });

  test('TC-F14-95 an ask-back that lapsed less than 24 h ago: "2" answers "Câu hỏi đã hết hạn, hãy hỏi lại" (English too), calls no agent, saves nothing', async () => {
    const u = await newUser();
    await seed(row(u.id, { askBack: askBack(new Date(Date.now() - minutes(11))) }));
    const before = await AgentTurn.countDocuments();

    const res = await sendTwo(u);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ route: 'rules', text: expired.vi, facts: [], sources: [], followups: [], remainingToday: 29 }); // the seeded turn counts

    await User.updateOne({ _id: u.id }, { language: 'en' });
    expect((await sendTwo(u, '3')).body.text).toBe(expired.en);

    expect(stub.calls).toEqual([]);
    expect(await Transaction.countDocuments()).toBe(0); // "2" is not read as 2.000 ₫
    expect(await AgentTurn.countDocuments()).toBe(before); // Express writes no turn
  });

  test('TC-F14-95 the 24 hours are counted from when it lapsed: at 23 h the answer is "expired", at 25 h "2" is handled as any other message', async () => {
    const u = await newUser();
    await seed(row(u.id, { askBack: askBack(new Date(Date.now() - hours(23))) }));
    expect((await sendTwo(u)).body.text).toBe(expired.vi);
    expect(stub.calls).toHaveLength(0);

    await AgentTurn.deleteMany({});
    await seed(row(u.id, { askBack: askBack(new Date(Date.now() - hours(25))) }));
    const old = await sendTwo(u);
    expect(old.body.text).not.toBe(expired.vi);
    expect(stub.calls.map((call) => call.body.text)).toEqual(['2']);
  });

  test('TC-F14-95 no ask-back at all: "2" goes to the agent like any question, never to the parser (no 2.000 ₫ draft, no capture)', async () => {
    const u = await newUser();
    const res = await sendTwo(u);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('capture');
    expect(stub.calls.map((call) => call.body.text)).toEqual(['2']);
  });

  test('TC-F14-95 only the user\'s own, uncleared, web ask-back counts: another user\'s, a cleared one, a Telegram one and one from another thread are ignored', async () => {
    const a = await newUser();
    const b = await newUser();
    const lapsed = askBack(new Date(Date.now() - minutes(11)));
    await seed(
      row(b.id, { askBack: lapsed }), // another user's
      row(a.id, { askBack: lapsed, clearedAt: new Date() }), // "Xoá" hid it
      row(a.id, { askBack: lapsed, channel: 'telegram', threadKey: '555' }),
      row(a.id, { askBack: lapsed, threadKey: 'other' }),
    );

    const res = await sendTwo(a);

    expect(res.body.text).not.toBe(expired.vi);
    expect(stub.calls.map((call) => call.body.userId)).toEqual([a.id]);
  });

  test('TC-F14-95 the latest ask-back decides: an old lapsed one under a newer live one is live; only 1, 2 and 3 alone are replies', async () => {
    const u = await newUser();
    await seed(
      row(u.id, { askBack: askBack(new Date(Date.now() - minutes(30))), createdAt: new Date(Date.now() - minutes(40)) }),
      row(u.id, { askBack: askBack(new Date(Date.now() + minutes(5))), createdAt: new Date(Date.now() - minutes(5)) }),
    );
    expect((await sendTwo(u)).body.text).not.toBe(expired.vi);
    expect(stub.calls).toHaveLength(1);

    await AgentTurn.deleteMany({});
    await seed(row(u.id, { askBack: askBack(new Date(Date.now() - minutes(11))) }));
    stub.calls.length = 0;
    for (const text of ['4', '0', '12', '2 phở', 'hai']) expect((await sendTwo(u, text)).body.text, text).not.toBe(expired.vi);
    expect(stub.calls.map((call) => call.body.text)).toEqual(['4', '0', '12', '2 phở', 'hai']);
  });

  test('TC-F14-95 with the agent unset there is no ask-back to answer: "2" gets the help text', async () => {
    const u = await newUser();
    await seed(row(u.id, { askBack: askBack(new Date(Date.now() - minutes(11))) }));
    delete env.AGENT_URL;

    const res = await sendTwo(u);

    expect(res.body).toMatchObject({ route: 'off', text: viText.help });
  });
});

describe('TC-F14-96 the thread, "Xoá" and the daily count', () => {
  test('TC-F14-96 GET /assistant/thread needs a login and an empty thread has no turns and 30 questions left', async () => {
    const noLogin = await request(app).get('/api/assistant/thread');
    expect(noLogin.status).toBe(401);
    expect((await request(app).delete('/api/assistant/thread')).status).toBe(401);

    const u = await newUser();
    const res = await u.thread();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ turns: [], ai: { remainingToday: 30 } });
  });

  test('TC-F14-96 the thread is the last 6 answered, uncleared web turns of this user, oldest first, each with its question, text, route, facts, sources, followups and card', async () => {
    const a = await newUser();
    const b = await newUser();
    const at = (minutesAgo) => new Date(Date.now() - minutes(minutesAgo));
    const card = { kind: 'ask_back', options: [{ n: 1, label: 'Chi theo danh mục' }] };
    const facts = [{ id: 'f1', label: 'Ăn uống 10/2026', display: '2.150.000 ₫' }];
    const rows = await seed(
      row(a.id, { question: 'too old', createdAt: at(80) }), // the 7th from the end
      row(a.id, { question: 'one', answer: 'a1', createdAt: at(70) }),
      row(a.id, { question: 'two', answer: 'a2', createdAt: at(60), facts, sources: ['Nguồn: x'], followups: ['Còn tháng trước?'], route: 'agent' }),
      row(a.id, { question: 'three', answer: 'a3', createdAt: at(50), card }),
      row(a.id, { question: 'cleared', createdAt: at(45), clearedAt: new Date() }),
      row(a.id, { question: 'telegram', createdAt: at(44), channel: 'telegram', threadKey: '555' }),
      row(a.id, { question: 'other thread', createdAt: at(43), threadKey: 'other' }),
      row(a.id, { question: 'in flight', answer: null, createdAt: at(42) }), // the agent has not finished it
      row(b.id, { question: "B's", createdAt: at(41) }),
      row(a.id, { question: 'four', answer: 'a4', createdAt: at(40) }),
      row(a.id, { question: 'five', answer: 'a5', createdAt: at(30) }),
      row(a.id, { question: 'six', answer: 'a6', createdAt: at(20) }),
      row(a.id, { question: 'seven', answer: 'a7', createdAt: at(10) }),
    );

    const res = await a.thread();

    expect(res.status).toBe(200);
    expect(res.body.turns.map((turn) => turn.question)).toEqual(['two', 'three', 'four', 'five', 'six', 'seven']);
    expect(res.body.turns[0]).toEqual({
      id: String(rows[2]._id),
      question: 'two',
      text: 'a2',
      route: 'agent',
      facts,
      sources: ['Nguồn: x'],
      followups: ['Còn tháng trước?'],
      createdAt: rows[2].createdAt.toISOString(),
    });
    expect(res.body.turns[1].card).toEqual(card); // the card is passed through unchanged
    expect(res.body.turns[0]).not.toHaveProperty('card'); // no card, no key
    for (const turn of res.body.turns) for (const key of ['userId', 'requestId', 'threadKey', 'channel', 'clearedAt', 'askBack']) expect(turn).not.toHaveProperty(key);
    expect(res.body.ai).toEqual({ remainingToday: 30 - 11 }); // every web chat row of today counts, answered or not, cleared or not, in any web thread
  });

  test('TC-F14-96 DELETE hides this user\'s web thread and changes nothing else: the rows stay, the other user and the other channel are untouched, the daily count is not given back', async () => {
    const a = await newUser();
    const b = await newUser();
    await seed(row(a.id), row(a.id), row(a.id, { channel: 'telegram', threadKey: '555' }), row(b.id));
    const before = await AgentTurn.find().lean();

    const res = await a.clear();

    expect(res.status).toBe(204);
    expect((await a.thread()).body.turns).toEqual([]);
    expect((await b.thread()).body.turns).toHaveLength(1);
    const after = await AgentTurn.find().lean();
    expect(after).toHaveLength(before.length); // never deleted
    for (const [i, turn] of after.entries()) {
      const { clearedAt, ...rest } = turn;
      const { clearedAt: was, ...restBefore } = before[i];
      expect(rest).toEqual(restBefore); // clearedAt is the only field Express writes
      const mine = String(turn.userId) === a.id && turn.channel === 'web';
      expect(Boolean(clearedAt), `${turn.channel} ${turn.userId}`).toBe(mine);
      expect(was).toBeNull();
    }
    expect((await a.thread()).body.ai.remainingToday).toBe(28); // the two cleared questions still count
  });

  test('TC-F14-96 remainingToday is 30 minus the web questions of today: a command, a confirm or schedule turn, Telegram, another user and yesterday are not counted, and it never goes below 0', async () => {
    const a = await newUser();
    const b = await newUser();
    vi.setSystemTime(new Date('2026-11-25T18:00:00Z')); // 01:00 on the 26th in Vietnam
    const midnight = new Date('2026-11-25T17:00:00Z'); // 00:00 on the 26th
    await seed(
      row(a.id, { createdAt: midnight }), // counts: the first moment of the day
      row(a.id, { createdAt: new Date('2026-11-25T17:30:00Z'), threadKey: 'other' }), // counts: the cap is per channel, not per thread
      row(a.id, { createdAt: new Date('2026-11-25T17:40:00Z'), clearedAt: new Date() }), // counts: "Xoá" does not give it back
      row(a.id, { createdAt: new Date('2026-11-25T16:59:59Z') }), // 23:59:59 on the 25th: yesterday
      row(a.id, { createdAt: new Date('2026-11-25T17:10:00Z'), command: true }), // D16: a command is not a question
      row(a.id, { createdAt: new Date('2026-11-25T17:11:00Z'), command: true }),
      row(a.id, { createdAt: new Date('2026-11-25T17:12:00Z'), trigger: 'confirm' }),
      row(a.id, { createdAt: new Date('2026-11-25T17:13:00Z'), trigger: 'schedule' }),
      row(a.id, { createdAt: new Date('2026-11-25T17:14:00Z'), channel: 'telegram', threadKey: '555' }),
      row(b.id, { createdAt: new Date('2026-11-25T17:15:00Z') }),
    );

    const thread = await a.thread();
    expect(thread.body.ai.remainingToday).toBe(27);
    agentWritesRows(); // the agent's row for this question is written before the answer comes back
    const chat = await a.chat(ask('tháng này ăn uống hết bao nhiêu'));
    expect(chat.body.remainingToday).toBe(26); // the same rule in both endpoints

    await a.chat(ask('/hoi tháng này ăn uống hết bao nhiêu'));
    expect((await a.thread()).body.ai.remainingToday).toBe(25); // /hoi is a question, not a command with a skill: its row counts

    await seed(...Array.from({ length: 40 }, () => row(a.id, { createdAt: new Date('2026-11-25T17:20:00Z') })));
    expect((await a.thread()).body.ai.remainingToday).toBe(0);
    expect((await a.chat(ask('hôm nay tiêu bao nhiêu'))).body.remainingToday).toBe(0);
  });
});

describe('TC-F14-97 private logs: the question, notes and figures never reach the server log', () => {
  const QUESTION = 'SECRETQUESTION 987654321 tiền nhà bao nhiêu';
  const FIGURE = '987.654.321 ₫';
  const NOTE = 'SECRETNOTE phở 45k';

  const logged = () => logs.flatMap((spy) => spy.mock.calls).map((args) => inspect(args, { depth: 6 })).join('\n');

  test('TC-F14-97 chat (answered, refused, duplicate, down, busy, capture, expired ask-back), thread and clear log no question text, note, figure or secret', async () => {
    const u = await newUser();
    const lapsed = askBack(new Date(Date.now() - minutes(11)));

    stub.handler = () => turnAnswer({ text: `Tiền nhà: ${FIGURE}`, facts: [{ id: 'f1', label: 'Tiền nhà', display: FIGURE }] });
    await u.chat(ask(QUESTION, { requestId: 'one' }));
    await u.chat(ask(QUESTION, { requestId: 'one' })); // 409
    stub.handler = (body) => HttpResponse.json({ error: { code: 'INTERNAL', message: `could not answer ${body.text} ${FIGURE}` } }, { status: 500 });
    await u.chat(ask(QUESTION)); // 503 AGENT_UNAVAILABLE
    stub.busy();
    await u.chat(ask(QUESTION)); // 503 AGENT_BUSY
    await u.chat(ask(NOTE)); // a capture
    await seed(row(u.id, { question: QUESTION, answer: `Tiền nhà: ${FIGURE}`, askBack: lapsed }));
    await u.chat(ask('2')); // the expired line
    await u.chat(ask(QUESTION, { month: '2026-13' })); // 400
    await u.thread();
    await u.clear();

    const text = logged();
    expect(logs.flatMap((spy) => spy.mock.calls).length, 'the 503s are logged like any 5xx').toBeGreaterThan(0);
    for (const secret of ['SECRETQUESTION', '987654321', '987.654.321', 'SECRETNOTE', 'tiền nhà bao nhiêu', AGENT_SECRET]) expect(text, secret).not.toContain(secret);
  });
});
