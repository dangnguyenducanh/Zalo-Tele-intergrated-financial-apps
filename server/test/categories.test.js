import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import app from '../src/app.js';
import { Category } from '../src/models/Category.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { DEFAULT_CATEGORIES } from '../src/seed/templates.js';
import { onUserRegistered } from '../src/services/auth.js';
import { seedCategoryTemplates } from '../src/services/categories.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { registerUser, resetLoginLimit } from './helpers/auth.js';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Wallet.init(), Category.init()]);
});
afterEach(async () => {
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(stopTestDb);

const api = (accessToken) => {
  const call = (method) => (path, body) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${accessToken}`).send(body);
  return { get: call('get'), post: call('post'), patch: call('patch'), delete: call('delete') };
};
const vietnameseNames = (categories) => categories.map((c) => c.names?.vi ?? c.name);
const templateNames = (type) => DEFAULT_CATEGORIES.filter((c) => c.type === type).map((c) => c.names.vi);

test('TC-F3-01 register seeds the default categories and the "Tiền mặt" default wallet', async () => {
  const { accessToken, user } = await registerUser();
  const me = api(accessToken);

  const expense = await me.get('/categories?type=expense');
  const income = await me.get('/categories?type=income');
  expect(expense.status).toBe(200);
  expect(vietnameseNames(expense.body)).toEqual(templateNames('expense'));
  expect(vietnameseNames(income.body)).toEqual(templateNames('income'));
  expect(expense.body[0]).toMatchObject({ userId: user.id, type: 'expense', names: { vi: 'Ăn uống', en: 'Food & drinks' }, isFallback: false });
  expect(expense.body[0].keywords).toContain('banh mi');
  expect(expense.body.at(-1)).toMatchObject({ names: { vi: 'Khác', en: 'Other' }, isFallback: true });
  expect(income.body.at(-1)).toMatchObject({ names: { vi: 'Thu khác', en: 'Other income' }, keywords: ['nhan', 'received'], isFallback: true });
  expect((await me.get('/categories')).body).toHaveLength(DEFAULT_CATEGORIES.length);

  const wallets = await me.get('/wallets');
  expect(wallets.body).toEqual([expect.objectContaining({ name: 'Tiền mặt', type: 'cash', aliases: ['tm', 'cash'], balance: 0 })]);
  expect(user.defaultWalletId).toBe(wallets.body[0].id);

  const english = await registerUser({ language: 'en' });
  expect((await api(english.accessToken).get('/wallets')).body[0].name).toBe('Cash');
  expect((await me.get('/categories?type=transfer')).status).toBe(400);
});

test('TC-F3-01 templates are copied, so template edits reach only users who register afterwards', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  await seedCategoryTemplates();
  const before = await registerUser();
  await Category.updateOne({ userId: null, 'names.vi': 'Ăn uống' }, { $push: { keywords: 'bun bo' } }); // admin edits a template
  const after = await registerUser();

  const foodOf = async ({ accessToken }) => (await api(accessToken).get('/categories?type=expense')).body[0];
  const [foodBefore, foodAfter] = [await foodOf(before), await foodOf(after)];
  expect(foodBefore.keywords).not.toContain('bun bo');
  expect(foodAfter.keywords).toContain('bun bo');
  expect(foodBefore.id).not.toBe(foodAfter.id); // each user owns a separate copy
  expect(await Category.countDocuments({ userId: null })).toBe(DEFAULT_CATEGORIES.length); // templates untouched
  log.mockRestore();
});

test('TC-F3-02 category CRUD with validation', async () => {
  const { accessToken } = await registerUser();
  const me = api(accessToken);

  for (const bad of [{ type: 'expense', name: '' }, { type: 'expense', name: '   ' }, { type: 'spending', name: 'Pets' }, { name: 'No type' }]) {
    const res = await me.post('/categories', bad);
    expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  }

  const created = await me.post('/categories', { type: 'expense', name: 'Thú cưng', keywords: ['Thức ăn mèo', 'pate', 'PATE', ' '], icon: 'Pets', color: '#795548' });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ type: 'expense', name: 'Thú cưng', keywords: ['thuc an meo', 'pate'], icon: 'Pets', isFallback: false });
  const { id } = created.body;

  const patched = await me.patch(`/categories/${id}`, { keywords: ['Phở Bò', 'cat litter'], type: 'income', isFallback: true });
  expect(patched.status).toBe(200);
  expect(patched.body).toMatchObject({ id, name: 'Thú cưng', keywords: ['pho bo', 'cat litter'], type: 'expense', isFallback: false });

  const deleted = await me.delete(`/categories/${id}`);
  expect(deleted.status).toBe(204);
  expect(vietnameseNames((await me.get('/categories?type=expense')).body)).not.toContain('Thú cưng');
  expect((await me.patch(`/categories/${id}`, { name: 'Back' })).status).toBe(404);
  expect((await me.delete(`/categories/${id}`)).status).toBe(404);
});

test('TC-F3-02 category names are unique per type, and other users\' categories answer 404', async () => {
  const userA = await registerUser();
  const userB = await registerUser();
  const asA = api(userA.accessToken);

  const duplicate = await asA.post('/categories', { type: 'expense', name: 'ăn UỐNG' }); // same as a default copy
  expect([duplicate.status, duplicate.body.error.code]).toEqual([409, 'NAME_TAKEN']);
  expect((await asA.post('/categories', { type: 'income', name: 'Ăn uống' })).status).toBe(201); // other type is fine

  const { body: pets } = await asA.post('/categories', { type: 'expense', name: 'Pets' });
  const renameTaken = await asA.patch(`/categories/${pets.id}`, { name: 'Food & drinks' });
  expect([renameTaken.status, renameTaken.body.error.code]).toEqual([409, 'NAME_TAKEN']);
  expect((await asA.patch(`/categories/${pets.id}`, { name: 'PETS' })).status).toBe(200); // renaming itself is fine

  const asB = api(userB.accessToken);
  for (const res of [await asB.patch(`/categories/${pets.id}`, { name: 'Hacked' }), await asB.delete(`/categories/${pets.id}`)]) {
    expect([res.status, res.body.error.code]).toEqual([404, 'NOT_FOUND']);
  }
  expect(await Category.findById(pets.id)).toMatchObject({ name: 'PETS', deletedAt: null });
});

test('TC-F3-03 deleting a category moves its transactions to the fallback; the fallback cannot be deleted', async () => {
  const { accessToken, user } = await registerUser();
  const me = api(accessToken);
  const expense = (await me.get('/categories?type=expense')).body;
  const food = expense[0];
  const other = expense.find((c) => c.isFallback);
  const transactions = mongoose.connection.collection('transactions');
  const userId = new mongoose.Types.ObjectId(user.id);
  const foodId = new mongoose.Types.ObjectId(food.id);
  await transactions.insertMany([
    { userId, categoryId: foodId, type: 'expense', amount: 45_000, status: 'confirmed', deletedAt: null },
    { userId, categoryId: foodId, type: 'expense', amount: 30_000, status: 'draft', deletedAt: null },
    { userId, categoryId: foodId, type: 'expense', amount: 20_000, status: 'confirmed', deletedAt: new Date() },
  ]);

  const res = await me.delete(`/categories/${food.id}`);
  expect(res.status).toBe(204);
  expect(await transactions.countDocuments({ categoryId: new mongoose.Types.ObjectId(other.id) })).toBe(3);
  expect(await transactions.countDocuments({ categoryId: foodId })).toBe(0);

  const fallback = await me.delete(`/categories/${other.id}`);
  expect([fallback.status, fallback.body.error.code]).toEqual([409, 'FALLBACK_CATEGORY']);
  const incomeFallback = (await me.get('/categories?type=income')).body.find((c) => c.isFallback);
  expect((await me.delete(`/categories/${incomeFallback.id}`)).status).toBe(409);
});

test('TC-F3-05 template seeding and default data are created once, however often they run', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  await seedCategoryTemplates();
  await seedCategoryTemplates();
  expect(await Category.countDocuments({ userId: null })).toBe(DEFAULT_CATEGORIES.length);

  // `npm run seed` gives users who registered before T05 their defaults; users who have them are skipped.
  const { user } = await registerUser();
  const doc = await User.findById(user.id);
  await onUserRegistered(doc);
  expect(await Wallet.countDocuments({ userId: user.id })).toBe(1);
  expect(await Category.countDocuments({ userId: user.id })).toBe(DEFAULT_CATEGORIES.length);

  const old = await User.create({ email: 'old@example.com', name: 'Old', passwordHash: 'x' });
  await onUserRegistered(old);
  expect((await User.findById(old._id)).defaultWalletId).toEqual((await Wallet.findOne({ userId: old._id }))._id);
  expect(await Category.countDocuments({ userId: old._id })).toBe(DEFAULT_CATEGORIES.length);
  log.mockRestore();
});
