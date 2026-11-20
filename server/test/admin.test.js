import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import { Category } from '../src/models/Category.js';
import { ChatLink } from '../src/models/ChatLink.js';
import { Session } from '../src/models/Session.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { DEFAULT_CATEGORIES } from '../src/seed/templates.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { loginAs, refresh, refreshCookie, registerUser, resetLoginLimit } from './helpers/auth.js';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Wallet.init(), Category.init(), ChatLink.init(), Transaction.init()]);
});
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {}); // "seed: created … templates"
});
afterEach(async () => {
  vi.restoreAllMocks();
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(stopTestDb);

const api = (accessToken) => {
  const call = (method) => (path, body) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${accessToken}`).send(body);
  return { get: call('get'), post: call('post'), patch: call('patch'), delete: call('delete') };
};

// The role lives in the access token, so after the promotion a refresh hands out a token that says "admin".
async function registerAdmin(overrides) {
  const account = await registerUser(overrides);
  await User.updateOne({ _id: account.user.id }, { role: 'admin' });
  const res = await refresh(account.cookie);
  return { ...account, ...res.body, cookie: refreshCookie(res) };
}

const codeOf = (res) => [res.status, res.body.error?.code];

test('TC-F11-01 admin routes need the admin role', async () => {
  const user = api((await registerUser()).accessToken);
  const admin = api((await registerAdmin()).accessToken);
  const someId = new mongoose.Types.ObjectId();

  const asUser = [
    await user.get('/admin/users'),
    await user.patch(`/admin/users/${someId}`, { status: 'locked' }),
    await user.get('/admin/categories'),
    await user.post('/admin/categories', { type: 'expense', names: { vi: 'A', en: 'A' } }),
    await user.patch(`/admin/categories/${someId}`, { keywords: [] }),
    await user.delete(`/admin/categories/${someId}`),
    await user.get('/admin/stats'),
  ];
  for (const res of asUser) expect(codeOf(res)).toEqual([403, 'FORBIDDEN']);

  expect(codeOf(await request(app).get('/api/admin/users'))).toEqual([401, 'UNAUTHENTICATED']);
  expect((await admin.get('/admin/users')).status).toBe(200);
  expect((await admin.get('/admin/stats')).status).toBe(200);
});

test('TC-F11-02 locking a user revokes their sessions; unlocking lets them log in again', async () => {
  const admin = api((await registerAdmin()).accessToken);
  const victim = await registerUser();
  const otherDevice = await loginAs(victim);

  const locked = await admin.patch(`/admin/users/${victim.user.id}`, { status: 'locked' });
  expect(locked.status).toBe(200);
  expect(locked.body).toMatchObject({ id: victim.user.id, status: 'locked', role: 'user' });
  expect(locked.body).not.toHaveProperty('passwordHash');

  expect(codeOf(await refresh(victim.cookie))).toEqual([401, 'INVALID_REFRESH']);
  expect(codeOf(await refresh(otherDevice.cookie))).toEqual([401, 'INVALID_REFRESH']);
  expect(await Session.countDocuments({ userId: victim.user.id, revokedAt: null })).toBe(0);
  const login = await request(app).post('/api/auth/login').send({ email: victim.email, password: victim.password });
  expect(codeOf(login)).toEqual([403, 'ACCOUNT_LOCKED']);

  expect((await admin.patch(`/admin/users/${victim.user.id}`, { status: 'active' })).body.status).toBe('active');
  expect((await request(app).post('/api/auth/login').send({ email: victim.email, password: victim.password })).status).toBe(200);
});

test('TC-F11-03 the last active admin cannot demote or lock themselves', async () => {
  const first = await registerAdmin();
  const me = api(first.accessToken);

  expect(codeOf(await me.patch(`/admin/users/${first.user.id}`, { role: 'user' }))).toEqual([409, 'LAST_ADMIN']);
  expect(codeOf(await me.patch(`/admin/users/${first.user.id}`, { status: 'locked' }))).toEqual([409, 'LAST_ADMIN']);
  expect(await User.findById(first.user.id).lean()).toMatchObject({ role: 'admin', status: 'active' });
  expect(await Session.countDocuments({ userId: first.user.id, revokedAt: null })).toBe(1); // still logged in

  // With a second active admin, either of them may step down.
  const second = await registerUser();
  const promoted = await me.patch(`/admin/users/${second.user.id}`, { role: 'admin' });
  expect(promoted.body).toMatchObject({ role: 'admin', status: 'active' });
  expect((await me.patch(`/admin/users/${first.user.id}`, { role: 'user' })).body.role).toBe('user');

  // A locked admin does not count as one who can still manage the system.
  await User.updateOne({ _id: first.user.id }, { role: 'admin', status: 'locked' });
  expect(codeOf(await me.patch(`/admin/users/${second.user.id}`, { status: 'locked' }))).toEqual([409, 'LAST_ADMIN']);

  // Bad input and unknown users.
  for (const body of [{}, { role: 'root' }, { status: 'deleted' }]) {
    expect(codeOf(await me.patch(`/admin/users/${second.user.id}`, body))).toEqual([400, 'VALIDATION_ERROR']);
  }
  expect(codeOf(await me.patch(`/admin/users/${new mongoose.Types.ObjectId()}`, { role: 'user' }))).toEqual([404, 'NOT_FOUND']);
  expect(codeOf(await me.patch('/admin/users/not-an-id', { role: 'user' }))).toEqual([400, 'VALIDATION_ERROR']);
});

test('TC-F11-04 template edits reach only users who register afterwards', async () => {
  const admin = api((await registerAdmin()).accessToken);
  const existing = await registerUser();

  const templates = await admin.get('/admin/categories?type=expense');
  const food = templates.body.find((t) => t.names.vi === 'Ăn uống');
  const edited = await admin.patch(`/admin/categories/${food.id}`, { keywords: [...food.keywords, 'Bún Bò'] });
  expect(edited.status).toBe(200);
  expect(edited.body.keywords).toContain('bun bo'); // stored the way the parser compares

  const added = await admin.post('/admin/categories', { type: 'expense', names: { vi: 'Thú cưng', en: 'Pets' }, keywords: ['pate'] });
  expect(added.status).toBe(201);
  expect(added.body).toMatchObject({ userId: null, type: 'expense', names: { vi: 'Thú cưng', en: 'Pets' }, isFallback: false });

  const newcomer = await registerUser();
  const expenseOf = async ({ accessToken }) => (await api(accessToken).get('/categories?type=expense')).body;
  const [oldList, newList] = [await expenseOf(existing), await expenseOf(newcomer)];
  const foodIn = (list) => list.find((c) => c.names?.vi === 'Ăn uống');

  expect(foodIn(oldList).keywords).not.toContain('bun bo');
  expect(foodIn(newList).keywords).toContain('bun bo');
  expect(oldList.some((c) => c.names?.vi === 'Thú cưng')).toBe(false);
  expect(newList.some((c) => c.names?.vi === 'Thú cưng')).toBe(true);
});

test('TC-F11-06 admin lists users with search, filters and pages, and sees system-wide counts only', async () => {
  const admin = await registerAdmin({ name: 'Boss', email: 'boss@example.com' });
  const as = api(admin.accessToken);
  const lan = await registerUser({ name: 'Nguyễn Lan', email: 'lan@example.com' });
  const minh = await registerUser({ name: 'Minh', email: 'minh.tran@example.com' });
  await User.updateOne({ _id: minh.user.id }, { status: 'locked' });

  const search = await as.get('/admin/users?q=LAN');
  expect(search.body).toMatchObject({ total: 1, items: [{ id: lan.user.id, name: 'Nguyễn Lan', role: 'user', status: 'active' }] });
  expect(search.body.items[0]).not.toHaveProperty('passwordHash');
  expect((await as.get('/admin/users?q=minh.tran')).body.total).toBe(1); // matches the email
  expect((await as.get('/admin/users?q=.*')).body.total).toBe(0); // typed text, not a regular expression
  expect((await as.get('/admin/users?role=admin')).body.items.map((u) => u.name)).toEqual(['Boss']);
  expect((await as.get('/admin/users?status=locked')).body.items.map((u) => u.name)).toEqual(['Minh']);

  const page2 = await as.get('/admin/users?limit=2&page=2');
  expect(page2.body.total).toBe(3);
  expect(page2.body.items.map((u) => u.name)).toEqual(['Boss']); // newest first: Minh, Nguyễn Lan | Boss
  for (const bad of ['role=root', 'page=0', 'limit=500', 'status=x']) {
    expect(codeOf(await as.get(`/admin/users?${bad}`))).toEqual([400, 'VALIDATION_ERROR']);
  }

  // Stats: Minh has not used the app for 10 days; Lan has a Telegram link and transactions from two sources.
  await Session.updateMany({ userId: minh.user.id }, { lastUsedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) });
  await ChatLink.create({ userId: lan.user.id, platform: 'telegram', platformUserId: '1', chatId: '1' });
  const tx = { userId: lan.user.id, walletId: new mongoose.Types.ObjectId(), categoryId: new mongoose.Types.ObjectId(), type: 'expense', amount: 45000, occurredAt: new Date() };
  await Transaction.create([
    { ...tx, source: 'web' },
    { ...tx, source: 'telegram', status: 'draft' },
    { ...tx, source: 'telegram' },
    { ...tx, source: 'web', deletedAt: new Date() }, // deleted: not counted
  ]);

  const stats = await as.get('/admin/stats');
  expect(stats.body).toEqual({
    users: 3,
    activeUsers7d: 2,
    chatLinks: { telegram: 1, zalo: 0 },
    transactionsBySource: { web: 1, telegram: 2, zalo: 0, receipt: 0 },
  });
});

test('TC-F11-07 default category template CRUD keeps the built-in set and the fallbacks', async () => {
  const as = api((await registerAdmin()).accessToken);
  expect(await Category.countDocuments({ userId: null })).toBe(0); // `npm run seed` has not run

  // Opening the page stores the built-in defaults first, so the admin edits the real set.
  const list = await as.get('/admin/categories');
  expect(list.body.map((t) => t.names.vi)).toEqual([
    ...DEFAULT_CATEGORIES.filter((t) => t.type === 'expense').map((t) => t.names.vi),
    ...DEFAULT_CATEGORIES.filter((t) => t.type === 'income').map((t) => t.names.vi),
  ]);
  expect((await as.get('/admin/categories?type=income')).body.every((t) => t.type === 'income')).toBe(true);
  expect(codeOf(await as.get('/admin/categories?type=transfer'))).toEqual([400, 'VALIDATION_ERROR']);

  for (const bad of [
    { type: 'expense', names: { vi: 'Chỉ tiếng Việt' } },
    { type: 'expense', names: { vi: ' ', en: 'Blank' } },
    { type: 'spending', names: { vi: 'A', en: 'A' } },
    { names: { vi: 'A', en: 'A' } },
  ]) {
    expect(codeOf(await as.post('/admin/categories', bad))).toEqual([400, 'VALIDATION_ERROR']);
  }

  const gifts = list.body.find((t) => t.names.en === 'Gifts');
  const renamed = await as.patch(`/admin/categories/${gifts.id}`, { names: { vi: 'Quà', en: 'Presents' }, color: '#123456', type: 'expense' });
  expect(renamed.body).toMatchObject({ names: { vi: 'Quà', en: 'Presents' }, color: '#123456', type: 'income' }); // type stays

  const fallback = list.body.find((t) => t.isFallback);
  expect(codeOf(await as.delete(`/admin/categories/${fallback.id}`))).toEqual([409, 'FALLBACK_CATEGORY']);
  expect((await as.delete(`/admin/categories/${gifts.id}`)).status).toBe(204);
  expect(codeOf(await as.delete(`/admin/categories/${gifts.id}`))).toEqual([404, 'NOT_FOUND']);
  expect(codeOf(await as.patch(`/admin/categories/${gifts.id}`, { keywords: [] }))).toEqual([404, 'NOT_FOUND']);

  // A user's own category is not a template, so the admin routes cannot touch it.
  const user = await registerUser();
  const ownCategory = (await api(user.accessToken).get('/categories')).body[0];
  expect(codeOf(await as.patch(`/admin/categories/${ownCategory.id}`, { keywords: ['x'] }))).toEqual([404, 'NOT_FOUND']);

  const newcomer = await registerUser();
  const names = (await api(newcomer.accessToken).get('/categories?type=income')).body.map((c) => c.names?.en);
  expect(names).not.toContain('Presents'); // deleted templates are not copied
  expect(names).toContain('Other income'); // the fallback still is
});
