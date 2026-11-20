import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import app from '../src/app.js';
import { Budget } from '../src/models/Budget.js';
import { Category } from '../src/models/Category.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { budgetWarning } from '../src/services/budgets.js';
import { monthKey } from '../src/utils/vnTime.js';
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { registerUser, resetLoginLimit } from './helpers/auth.js';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Wallet.init(), Category.init(), Transaction.init(), Budget.init()]); // unique indexes first
});
afterEach(async () => {
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(stopTestDb);

// Calls the API as one logged-in user: api(token).get('/budgets') …
const api = (accessToken) => {
  const call = (method) => (path, body) => request(app)[method](`/api${path}`).set('Authorization', `Bearer ${accessToken}`).send(body);
  return { get: call('get'), post: call('post'), patch: call('patch'), delete: call('delete') };
};

// A registered user with its default wallet and a few default categories by their Vietnamese names.
async function newUser() {
  const { accessToken, user } = await registerUser();
  const me = api(accessToken);
  const { body: categories } = await me.get('/categories');
  const byName = (vi) => categories.find((c) => c.names?.vi === vi).id;
  return { me, user, walletId: user.defaultWalletId, food: byName('Ăn uống'), transport: byName('Đi lại'), salary: byName('Lương') };
}

// A confirmed web transaction through the API.
async function spend(u, categoryId, amount, occurredAt = '2026-11-10T05:00:00.000Z', type = 'expense') {
  const res = await u.me.post('/transactions', { type, amount, walletId: u.walletId, categoryId, occurredAt });
  expect(res.status).toBe(201);
  return res.body;
}

test('TC-F5-01 budget CRUD and one budget per category per month', async () => {
  const u = await newUser();
  const body = { month: '2026-11', categoryId: u.food, limit: 1_000_000 };

  const created = await u.me.post('/budgets', body);
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ ...body, userId: u.user.id, spent: 0, percent: 0, id: expect.any(String) });
  expect(created.body).not.toHaveProperty('_id');

  const again = await u.me.post('/budgets', { ...body, limit: 5 });
  expect([again.status, again.body.error.code]).toEqual([409, 'BUDGET_EXISTS']);

  // The overall budget (categoryId null) is also one per month; the same category in another month is fine.
  const overall = await u.me.post('/budgets', { month: '2026-11', categoryId: null, limit: 3_000_000 });
  expect(overall.status).toBe(201);
  expect(overall.body.categoryId).toBeNull();
  expect((await u.me.post('/budgets', { month: '2026-11', categoryId: null, limit: 1 })).body.error.code).toBe('BUDGET_EXISTS');
  expect((await u.me.post('/budgets', { ...body, month: '2026-12' })).status).toBe(201);

  const list = await u.me.get('/budgets?month=2026-11');
  expect(list.status).toBe(200);
  expect(list.body.map((b) => [b.categoryId, b.limit])).toEqual([
    [null, 3_000_000], // the overall budget comes first
    [u.food, 1_000_000],
  ]);

  const patched = await u.me.patch(`/budgets/${created.body.id}`, { limit: 2_000_000, month: '2027-01', categoryId: u.transport });
  expect(patched.status).toBe(200);
  expect(patched.body).toMatchObject({ ...body, limit: 2_000_000, spent: 0, percent: 0 }); // only the limit changes

  expect((await u.me.delete(`/budgets/${created.body.id}`)).status).toBe(204);
  expect((await u.me.delete(`/budgets/${created.body.id}`)).status).toBe(404);
  expect((await u.me.patch(`/budgets/${created.body.id}`, { limit: 1 })).status).toBe(404);
  expect((await u.me.get('/budgets?month=2026-11')).body.map((b) => b.categoryId)).toEqual([null]);
  expect((await u.me.post('/budgets', body)).status).toBe(201); // a deleted budget frees its month again
});

test('TC-F5-01 budget input is validated and ownership is enforced', async () => {
  const a = await newUser();
  const b = await newUser();
  const body = { month: '2026-11', categoryId: a.food, limit: 1_000_000 };

  for (const bad of [
    { ...body, month: '2026-13' },
    { ...body, month: '2026-1' },
    { ...body, month: '11/2026' },
    { ...body, month: undefined },
    { ...body, categoryId: undefined }, // the overall budget must be asked for with null
    { ...body, categoryId: 'not-an-id' },
    { ...body, limit: 0 },
    { ...body, limit: -5 },
    { ...body, limit: 12.5 },
    { ...body, limit: '1000' },
    { ...body, limit: 2 ** 53 },
    { ...body, categoryId: a.salary }, // income categories have no spending to limit
  ]) {
    const res = await a.me.post('/budgets', bad);
    expect([res.status, res.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  }
  for (const query of ['?month=2026-00', '?month=abc']) {
    expect((await a.me.get(`/budgets${query}`)).status).toBe(400);
  }

  // Another user's category or a deleted one → 404, and nothing is saved.
  const foreign = await a.me.post('/budgets', { ...body, categoryId: b.food });
  expect([foreign.status, foreign.body.error.details]).toEqual([404, [{ path: 'categoryId', issue: 'not_found' }]]);
  await a.me.delete(`/categories/${a.transport}`);
  expect((await a.me.post('/budgets', { ...body, categoryId: a.transport })).status).toBe(404);
  expect(await Budget.countDocuments()).toBe(0);

  // B cannot see, change or delete A's budget.
  const { body: budget } = await a.me.post('/budgets', body);
  expect((await b.me.get('/budgets?month=2026-11')).body).toEqual([]);
  expect((await b.me.patch(`/budgets/${budget.id}`, { limit: 1 })).status).toBe(404);
  expect((await b.me.delete(`/budgets/${budget.id}`)).status).toBe(404);
  expect((await a.me.patch('/budgets/not-an-id', { limit: 1 })).status).toBe(400);
  for (const limit of [0, 1.5, undefined]) {
    expect((await a.me.patch(`/budgets/${budget.id}`, { limit })).status).toBe(400);
  }
  expect((await Budget.findById(budget.id)).limit).toBe(1_000_000);

  // Without ?month the current Vietnamese month is listed; without a token there is nothing.
  await a.me.post('/budgets', { ...body, month: monthKey(new Date()) });
  expect((await a.me.get('/budgets')).body.map((x) => x.month)).toEqual([monthKey(new Date())]);
  expect((await request(app).get('/api/budgets')).status).toBe(401);
});

test('TC-F5-01 POST /budgets/copy copies one month into another without duplicates', async () => {
  const u = await newUser();
  await u.me.post('/budgets', { month: '2026-11', categoryId: null, limit: 3_000_000 });
  await u.me.post('/budgets', { month: '2026-11', categoryId: u.food, limit: 1_000_000 });
  await u.me.post('/budgets', { month: '2026-11', categoryId: u.transport, limit: 500_000 });
  await u.me.post('/budgets', { month: '2026-12', categoryId: u.food, limit: 1_200_000 }); // already set for December
  await u.me.delete(`/categories/${u.transport}`); // a deleted category's budget is not carried over

  const copied = await u.me.post('/budgets/copy', { from: '2026-11', to: '2026-12' });
  expect([copied.status, copied.body]).toEqual([201, { created: 1 }]);
  const december = (await u.me.get('/budgets?month=2026-12')).body;
  expect(december.map((b) => [b.categoryId, b.limit])).toEqual([
    [null, 3_000_000],
    [u.food, 1_200_000], // the existing December budget is kept
  ]);
  expect((await u.me.get('/budgets?month=2026-11')).body).toHaveLength(2); // the deleted category's budget is hidden

  expect((await u.me.post('/budgets/copy', { from: '2026-11', to: '2026-12' })).body).toEqual({ created: 0 });
  expect((await u.me.post('/budgets/copy', { from: '2026-11', to: '13-2026' })).status).toBe(400);

  // Copying never reads another user's budgets.
  const other = await newUser();
  expect((await other.me.post('/budgets/copy', { from: '2026-11', to: '2026-12' })).body).toEqual({ created: 0 });
});

test('TC-F5-02 spent and percent count only confirmed expenses of that category and month', async () => {
  const u = await newUser();
  const { body: food } = await u.me.post('/budgets', { month: '2026-11', categoryId: u.food, limit: 1_000_000 });
  await u.me.post('/budgets', { month: '2026-11', categoryId: null, limit: 4_000_000 });

  await spend(u, u.food, 450_000);
  await spend(u, u.food, 300_000, '2026-10-31T17:30:00.000Z'); // 00:30 on 1 Nov in Vietnam
  await spend(u, u.transport, 200_000); // another category
  await spend(u, u.salary, 10_000_000, '2026-11-05T02:00:00.000Z', 'income'); // income is not spending
  await spend(u, u.food, 70_000, '2026-11-30T17:10:00.000Z'); // 00:10 on 1 Dec in Vietnam
  const deleted = await spend(u, u.food, 90_000);
  await u.me.delete(`/transactions/${deleted.id}`);
  await Transaction.create({
    userId: u.user.id, walletId: u.walletId, categoryId: u.food, type: 'expense', amount: 100_000,
    occurredAt: new Date('2026-11-12T05:00:00.000Z'), status: 'draft', source: 'telegram',
  });

  const list = (await u.me.get('/budgets?month=2026-11')).body;
  expect(list.map(({ categoryId, spent, percent }) => ({ categoryId, spent, percent }))).toEqual([
    { categoryId: null, spent: 950_000, percent: 24 }, // all confirmed expenses: 950 000 / 4 000 000 = 23.75 %
    { categoryId: u.food, spent: 750_000, percent: 75 },
  ]);

  // Usage can pass 100 %, and PATCH answers with the new percentage.
  await spend(u, u.food, 500_000);
  const patched = await u.me.patch(`/budgets/${food.id}`, { limit: 1_000_000 });
  expect(patched.body).toMatchObject({ spent: 1_250_000, percent: 125 });
});

// budgetWarning() with ids as strings, the way the API and the bots send them on.
const warningFor = async (...args) => JSON.parse(JSON.stringify(await budgetWarning(...args)));

test('TC-F5-05 budgetWarning reports a category or overall budget at 80 % and at 100 %', async () => {
  const u = await newUser();
  const month = '2026-11';
  await u.me.post('/budgets', { month, categoryId: u.food, limit: 1_000_000 });

  await spend(u, u.food, 799_999);
  expect(await warningFor(u.user.id, u.food, month)).toBeNull(); // 79.9999 % is not yet 80 %
  expect(await warningFor(u.user.id, u.transport, month)).toBeNull(); // no budget for Đi lại

  await spend(u, u.food, 1);
  expect(await warningFor(u.user.id, u.food, month)).toMatchObject({ categoryId: u.food, limit: 1_000_000, spent: 800_000, percent: 80, threshold: 80 });

  await spend(u, u.food, 250_000);
  expect(await warningFor(u.user.id, u.food, month)).toMatchObject({ categoryId: u.food, spent: 1_050_000, percent: 105, threshold: 100 });
  expect(await warningFor(u.user.id, u.food, '2026-12')).toBeNull(); // another month

  // The overall budget warns too, for any category, and the fuller of the two budgets is reported.
  await u.me.post('/budgets', { month, categoryId: null, limit: 1_400_000 });
  await spend(u, u.transport, 100_000);
  expect(await warningFor(u.user.id, u.transport, month)).toMatchObject({ categoryId: null, spent: 1_150_000, percent: 82, threshold: 80 });
  expect(await warningFor(u.user.id, u.food, month)).toMatchObject({ categoryId: u.food, threshold: 100 });

  // Another user's spending never counts.
  const other = await newUser();
  expect(await warningFor(other.user.id, other.food, month)).toBeNull();
});
