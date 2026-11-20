import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import app from '../src/app.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { registerUser, resetLoginLimit } from './helpers/auth.js';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Wallet.init()]); // build the unique indexes before the tests rely on them
});
afterEach(async () => {
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(stopTestDb);

// Calls the API as one logged-in user: api(token).get('/wallets') …
const api = (accessToken) => {
  const call = (method) => (path, body) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${accessToken}`).send(body);
  return { get: call('get'), post: call('post'), patch: call('patch'), delete: call('delete') };
};

// The Transaction model arrives with T07, so tests insert raw documents shaped like docs/03.
const oid = (id) => new mongoose.Types.ObjectId(id);
const addTransaction = (userId, walletId, fields) =>
  mongoose.connection.collection('transactions').insertOne({
    userId: oid(userId),
    walletId: oid(walletId),
    categoryId: new mongoose.Types.ObjectId(),
    status: 'confirmed',
    deletedAt: null,
    occurredAt: new Date(),
    ...fields,
  });

const momo = { name: 'MoMo', type: 'ewallet', initialBalance: 100_000, aliases: ['MM', 'momo'], color: '#a50064', icon: 'Wallet' };

test('TC-F2-01 wallet CRUD answers 201, 200, 200, 200, 204 and the deleted wallet leaves the list', async () => {
  const { accessToken } = await registerUser();
  const me = api(accessToken);

  const created = await me.post('/wallets', momo);
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ name: 'MoMo', type: 'ewallet', initialBalance: 100_000, balance: 100_000, aliases: ['mm', 'momo'], archived: false });
  const { id } = created.body;

  const list = await me.get('/wallets');
  expect(list.status).toBe(200);
  expect(list.body.map((w) => w.name)).toEqual(['Tiền mặt', 'MoMo']); // the default wallet from register comes first

  const one = await me.get(`/wallets/${id}`);
  expect([one.status, one.body.id, one.body.balance]).toEqual([200, id, 100_000]);

  const renamed = await me.patch(`/wallets/${id}`, { name: 'Ví MoMo', initialBalance: 50_000 });
  expect(renamed.status).toBe(200);
  expect(renamed.body).toMatchObject({ id, name: 'Ví MoMo', balance: 50_000 });

  const deleted = await me.delete(`/wallets/${id}`);
  expect(deleted.status).toBe(204);
  expect((await me.get('/wallets')).body.map((w) => w.name)).toEqual(['Tiền mặt']);
  expect((await me.get(`/wallets/${id}`)).status).toBe(404);
  expect(await Wallet.findById(id)).toHaveProperty('deletedAt', expect.any(Date)); // soft delete keeps the row
});

test('TC-F2-01 wallet input is validated and names are unique per user', async () => {
  const { accessToken } = await registerUser();
  const me = api(accessToken);

  for (const bad of [
    { ...momo, name: '' },
    { ...momo, name: 'x'.repeat(41) },
    { ...momo, type: 'crypto' },
    { ...momo, initialBalance: 1.5 },
    { ...momo, initialBalance: '100000' },
    { name: 'No type', initialBalance: 0 },
  ]) {
    const res = await me.post('/wallets', bad);
    expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  }

  const credit = await me.post('/wallets', { name: 'Visa', type: 'credit', initialBalance: -2_000_000 });
  expect([credit.status, credit.body.balance]).toEqual([201, -2_000_000]); // a credit card may start negative

  const taken = await me.post('/wallets', { ...momo, name: 'tiền MẶT' }); // same as the default wallet, other case
  expect([taken.status, taken.body.error.code]).toEqual([409, 'NAME_TAKEN']);
  const renameTaken = await me.patch(`/wallets/${credit.body.id}`, { name: 'Tiền mặt' });
  expect([renameTaken.status, renameTaken.body.error.code]).toEqual([409, 'NAME_TAKEN']);

  // A deleted wallet frees its name, and another user may use any name.
  await me.delete(`/wallets/${credit.body.id}`);
  expect((await me.post('/wallets', { name: 'Visa', type: 'credit', initialBalance: 0 })).status).toBe(201);
  const other = await registerUser();
  expect((await api(other.accessToken).post('/wallets', { name: 'Visa', type: 'credit', initialBalance: 0 })).status).toBe(201);
});

test('TC-F2-01 archived wallets are hidden unless includeArchived=true', async () => {
  const { accessToken } = await registerUser();
  const me = api(accessToken);
  const { body: wallet } = await me.post('/wallets', momo);

  const archived = await me.patch(`/wallets/${wallet.id}`, { archived: true });
  expect([archived.status, archived.body.archived]).toEqual([200, true]);

  expect((await me.get('/wallets')).body.map((w) => w.name)).toEqual(['Tiền mặt']);
  expect((await me.get('/wallets?includeArchived=true')).body.map((w) => w.name)).toEqual(['Tiền mặt', 'MoMo']);
  expect((await me.get('/wallets?includeArchived=maybe')).status).toBe(400);
});

test('TC-F2-02 user B cannot read, change or delete user A\'s wallet', async () => {
  const userA = await registerUser();
  const userB = await registerUser();
  const { body: walletOfA } = await api(userA.accessToken).post('/wallets', momo);
  const asB = api(userB.accessToken);

  const responses = [
    await asB.get(`/wallets/${walletOfA.id}`),
    await asB.patch(`/wallets/${walletOfA.id}`, { name: 'Hacked', initialBalance: 0 }),
    await asB.delete(`/wallets/${walletOfA.id}`),
  ];
  for (const res of responses) expect([res.status, res.body.error.code]).toEqual([404, 'NOT_FOUND']);

  const inDb = await Wallet.findById(walletOfA.id);
  expect(inDb).toMatchObject({ name: 'MoMo', initialBalance: 100_000, deletedAt: null });
  expect((await asB.get('/wallets')).body.map((w) => w.name)).toEqual(['Tiền mặt']); // only B's own wallet
  expect((await asB.get('/wallets/not-an-id')).status).toBe(400);
});

test('TC-F2-03 a wallet used by a confirmed transaction cannot be deleted', async () => {
  const { accessToken, user } = await registerUser();
  const me = api(accessToken);
  const { body: wallet } = await me.post('/wallets', momo);
  const { body: unused } = await me.post('/wallets', { name: 'Bank', type: 'bank', initialBalance: 0 });
  await addTransaction(user.id, wallet.id, { type: 'expense', amount: 30_000 });
  await addTransaction(user.id, unused.id, { type: 'expense', amount: 30_000, status: 'confirmed', deletedAt: new Date() });

  const res = await me.delete(`/wallets/${wallet.id}`);
  expect([res.status, res.body.error.code]).toEqual([409, 'WALLET_IN_USE']);
  expect((await me.get(`/wallets/${wallet.id}`)).status).toBe(200);
  expect((await me.delete(`/wallets/${unused.id}`)).status).toBe(204); // only a deleted transaction used it
});

test('TC-F2-03 deleting the default wallet clears the user\'s default', async () => {
  const { accessToken, user } = await registerUser();
  expect(user.defaultWalletId).toEqual(expect.any(String));

  expect((await api(accessToken).delete(`/wallets/${user.defaultWalletId}`)).status).toBe(204);
  expect((await User.findById(user.id)).defaultWalletId).toBeNull(); // the bot then falls back to another wallet
});

test('TC-F2-04 balance counts only confirmed, non-deleted transactions of that wallet', async () => {
  const userA = await registerUser();
  const userB = await registerUser();
  const { body: wallet } = await api(userA.accessToken).post('/wallets', { name: 'Test', type: 'bank', initialBalance: 100_000 });
  const add = (fields) => addTransaction(userA.user.id, wallet.id, fields);
  await add({ type: 'income', amount: 50_000 });
  await add({ type: 'expense', amount: 30_000 });
  await add({ type: 'expense', amount: 20_000, status: 'draft' });
  await add({ type: 'expense', amount: 10_000, deletedAt: new Date() });
  await addTransaction(userA.user.id, userA.user.defaultWalletId, { type: 'expense', amount: 7_000 }); // other wallet
  await addTransaction(userB.user.id, wallet.id, { type: 'expense', amount: 5_000 }); // forged row of another user

  const list = await api(userA.accessToken).get('/wallets');
  const byName = Object.fromEntries(list.body.map((w) => [w.name, w.balance]));
  expect(byName).toEqual({ 'Tiền mặt': -7_000, Test: 120_000 });
  expect((await api(userA.accessToken).get(`/wallets/${wallet.id}`)).body.balance).toBe(120_000);
});
