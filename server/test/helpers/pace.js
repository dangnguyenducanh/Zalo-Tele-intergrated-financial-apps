import { vi } from 'vitest';
import { Budget } from '../../src/models/Budget.js';
import { Category } from '../../src/models/Category.js';
import { Transaction } from '../../src/models/Transaction.js';

// The clock of a pace test: noon in Vietnam on `day` of November 2026. Only Date is faked, so the database and the
// mocked network keep working. Put the real clock back with vi.useRealTimers() (an afterEach in each test file).
export function novemberDay(day) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`2026-11-${String(day).padStart(2, '0')}T12:00:00+07:00`));
}

// docs/02 §2.11.2 (A2) as data: 7.100.000 of an overall budget of 8.000.000 spent in November 2026, 844.000 of it on
// food (budget 1.000.000), the rest on housing (no budget). On the 25th the overall budget has 900.000 left for 6 days
// (150.000 a day), food has 156.000 left (26.000 a day). Written through the models, so no login is needed.
export async function seedPaceMonth({ userId, walletId }) {
  const idOf = async (name) => (await Category.findOne({ userId, 'names.vi': name }))._id;
  const [food, housing] = [await idOf('Ăn uống'), await idOf('Nhà ở')];
  const spend = (categoryId, amount) =>
    Transaction.create({ userId, walletId, categoryId, type: 'expense', amount, occurredAt: new Date('2026-11-10T05:00:00.000Z') });
  await spend(food, 844_000);
  await spend(housing, 6_256_000);
  await Budget.create({ userId, month: '2026-11', categoryId: null, limit: 8_000_000 });
  await Budget.create({ userId, month: '2026-11', categoryId: food, limit: 1_000_000 });
  return { food, housing };
}

// A reply with every kind of space but the line break (the no-break space of "7.100.000 ₫" included) as a plain one,
// to compare it with text typed in a test.
export const plain = (text) => text.replace(/[^\S\n]/g, ' ');

// /dubao on the 25th of seedPaceMonth()'s month, as a Vietnamese user reads it (spaces made plain by plain()): the same on
// every chat app, because the core builds it once.
export const A2_DUBAO_VI = [
  '📊 Dự báo tháng 11/2026 (ngày 25/30)',
  'Tổng: đã chi 7.100.000 ₫ / 8.000.000 ₫. Còn 900.000 ₫ cho 6 ngày → tối đa 150.000 ₫/ngày. Theo nhịp này cuối tháng ≈ 8.520.000 ₫, vượt khoảng 29/11.',
  'Ăn uống: tối đa 26.000 ₫/ngày. Cuối tháng ≈ 1.012.800 ₫, vượt khoảng 30/11.',
].join('\n');
