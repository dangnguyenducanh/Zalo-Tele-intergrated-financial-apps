import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import enText from '../src/bot/messages.en.js';
import viText from '../src/bot/messages.vi.js';
import { whatsapp } from '../src/bot/whatsapp.js';
import { env } from '../src/config/env.js';
import { ChatLink } from '../src/models/ChatLink.js';
import { LinkCode } from '../src/models/LinkCode.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import recorded from './fixtures/kie-analyze.json' with { type: 'json' };
import fixtures from './fixtures/whatsapp-webhooks.json' with { type: 'json' };
import { refresh, registerUser, resetLoginLimit } from './helpers/auth.js';
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
const MEDIA_ID = fixtures.image.entry[0].changes[0].value.messages[0].image.id;
const MEDIA_URL = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1104938573226018&ext=1763620800&hash=ATt9'; // lives 5 minutes

// The WhatsApp settings under NODE_ENV=test (config/env.js).
const ACCESS_TOKEN = 'test-whatsapp-token';
const PHONE_NUMBER_ID = '1234567890';
const APP_SECRET = 'test-whatsapp-secret';
const VERIFY_TOKEN = 'test-whatsapp-verify-token';

// Every Graph API call the server makes, answered the way Meta answers, and every KIE call. A call without the
// bearer token gets Meta's "invalid token" error, so a missing Authorization header fails the test that made it.
const graph = [];
const kieCalls = [];
const unauthorized = () => HttpResponse.json({ error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 } }, { status: 401 });
const authorized = (request) => request.headers.get('authorization') === `Bearer ${ACCESS_TOKEN}`;
const outbound = setupServer(
  http.post('https://graph.facebook.com/:version/:phoneNumberId/messages', async ({ params, request }) => {
    const body = await request.json();
    graph.push({ call: 'send', version: params.version, phoneNumberId: params.phoneNumberId, authorization: request.headers.get('authorization'), body });
    if (!authorized(request)) return unauthorized();
    return HttpResponse.json({ messaging_product: 'whatsapp', contacts: [{ input: body.recipient, user_id: body.recipient }], messages: [{ id: `wamid.sent${graph.length}` }] });
  }),
  http.get('https://graph.facebook.com/:version/:mediaId', ({ params, request }) => {
    graph.push({ call: 'media', version: params.version, mediaId: params.mediaId, authorization: request.headers.get('authorization') });
    if (!authorized(request)) return unauthorized();
    return HttpResponse.json({ messaging_product: 'whatsapp', url: MEDIA_URL, mime_type: 'image/jpeg', file_size: PHOTO.length, id: params.mediaId });
  }),
  http.get('https://lookaside.fbsbx.com/whatsapp_business/attachments/', ({ request }) => {
    graph.push({ call: 'download', authorization: request.headers.get('authorization') });
    if (!authorized(request)) return unauthorized();
    return new HttpResponse(PHOTO, { headers: { 'content-type': 'image/jpeg' } });
  }),
  http.post('http://kie.test/analyze', () => {
    kieCalls.push('analyze');
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
// The webhook only logs a failed update (Meta already has its 200), so a logged error fails the test.
let errorLog;
beforeEach(() => {
  errorLog = vi.spyOn(console, 'error');
});
afterEach(async () => {
  expect(errorLog).not.toHaveBeenCalled();
  errorLog.mockRestore();
  vi.restoreAllMocks();
  outbound.resetHandlers();
  graph.length = 0;
  kieCalls.length = 0;
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(async () => {
  outbound.close();
  await stopTestDb();
  delete process.env.KIE_URL;
});

// Two WhatsApp users. The phone number is what must never be stored or returned; B adopted a username, so Meta
// leaves the phone number out of everything it sends.
const USER_A = { bsuid: 'VN.13491208655302741918', phone: '84912345678' };
const USER_B = { bsuid: 'VN.24680135792468013579', phone: '84987654321' };
const USER_NAMELESS = { bsuid: 'VN.55555555555555555555' };
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// A recorded webhook body, copied with a fresh message id and pointed at another user, text or field.
let nextMessageId = 0;
function incoming(name, fields = {}, user = USER_A, profileName = 'Anh Nguyen') {
  const body = structuredClone(fixtures[name]);
  const { messages, contacts } = body.entry[0].changes[0].value;
  nextMessageId += 1;
  Object.assign(messages[0], { id: `wamid.test${nextMessageId}`, from_user_id: user.bsuid, ...fields });
  Object.assign(contacts[0], { user_id: user.bsuid });
  contacts[0].profile.name = profileName;
  if (user.phone) {
    messages[0].from = user.phone;
    contacts[0].wa_id = user.phone;
  } else {
    delete messages[0].from;
    delete contacts[0].wa_id;
    contacts[0].profile.username = 'anh.nguyen';
  }
  return body;
}
const textMessage = (text, user, profileName) => incoming('text', { text: { body: text } }, user, profileName);
const pressMessage = (id, user) => incoming('buttonReply', { interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } }, user);
const wamidOf = (body) => body.entry[0].changes[0].value.messages[0].id;

const sign = (raw, secret = APP_SECRET) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

// POSTs a body the way Meta does (signed over the exact bytes sent), then waits for the work the webhook handed to
// waitUntil(). `signature: null` sends no header. The response also says how much work the webhook started.
async function deliver(body, { signature, secret } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body); // a string is sent as it is: Supertest would re-serialise a Buffer
  const post = request(app).post('/api/webhooks/whatsapp').set('Content-Type', 'application/json');
  const header = signature === undefined ? sign(raw, secret) : signature;
  if (header !== null) post.set('X-Hub-Signature-256', header);
  const res = await post.send(raw);
  const work = background.splice(0);
  await Promise.all(work);
  res.started = work.length;
  return res;
}

// Sends a webhook body and returns the Graph API calls the server made in answer.
async function send(body) {
  const from = graph.length;
  await deliver(body);
  return graph.slice(from);
}
const say = (text, user = USER_A) => send(textMessage(text, user));
const press = (id, user = USER_A) => send(pressMessage(id, user));
// The text of a sent message, whether it is a plain text or a button message; textsOf() for a list of Graph calls.
const textOf = (call) => call.body.text?.body ?? call.body.interactive?.body.text;
const textsOf = (calls) => calls.filter((c) => c.call === 'send').map(textOf);

// A registered user whose WhatsApp chat is linked with "/link CODE". Returns the web user and a way to call the API.
async function linkedUser(whatsappUser = USER_A, overrides = {}) {
  const { accessToken, user } = await registerUser(overrides);
  const { body } = await request(app).post('/api/chat-links/code').set('Authorization', `Bearer ${accessToken}`);
  await say(`/link ${body.code}`, whatsappUser);
  const as = (method) => (path, payload) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${accessToken}`).send(payload);
  return { user, accessToken, get: as('get'), post: as('post') };
}

test('TC-F8-26 the setup GET answers Meta\'s challenge as plain text only for the right mode and verify token', async () => {
  const get = (query) => request(app).get(`/api/webhooks/whatsapp${query}`);
  const ok = await get(`?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`);
  expect([ok.status, ok.text, ok.type]).toEqual([200, '1158201444', 'text/plain']);

  for (const query of [
    `?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`,
    `?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}x&hub.challenge=1`,
    `?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`,
    `?hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`,
    `?hub.mode=subscribe&hub.challenge=1`,
    `?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`, // twice: an array, not our token
    `?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}`, // no challenge to echo
    '',
  ]) {
    const res = await get(query);
    expect([query, res.status, res.body.error?.code]).toEqual([query, 403, 'FORBIDDEN']);
  }
  expect(graph).toEqual([]);
});

test('TC-F8-27 a POST without a valid X-Hub-Signature-256 gets 401; nothing is processed, stored or sent', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // each refusal logs its cause (TC-F8-42)
  await linkedUser();
  graph.length = 0;
  const body = textMessage('grab 32k');
  const raw = JSON.stringify(body);
  const good = sign(raw);

  const bad = {
    'no header': null,
    'empty header': '',
    'wrong hex': `sha256=${'0'.repeat(64)}`,
    'signed with another secret': sign(raw, 'another-secret'),
    'without the sha256= prefix': good.slice('sha256='.length),
    'another algorithm': good.replace('sha256=', 'sha1='),
    truncated: good.slice(0, -2),
    'signed over another body': sign(JSON.stringify(textMessage('phở 45k'))),
  };
  for (const [why, signature] of Object.entries(bad)) {
    const res = await deliver(raw, { signature });
    expect([why, res.status, res.body.error.code, res.started]).toEqual([why, 401, 'UNAUTHENTICATED', 0]);
  }
  expect(graph).toEqual([]); // no Graph call
  expect(await Transaction.countDocuments()).toBe(0);

  // The same bytes with the right signature are handled.
  const res = await deliver(raw, { signature: good });
  expect(res.status).toBe(200);
  expect(await Transaction.countDocuments({ amount: 32_000, status: 'draft' })).toBe(1);
  expect(graph).toHaveLength(1);
});

test('TC-F8-42 a refused POST says why in the log, once per cause, and never prints the header or a secret', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const raw = JSON.stringify(textMessage('grab 32k'));
  const header = sign(raw);

  // No raw body: the parser did not keep one (not JSON, or no body), whatever the signature says.
  const notJson = await request(app).post('/api/webhooks/whatsapp').set('Content-Type', 'text/plain').set('X-Hub-Signature-256', header).send(raw);
  const noBody = await request(app).post('/api/webhooks/whatsapp').set('X-Hub-Signature-256', header);
  expect([notJson.status, noBody.status]).toEqual([401, 401]);
  expect(warn.mock.calls).toEqual([
    [`${notJson.headers['x-request-id']} whatsapp webhook: no raw body (content-type text/plain)`],
    [`${noBody.headers['x-request-id']} whatsapp webhook: no raw body (content-type none)`],
  ]);
  warn.mockClear();

  // A raw body whose signature is missing or wrong.
  const wrong = [null, `sha256=${'0'.repeat(64)}`, sign(raw, 'another-secret')];
  const answers = [];
  for (const signature of wrong) answers.push(await deliver(raw, { signature }));
  expect(answers.map((res) => res.status)).toEqual([401, 401, 401]);
  expect(warn.mock.calls).toEqual(answers.map((res) => [`${res.headers['x-request-id']} whatsapp webhook: signature mismatch`]));

  // Nothing printed holds a signature, a header value or a setting.
  const printed = JSON.stringify(warn.mock.calls);
  for (const secret of [header, ...wrong.filter(Boolean), APP_SECRET, VERIFY_TOKEN, ACCESS_TOKEN]) expect(printed).not.toContain(secret);

  // A good signature says nothing.
  warn.mockClear();
  expect((await deliver(raw)).status).toBe(200);
  expect(warn).not.toHaveBeenCalled();
});

test('TC-F8-43 the request log line of the setup GET has the path only: no query, no verify token', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  errorLog.mockImplementation(() => {}); // the error handler logs a 5xx too, with the URL
  const url = (token) => `/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`;
  const savedEnv = env.NODE_ENV;
  const savedToken = env.WHATSAPP_VERIFY_TOKEN;
  env.NODE_ENV = 'development'; // the request log is off under NODE_ENV=test
  const statuses = [];
  try {
    statuses.push((await request(app).get(url(VERIFY_TOKEN))).status); // right token
    statuses.push((await request(app).get(url(`${VERIFY_TOKEN}x`))).status); // a mistyped token is as secret as the real one
    env.WHATSAPP_VERIFY_TOKEN = undefined; // the webhook is off: the 5xx path logs the URL too
    statuses.push((await request(app).get(url(VERIFY_TOKEN))).status);
    await vi.waitFor(() => expect(info).toHaveBeenCalledTimes(3)); // each line is written when its response is done
  } finally {
    env.NODE_ENV = savedEnv;
    env.WHATSAPP_VERIFY_TOKEN = savedToken;
  }
  expect(statuses).toEqual([200, 403, 503]);
  expect(info.mock.calls.map(([line]) => line.replace(/^[0-9a-f-]{36} /, '').replace(/ \d+ms$/, ''))).toEqual([
    'GET /api/webhooks/whatsapp 200',
    'GET /api/webhooks/whatsapp 403',
    'GET /api/webhooks/whatsapp 503',
  ]);
  const printed = JSON.stringify([info.mock.calls, errorLog.mock.calls.map(([line]) => line)]);
  expect(errorLog).toHaveBeenCalledTimes(1);
  for (const leak of [VERIFY_TOKEN, 'hub.', '?', '1158201444']) expect(printed).not.toContain(leak);
  errorLog.mockClear();
});

test('TC-F8-28 the signature covers the raw bytes Meta sent: extra spaces, \\u escapes and a Vietnamese profile name', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // the tampered body's refusal logs its cause (TC-F8-42)
  const { accessToken } = await registerUser();
  const { body } = await request(app).post('/api/chat-links/code').set('Authorization', `Bearer ${accessToken}`);
  const name = 'Nguyễn Văn Ánh';
  // Meta writes non-ASCII characters as \uXXXX; JSON.stringify of the parsed body does not.
  const escapeUnicode = (json) => json.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

  const link = escapeUnicode(JSON.stringify(textMessage(`/link ${body.code}`, USER_A, name), null, 2)); // pretty-printed and escaped
  expect(link).not.toBe(JSON.stringify(JSON.parse(link))); // re-serialising the parsed body would give other bytes
  expect(link).toContain('\\u1ec5'); // the ễ of "Nguyễn"
  const linked = await deliver(link);
  expect(linked.status).toBe(200);
  expect(await ChatLink.findOne().lean()).toMatchObject({ platform: 'whatsapp', displayName: name });

  const escaped = escapeUnicode(JSON.stringify(textMessage('phở 45k', USER_A, name)));
  const utf8 = JSON.stringify(textMessage('cà phê 30k', USER_A, name)); // the characters themselves, sent as UTF-8
  for (const raw of [escaped, utf8]) expect((await deliver(raw)).status).toBe(200);
  expect(await Transaction.find().sort({ amount: 1 }).lean()).toMatchObject([
    { amount: 30_000, note: 'cà phê', status: 'draft' },
    { amount: 45_000, note: 'phở', status: 'draft' },
  ]);

  // A body changed by even one space after signing is refused.
  const signed = sign(utf8);
  const tampered = await deliver(`${utf8} `, { signature: signed });
  expect(tampered.status).toBe(401);
});

test('TC-F8-29 a status update (sent, delivered, read) and other empty changes get 200; nothing is stored or sent', async () => {
  await linkedUser();
  graph.length = 0;
  const bodies = ['sent', 'delivered', 'read'].map((status) => {
    const body = structuredClone(fixtures.statuses);
    body.entry[0].changes[0].value.statuses[0].status = status;
    return body;
  });
  const others = [
    {},
    [],
    { object: 'whatsapp_business_account' },
    { entry: [{}] },
    { entry: [{ changes: [{ field: 'account_update', value: { messages: [{ type: 'text' }] } }] }] },
    { entry: [{ changes: [{ field: 'messages', value: {} }] }] },
    { entry: [{ changes: [{ field: 'messages', value: { messages: [null, 7, {}] } }] }] },
  ];
  for (const body of [...bodies, ...others]) expect((await deliver(body)).status).toBe(200);
  expect(graph).toEqual([]);
  expect(await Transaction.countDocuments()).toBe(0);
  expect(await ChatLink.countDocuments()).toBe(1); // only the one made by linkedUser()
});

test('TC-F8-30 the same wamid delivered twice, one after the other or at the same moment, makes one draft and one button message', async () => {
  await linkedUser();
  graph.length = 0;

  const first = textMessage('cafe 20k');
  await deliver(first);
  await deliver(first);
  expect(graph).toHaveLength(1);
  expect(await Transaction.find({ amount: 20_000 }).lean()).toMatchObject([{ chatRef: { platform: 'whatsapp', chatId: USER_A.bsuid, messageId: `${wamidOf(first)}:1` } }]);

  const second = textMessage('trà sữa 30k');
  const from = graph.length;
  await Promise.all([deliver(second), deliver(second)]);
  expect(graph.length - from).toBe(1);
  expect(await Transaction.countDocuments({ amount: 30_000 })).toBe(1);

  // The same wamid from another chat is another message: the chat id is part of the key.
  await linkedUser(USER_B);
  await send(structuredClone(textMessage('cafe 20k', USER_B)));
  expect(await Transaction.countDocuments({ amount: 20_000 })).toBe(2);
});

test('TC-F8-31 "/link CODE" typed from the wa.me text links the chat by its BSUID and names the account; a chat links once', async () => {
  const { accessToken, user } = await registerUser({ name: 'Lan' });
  const me = (path) => request(app).post(`/api${path}`).set('Authorization', `Bearer ${accessToken}`);
  const { body } = await me('/chat-links/code');
  expect(new URL(body.links.whatsapp).searchParams.get('text')).toBe(`/link ${body.code}`); // what the user taps Send on

  const replies = await say(`/link ${body.code}`);
  expect(replies).toHaveLength(1);
  expect(replies[0].body).toMatchObject({ recipient: USER_A.bsuid, type: 'text', text: { body: viText.linked('Lan') } });
  expect(await ChatLink.find().lean()).toMatchObject([
    { userId: oid(user.id), platform: 'whatsapp', platformUserId: USER_A.bsuid, chatId: USER_A.bsuid, displayName: 'Anh Nguyen', viaClaim: false },
  ]);

  // The web sees the profile name; a second code from the same chat changes nothing.
  const list = await request(app).get('/api/chat-links').set('Authorization', `Bearer ${accessToken}`);
  expect(list.body).toMatchObject([{ platform: 'whatsapp', displayName: 'Anh Nguyen' }]);
  const another = (await me('/chat-links/code')).body;
  expect(textOf((await say(`/link ${another.code}`))[0])).toBe(viText.alreadyLinked);
  expect(await ChatLink.countDocuments()).toBe(1);

  // A start from an unlinked chat with a wrong code gets the "invalid code" sentence and a claim link (TC-F7-17).
  const wrong = await say('/link ZZZZZZ', USER_B);
  expect(textOf(wrong[0])).toContain(viText.invalidCode);
  expect(textOf(wrong[0])).toMatch(/\/link\?t=/);
});

test('TC-F8-32 TC-F7-16 TC-F7-18 an unlinked WhatsApp chat gets a claim link; claiming it links the chat and the chat hears it', async () => {
  const replies = await say('xin chào');
  expect(replies).toHaveLength(1);
  expect(replies[0].body).toMatchObject({ recipient: USER_A.bsuid, type: 'text' });
  const [, token] = /http:\/\/localhost:5300\/link\?t=([A-Za-z0-9_-]{32})/.exec(textOf(replies[0]));
  expect(await LinkCode.find().lean()).toMatchObject([
    { chat: { platform: 'whatsapp', platformUserId: USER_A.bsuid, chatId: USER_A.bsuid, displayName: 'Anh Nguyen' } },
  ]);
  expect(await Transaction.countDocuments()).toBe(0);

  const { accessToken, user } = await registerUser({ name: 'Lan' });
  const post = (path) => request(app).post(`/api/chat-links/${path}`).set('Authorization', `Bearer ${accessToken}`).send({ token });
  expect((await post('claim/preview')).body).toEqual({ platform: 'whatsapp', displayName: 'Anh Nguyen' });
  graph.length = 0;
  expect((await post('claim')).status).toBe(201);
  await Promise.all(background.splice(0));
  expect(graph).toHaveLength(1);
  expect(graph[0].body).toMatchObject({ recipient: USER_A.bsuid, type: 'text', text: { body: viText.linked('Lan') } });
  expect(await ChatLink.find().lean()).toMatchObject([{ userId: oid(user.id), platform: 'whatsapp', platformUserId: USER_A.bsuid, viaClaim: true }]);
});

test('TC-F8-33 "phở 45k" → a button message; ✅ saves it, ❌ discards the next, ✏️ answers with the Bot inbox URL', async () => {
  await linkedUser();
  graph.length = 0;

  const first = await say('phở 45k');
  expect(first).toHaveLength(1);
  const draft = await Transaction.findOne().lean();
  expect(first[0]).toMatchObject({ version: expect.stringMatching(/^v\d+\.\d+$/), phoneNumberId: PHONE_NUMBER_ID, authorization: `Bearer ${ACCESS_TOKEN}` });
  expect(first[0].body).toEqual({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    recipient: USER_A.bsuid,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: expect.stringMatching(/45\.000.*Ăn uống.*phở/) },
      action: {
        buttons: [
          { type: 'reply', reply: { id: `c:${draft._id}`, title: '✅ Lưu' } },
          { type: 'reply', reply: { id: `x:${draft._id}`, title: '❌ Huỷ' } },
          { type: 'reply', reply: { id: `e:${draft._id}`, title: '✏️ Sửa' } },
        ],
      },
    },
  }); // no `to`: Meta reserves it for phone numbers
  expect(draft).toMatchObject({ amount: 45_000, status: 'draft', source: 'whatsapp', chatRef: { platform: 'whatsapp', chatId: USER_A.bsuid } });

  // ✅ saves it and says so; the same button again says it is saved already.
  const saved = await press(`c:${draft._id}`);
  expect(saved).toHaveLength(1);
  expect(saved[0].body).toMatchObject({ recipient: USER_A.bsuid, type: 'text', text: { body: expect.stringMatching(/Đã lưu.*45\.000/) } });
  expect(await Transaction.findById(draft._id)).toMatchObject({ status: 'confirmed', source: 'whatsapp' });
  expect(textOf((await press(`c:${draft._id}`))[0])).toBe(viText.alreadyConfirmed);

  // ❌ discards (a soft delete, as on Telegram).
  await say('grab 32k');
  const second = await Transaction.findOne({ amount: 32_000 });
  expect(textOf((await press(`x:${second._id}`))[0])).toMatch(/Đã huỷ.*32\.000/);
  expect(await Transaction.findById(second._id)).toMatchObject({ status: 'draft', deletedAt: expect.any(Date) });

  // ✏️ points at the web; the draft keeps waiting.
  await say('cafe 20k');
  const third = await Transaction.findOne({ amount: 20_000 });
  const edit = await press(`e:${third._id}`);
  expect(edit).toHaveLength(1);
  expect(edit[0].body).toMatchObject({ recipient: USER_A.bsuid, type: 'text', text: { body: `${env.APP_URL}/bot` } });
  expect(await Transaction.findById(third._id)).toMatchObject({ status: 'draft', deletedAt: null });

  // The access token travels in the Authorization header only.
  expect(JSON.stringify(graph.map((call) => ({ ...call, authorization: undefined })))).not.toContain(ACCESS_TOKEN);
  expect(new Set(graph.map((c) => c.authorization))).toEqual(new Set([`Bearer ${ACCESS_TOKEN}`]));
});

test('TC-F8-34 a receipt photo is fetched from the Graph API with the token, read by KIE and becomes a draft with buttons; a redelivery repeats nothing', async () => {
  const { user } = await linkedUser();
  graph.length = 0;

  const photo = incoming('image');
  const calls = await send(photo);
  expect(calls.map((c) => c.call)).toEqual(['send', 'media', 'download', 'send']);
  expect(textOf(calls[0])).toBe(viText.readingReceipt);
  expect(calls[1]).toMatchObject({ mediaId: MEDIA_ID, authorization: `Bearer ${ACCESS_TOKEN}` });
  expect(calls[2].authorization).toBe(`Bearer ${ACCESS_TOKEN}`); // the media URL needs the token too
  expect(calls[3].body).toMatchObject({ recipient: USER_A.bsuid, type: 'interactive', interactive: { type: 'button' } });
  expect(textOf(calls[3])).toContain('116.000');
  expect(textOf(calls[3])).toContain(viText.receiptItems({ count: 6, reconciled: true }));
  expect(kieCalls).toHaveLength(1);

  const draft = await Transaction.findOne().lean();
  expect(draft).toMatchObject({
    userId: oid(user.id),
    amount: 116_000,
    status: 'draft',
    source: 'whatsapp',
    chatRef: { platform: 'whatsapp', chatId: USER_A.bsuid, messageId: `${wamidOf(photo)}:1` },
    receipt: { fileRef: MEDIA_ID },
  });

  // The same photo delivered again: no Graph call, no KIE call, no second draft.
  graph.length = 0;
  await deliver(photo);
  await Promise.all([deliver(photo), deliver(photo)]);
  expect(graph).toEqual([]);
  expect(kieCalls).toHaveLength(1);
  expect(await Transaction.countDocuments()).toBe(1);

  expect(textOf((await press(`c:${draft._id}`))[0])).toMatch(/Đã lưu.*116\.000/);
});

test('TC-F8-34 a receipt KIE cannot read, or a media id Meta no longer has, tells the user to type the amount', async () => {
  await linkedUser();
  graph.length = 0;

  outbound.use(http.post('http://kie.test/analyze', () => HttpResponse.json({ ...recorded, fields: { ...recorded.fields, total: '' } }))); // KIE finds no total
  const unreadable = await send(incoming('image'));
  expect(textsOf(unreadable)).toEqual([viText.readingReceipt, viText.receiptUnreadable]);

  // Meta answers 404 for a media id that expired: the user hears it, and the webhook logs the failure.
  errorLog.mockImplementation(() => {});
  outbound.use(http.get('https://graph.facebook.com/:version/:mediaId', () => HttpResponse.json({ error: { message: 'Media not found', code: 100 } }, { status: 404 })));
  const gone = await send(incoming('image'));
  expect(textsOf(gone)).toEqual([viText.readingReceipt, viText.receiptUnavailable]);
  expect(errorLog).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(errorLog.mock.calls)).not.toContain(ACCESS_TOKEN);
  errorLog.mockClear();
  expect(await Transaction.countDocuments()).toBe(0);
});

test('TC-F8-35 a long reply is split at 4096 characters; a button message keeps to 1024 / 3 buttons / 20-character titles / 256-character ids', async () => {
  const lines = Array.from({ length: 120 }, (_, i) => `Dòng ${i + 1}: ${'x'.repeat(60)}`);
  await whatsapp.sendText(USER_A.bsuid, lines.join('\n'));
  const parts = graph.map(textOf);
  expect(parts.length).toBeGreaterThan(1);
  for (const part of parts) expect(Array.from(part).length).toBeLessThanOrEqual(4096);
  expect(parts.join('\n')).toBe(lines.join('\n')); // cut at line breaks, nothing lost or repeated

  graph.length = 0;
  await whatsapp.sendText(USER_A.bsuid, 'a'.repeat(5000)); // no line break to cut at
  expect(graph.map((c) => textOf(c).length)).toEqual([4096, 904]);

  graph.length = 0;
  await whatsapp.sendText(USER_A.bsuid, '😀'.repeat(5000)); // a cut never lands inside a surrogate pair
  expect(graph.map(textOf).every((part) => part.isWellFormed() && Array.from(part).length <= 4096)).toBe(true);
  expect(graph.map(textOf).join('')).toBe('😀'.repeat(5000));

  graph.length = 0;
  const id = '0123456789abcdef01234567';
  for (const language of ['vi', 'en']) {
    await whatsapp.sendDraft(USER_A.bsuid, { id, text: 'y'.repeat(3000) }, language);
  }
  for (const { body } of graph) {
    expect(Array.from(body.interactive.body.text).length).toBeLessThanOrEqual(1024);
    const buttons = body.interactive.action.buttons.map((b) => b.reply);
    expect(buttons).toHaveLength(3);
    for (const { id: buttonId, title } of buttons) {
      expect(Array.from(title).length).toBeLessThanOrEqual(20);
      expect(buttonId.length).toBeLessThanOrEqual(256);
    }
  }
  expect(graph[1].body.interactive.action.buttons.map((b) => b.reply.title)).toEqual([enText.buttons.save, enText.buttons.discard, enText.buttons.edit]);
});

test('TC-F8-36 a message without "from" (a user with a username) links and captures by BSUID, and is answered through "recipient"', async () => {
  const { user } = await linkedUser(USER_NAMELESS);
  expect(await ChatLink.find().lean()).toMatchObject([
    { userId: oid(user.id), platform: 'whatsapp', platformUserId: USER_NAMELESS.bsuid, chatId: USER_NAMELESS.bsuid, displayName: 'Anh Nguyen' },
  ]);
  graph.length = 0;

  const [reply] = await say('phở 45k', USER_NAMELESS);
  expect(reply.body.recipient).toBe(USER_NAMELESS.bsuid);
  const draft = await Transaction.findOne().lean();
  expect(draft).toMatchObject({ source: 'whatsapp', chatRef: { chatId: USER_NAMELESS.bsuid } });
  expect(textOf((await press(`c:${draft._id}`, USER_NAMELESS))[0])).toMatch(/Đã lưu.*45\.000/);
  expect((await Transaction.findById(draft._id)).status).toBe('confirmed');
  for (const call of graph) expect(call.body).not.toHaveProperty('to');

  // A message with no BSUID has no safe key (the phone number is never one, and a contact is not proof of who sent it):
  // it is ignored and says so in the log, without the number.
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const phoneOnly = textMessage('cafe 20k', USER_A);
  delete phoneOnly.entry[0].changes[0].value.messages[0].from_user_id;
  graph.length = 0;
  expect(await send(phoneOnly)).toEqual([]);
  expect(await Transaction.countDocuments({ amount: 20_000 })).toBe(0);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(warn.mock.calls)).not.toContain(USER_A.phone);
});

test('TC-F8-37 no phone number is stored or returned: not in any collection, nor in any API answer', async () => {
  // A links with "/link CODE" and has a phone number in every payload; B (no phone) links with a claim link.
  const a = await linkedUser(USER_A, { name: 'Lan' });
  const claim = await say('xin chào', USER_B);
  const [, token] = /\/link\?t=([A-Za-z0-9_-]{32})/.exec(textOf(claim[0]));
  const b = await registerUser({ name: 'Minh' });
  const asB = (method, path, payload) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${b.accessToken}`).send(payload);
  const answers = [];
  const keep = (res) => {
    answers.push(res.text);
    return res;
  };
  keep(await asB('post', '/chat-links/claim/preview', { token }));
  keep(await asB('post', '/chat-links/claim', { token }));
  await Promise.all(background.splice(0));

  // A text draft and a receipt draft for each; one of A's is confirmed.
  await say('phở 45k', USER_A);
  await send(incoming('image', {}, USER_A));
  await say('grab 32k', USER_B);
  await send(incoming('image', {}, USER_B));
  const [draftA] = await Transaction.find({ 'chatRef.chatId': USER_A.bsuid }).sort({ _id: 1 });
  await press(`c:${draftA._id}`, USER_A);
  expect(await Transaction.countDocuments({ source: 'whatsapp', status: 'draft' })).toBe(3);

  // Every collection, every document.
  const dump = [];
  for (const collection of await mongoose.connection.db.collections()) dump.push(...(await collection.find().toArray()));
  const stored = JSON.stringify(dump);
  expect(stored).toContain(USER_A.bsuid);
  expect(stored).toContain(USER_B.bsuid);

  // Every endpoint that can return this data.
  const asA = (method, path, payload) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${a.accessToken}`).send(payload);
  const draftsOfA = keep(await asA('get', '/transactions?source=whatsapp')).body.items;
  keep(await asA('get', '/chat-links'));
  keep(await asB('get', '/chat-links'));
  keep(await asB('get', '/transactions?status=draft'));
  for (const { id } of draftsOfA) keep(await asA('get', `/transactions/${id}`));
  keep(await asA('patch', `/transactions/${draftsOfA.at(-1).id}`, { note: 'đã sửa' }));
  keep(await asA('post', `/transactions/${draftsOfA.at(-1).id}/confirm`));
  const admin = await registerUser({ name: 'Boss' });
  await User.updateOne({ _id: admin.user.id }, { role: 'admin' });
  const token2 = (await refresh(admin.cookie)).body.accessToken;
  for (const path of ['/admin/stats', '/admin/users']) keep(await request(app).get(`/api${path}`).set('Authorization', `Bearer ${token2}`));
  expect(answers.length).toBeGreaterThan(8);
  keep({ text: JSON.stringify(graph) }); // what was sent to Meta carries the BSUID in `recipient`, never a phone number

  for (const phone of [USER_A.phone, USER_B.phone, USER_A.phone.slice(2), USER_B.phone.slice(2)]) {
    expect(stored).not.toContain(phone);
    for (const answer of answers) expect(answer).not.toContain(phone);
  }
  // The web shows the profile name and the platform, and the admin counts chats and transactions.
  expect(JSON.parse(answers.find((text) => text.includes('Anh Nguyen') && text.startsWith('[')))).toMatchObject([{ platform: 'whatsapp', displayName: 'Anh Nguyen' }]);
});

test('TC-F8-38 with any of the four WhatsApp settings unset, both webhook calls answer 503 and process nothing, and the link card gets no WhatsApp link', async () => {
  const { accessToken } = await linkedUser();
  graph.length = 0;
  const links = (await request(app).post('/api/chat-links/code').set('Authorization', `Bearer ${accessToken}`)).body.links;
  expect(links.whatsapp).toMatch(/^https:\/\/wa\.me\//); // with everything set
  errorLog.mockImplementation(() => {}); // the error handler logs every 5xx

  for (const key of ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN']) {
    const saved = env[key];
    env[key] = undefined; // WHATSAPP_NUMBER stays set
    try {
      const setup = await request(app).get(`/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`);
      const post = await deliver(textMessage('grab 32k'));
      expect([key, setup.status, setup.body.error.code]).toEqual([key, 503, 'FEATURE_NOT_CONFIGURED']);
      expect([key, post.status, post.body.error.code, post.started]).toEqual([key, 503, 'FEATURE_NOT_CONFIGURED', 0]);

      const { accessToken: other } = await registerUser(); // a code is limited to 5 per user and 10 minutes
      const card = await request(app).post('/api/chat-links/code').set('Authorization', `Bearer ${other}`);
      expect(card.body.links).toEqual({ telegram: expect.stringMatching(/^https:\/\/t\.me\//), whatsapp: null, zalo: links.zalo });
    } finally {
      env[key] = saved;
    }
  }
  expect(errorLog).toHaveBeenCalledTimes(8); // a GET and a POST for each setting
  errorLog.mockClear();
  expect(graph).toEqual([]);
  expect(await Transaction.countDocuments()).toBe(0);
});

test('TC-F8-39 audio, sticker, location and unsupported messages get the help text; a group message, a reaction, a system note, an unknown button and a message with no id are ignored', async () => {
  await linkedUser();
  graph.length = 0;

  for (const name of ['audio', 'sticker', 'location', 'unsupported']) {
    const replies = await send(incoming(name));
    expect([name, replies.map(textOf)]).toEqual([name, [viText.help]]);
    expect(replies[0].body.type).toBe('text');
  }
  expect(await Transaction.countDocuments()).toBe(0);

  // The same from a chat that is not linked: a claim link, not the help text.
  expect(textOf((await send(incoming('sticker', {}, USER_B)))[0])).toMatch(/\/link\?t=/);

  graph.length = 0;
  const group = textMessage('grab 32k');
  group.entry[0].changes[0].value.messages[0].group_id = 'GROUP.1234567890'; // other people would see the money
  const noId = textMessage('grab 32k');
  delete noId.entry[0].changes[0].value.messages[0].id;
  const reaction = incoming('sticker', { type: 'reaction', sticker: undefined, reaction: { message_id: 'wamid.sent1', emoji: '👍' } }); // an emoji on our message
  const system = incoming('sticker', { type: 'system', sticker: undefined, system: { type: 'user_changed_user_id', body: 'The user changed their username.' } }); // Meta's note that the BSUID changed
  for (const body of [group, noId, reaction, system, pressMessage('zz:nothing'), pressMessage('c:not-a-draft-id'), pressMessage(undefined)]) {
    expect(await send(body)).toEqual([]);
  }
  expect(await Transaction.countDocuments()).toBe(0);
});

test("TC-F8-39 a button press only touches the presser's own drafts; an unlinked chat's press gets the link instructions", async () => {
  await linkedUser(USER_A);
  await linkedUser(USER_B);
  await say('phở 45k', USER_A);
  const draft = await Transaction.findOne().lean();

  for (const action of ['c', 'x']) {
    const reply = await press(`${action}:${draft._id}`, USER_B);
    expect(textOf(reply.at(-1))).toBe(viText.notFound);
  }
  expect(await Transaction.findById(draft._id)).toMatchObject({ status: 'draft', deletedAt: null });

  const stranger = { bsuid: 'VN.11111111111111111111' };
  const unlinked = await press(`c:${draft._id}`, stranger);
  expect(unlinked).toHaveLength(1);
  expect(textOf(unlinked[0])).toContain('Vui lòng liên kết');
  expect(textOf(unlinked[0])).not.toMatch(/\/link\?t=/); // a button's notice is not a message that makes a claim link
  expect(await Transaction.findById(draft._id)).toMatchObject({ status: 'draft', deletedAt: null });
});

test('TC-F8-40 /today, /month, /lang, /help, typed ok / huy and an admin lock work on WhatsApp as on Telegram and Zalo', async () => {
  const { user } = await linkedUser();
  graph.length = 0;

  expect(textOf((await say('/help'))[0])).toBe(viText.help);
  expect(textOf((await say('/today'))[0])).toMatch(/^📅 Hôm nay/);
  expect(textOf((await say('/month'))[0])).toMatch(/^📅 Tháng/);
  expect(textOf((await say('/lang en'))[0])).toBe(enText.languageSet);
  expect(textOf((await say('/help'))[0])).toBe(enText.help);

  await say('coffee 30k');
  expect(textOf((await say('ok'))[0])).toMatch(/Saved: .*30,000/);
  await say('grab 32k');
  expect(textOf((await say('huy'))[0])).toMatch(/Discarded: .*32,000/);
  expect(await Transaction.find({ deletedAt: null }).lean()).toMatchObject([{ amount: 30_000, status: 'confirmed' }]);

  // Locked by an admin: nothing is recorded, a draft's button answers "locked" too.
  await say('cafe 20k');
  const draft = await Transaction.findOne({ amount: 20_000 });
  await User.updateOne({ _id: user.id }, { status: 'locked' });
  expect(textOf((await say('phở 45k'))[0])).toBe(enText.locked);
  expect(textOf((await press(`c:${draft._id}`))[0])).toBe(enText.locked);
  expect(await Transaction.countDocuments({ status: 'draft', deletedAt: null })).toBe(1);
});
