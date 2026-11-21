import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { Session } from '../src/models/Session.js';
import { User } from '../src/models/User.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { claimsOf, loginAs, refresh, refreshCookie, registerUser, resetLoginLimit } from './helpers/auth.js';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Session.init()]); // wait for the unique indexes before testing them
});
afterEach(async () => {
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(stopTestDb);

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

describe('register', () => {
  test('TC-F1-01 register stores a bcrypt hash and opens a session', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Lan', email: 'Lan@Example.com', password: 'correct-horse-1' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Lan', email: 'lan@example.com', role: 'user', status: 'active', language: 'vi', theme: 'system' });
    expect(res.body.user.id).toMatch(/^[0-9a-f]{24}$/);
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('rt='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/Max-Age=604800/); // 7 days

    const user = await User.findOne({ email: 'lan@example.com' }).select('+passwordHash');
    expect(user.passwordHash).toMatch(/^\$2[aby]\$10\$/); // bcrypt, cost 10
    expect(user.passwordHash).not.toContain('correct-horse-1');

    const sessions = await Session.find({ userId: user._id });
    expect(sessions).toHaveLength(1);
    const token = refreshCookie(res).slice('rt='.length);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    expect(sessions[0].tokenHash).toBe(sha256(token)); // only the hash is stored
    expect(sessions[0].revokedAt).toBeNull();

    const claims = jwt.verify(res.body.accessToken, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    expect(claims).toMatchObject({ sub: String(user._id), role: 'user', sid: String(sessions[0]._id) });
    expect(claims.exp - claims.iat).toBe(15 * 60);
  });

  test('TC-F1-01 register rejects a bad email, a short password or a missing name with 400', async () => {
    const bad = [
      { name: 'Lan', email: 'not-an-email', password: 'correct-horse-1' },
      { name: 'Lan', email: 'lan@example.com', password: 'short' },
      { email: 'lan@example.com', password: 'correct-horse-1' },
    ];
    for (const body of bad) {
      const res = await request(app).post('/api/auth/register').send(body);
      expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
    }
    expect(await User.countDocuments()).toBe(0);
  });

  test('TC-F1-02 duplicate email (any letter case) is rejected with 409 EMAIL_TAKEN', async () => {
    await registerUser({ email: 'dup@example.com' });

    const res = await request(app).post('/api/auth/register').send({ name: 'Other', email: 'DUP@Example.COM', password: 'another-pass-2' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(await User.countDocuments()).toBe(1);
  });
});

describe('login', () => {
  test('TC-F1-03 wrong password and unknown email look the same', async () => {
    const { email } = await registerUser();

    const wrongPassword = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password' });

    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Wrong email or password' } });
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  test('TC-F1-03 the right password logs in with any letter case of the email and opens a second session', async () => {
    const { email, password, user } = await registerUser();

    const res = await request(app).post('/api/auth/login').send({ email: email.toUpperCase(), password });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(claimsOf(res.body.accessToken).sub).toBe(user.id);
    expect(refreshCookie(res)).toMatch(/^rt=/);
    expect(await Session.countDocuments({ userId: user.id })).toBe(2);
  });

  test('TC-F1-07 login is rate-limited after 10 failed attempts from one IP', async () => {
    const { email, password } = await registerUser();
    const login = (ip, body) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send(body);

    // Successful logins do not count towards the limit.
    for (let i = 0; i < 3; i += 1) expect((await login('203.0.113.7', { email, password })).status).toBe(200);
    for (let i = 0; i < 10; i += 1) expect((await login('203.0.113.7', { email, password: 'guess-' + i })).status).toBe(401);

    const blocked = await login('203.0.113.7', { email, password: 'guess-10' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    // The right password is blocked too while the window lasts; another IP is not affected.
    expect((await login('203.0.113.7', { email, password })).status).toBe(429);
    expect((await login('198.51.100.9', { email, password })).status).toBe(200);
  });

  test('TC-F1-09 a locked user cannot log in or refresh', async () => {
    const { user, email, password, cookie } = await registerUser();
    await User.updateOne({ _id: user.id }, { status: 'locked' }); // what the admin lock does (T15)

    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_LOCKED');

    // A wrong password still answers 401, so the lock is only revealed to someone who knows the password.
    const wrong = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' });
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const res = await refresh(cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('access token (requireAuth)', () => {
  test('TC-F1-04 protected routes need a valid JWT', async () => {
    const { accessToken, user } = await registerUser();
    const [header, , signature] = accessToken.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...claimsOf(accessToken), role: 'admin' })).toString('base64url');
    const tampered = `${header}.${forgedPayload}.${signature}`;
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${forgedPayload}.`;
    const expired = jwt.sign({ sub: user.id, role: 'user', sid: claimsOf(accessToken).sid, exp: Math.floor(Date.now() / 1000) - 60 }, env.JWT_ACCESS_SECRET);
    const get = (auth) => request(app).get('/api/sessions').set('Authorization', auth);

    const cases = [
      [await request(app).get('/api/sessions'), 'UNAUTHENTICATED'],
      [await get(`Bearer ${tampered}`), 'UNAUTHENTICATED'],
      [await get(`Bearer ${unsigned}`), 'UNAUTHENTICATED'],
      [await get(accessToken), 'UNAUTHENTICATED'], // no "Bearer " prefix
      [await get(`Bearer ${expired}`), 'TOKEN_EXPIRED'],
    ];
    for (const [res, code] of cases) {
      expect([res.status, res.body.error.code]).toEqual([401, code]);
    }

    const ok = await get(`Bearer ${accessToken}`);
    expect(ok.status).toBe(200);
  });

  test('TC-F1-04 GET /auth/me returns the logged-in user', async () => {
    const { accessToken, user } = await registerUser({ name: 'Minh' });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    const anonymous = await request(app).get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, name: 'Minh' });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(anonymous.status).toBe(401);
  });
});

describe('refresh and logout', () => {
  test('TC-F1-05 refresh rotates the token and detects reuse', async () => {
    const { cookie: cookieA, user } = await registerUser();

    const first = await refresh(cookieA);
    expect(first.status).toBe(200);
    expect(first.body.user.id).toBe(user.id);
    const cookieB = refreshCookie(first);
    expect(cookieB).toMatch(/^rt=/);
    expect(cookieB).not.toBe(cookieA);

    const oldSession = await Session.findOne({ tokenHash: sha256(cookieA.slice(3)) });
    const newSession = await Session.findOne({ tokenHash: sha256(cookieB.slice(3)) });
    expect(oldSession.revokedAt).not.toBeNull();
    expect(String(oldSession.replacedBy)).toBe(String(newSession._id));
    expect(claimsOf(first.body.accessToken).sid).toBe(String(newSession._id));

    // B is used (rotated to C), then someone presents the already rotated token A again: it was probably stolen.
    const second = await refresh(cookieB);
    expect(second.status).toBe(200);
    const cookieC = refreshCookie(second);
    const reuse = await refresh(cookieA);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('INVALID_REFRESH');

    // Every session of the user is revoked, so C (the legitimate holder's newest token) fails too.
    expect((await refresh(cookieC)).status).toBe(401);
    expect(await Session.countDocuments({ userId: user.id, revokedAt: null })).toBe(0);
  });

  test('TC-F1-05 reuse outside the 30 s grace window is theft even if the replacement was never used', async () => {
    const { cookie: cookieA, user } = await registerUser();
    const cookieB = refreshCookie(await refresh(cookieA));
    // A was rotated 31 s ago.
    await Session.updateOne({ tokenHash: sha256(cookieA.slice(3)) }, { revokedAt: new Date(Date.now() - 31_000) });

    expect((await refresh(cookieA)).status).toBe(401);
    expect((await refresh(cookieB)).status).toBe(401);
    expect(await Session.countDocuments({ userId: user.id, revokedAt: null })).toBe(0);
  });

  test('TC-F1-19 a refresh whose answer was lost: the old token works once more within 30 s, one session stays (BUG-003)', async () => {
    const { cookie: cookieA, user, email, password } = await registerUser();
    const other = await loginAs({ email, password }); // the same user on a second device
    const lost = await refresh(cookieA); // rotated A → B, but the browser never got B (navigation, reload, network drop)
    const cookieB = refreshCookie(lost);

    const again = await refresh(cookieA);
    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(user.id);
    const cookieC = refreshCookie(again);
    expect(cookieC).not.toBe(cookieB);

    // The unused B is revoked so only one chain stays alive; C keeps working; the other device was not touched.
    expect((await Session.findOne({ tokenHash: sha256(cookieB.slice(3)) })).revokedAt).not.toBeNull();
    const cookieD = refreshCookie(await refresh(cookieC));
    expect(cookieD).toMatch(/^rt=/);
    expect((await refresh(other.cookie)).status).toBe(200);
    // A third try with A is theft now (its replacement C was used): every session is revoked.
    expect((await refresh(cookieA)).status).toBe(401);
    expect(await Session.countDocuments({ userId: user.id, revokedAt: null })).toBe(0);
  });

  test('TC-F1-05 refresh without a cookie, with an unknown token or after expiry answers 401 INVALID_REFRESH', async () => {
    const { cookie, user } = await registerUser();
    await Session.updateOne({ userId: user.id }, { expiresAt: new Date(Date.now() - 1000) });

    for (const res of [await refresh(undefined), await refresh('rt=not-a-real-token'), await refresh('rt=j:{"a":1}'), await refresh(cookie)]) {
      expect([res.status, res.body.error.code]).toEqual([401, 'INVALID_REFRESH']);
    }
  });

  test('TC-F1-06 logout revokes the session and clears the cookie', async () => {
    const me = await registerUser();
    const other = await loginAs(me);
    const { cookie } = me;

    const res = await request(app).post('/api/auth/logout').set('Cookie', cookie);

    expect(res.status).toBe(204);
    const cleared = res.headers['set-cookie'].find((c) => c.startsWith('rt='));
    expect(cleared).toMatch(/^rt=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/Path=\/api\/auth/);

    const again = await refresh(cookie);
    expect([again.status, again.body.error.code]).toEqual([401, 'INVALID_REFRESH']);
    // Only this device was logged out; the other one still refreshes.
    expect((await refresh(other.cookie)).status).toBe(200);
  });

  test('TC-F1-06 logout without a cookie still answers 204', async () => {
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(204);
  });
});

describe('sessions', () => {
  test('TC-F1-10 log out other devices', async () => {
    const device1 = await registerUser();
    const device2 = await loginAs(device1);
    const auth1 = `Bearer ${device1.accessToken}`;

    const list = await request(app).get('/api/sessions').set('Authorization', auth1);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body.find((s) => s.current)).toMatchObject({ userAgent: 'device-1' });
    expect(list.body.find((s) => !s.current)).toMatchObject({ userAgent: 'device-2' });
    expect(Object.keys(list.body[0]).sort()).toEqual(['current', 'id', 'ip', 'lastUsedAt', 'userAgent']);

    const res = await request(app).delete('/api/sessions?others=true').set('Authorization', auth1);
    expect(res.status).toBe(204);

    const device2Refresh = await refresh(device2.cookie);
    expect([device2Refresh.status, device2Refresh.body.error.code]).toEqual([401, 'INVALID_REFRESH']);
    // Device 1 still works, and device 2's failed refresh did not count as token theft.
    const device1Refresh = await refresh(device1.cookie);
    expect(device1Refresh.status).toBe(200);
    const after = await request(app).get('/api/sessions').set('Authorization', `Bearer ${device1Refresh.body.accessToken}`);
    expect(after.body).toHaveLength(1);
    expect(after.body[0].current).toBe(true);
  });

  test('TC-F1-10 DELETE /sessions without others=true is rejected with 400', async () => {
    const { accessToken } = await registerUser();

    const res = await request(app).delete('/api/sessions').set('Authorization', `Bearer ${accessToken}`);

    expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  });

  test('TC-F1-10 a user can revoke one of their sessions but not another user\'s', async () => {
    const userA = await registerUser();
    const phone = await loginAs(userA, 'phone');
    const userB = await registerUser();
    const sessionsOfA = await request(app).get('/api/sessions').set('Authorization', `Bearer ${userA.accessToken}`);
    const phoneSession = sessionsOfA.body.find((s) => s.userAgent === 'phone');

    const byB = await request(app).delete(`/api/sessions/${phoneSession.id}`).set('Authorization', `Bearer ${userB.accessToken}`);
    expect([byB.status, byB.body.error.code]).toEqual([404, 'NOT_FOUND']);
    expect((await Session.findById(phoneSession.id)).revokedAt).toBeNull(); // untouched

    const byA = await request(app).delete(`/api/sessions/${phoneSession.id}`).set('Authorization', `Bearer ${userA.accessToken}`);
    expect(byA.status).toBe(204);
    expect((await refresh(phone.cookie)).status).toBe(401);
    expect((await refresh(userA.cookie)).status).toBe(200); // the device that revoked it is not affected
    const again = await request(app).delete(`/api/sessions/${phoneSession.id}`).set('Authorization', `Bearer ${userA.accessToken}`);
    expect(again.status).toBe(404);

    const badId = await request(app).delete('/api/sessions/not-an-id').set('Authorization', `Bearer ${userA.accessToken}`);
    expect([badId.status, badId.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  });
});
