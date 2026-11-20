import request from 'supertest';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import app from '../src/app.js';
import { Budget } from '../src/models/Budget.js';
import { Category } from '../src/models/Category.js';
import { Transaction } from '../src/models/Transaction.js';
import { User } from '../src/models/User.js';
import { Wallet } from '../src/models/Wallet.js';
import { monthKey } from '../src/utils/vnTime.js';
import fixture from './fixtures/expected-stats.json' with { type: 'json' };
import { clearTestDb, startTestDb, stopTestDb } from './helpers/db.js';
import { registerUser, resetLoginLimit } from './helpers/auth.js';

beforeAll(async () => {
  await startTestDb();
  await Promise.all([User.init(), Wallet.init(), Category.init(), Transaction.init(), Budget.init()]);
});
afterEach(async () => {
  await clearTestDb();
  await resetLoginLimit();
});
afterAll(stopTestDb);

const get = (accessToken, path) => request(app).get(`/api${path}`).set('Authorization', `Bearer ${accessToken}`);

// Registers a user and stores the fixture's budgets and transactions for them (docs/07 §7.2).
// Returns the token and a lookup from a category id to its Vietnamese name.
async function seedFixture(overrides) {
  const { accessToken, user } = await registerUser(overrides);
  const categories = await Category.find({ userId: user.id });
  const idOf = (vi) => (vi === null ? null : categories.find((c) => c.names.vi === vi)._id);
  await Budget.insertMany(fixture.budgets.map((b) => ({ userId: user.id, month: fixture.month, categoryId: idOf(b.category), limit: b.limit })));
  await Transaction.insertMany(
    fixture.transactions.map((t) => ({
      userId: user.id,
      walletId: user.defaultWalletId,
      categoryId: idOf(t.category),
      type: t.type,
      amount: t.amount,
      occurredAt: new Date(t.occurredAt),
      status: t.status ?? 'confirmed',
      deletedAt: t.deleted ? new Date() : null,
    })),
  );
  const nameOf = (id) => (id === null ? null : categories.find((c) => String(c._id) === id).names.vi);
  return { accessToken, user, nameOf };
}

test('TC-F6-01 GET /stats/summary equals the hand-computed fixture', async () => {
  const { accessToken, nameOf } = await seedFixture();

  const res = await get(accessToken, `/stats/summary?month=${fixture.month}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual(fixture.expected.summary);

  // Budget usage for the same month: the budgets joined with the month's expenses (docs/03 §3.4).
  const budgets = (await get(accessToken, `/budgets?month=${fixture.month}`)).body;
  expect(budgets.map((b) => ({ category: nameOf(b.categoryId), limit: b.limit, spent: b.spent, percent: b.percent }))).toEqual(
    fixture.expected.budgets,
  );

  // A month without data is all zeros; a month without an overall budget has budget null.
  expect((await get(accessToken, '/stats/summary?month=2027-01')).body).toEqual({ income: 0, expense: 0, net: 0, budget: null });
  expect((await get(accessToken, '/stats/summary?month=2026-12')).body).toEqual({ income: 0, expense: 80_000, net: -80_000, budget: null }); // 00:10 on 1 Dec
  // October holds only the 23:30 salary (31 Oct in Vietnam): income, no spending, so net is positive.
  expect((await get(accessToken, '/stats/summary?month=2026-10')).body).toEqual({ income: 15_000_000, expense: 0, net: 15_000_000, budget: null });

  // Another user sees none of it.
  const other = await registerUser();
  expect((await get(other.accessToken, `/stats/summary?month=${fixture.month}`)).body).toEqual({ income: 0, expense: 0, net: 0, budget: null });

  // Without ?month the current Vietnamese month is used; a bad month or no token is refused.
  const now = await get(accessToken, '/stats/summary');
  expect(now.status).toBe(200);
  expect(now.body).toEqual((await get(accessToken, `/stats/summary?month=${monthKey(new Date())}`)).body);
  for (const month of ['2026-13', '2026-1', 'nov']) {
    const bad = await get(accessToken, `/stats/summary?month=${month}`);
    expect([bad.status, bad.body.error.code]).toEqual([400, 'VALIDATION_ERROR']);
  }
  expect((await request(app).get('/api/stats/summary')).status).toBe(401);
});

test('TC-F6-02 GET /stats/by-category totals and percentages', async () => {
  const { accessToken, nameOf } = await seedFixture();

  for (const type of ['expense', 'income']) {
    const query = type === 'expense' ? '' : '&type=income'; // expense is the default
    const res = await get(accessToken, `/stats/by-category?month=${fixture.month}${query}`);
    expect(res.status).toBe(200);
    expect(res.body.map(({ categoryId, name, total, percent }) => ({ name, total, percent, vi: nameOf(categoryId) }))).toEqual(
      fixture.expected.byCategory[type].map((row) => ({ ...row, vi: row.name })), // biggest first, with the category's name
    );
    const sum = res.body.reduce((total, row) => total + row.percent, 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(1);
  }

  // Names follow the user's language, and a category the user renamed shows its own name.
  const english = await seedFixture({ language: 'en' });
  const bills = await Category.findOne({ userId: english.user.id, 'names.en': 'Bills' });
  bills.name = 'Điện nước';
  await bills.save();
  const names = (await get(english.accessToken, `/stats/by-category?month=${fixture.month}`)).body.map((row) => row.name);
  expect(names).toEqual(['Shopping', 'Điện nước', 'Food & drinks', 'Transport']);

  expect((await get(accessToken, '/stats/by-category?month=2027-01')).body).toEqual([]);
  expect((await get(accessToken, `/stats/by-category?month=${fixture.month}&type=transfer`)).status).toBe(400);
});

test('TC-F6-03 GET /stats/daily groups by the Vietnamese calendar date', async () => {
  const { accessToken } = await seedFixture();

  const res = await get(accessToken, `/stats/daily?month=${fixture.month}`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(30); // every day of November, so the bar chart has no gaps
  for (const [index, day] of res.body.entries()) {
    const date = `2026-11-${String(index + 1).padStart(2, '0')}`;
    expect(day).toEqual({ date, ...(fixture.expected.dailyNonZero[date] ?? { income: 0, expense: 0 }) });
  }

  // The rows around midnight: 23:59 on 19 Nov and 00:00 on 20 Nov in Vietnam are different days,
  // 00:30 on 1 Nov counts in November and 00:10 on 1 Dec does not.
  const byDate = Object.fromEntries(res.body.map((day) => [day.date, day.expense]));
  expect([byDate['2026-11-19'], byDate['2026-11-20'], byDate['2026-11-01']]).toEqual([15_000, 35_000, 45_000]);
  const december = (await get(accessToken, '/stats/daily?month=2026-12')).body;
  expect(december).toHaveLength(31);
  expect(december[0]).toEqual({ date: '2026-12-01', income: 0, expense: 80_000 });

  expect((await get(accessToken, '/stats/daily?month=2027-02')).body).toHaveLength(28);
  expect((await get(accessToken, '/stats/daily?month=2028-02')).body).toHaveLength(29); // leap year
  expect((await get(accessToken, '/stats/daily?month=02-2026')).status).toBe(400);
});
