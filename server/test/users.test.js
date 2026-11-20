import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import { requireAuth } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/error.js';
import { requireRole } from '../src/middleware/requireRole.js';
import { User } from '../src/models/User.js';
import { seedUsers } from '../src/services/users.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { loginAs, refresh, registerUser, resetLoginLimit } from './helpers/auth.js';

beforeAll(async () => {
  await startTestDb();
  await User.init();
});
afterEach(async () => {
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(stopTestDb);

const patchMe = (accessToken, body) => request(app).patch('/api/users/me').set('Authorization', `Bearer ${accessToken}`).send(body);

test('TC-F1-11 a user updates their name and preferences; role and email cannot be changed this way', async () => {
  const { accessToken, user } = await registerUser({ email: 'me@example.com' });

  const res = await patchMe(accessToken, { name: '  Lan Anh  ', language: 'en', theme: 'dark', role: 'admin', email: 'x@example.com' });

  expect(res.status).toBe(200);
  expect(res.body.user).toMatchObject({ id: user.id, name: 'Lan Anh', language: 'en', theme: 'dark', role: 'user', email: 'me@example.com' });
  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
  expect(me.body.user).toMatchObject({ language: 'en', theme: 'dark' });

  for (const bad of [{ theme: 'blue' }, { language: 'fr' }, { name: '' }, { name: 'x'.repeat(61) }, { defaultWalletId: 'abc' }]) {
    const r = await patchMe(accessToken, bad);
    expect([r.status, r.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  }
});

test('TC-F1-11 the default wallet must be one of the user\'s own wallets', async () => {
  const userA = await registerUser();
  const userB = await registerUser();
  // The wallets collection belongs to T05; insert raw documents shaped like docs/03.
  const wallets = mongoose.connection.collection('wallets');
  const { insertedId: walletOfA } = await wallets.insertOne({ userId: new mongoose.Types.ObjectId(userA.user.id), name: 'Cash', deletedAt: null });
  const { insertedId: deletedWalletOfA } = await wallets.insertOne({ userId: new mongoose.Types.ObjectId(userA.user.id), name: 'Old', deletedAt: new Date() });

  const own = await patchMe(userA.accessToken, { defaultWalletId: String(walletOfA) });
  expect(own.status).toBe(200);
  expect(own.body.user.defaultWalletId).toBe(String(walletOfA));

  const notMine = await patchMe(userB.accessToken, { defaultWalletId: String(walletOfA) });
  expect([notMine.status, notMine.body.error.code]).toEqual([404, 'NOT_FOUND']);
  const deleted = await patchMe(userA.accessToken, { defaultWalletId: String(deletedWalletOfA) });
  expect(deleted.status).toBe(404);

  const cleared = await patchMe(userA.accessToken, { defaultWalletId: null });
  expect(cleared.body.user.defaultWalletId).toBeNull();
});

test('TC-F1-12 changing the password checks the current one and logs out the other devices', async () => {
  const laptop = await registerUser({ password: 'old-password-1' });
  const phone = await loginAs(laptop);
  const change = (body) => request(app).patch('/api/users/me/password').set('Authorization', `Bearer ${laptop.accessToken}`).send(body);

  const wrong = await change({ currentPassword: 'not-my-password', newPassword: 'new-password-2' });
  expect([wrong.status, wrong.body.error.code]).toEqual([401, 'INVALID_CREDENTIALS']);
  const tooShort = await change({ currentPassword: 'old-password-1', newPassword: 'short' });
  expect(tooShort.status).toBe(400);

  const ok = await change({ currentPassword: 'old-password-1', newPassword: 'new-password-2' });
  expect(ok.status).toBe(204);

  expect((await refresh(phone.cookie)).status).toBe(401); // other device logged out
  expect((await refresh(laptop.cookie)).status).toBe(200); // this device stays logged in
  const login = (password) => request(app).post('/api/auth/login').send({ email: laptop.email, password });
  expect((await login('old-password-1')).status).toBe(401);
  expect((await login('new-password-2')).status).toBe(200);
});

test('TC-F1-13 requireRole(\'admin\') lets admins through and answers 403 FORBIDDEN to everyone else', async () => {
  const adminOnly = express()
    .get('/admin-only', requireAuth, requireRole('admin'), (req, res) => res.json({ ok: true }))
    .use(errorHandler);
  const { accessToken: userToken } = await registerUser();
  const admin = await registerUser();
  await User.updateOne({ _id: admin.user.id }, { role: 'admin' });
  const { accessToken: adminToken } = await refresh(admin.cookie).then((r) => r.body); // new token carries the new role

  const asUser = await request(adminOnly).get('/admin-only').set('Authorization', `Bearer ${userToken}`);
  const asAdmin = await request(adminOnly).get('/admin-only').set('Authorization', `Bearer ${adminToken}`);
  const anonymous = await request(adminOnly).get('/admin-only');

  expect([asUser.status, asUser.body.error.code]).toEqual([403, 'FORBIDDEN']);
  expect(asAdmin.status).toBe(200);
  expect(anonymous.status).toBe(401);
});

test('TC-F1-14 seeding creates the admin and test users once and can run again safely', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const source = {
    SEED_ADMIN_EMAIL: 'Admin@Example.com',
    SEED_ADMIN_PASSWORD: 'admin-password-1',
    TEST_USER_A_EMAIL: 'usera@example.com',
    TEST_USER_A_PASSWORD: 'user-a-password',
    TEST_USER_B_EMAIL: 'userb@example.com',
    TEST_USER_B_PASSWORD: 'user-b-password',
  };

  await seedUsers(source); // `npm run seed`: admin only
  expect(await User.find().distinct('email')).toEqual(['admin@example.com']);

  await seedUsers(source, { test: true }); // `npm run seed:test`: admin + userA + userB
  await seedUsers(source, { test: true });
  const users = await User.find().sort({ email: 1 });
  expect(users.map((u) => [u.email, u.role])).toEqual([
    ['admin@example.com', 'admin'],
    ['usera@example.com', 'user'],
    ['userb@example.com', 'user'],
  ]);

  const login = await request(app).post('/api/auth/login').send({ email: 'admin@example.com', password: 'admin-password-1' });
  expect(login.status).toBe(200);
  expect(login.body.user.role).toBe('admin');

  await seedUsers({}, { test: true }); // nothing configured: skipped with a message, no crash
  expect(await User.countDocuments()).toBe(3);
  expect(log).toHaveBeenCalledWith(expect.stringMatching(/SEED_ADMIN_EMAIL/));
  log.mockRestore();
});
