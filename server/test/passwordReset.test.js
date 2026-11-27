import { createHash } from 'node:crypto';
import crypto from 'node:crypto';
import { inspect } from 'node:util';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import { handleMessage } from '../src/bot/core.js';
import viText from '../src/bot/messages.vi.js';
import { env } from '../src/config/env.js';
import { mailRateLimit } from '../src/middleware/rateLimit.js';
import { ChatLink } from '../src/models/ChatLink.js';
import { EmailCode } from '../src/models/EmailCode.js';
import { LinkCode } from '../src/models/LinkCode.js';
import { Session } from '../src/models/Session.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import { createClaimToken, createLinkCode, redeemLinkCode } from '../src/services/chatLinks.js';
import { loginAs, refresh, registerUser, resetLoginLimit } from './helpers/auth.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { failNextSend, sendCode, sentMail } from './helpers/mailbox.js';

// docs/07 §7.10.3, the password-reset half: forgot (a code row for every address, mail only for an active user) and
// reset (the right code sets the password, signs out every device, unlinks every chat). services/mail.js is replaced
// (helpers/mail-mock.js), so each test reads the code the server asked the mailer to send. Time moves by shifting the
// stored dates back (age()), so no fake timer touches the MongoDB driver.

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Session.init(), EmailCode.init(), ChatLink.init(), LinkCode.init()]); // wait for the indexes
});
afterEach(async () => {
  await clearTestDb();
  await resetLoginLimit();
  Object.assign(env, { NODE_ENV: 'test', GMAIL_USER: undefined, GMAIL_APP_PASSWORD: undefined });
  vi.restoreAllMocks();
});
afterAll(stopTestDb);

const NEW_PASSWORD = 'brand-new-pass-9';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const post = (path, data, ip) => {
  const req = request(app).post(`/api/auth/${path}`).set('User-Agent', 'device-1');
  return (ip ? req.set('X-Forwarded-For', ip) : req).send(data);
};
const forgot = (email, ip) => post('password/forgot', { email }, ip);
const reset = (email, code, newPassword = NEW_PASSWORD, ip) => post('password/reset', { email, code, newPassword }, ip);
const errorOf = (res) => [res.status, res.body.error?.code];
const wrongCode = (right) => (right === '000000' ? '111111' : '000000');
// The newest reset code mailed to this address (a sign-up mail to the same address is another purpose).
const resetCode = (to) => sentMail().findLast((mail) => mail.to === to && mail.purpose === 'reset')?.code;
const fixCodes = (...codes) => {
  const randomInt = vi.spyOn(crypto, 'randomInt');
  for (const code of codes) randomInt.mockReturnValueOnce(Number(code));
};

async function age(seconds) {
  const back = (date) => new Date(date.getTime() - seconds * 1000);
  for (const row of await EmailCode.find().lean()) {
    await EmailCode.updateOne({ _id: row._id }, { sends: row.sends.map(back), codeExpiresAt: back(row.codeExpiresAt), expiresAt: back(row.expiresAt) });
  }
}

// A user who is not made by registerUser (no session): a locked one, say.
const lockedUser = (email = 'locked@example.com') => User.create({ name: 'Locked', email, passwordHash: 'x', status: 'locked' });

// Every line any console method got while `run` ran, for the "never in a log" checks.
async function captureLogs(run) {
  const spies = ['log', 'info', 'warn', 'error'].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  await run();
  return spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' '))).join('\n');
}

describe('forgot without enumeration', () => {
  test('TC-F1-53 an unknown, a locked and an active address get the same 202 { resendAfter: 60 }, and only the active one gets a mail', async () => {
    const active = await registerUser({ language: 'en' });
    await lockedUser();
    const answers = [];
    for (const email of ['nobody@example.com', 'locked@example.com', active.email]) {
      answers.push(await forgot(email));
      await resetLoginLimit();
    }

    expect(answers.map((res) => [res.status, res.body])).toEqual(Array(3).fill([202, { resendAfter: 60 }]));
    expect(answers.every((res) => res.headers['set-cookie'] === undefined)).toBe(true);
    expect(sentMail().filter((mail) => mail.purpose === 'reset')).toEqual([{ to: active.email, purpose: 'reset', code: expect.stringMatching(/^\d{6}$/), language: 'en' }]);
  });

  test('TC-F1-53 every address gets a reset row (D2), each with a code hash and its own 10 minutes, and no user is created or changed', async () => {
    const active = await registerUser();
    await lockedUser();
    const before = await User.find().select('+passwordHash').lean();
    for (const email of ['nobody@example.com', 'locked@example.com', active.email]) await forgot(email);

    const rows = await EmailCode.find({ purpose: 'reset' }).sort({ email: 1 }).lean();

    expect(rows.map((row) => row.email)).toEqual([active.email, 'locked@example.com', 'nobody@example.com'].sort());
    for (const row of rows) {
      expect(row).toMatchObject({ purpose: 'reset', attempts: 0 });
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.sends).toHaveLength(1);
      expect(row.signup).toBeUndefined();
      expect(row.codeExpiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    }
    expect(await User.find().select('+passwordHash').lean()).toEqual(before);
  });

  test('TC-F1-53 the answer does not wait for the send: a mail that is still being sent does not hold the 202 (waitUntil)', async () => {
    const active = await registerUser();
    let finish;
    sendCode.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve))); // a Gmail that takes its time

    const res = await forgot(active.email);

    expect([res.status, res.body]).toEqual([202, { resendAfter: 60 }]);
    expect(finish).toBeDefined(); // the send was started, and it is still running
    finish();
  });

  test('TC-F1-53 a send that fails still answers the same 202, keeps the row, and logs only the masked address and the error code', async () => {
    const { sendCode: realSend, setMailSender } = await vi.importActual('../src/services/mail.js');
    const active = await registerUser();
    const tried = [];
    setMailSender(async (asked) => {
      tried.push(asked.code);
      throw Object.assign(new Error(`rejected ${asked.to} ${asked.code}`), { code: 'ECONNECTION' });
    });
    sendCode.mockImplementation((asked) => realSend(asked));
    Object.assign(env, { NODE_ENV: 'production', GMAIL_USER: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcdefghijklmnop' });

    let res;
    const logs = await captureLogs(async () => {
      res = await forgot(active.email);
      await vi.waitFor(() => expect(tried).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 20)); // the background send ends and logs
    });
    setMailSender(undefined);

    expect([res.status, res.body]).toEqual([202, { resendAfter: 60 }]);
    expect(await EmailCode.countDocuments({ purpose: 'reset', email: active.email })).toBe(1);
    expect(logs).toContain(`[mail] send failed for ${active.email[0]}***@example.com: ECONNECTION`);
    for (const secret of [...tried, active.email]) expect(logs).not.toContain(secret);
  });

  test('TC-F1-53 a failing mailer on a one-off send leaves no unhandled rejection and the same 202', async () => {
    const active = await registerUser();
    failNextSend();

    const res = await forgot(active.email);
    await new Promise((resolve) => setTimeout(resolve, 20)); // an unhandled rejection would fail the run here

    expect([res.status, res.body]).toEqual([202, { resendAfter: 60 }]);
  });

  test('TC-F1-53 forgot checks its body: no email, a bad email, an operator instead of a string; nothing is written or sent', async () => {
    for (const bad of [{}, { email: 'not-an-email' }, { email: { $gt: '' } }]) {
      expect(errorOf(await post('password/forgot', bad))).toEqual([400, 'VALIDATION_ERROR']);
    }

    expect(await EmailCode.countDocuments()).toBe(0);
    expect(sentMail()).toEqual([]);
  });

  test('TC-F1-53 the address is read in lower case: "Lan@Example.com" finds the account', async () => {
    const active = await registerUser({ email: 'lan@example.com' });

    const res = await forgot('LAN@Example.COM');

    expect(res.status).toBe(202);
    expect(resetCode(active.email)).toMatch(/^\d{6}$/);
  });
});

describe('the same answers for every address (D2)', () => {
  test('TC-F1-54 after forgot, a wrong code on reset is the same CODE_INVALID with attemptsLeft 4 for an unknown, a locked and an active address', async () => {
    const active = await registerUser();
    await lockedUser();
    fixCodes('123456', '123456', '123456');
    const emails = ['nobody@example.com', 'locked@example.com', active.email];
    for (const email of emails) {
      await forgot(email);
      await resetLoginLimit();
    }

    const answers = [];
    for (const email of emails) answers.push(await reset(email, '000000'));

    expect(answers.map((res) => [res.status, res.body.error.code, res.body.error.details])).toEqual(Array(3).fill([400, 'CODE_INVALID', { attemptsLeft: 4 }]));
  });

  test('TC-F1-54 the right code is told apart only once it is spent: an unknown address is CODE_EXPIRED, a locked one ACCOUNT_LOCKED', async () => {
    await lockedUser();
    fixCodes('123456', '123456');
    await forgot('nobody@example.com');
    await resetLoginLimit();
    await forgot('locked@example.com');

    const unknown = await reset('nobody@example.com', '123456');
    const locked = await reset('locked@example.com', '123456');

    expect(errorOf(unknown)).toEqual([400, 'CODE_EXPIRED']);
    expect(errorOf(locked)).toEqual([403, 'ACCOUNT_LOCKED']);
  });

  test('TC-F1-54 a second forgot within 60 s is the same 429 RATE_LIMITED with retryAfter for an unknown, a locked and an active address', async () => {
    const active = await registerUser();
    await lockedUser();
    const emails = ['nobody@example.com', 'locked@example.com', active.email];
    for (const email of emails) {
      await forgot(email);
      await resetLoginLimit();
    }
    const mails = sentMail().length;

    const answers = [];
    for (const email of emails) {
      answers.push(await forgot(email));
      await resetLoginLimit();
    }

    for (const res of answers) {
      expect(errorOf(res)).toEqual([429, 'RATE_LIMITED']);
      expect(res.body.error.details.retryAfter).toBeGreaterThan(55);
      expect(res.body.error.details.retryAfter).toBeLessThanOrEqual(60);
    }
    expect(sentMail()).toHaveLength(mails); // the refused ones sent nothing
  });

  test('TC-F1-54 after 61 s forgot sends a new code and the old one no longer works; the 6th send in an hour is 429, even for an unknown address', async () => {
    const active = await registerUser();
    await forgot(active.email);
    const first = resetCode(active.email);
    for (let i = 0; i < 4; i += 1) {
      await age(61);
      await resetLoginLimit();
      expect((await forgot(active.email)).status).toBe(202); // sends 2 to 5
      await forgot('nobody@example.com'); // the unknown address counts the same (sends 1 to 4)
    }
    await age(61);
    await resetLoginLimit();

    const sixth = await forgot(active.email);

    expect(errorOf(sixth)).toEqual([429, 'RATE_LIMITED']);
    expect(sixth.body.error.details.retryAfter).toBeGreaterThan(60);
    expect(resetCode(active.email)).not.toBe(first);
    expect(errorOf(await reset(active.email, first))).toEqual([400, 'CODE_INVALID']); // replaced by the newer code
    await age(3600);
    expect((await forgot(active.email)).status).toBe(202);
  });

  test('TC-F1-54 with mail off (production without GMAIL_*) forgot is 503 FEATURE_NOT_CONFIGURED for every address, with no row and no mail', async () => {
    const active = await registerUser();
    await lockedUser();
    env.NODE_ENV = 'production';

    for (const email of ['nobody@example.com', 'locked@example.com', active.email]) {
      const res = await forgot(email);
      expect(errorOf(res)).toEqual([503, 'FEATURE_NOT_CONFIGURED']);
    }

    expect(await EmailCode.countDocuments()).toBe(0);
    expect(sentMail().filter((mail) => mail.purpose === 'reset')).toEqual([]);
  });

  test('TC-F1-54 with mail off, reset has no code to find: CODE_EXPIRED, and the password stays', async () => {
    const active = await registerUser();
    env.NODE_ENV = 'production';

    const res = await reset(active.email, '123456');

    expect(errorOf(res)).toEqual([400, 'CODE_EXPIRED']);
    expect((await loginAs(active, 'device-9')).accessToken).toBeTruthy();
  });
});

describe('password reset', () => {
  test('TC-F1-55 the right code answers 204 with no body, token or cookie; both devices are logged out; the old password fails and the new one works', async () => {
    const a = await registerUser();
    const second = await loginAs(a);
    await forgot(a.email);

    const res = await reset(a.email, resetCode(a.email));

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toEqual({});
    expect((await refresh(a.cookie)).status).toBe(401);
    expect((await refresh(second.cookie)).status).toBe(401);
    expect(await Session.countDocuments({ userId: a.user.id, revokedAt: null })).toBe(0);
    expect(errorOf(await post('login', { email: a.email, password: a.password }))).toEqual([401, 'INVALID_CREDENTIALS']);
    expect((await loginAs({ email: a.email, password: NEW_PASSWORD })).accessToken).toBeTruthy();
    expect(await EmailCode.countDocuments({ purpose: 'reset' })).toBe(0); // the row is gone
  });

  test('TC-F1-55 reset does not touch another user: B stays logged in with the same password', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await forgot(a.email);

    expect((await reset(a.email, resetCode(a.email))).status).toBe(204);

    expect((await refresh(b.cookie)).status).toBe(200);
    expect((await loginAs(b)).accessToken).toBeTruthy();
  });

  test('TC-F1-55 the code is single use: the same code twice is CODE_EXPIRED the second time and the password is the first one', async () => {
    const a = await registerUser();
    await forgot(a.email);
    const code = resetCode(a.email);
    await reset(a.email, code);

    const again = await reset(a.email, code, 'another-pass-77');

    expect(errorOf(again)).toEqual([400, 'CODE_EXPIRED']);
    expect((await loginAs({ email: a.email, password: NEW_PASSWORD })).accessToken).toBeTruthy();
  });

  test('TC-F1-55 the same right code sent twice at once is one 204 and one CODE_EXPIRED', async () => {
    const a = await registerUser();
    await forgot(a.email);
    const code = resetCode(a.email);

    const answers = await Promise.all([reset(a.email, code), reset(a.email, code, 'another-pass-77')]);

    expect(answers.map((res) => res.status).sort()).toEqual([204, 400]);
    expect(answers.find((res) => res.status === 400).body.error.code).toBe('CODE_EXPIRED');
    const winner = answers[0].status === 204 ? NEW_PASSWORD : 'another-pass-77';
    expect((await loginAs({ email: a.email, password: winner })).accessToken).toBeTruthy();
  });

  test('TC-F1-55 5 wrong codes answer CODE_INVALID with 4, 3, 2, 1, 0 tries left, then even the right code is CODE_EXPIRED and the password stays', async () => {
    const a = await registerUser();
    await forgot(a.email);
    const code = resetCode(a.email);

    for (const attemptsLeft of [4, 3, 2, 1, 0]) {
      const res = await reset(a.email, wrongCode(code));
      expect([res.status, res.body.error.code, res.body.error.details]).toEqual([400, 'CODE_INVALID', { attemptsLeft }]);
    }

    expect(errorOf(await reset(a.email, code))).toEqual([400, 'CODE_EXPIRED']);
    expect((await refresh(a.cookie)).status).toBe(200); // nobody was signed out
    expect((await loginAs(a)).accessToken).toBeTruthy();
  });

  test('TC-F1-55 a code is CODE_EXPIRED after 10 minutes, even the right one', async () => {
    const a = await registerUser();
    await forgot(a.email);
    await age(10 * 60 + 1);

    expect(errorOf(await reset(a.email, resetCode(a.email)))).toEqual([400, 'CODE_EXPIRED']);
  });

  test('TC-F1-55 a new password of 7 characters or 73 bytes is a 400 that spends nothing: the same code then works with a good one', async () => {
    const a = await registerUser();
    await forgot(a.email);
    const code = resetCode(a.email);

    for (const bad of ['short77', 'a'.repeat(73), 'é'.repeat(37)]) {
      expect(errorOf(await reset(a.email, code, bad))).toEqual([400, 'VALIDATION_ERROR']);
    }
    for (const bad of [{ code: '12345' }, { code: 'abcdef' }, { code: undefined }, { newPassword: undefined }, { email: undefined }]) {
      const res = await post('password/reset', { email: a.email, code, newPassword: NEW_PASSWORD, ...bad });
      expect(errorOf(res)).toEqual([400, 'VALIDATION_ERROR']);
    }

    expect((await EmailCode.findOne({ purpose: 'reset' }).lean()).attempts).toBe(0);
    expect((await reset(a.email, code)).status).toBe(204);
  });

  test('TC-F1-55 a password of exactly 72 bytes is accepted', async () => {
    const a = await registerUser();
    await forgot(a.email);

    const res = await reset(a.email, resetCode(a.email), 'p'.repeat(72));

    expect(res.status).toBe(204);
    expect((await loginAs({ email: a.email, password: 'p'.repeat(72) })).accessToken).toBeTruthy();
  });

  test('TC-F1-55 a sign-up code and a reset code do not cross: neither opens the other\'s door', async () => {
    const a = await registerUser();
    fixCodes('111111', '222222');
    const pending = await post('register', { name: 'New', email: 'new@example.com', password: 'correct-horse-1' }); // sign-up code 111111
    await forgot('new@example.com'); // no user, so a reset row (code 222222) and no mail
    await resetLoginLimit();
    await forgot(a.email); // a reset row for a real user

    // Reset with the sign-up code: the reset row has another code (new@) or none of that code (a's row).
    expect(errorOf(await reset('new@example.com', '111111'))).toEqual([400, 'CODE_INVALID']);
    // Verify with the reset code: the sign-up row has another code.
    const verified = await post('register/verify', { email: 'new@example.com', code: '222222', signupToken: pending.body.signupToken });

    expect(errorOf(verified)).toEqual([400, 'CODE_INVALID']);
    expect(await User.countDocuments({ email: 'new@example.com' })).toBe(0);
    expect((await refresh(a.cookie)).status).toBe(200);
    // A sign-up code for an address with no reset row at all: CODE_EXPIRED.
    await post('register', { name: 'Other', email: 'other@example.com', password: 'correct-horse-1' });
    expect(errorOf(await reset('other@example.com', sentMail().findLast((mail) => mail.to === 'other@example.com').code))).toEqual([400, 'CODE_EXPIRED']);
    expect(await User.countDocuments({ email: 'other@example.com' })).toBe(0);
  });

  test('TC-F1-55 an account that was deleted after forgot answers CODE_EXPIRED when the right code arrives', async () => {
    const a = await registerUser();
    await forgot(a.email);
    const code = resetCode(a.email);
    await User.deleteOne({ _id: a.user.id });

    expect(errorOf(await reset(a.email, code))).toEqual([400, 'CODE_EXPIRED']);
    expect(await EmailCode.countDocuments({ purpose: 'reset' })).toBe(0); // the code is spent
  });

  test('TC-F1-55 there is no per-IP limit on reset (D7): 15 wrong guesses from one IP are all answered by the code check', async () => {
    const answers = [];
    for (let i = 0; i < 15; i += 1) answers.push((await reset('nobody@example.com', '123456', NEW_PASSWORD, '203.0.113.20')).status);

    expect(answers).toEqual(Array(15).fill(400));
  });
});

describe('locked during reset', () => {
  test('TC-F1-56 a user locked after forgot gets 403 ACCOUNT_LOCKED with the right code, the code is spent, and nothing else changes', async () => {
    const b = await registerUser();
    await forgot(b.email);
    const code = resetCode(b.email);
    await User.updateOne({ _id: b.user.id }, { status: 'locked' }); // the status write of PATCH /admin/users/:id
    const before = await User.findById(b.user.id).select('+passwordHash').lean();
    await ChatLink.create({ userId: b.user.id, platform: 'telegram', platformUserId: '700', chatId: '700' });
    await createLinkCode(b.user.id);

    const first = await reset(b.email, code);
    const second = await reset(b.email, code);

    expect(errorOf(first)).toEqual([403, 'ACCOUNT_LOCKED']);
    expect(errorOf(second)).toEqual([400, 'CODE_EXPIRED']); // spent
    expect(await EmailCode.countDocuments({ purpose: 'reset', email: b.email })).toBe(0);
    expect(await User.findById(b.user.id).select('+passwordHash').lean()).toEqual(before); // same hash, same everything
    expect(await Session.countDocuments({ userId: b.user.id, revokedAt: null })).toBe(1); // reset revoked nothing
    expect(await ChatLink.countDocuments({ userId: b.user.id })).toBe(1);
    expect(await LinkCode.countDocuments({ userId: b.user.id })).toBe(1);
  });

  test('TC-F1-56 a lock that lands while the new hash is being made also gives 403 and keeps the old password', async () => {
    const b = await registerUser();
    await forgot(b.email);
    const code = resetCode(b.email);
    const realHash = bcrypt.hash.bind(bcrypt);
    vi.spyOn(bcrypt, 'hash').mockImplementationOnce(async (...args) => {
      await User.updateOne({ _id: b.user.id }, { status: 'locked' }); // the admin locks between the status check and the write
      return realHash(...args);
    });

    const res = await reset(b.email, code);

    expect(errorOf(res)).toEqual([403, 'ACCOUNT_LOCKED']);
    const { passwordHash } = await User.findById(b.user.id).select('+passwordHash').lean();
    expect(await bcrypt.compare(b.password, passwordHash)).toBe(true); // still the old password
    expect(await Session.countDocuments({ userId: b.user.id, revokedAt: null })).toBe(1);
  });
});

describe('mail rate limit', () => {
  test('TC-F1-57 forgot shares the count of 10 with register and resend: the 11th code request from one IP is 429 with retryAfter, no row, no mail', async () => {
    const ip = '203.0.113.7';
    await User.create({ name: 'Real', email: 'real@example.com', passwordHash: 'x' });
    for (let i = 0; i < 5; i += 1) expect((await post('register', { name: 'N', email: `n${i}@example.com`, password: 'correct-horse-1' }, ip)).status).toBe(202);
    for (let i = 0; i < 2; i += 1) await post('register/resend', { email: `n${i}@example.com` }, ip); // too early (429) or not, they count
    expect((await forgot('real@example.com', ip)).status).toBe(202);
    expect((await forgot('nobody@example.com', ip)).status).toBe(202); // an answer with nothing sent counts too
    expect((await forgot('real@example.com', ip)).status).toBe(429); // the 10th: the address's own 60 s wait
    const mails = sentMail().length;

    const eleventh = await forgot('late@example.com', ip);

    expect(errorOf(eleventh)).toEqual([429, 'RATE_LIMITED']);
    expect(eleventh.body.error.details.retryAfter).toBeGreaterThan(60); // the IP wait, not the 60 s address wait
    expect(eleventh.body.error.details.retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(sentMail()).toHaveLength(mails);
    expect(await EmailCode.countDocuments({ purpose: 'reset', email: 'late@example.com' })).toBe(0);
    expect((await forgot('late@example.com', '203.0.113.8')).status).toBe(202); // another IP is not limited
    mailRateLimit.resetKey(ip); // what 15 minutes do
    expect((await forgot('late2@example.com', ip)).status).toBe(202);
  });

  test('TC-F1-57 reset has no mail limit: it sends no mail, so 12 resets from one IP are all answered by the code check', async () => {
    for (let i = 0; i < 12; i += 1) expect((await reset('nobody@example.com', '123456', NEW_PASSWORD, '203.0.113.9')).status).toBe(400);
  });
});

describe('storage and logs', () => {
  test('TC-F1-58 the reset row holds only the code hash, and after the reset no password or code is in any document', async () => {
    const a = await registerUser();
    await forgot(a.email);
    const code = resetCode(a.email);
    const [row] = await EmailCode.collection.find({ purpose: 'reset' }).toArray();

    expect(row.codeHash).toBe(sha256(code));
    expect(Object.values(row)).not.toContain(code);
    expect(JSON.stringify(row)).not.toContain(NEW_PASSWORD);
    expect(row.signup).toBeUndefined();

    await reset(a.email, code);
    const users = JSON.stringify(await User.collection.find().toArray());
    const [{ passwordHash }] = await User.collection.find().toArray();
    expect(users).not.toContain(NEW_PASSWORD);
    expect(passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(await bcrypt.compare(NEW_PASSWORD, passwordHash)).toBe(true);
    expect(JSON.stringify(await EmailCode.collection.find().toArray())).not.toContain(code);
  });

  test('TC-F1-58 in production with mail on, forgot and reset log no code and no password, and the address only masked', async () => {
    const { sendCode: realSend, setMailSender } = await vi.importActual('../src/services/mail.js');
    const a = await registerUser({ email: 'lan@example.com' });
    const delivered = [];
    setMailSender(async (asked) => void delivered.push(asked)); // the real mailer, delivery replaced
    sendCode.mockImplementation((asked) => realSend(asked));
    Object.assign(env, { NODE_ENV: 'production', GMAIL_USER: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcdefghijklmnop' });

    let res;
    const logs = await captureLogs(async () => {
      await forgot('nobody@example.com');
      await resetLoginLimit();
      await forgot(a.email);
      await vi.waitFor(() => expect(delivered).toHaveLength(1));
      expect((await reset(a.email, wrongCode(delivered[0].code))).status).toBe(400);
      res = await reset(a.email, delivered[0].code);
      expect((await reset(a.email, delivered[0].code)).status).toBe(400); // no live row
    });
    setMailSender(undefined);

    expect(res.status).toBe(204);
    for (const secret of [delivered[0].code, NEW_PASSWORD, 'lan@example.com', 'nobody@example.com']) expect(logs).not.toContain(secret);
  });

  test('TC-F1-58 in development without GMAIL_* the real mailer writes the reset code to the log with the masked address, and the flow completes from that line', async () => {
    const { sendCode: realSend } = await vi.importActual('../src/services/mail.js');
    const a = await registerUser({ email: 'lan@example.com' });
    sendCode.mockImplementation((asked) => realSend(asked));
    env.NODE_ENV = 'development';

    const logs = await captureLogs(async () => {
      await forgot(a.email);
      await vi.waitFor(() => expect(sendCode).toHaveBeenCalled());
    });

    const code = /\[mail\] reset code for l\*\*\*@example\.com: (\d{6})/.exec(logs)?.[1];
    expect(code).toBeDefined();
    expect((await reset(a.email, code)).status).toBe(204);
  });
});

describe('chats are unlinked by a reset (D3)', () => {
  // A chat of the user and the adapter the bot core talks through.
  const linkChat = (user, platformUserId, platform = 'telegram') =>
    ChatLink.create({ userId: user.id, platform, platformUserId, chatId: platformUserId, displayName: `chat ${platformUserId}` });
  const sentTexts = [];
  const adapter = (platform = 'telegram') => ({
    platform,
    sendText: async (_chatId, text) => void sentTexts.push(text),
    sendDraft: async (_chatId, draft) => void sentTexts.push(draft.text),
  });
  const say = (platformUserId, text, platform = 'telegram') =>
    handleMessage(adapter(platform), { platformUserId, chatId: platformUserId, messageId: '1', displayName: 'x', text });

  afterEach(() => {
    sentTexts.length = 0;
  });

  async function twoUsersWithChats() {
    const a = await registerUser();
    const b = await registerUser();
    await linkChat(a.user, '800');
    await linkChat(a.user, '801', 'zalo');
    await linkChat(b.user, '810');
    const aCode = await createLinkCode(a.user.id);
    const bCode = await createLinkCode(b.user.id);
    await resetLoginLimit();
    return { a, b, aCode, bCode };
  }

  test('TC-F1-59 after A\'s reset A has no chat links and no link codes, and B keeps both', async () => {
    const { a, b } = await twoUsersWithChats();
    await forgot(a.email);

    expect((await reset(a.email, resetCode(a.email))).status).toBe(204);

    expect(await ChatLink.countDocuments({ userId: a.user.id })).toBe(0);
    expect(await LinkCode.countDocuments({ userId: a.user.id })).toBe(0);
    expect(await ChatLink.find({ userId: b.user.id }).lean()).toHaveLength(1);
    expect(await LinkCode.countDocuments({ userId: b.user.id })).toBe(1);
  });

  test('TC-F1-59 a message from A\'s old chat gets the please-link reply and saves nothing, while B\'s chat still works', async () => {
    const { a, b } = await twoUsersWithChats();
    await forgot(a.email);
    await reset(a.email, resetCode(a.email));

    await say('800', '45k phở');
    await say('801', '30k cafe', 'zalo');

    expect(sentTexts[0]).toContain(viText.pleaseLink(env.APP_URL ?? ''));
    expect(sentTexts[1]).toContain(viText.pleaseLink(env.APP_URL ?? ''));
    expect(await Transaction.countDocuments({ userId: a.user.id })).toBe(0);
    sentTexts.length = 0;
    await say('810', '20k bánh mì');
    expect(await Transaction.countDocuments({ userId: b.user.id })).toBe(1);
    expect(sentTexts[0]).not.toContain(viText.pleaseLink(env.APP_URL ?? ''));
  });

  test('TC-F1-59 a link code made before the reset cannot link a chat after it', async () => {
    const { a, aCode } = await twoUsersWithChats();
    await forgot(a.email);
    await reset(a.email, resetCode(a.email));

    const linked = await redeemLinkCode(aCode.code, { platform: 'telegram', platformUserId: '900', chatId: '900', displayName: 'new' });
    await say('901', `/link ${aCode.code}`);

    expect(linked).toBeNull();
    expect(await ChatLink.countDocuments({ userId: a.user.id })).toBe(0);
    expect(sentTexts[0]).toContain(viText.invalidCode);
  });

  test('TC-F1-59 a claim link a chat got before it was linked does not survive its unlinking', async () => {
    const { a } = await twoUsersWithChats();
    await createClaimToken({ platform: 'telegram', platformUserId: '800', chatId: '800', displayName: 'x' }); // made while 800 was not linked
    await forgot(a.email);

    await reset(a.email, resetCode(a.email));

    expect(await LinkCode.countDocuments({ 'chat.platformUserId': '800' })).toBe(0);
  });

  test('TC-F1-59 a wrong code unlinks nothing, and the account stays linked', async () => {
    const { a } = await twoUsersWithChats();
    await forgot(a.email);

    expect((await reset(a.email, wrongCode(resetCode(a.email)))).status).toBe(400);

    expect(await ChatLink.countDocuments({ userId: a.user.id })).toBe(2);
    expect(await LinkCode.countDocuments({ userId: a.user.id })).toBe(1);
  });

  test('TC-F1-59 a locked account unlinks nothing', async () => {
    const { a } = await twoUsersWithChats();
    await forgot(a.email);
    await User.updateOne({ _id: a.user.id }, { status: 'locked' });

    expect((await reset(a.email, resetCode(a.email))).status).toBe(403);

    expect(await ChatLink.countDocuments({ userId: a.user.id })).toBe(2);
    expect(await LinkCode.countDocuments({ userId: a.user.id })).toBe(1);
  });

  test('TC-F1-59 a Settings password change keeps the chat links and the link codes', async () => {
    const { a } = await twoUsersWithChats();

    const change = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ currentPassword: a.password, newPassword: 'third-password-3' });

    expect(change.status).toBe(204);
    expect(await ChatLink.countDocuments({ userId: a.user.id })).toBe(2);
    expect(await LinkCode.countDocuments({ userId: a.user.id })).toBe(1);
  });

  test('TC-F1-59 drafts and transactions of the user stay after the reset', async () => {
    const { a } = await twoUsersWithChats();
    await say('800', '45k phở'); // a draft waiting for ok
    const drafts = await Transaction.countDocuments({ userId: a.user.id });
    await forgot(a.email);

    expect((await reset(a.email, resetCode(a.email))).status).toBe(204);

    expect(drafts).toBe(1);
    expect(await Transaction.countDocuments({ userId: a.user.id })).toBe(1);
  });
});

describe('reset during login', () => {
  // The first bcrypt.compare (this login's) is held until `resume()`, so the interleaving happens on every run (as in
  // auth.test.js, BUG-040). It returns the login's response once the compare has finished.
  async function startLoginPausedAtBcrypt({ email, password }) {
    const realCompare = bcrypt.compare.bind(bcrypt);
    let resume;
    let reached;
    const gate = new Promise((resolve) => (resume = resolve));
    const waiting = new Promise((resolve) => (reached = resolve));
    const spy = vi.spyOn(bcrypt, 'compare').mockImplementationOnce(async (...args) => {
      reached();
      await gate;
      return realCompare(...args);
    });
    const response = request(app).post('/api/auth/login').set('User-Agent', 'device-3').send({ email, password }).then((res) => res);
    await waiting;
    return async () => {
      resume();
      const res = await response;
      spy.mockRestore();
      return res;
    };
  }

  test('TC-F1-60 a login that checked the old password before the reset and finishes after it gets 401 INVALID_CREDENTIALS and no live session', async () => {
    const a = await registerUser();
    await forgot(a.email);
    const code = resetCode(a.email);
    const finishLogin = await startLoginPausedAtBcrypt(a); // device C is checking the old password...

    const done = await reset(a.email, code); // ...the reset lands...
    const login = await finishLogin(); // ...and the login finishes after it

    expect(done.status).toBe(204);
    expect(errorOf(login)).toEqual([401, 'INVALID_CREDENTIALS']);
    expect(login.headers['set-cookie']).toBeUndefined();
    expect(await Session.find({ userId: a.user.id, revokedAt: null }).lean()).toEqual([]);
    expect((await loginAs({ email: a.email, password: NEW_PASSWORD })).accessToken).toBeTruthy();
  });
});
