import { createHash } from 'node:crypto';
import crypto from 'node:crypto';
import { inspect } from 'node:util';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { mailRateLimit } from '../src/middleware/rateLimit.js';
import { Category } from '../src/models/Category.js';
import { EmailCode } from '../src/models/EmailCode.js';
import { Session } from '../src/models/Session.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { hashCode, makeCode, sameHash } from '../src/services/emailCodes.js';
import { resetLoginLimit } from './helpers/auth.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { failNextSend, lastCode, sendCode, sentMail } from './helpers/mailbox.js';

// docs/07 §7.10: sign-up with an emailed code on the API. services/mail.js is replaced (helpers/mail-mock.js), so each
// test reads the code the server asked the mailer to send. Time moves by shifting the stored dates back (age()), so
// no fake timer touches the MongoDB driver.

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Session.init(), EmailCode.init()]); // wait for the indexes before relying on them
});
afterEach(async () => {
  await clearTestDb();
  await resetLoginLimit();
  Object.assign(env, { NODE_ENV: 'test', GMAIL_USER: undefined, GMAIL_APP_PASSWORD: undefined });
  vi.restoreAllMocks();
});
afterAll(stopTestDb);

const PASSWORD = 'correct-horse-1';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const body = (overrides = {}) => ({ name: 'Lan', email: 'lan@example.com', password: PASSWORD, ...overrides });
const post = (path, data, ip) => {
  const req = request(app).post(`/api/auth/${path}`).set('User-Agent', 'device-1');
  return (ip ? req.set('X-Forwarded-For', ip) : req).send(data);
};
const register = (overrides, ip) => post('register', body(overrides), ip);
const verify = (email, code, signupToken, ip) => post('register/verify', { email, code, signupToken }, ip);
const resend = (email, ip) => post('register/resend', { email }, ip);
const wrongCode = (right) => (right === '000000' ? '111111' : '000000');

// Moves the clock forward by moving every stored date back, which is all the code ever compares with `new Date()`.
async function age(seconds) {
  const back = (date) => new Date(date.getTime() - seconds * 1000);
  for (const row of await EmailCode.find().lean()) {
    await EmailCode.updateOne({ _id: row._id }, { sends: row.sends.map(back), codeExpiresAt: back(row.codeExpiresAt), expiresAt: back(row.expiresAt) });
  }
}

// Registers an address and returns what a verify needs.
async function signUp(overrides = {}) {
  const res = await register(overrides);
  expect(res.status).toBe(202);
  const email = (overrides.email ?? 'lan@example.com').toLowerCase();
  return { email, code: lastCode(email), token: res.body.signupToken };
}

// Every line any console method got while `run` ran, for the "never in a log" checks.
async function captureLogs(run) {
  const spies = ['log', 'info', 'warn', 'error'].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  await run();
  return spies.flatMap((spy) => spy.mock.calls.map((args) => args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 6 }))).join(' '))).join('\n');
}

describe('code helpers', () => {
  test('TC-F1-43 a code is always 6 digits and keeps its leading zeros', () => {
    for (let i = 0; i < 1000; i += 1) expect(makeCode()).toMatch(/^\d{6}$/);
    vi.spyOn(crypto, 'randomInt').mockReturnValueOnce(4215);
    expect(makeCode()).toBe('004215');
  });

  test('TC-F1-43 a code is kept only as its SHA-256 and compared with timingSafeEqual', () => {
    const compare = vi.spyOn(crypto, 'timingSafeEqual');
    expect(hashCode('004215')).toBe(sha256('004215'));
    expect(sameHash(hashCode('004215'), hashCode('004215'))).toBe(true);
    expect(sameHash(hashCode('004215'), hashCode('004216'))).toBe(false);
    expect(compare).toHaveBeenCalledTimes(2);
  });
});

describe('sign-up with a code', () => {
  test('TC-F1-44 register answers 202 and mails a code: no user, no cookie, one pending row with only hashes', async () => {
    const res = await register({ email: 'Lan@Example.com', language: 'en' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ email: 'l***@example.com', resendAfter: 60, signupToken: expect.stringMatching(/^[A-Za-z0-9_-]{22,}$/) });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await User.countDocuments()).toBe(0);
    expect(await Session.countDocuments()).toBe(0);
    const mail = sentMail();
    expect(mail).toEqual([{ to: 'lan@example.com', purpose: 'signup', code: expect.stringMatching(/^\d{6}$/), language: 'en' }]);

    const rows = await EmailCode.find().lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'signup', email: 'lan@example.com', codeHash: sha256(mail[0].code), attempts: 0 });
    expect(rows[0].signup).toMatchObject({ name: 'Lan', language: 'en', tokenHash: sha256(res.body.signupToken) });
    expect(rows[0].signup.passwordHash).toMatch(/^\$2[aby]\$10\$/); // bcrypt, never the password
    expect(rows[0].sends).toHaveLength(1);
    const now = Date.now();
    expect(rows[0].codeExpiresAt.getTime() - now).toBeGreaterThan(9 * 60_000); // 10 minutes
    expect(rows[0].codeExpiresAt.getTime() - now).toBeLessThanOrEqual(10 * 60_000);
    expect(rows[0].expiresAt.getTime() - now).toBeGreaterThan(59 * 60_000); // the row lives 1 hour after the send
  });

  test('TC-F1-44 the right code creates the user, the Cash wallet and the categories and answers like today\'s register', async () => {
    const { email, code, token } = await signUp({ name: 'Lan', language: 'en' });

    const res = await verify(email, code, token);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Lan', email, role: 'user', status: 'active', language: 'en' });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.accessToken).toEqual(expect.any(String));
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('rt='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(await EmailCode.countDocuments()).toBe(0); // the row is gone
    expect(await Wallet.countDocuments({ userId: res.body.user.id })).toBe(1);
    expect(await Category.countDocuments({ userId: res.body.user.id })).toBeGreaterThan(0);
    const [session] = await Session.find({ userId: res.body.user.id });
    expect(session.userAgent).toBe('device-1'); // this request's client, not the register request's
    // The password the user typed at register is the one that logs in.
    expect((await post('login', { email, password: PASSWORD })).status).toBe(200);
  });

  test('TC-F1-44 the stored sign-up password hash is the one the user gets', async () => {
    const { email, code, token } = await signUp();
    const [row] = await EmailCode.find().lean();

    await verify(email, code, token);

    const user = await User.findOne({ email }).select('+passwordHash');
    expect(user.passwordHash).toBe(row.signup.passwordHash);
  });

  test('TC-F1-44 register checks the body as today: bad email, short password, no name, an operator instead of a string', async () => {
    for (const bad of [{ email: 'nope' }, { password: 'short' }, { name: '' }, { email: { $gt: '' } }]) {
      const res = await register(bad);
      expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    }
    expect(sentMail()).toEqual([]);
    expect(await EmailCode.countDocuments()).toBe(0);
  });

  test('TC-F1-44 verify checks its body: a code that is not 6 digits, no code, no token', async () => {
    const { email, code, token } = await signUp();

    for (const bad of [{ code: '12345' }, { code: 'abcdef' }, { code: undefined }, { signupToken: undefined }, { signupToken: '' }]) {
      const res = await post('register/verify', { email, code, signupToken: token, ...bad });
      expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    }
    expect((await EmailCode.findOne().lean()).attempts).toBe(0); // a malformed request is not a guess
  });
});

describe('the sign-up token (D1)', () => {
  test('TC-F1-45 registering again replaces the earlier token: the first tab\'s newest code answers CODE_EXPIRED and uses no attempt', async () => {
    const first = await signUp({ name: 'A', password: 'password-of-a' });
    await age(61); // past the 60 s wait
    const second = await signUp({ name: 'B', password: 'password-of-b' }); // B registers the same address

    expect(second.token).not.toBe(first.token);
    const early = await verify(first.email, second.code, first.token); // A's token with the newest code
    expect([early.status, early.body.error.code]).toEqual([400, 'CODE_EXPIRED']);
    expect(await User.countDocuments()).toBe(0);
    expect((await EmailCode.findOne().lean()).attempts).toBe(0); // no attempt used

    const late = await verify(second.email, second.code, second.token);
    expect(late.status).toBe(201);
    expect(late.body.user.name).toBe('B'); // the last register wins: its name...
    expect((await post('login', { email: second.email, password: 'password-of-b' })).status).toBe(200); // ...and its password
    expect((await post('login', { email: second.email, password: 'password-of-a' })).status).toBe(401);
  });

  test('TC-F1-45 a verify with the token of another address or an invented token is CODE_EXPIRED', async () => {
    const lan = await signUp({ email: 'lan@example.com' });
    const minh = await signUp({ email: 'minh@example.com' });

    for (const [email, code, token] of [
      [lan.email, lan.code, minh.token],
      [minh.email, minh.code, lan.token],
      [lan.email, lan.code, 'made-up-token'],
    ]) {
      const res = await verify(email, code, token);
      expect([res.status, res.body.error.code]).toEqual([400, 'CODE_EXPIRED']);
    }
    expect(await User.countDocuments()).toBe(0);
    expect((await EmailCode.find().lean()).map((row) => row.attempts)).toEqual([0, 0]);
  });
});

describe('a taken address and a failed send', () => {
  test('TC-F1-46 registering an address that has an account is 409 EMAIL_TAKEN with no mail and no row, in any letter case', async () => {
    await User.create({ name: 'Old', email: 'taken@example.com', passwordHash: 'x' });

    for (const email of ['taken@example.com', 'TAKEN@Example.COM']) {
      const res = await register({ email });
      expect([res.status, res.body.error.code]).toEqual([409, 'EMAIL_TAKEN']);
    }
    expect(sentMail()).toEqual([]);
    expect(await EmailCode.countDocuments()).toBe(0);
  });

  test('TC-F1-46 an address registered while its code was out: verify answers 409 EMAIL_TAKEN and no second user exists', async () => {
    const { email, code, token } = await signUp({ email: 'race@example.com' });
    await User.create({ name: 'First', email, passwordHash: 'x' });

    const res = await verify(email, code, token);

    expect([res.status, res.body.error.code]).toEqual([409, 'EMAIL_TAKEN']);
    expect(await User.countDocuments({ email })).toBe(1);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('TC-F1-46 when the mail cannot be sent register answers 503 EMAIL_SEND_FAILED and leaves no row', async () => {
    failNextSend();

    const res = await register();

    expect([res.status, res.body.error.code]).toEqual([503, 'EMAIL_SEND_FAILED']);
    expect(await EmailCode.countDocuments()).toBe(0);
    expect(await User.countDocuments()).toBe(0);
    expect((await register()).status).toBe(202); // nothing is left to block a retry
  });

  test('TC-F1-46 a failed send does not delete a sign-up that a newer register wrote meanwhile', async () => {
    // The first register's send is slow and fails after a second register replaced the row.
    let release;
    sendCode.mockImplementationOnce(() => new Promise((_, reject) => (release = () => reject(new Error('the email could not be sent')))));
    const first = register().then((res) => res); // .then() sends it
    await vi.waitFor(() => expect(release).toBeDefined());
    await age(61);
    const second = await register();
    expect(second.status).toBe(202);

    release();
    expect((await first).body.error.code).toBe('EMAIL_SEND_FAILED');

    expect(await EmailCode.countDocuments()).toBe(1); // the newer sign-up is still there
    expect((await verify('lan@example.com', lastCode('lan@example.com'), second.body.signupToken)).status).toBe(201);
  });
});

describe('wrong tries, expiry and the race', () => {
  test('TC-F1-47 5 wrong codes answer CODE_INVALID with 4, 3, 2, 1, 0 tries left, then even the right code is CODE_EXPIRED', async () => {
    const { email, code, token } = await signUp();

    for (const attemptsLeft of [4, 3, 2, 1, 0]) {
      const res = await verify(email, wrongCode(code), token);
      expect([res.status, res.body.error.code, res.body.error.details]).toEqual([400, 'CODE_INVALID', { attemptsLeft }]);
    }
    const dead = await verify(email, code, token);

    expect([dead.status, dead.body.error.code]).toEqual([400, 'CODE_EXPIRED']);
    expect(await User.countDocuments()).toBe(0);
  });

  test('TC-F1-47 the 5th try can still be the right one', async () => {
    const { email, code, token } = await signUp();
    for (let i = 0; i < 4; i += 1) expect((await verify(email, wrongCode(code), token)).status).toBe(400);

    expect((await verify(email, code, token)).status).toBe(201);
  });

  test('TC-F1-47 a code is CODE_EXPIRED after 10 minutes, even the right one', async () => {
    const { email, code, token } = await signUp();
    await age(10 * 60 + 1);

    const res = await verify(email, code, token);

    expect([res.status, res.body.error.code]).toEqual([400, 'CODE_EXPIRED']);
    expect(await User.countDocuments()).toBe(0);
  });

  test('TC-F1-47 no pending sign-up at all is CODE_EXPIRED too', async () => {
    const res = await verify('nobody@example.com', '123456', 'token');

    expect([res.status, res.body.error.code]).toEqual([400, 'CODE_EXPIRED']);
  });

  test('TC-F1-47 the same right code sent twice at once makes one user: one 201 and one CODE_EXPIRED', async () => {
    const { email, code, token } = await signUp();

    const answers = await Promise.all([verify(email, code, token), verify(email, code, token)]);

    expect(answers.map((res) => res.status).sort()).toEqual([201, 400]);
    expect(answers.find((res) => res.status === 400).body.error.code).toBe('CODE_EXPIRED');
    expect(await User.countDocuments()).toBe(1);
    expect(await Wallet.countDocuments()).toBe(1);
    expect(await Session.countDocuments()).toBe(1);
  });
});

describe('resend', () => {
  test('TC-F1-48 a resend right after register is 429 RATE_LIMITED with retryAfter seconds and sends nothing', async () => {
    await signUp();

    const res = await resend('lan@example.com');

    expect([res.status, res.body.error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(res.body.error.details.retryAfter).toBeGreaterThan(55);
    expect(res.body.error.details.retryAfter).toBeLessThanOrEqual(60);
    expect(sentMail()).toHaveLength(1);
  });

  test('TC-F1-48 after 61 s a resend answers 202 { resendAfter: 60 } with a new code, and the old code no longer works', async () => {
    const { email, code: oldCode, token } = await signUp();
    await age(61);

    const res = await resend(email);

    expect([res.status, res.body]).toEqual([202, { resendAfter: 60 }]);
    expect(sentMail()).toHaveLength(2);
    const newCode = lastCode(email);
    expect(newCode).not.toBe(oldCode);
    expect(sentMail().at(-1)).toMatchObject({ to: email, purpose: 'signup', language: 'vi' });
    const old = await verify(email, oldCode, token);
    expect([old.status, old.body.error.code, old.body.error.details]).toEqual([400, 'CODE_INVALID', { attemptsLeft: 4 }]);
    expect((await verify(email, newCode, token)).status).toBe(201); // the same token: the resend kept it
  });

  test('TC-F1-48 a resend resets the tries: 4 wrong codes, a resend, then 5 more tries', async () => {
    const { email, code, token } = await signUp();
    for (let i = 0; i < 4; i += 1) await verify(email, wrongCode(code), token);
    await age(61);
    await resend(email);

    const res = await verify(email, wrongCode(lastCode(email)), token);

    expect(res.body.error.details).toEqual({ attemptsLeft: 4 });
  });

  test('TC-F1-48 registering again counts as a send: a resend right after it is 429', async () => {
    await signUp();
    await age(61);
    await signUp(); // the second register

    const res = await resend('lan@example.com');

    expect(res.status).toBe(429);
    expect(sentMail()).toHaveLength(2);
  });

  test('TC-F1-48 registering again within 60 s is 429 and does not replace the pending sign-up', async () => {
    const first = await signUp({ name: 'A' });

    const again = await register({ name: 'B' });

    expect([again.status, again.body.error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(again.body.error.details.retryAfter).toBeGreaterThan(0);
    expect(sentMail()).toHaveLength(1);
    expect((await verify(first.email, first.code, first.token)).body.user.name).toBe('A');
  });

  test('TC-F1-48 the 6th send within an hour is 429, and sends work again once the hour has passed', async () => {
    const { email } = await signUp(); // send 1
    for (let i = 0; i < 4; i += 1) {
      await age(61);
      expect((await resend(email)).status).toBe(202); // sends 2 to 5
      await resetLoginLimit(); // the per-IP limit is another test
    }
    await age(61);

    const sixth = await resend(email);

    expect([sixth.status, sixth.body.error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(sixth.body.error.details.retryAfter).toBeGreaterThan(60);
    expect(sentMail()).toHaveLength(5);
    await age(3600);
    expect((await resend(email)).status).toBe(202);
  });

  test('TC-F1-48 a resend for an address with no pending sign-up (D5): 202 every time, no row, no mail, and register then works', async () => {
    for (let i = 0; i < 6; i += 1) {
      const res = await resend('ghost@example.com');
      expect([res.status, res.body]).toEqual([202, { resendAfter: 60 }]);
    }
    expect(sentMail()).toEqual([]);
    expect(await EmailCode.countDocuments()).toBe(0);

    expect((await register({ email: 'ghost@example.com' })).status).toBe(202);
  });

  test('TC-F1-48 a resend for an address that has an account also sends nothing and answers the same 202', async () => {
    await User.create({ name: 'Old', email: 'taken@example.com', passwordHash: 'x' });

    const res = await resend('taken@example.com');

    expect([res.status, res.body]).toEqual([202, { resendAfter: 60 }]);
    expect(sentMail()).toEqual([]);
  });

  test('TC-F1-48 a sign-up row that outlived its hour (TTL not swept yet) counts as nothing pending', async () => {
    const { email } = await signUp();
    await age(3601);

    const res = await resend(email);

    expect([res.status, res.body]).toEqual([202, { resendAfter: 60 }]);
    expect(sentMail()).toHaveLength(1);
  });

  test('TC-F1-48 after 60 s, 5 parallel resends send one mail: one 202, four 429', async () => {
    const { email } = await signUp();
    await age(61);

    const answers = await Promise.all(Array.from({ length: 5 }, () => resend(email)));

    expect(answers.map((res) => res.status).sort()).toEqual([202, 429, 429, 429, 429]);
    expect(sentMail()).toHaveLength(2); // the register's mail and one resend
  });

  test('TC-F1-48 a resend whose mail fails still answers 202 (D6) and keeps the sign-up data and the token', async () => {
    const { email, token } = await signUp({ name: 'Lan' });
    await age(61);
    failNextSend();

    const res = await resend(email);

    expect([res.status, res.body]).toEqual([202, { resendAfter: 60 }]);
    expect(sentMail()).toHaveLength(2); // the send was tried; its code replaced the old one
    expect((await EmailCode.findOne().lean()).sends).toHaveLength(2); // and it counts toward the limits
    const done = await verify(email, lastCode(email), token);
    expect([done.status, done.body.user.name]).toEqual([201, 'Lan']);
  });

  test('TC-F1-48 a resend with mail off is 503 FEATURE_NOT_CONFIGURED', async () => {
    env.NODE_ENV = 'production'; // production without GMAIL_*: codes are off

    const res = await resend('lan@example.com');

    expect([res.status, res.body.error.code]).toEqual([503, 'FEATURE_NOT_CONFIGURED']);
  });

  test('TC-F1-48 a resend checks its body', async () => {
    const res = await post('register/resend', { email: 'not-an-email' });

    expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  });
});

describe('mail rate limit', () => {
  test('TC-F1-49 the 11th code request from one IP in 15 minutes is 429 with retryAfter and no mail; another IP is not limited', async () => {
    for (let i = 0; i < 10; i += 1) expect((await register({ email: `n${i}@example.com` }, '203.0.113.7')).status).toBe(202);

    const eleventh = await register({ email: 'n10@example.com' }, '203.0.113.7');

    expect([eleventh.status, eleventh.body.error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(eleventh.body.error.details.retryAfter).toBeGreaterThan(0);
    expect(eleventh.body.error.details.retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(sentMail()).toHaveLength(10);
    expect((await register({ email: 'n11@example.com' }, '203.0.113.8')).status).toBe(202);
    mailRateLimit.resetKey('203.0.113.7'); // what 15 minutes do
    expect((await register({ email: 'n12@example.com' }, '203.0.113.7')).status).toBe(202);
  });

  test('TC-F1-49 register and resend share one count, and a resend that answers 202 or 429 counts too', async () => {
    for (let i = 0; i < 5; i += 1) await register({ email: `n${i}@example.com` }, '203.0.113.9'); // 5 registers
    for (let i = 0; i < 4; i += 1) await resend(`n${i}@example.com`, '203.0.113.9'); // 4 resends (429: too early)
    await resend('ghost@example.com', '203.0.113.9'); // the 10th: a 202 with nothing sent

    const res = await resend('n0@example.com', '203.0.113.9');

    expect([res.status, res.body.error.code]).toEqual([429, 'RATE_LIMITED']);
    expect(res.body.error.details.retryAfter).toBeGreaterThan(60); // the IP wait, not the 60 s address wait
  });

  test('TC-F1-49 verify has no per-IP limit (D7): 15 wrong guesses from one IP are all answered by the code check', async () => {
    const answers = [];
    for (let i = 0; i < 15; i += 1) answers.push((await verify('nobody@example.com', '123456', 'token', '203.0.113.20')).status);

    expect(answers).toEqual(Array(15).fill(400));
  });

  test('TC-F1-49 the old login limit stays: register still answers 429 after 10 failed attempts from one IP', async () => {
    for (let i = 0; i < 10; i += 1) expect((await register({ email: 'bad' }, '203.0.113.30')).status).toBe(400);
    mailRateLimit.resetKey('203.0.113.30'); // only authRateLimit is left to answer

    const res = await register({ email: 'ok@example.com' }, '203.0.113.30');

    expect([res.status, res.body.error.code]).toEqual([429, 'RATE_LIMITED']);
  });
});

describe('storage and logs', () => {
  test('TC-F1-50 the database holds no code, no password and no token in plain text', async () => {
    const { email, code, token } = await signUp();
    const [row] = await EmailCode.collection.find().toArray();

    const stored = JSON.stringify(row);
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(token);
    expect(Object.values(row)).not.toContain(code);
    expect(row.codeHash).toBe(sha256(code));
    expect(row.signup.tokenHash).toBe(sha256(token));

    await verify(email, code, token);
    const users = JSON.stringify(await User.collection.find().toArray());
    expect(users).not.toContain(PASSWORD);
    expect(users).not.toContain(token);
  });

  test('TC-F1-50 in production with mail on, a whole sign-up logs no code, password or token, and the address only masked', async () => {
    const { sendCode: realSend, setMailSender } = await vi.importActual('../src/services/mail.js');
    const delivered = [];
    setMailSender(async (asked) => void delivered.push(asked)); // the real mailer, delivery replaced
    sendCode.mockImplementation((asked) => realSend(asked));
    Object.assign(env, { NODE_ENV: 'production', GMAIL_USER: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcdefghijklmnop' });

    let code;
    let token;
    const logs = await captureLogs(async () => {
      const res = await register();
      expect(res.status).toBe(202);
      token = res.body.signupToken;
      code = delivered[0].code;
      await age(61);
      expect((await resend('lan@example.com')).status).toBe(202);
      expect((await verify('lan@example.com', delivered.at(-1).code, token)).status).toBe(201);
      expect((await verify('lan@example.com', '000000', token)).status).toBe(400); // no live row: CODE_EXPIRED
    });
    setMailSender(undefined);

    expect(delivered).toHaveLength(2);
    for (const secret of [code, delivered[1].code, PASSWORD, token, 'lan@example.com']) expect(logs).not.toContain(secret);
  });

  test('TC-F1-50 a refused send logs only the masked address and the error code, never the code or the full address', async () => {
    const { sendCode: realSend, setMailSender } = await vi.importActual('../src/services/mail.js');
    let code;
    setMailSender(async (asked) => {
      code = asked.code;
      throw Object.assign(new Error(`535 rejected ${asked.to} with ${asked.code}`), { code: 'EAUTH', responseCode: 535 });
    });
    sendCode.mockImplementation((asked) => realSend(asked));
    Object.assign(env, { NODE_ENV: 'production', GMAIL_USER: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcdefghijklmnop' });

    let res;
    const logs = await captureLogs(async () => {
      res = await register();
    });
    setMailSender(undefined);

    expect([res.status, res.body.error.code]).toEqual([503, 'EMAIL_SEND_FAILED']);
    expect(logs).toContain('[mail] send failed for l***@example.com: EAUTH 535');
    for (const secret of [code, 'lan@example.com', PASSWORD]) expect(logs).not.toContain(secret);
    expect(JSON.stringify(res.body)).not.toContain('lan@example.com');
  });

  test('TC-F1-50 a resend that fails logs the same safe line and no code or address', async () => {
    const { sendCode: realSend, setMailSender } = await vi.importActual('../src/services/mail.js');
    let fail = false;
    const tried = [];
    setMailSender(async (asked) => {
      tried.push(asked.code);
      if (fail) throw Object.assign(new Error(`rejected ${asked.to} ${asked.code}`), { code: 'ECONNECTION' });
    });
    sendCode.mockImplementation((asked) => realSend(asked));
    Object.assign(env, { NODE_ENV: 'production', GMAIL_USER: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcdefghijklmnop' });
    await signUp();
    await age(61);
    fail = true;

    let res;
    const logs = await captureLogs(async () => {
      res = await resend('lan@example.com');
      await vi.waitFor(() => expect(tried).toHaveLength(2));
      await new Promise((resolve) => setTimeout(resolve, 20)); // the background send ends and logs
    });
    setMailSender(undefined);

    expect(res.status).toBe(202);
    expect(logs).toContain('[mail] send failed for l***@example.com: ECONNECTION');
    for (const secret of [...tried, 'lan@example.com']) expect(logs).not.toContain(secret);
  });
});

describe('no mail configured', () => {
  test('TC-F1-51 in production without GMAIL_* 11 sign-ups from one IP all answer 201, logged in, with no code and no row', async () => {
    env.NODE_ENV = 'production';

    for (let i = 0; i < 11; i += 1) {
      const res = await register({ email: `p${i}@example.com`, name: `P${i}` }, '203.0.113.50');
      expect(res.status).toBe(201);
      expect(res.headers['set-cookie'].some((c) => c.startsWith('rt='))).toBe(true);
      expect(res.body.user.email).toBe(`p${i}@example.com`);
    }

    expect(await User.countDocuments()).toBe(11);
    expect(await EmailCode.countDocuments()).toBe(0);
    expect(sentMail()).toEqual([]);
    expect(await Wallet.countDocuments()).toBe(11);
  });

  test('TC-F1-51 in production with only one of the two settings codes are off too', async () => {
    Object.assign(env, { NODE_ENV: 'production', GMAIL_USER: 'sender@gmail.com' });

    expect((await register()).status).toBe(201);
  });

  test('TC-F1-51 with mail off a taken address is still 409 and verify checks as normal (CODE_EXPIRED, no row)', async () => {
    env.NODE_ENV = 'production';
    expect((await register()).status).toBe(201);

    const taken = await register();
    const verified = await verify('lan@example.com', '123456', 'token');

    expect([taken.status, taken.body.error.code]).toEqual([409, 'EMAIL_TAKEN']);
    expect([verified.status, verified.body.error.code]).toEqual([400, 'CODE_EXPIRED']);
  });

  test('TC-F1-51 in development without GMAIL_* the real mailer writes the code to the log and the flow completes from that line', async () => {
    const { sendCode: realSend } = await vi.importActual('../src/services/mail.js');
    sendCode.mockImplementation((asked) => realSend(asked));
    env.NODE_ENV = 'development';
    let token;

    const logs = await captureLogs(async () => {
      token = (await register()).body.signupToken;
    });

    const code = /\[mail\] signup code for l\*\*\*@example\.com: (\d{6})/.exec(logs)?.[1];
    expect(code).toBeDefined();
    expect((await verify('lan@example.com', code, token)).status).toBe(201);
  });
});

describe('indexes', () => {
  test('TC-NF-26 emailCodes has a unique index on (purpose, email) and a TTL index on expiresAt', async () => {
    const indexes = await EmailCode.collection.indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: { purpose: 1, email: 1 }, unique: true }),
        expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
      ]),
    );
  });

  test('TC-NF-26 two sign-up rows for one address cannot exist, but a sign-up and a reset row can', async () => {
    const row = (purpose) => ({ purpose, email: 'a@example.com', codeHash: 'h', codeExpiresAt: new Date(), expiresAt: new Date(Date.now() + 1000) });
    await EmailCode.create(row('signup'));
    await EmailCode.create(row('reset'));

    await expect(EmailCode.create(row('signup'))).rejects.toMatchObject({ code: 11000 });
  });
});

describe('the Vitest mail mock', () => {
  beforeEach(() => {
    sendCode.mockClear();
  });

  test('TC-NF-27 every test file starts with the mailer replaced: vitest.config.js lists the setup file and sendCode is a recorder', async () => {
    const { default: config } = await import('../vitest.config.js');
    expect(config.test.setupFiles).toContain('./test/helpers/mail-mock.js');
    expect(vi.isMockFunction(sendCode)).toBe(true);
    expect(await sendCode({ to: 'x@example.com', purpose: 'signup', code: '123456', language: 'vi' })).toBeUndefined();
    expect(sentMail()).toEqual([{ to: 'x@example.com', purpose: 'signup', code: '123456', language: 'vi' }]);
  });
});
