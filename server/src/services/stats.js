import mongoose from 'mongoose';
import { Budget } from '../models/Budget.js';
import { Category } from '../models/Category.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { monthRange } from '../utils/vnTime.js';

// $match for the money that really moved between two instants (`end` excluded): the user's confirmed, non-deleted
// transactions (docs/03 §3.4). Aggregations do not cast, so userId becomes an ObjectId here.
export function confirmedInRange(userId, start, end) {
  return {
    userId: new mongoose.Types.ObjectId(String(userId)),
    status: 'confirmed',
    deletedAt: null,
    occurredAt: { $gte: start, $lt: end },
  };
}

// The same for a Vietnamese month 'YYYY-MM'.
const confirmedInMonth = (userId, month) => confirmedInRange(userId, ...Object.values(monthRange(month)));

// Σ amount per category for one type in the month → [{ _id: categoryId, total }], biggest first.
// Budgets (services/budgets.js) use it too, for how much of each category's budget is spent.
export function totalsByCategory(userId, month, type) {
  return Transaction.aggregate([
    { $match: { ...confirmedInMonth(userId, month), type } },
    { $group: { _id: '$categoryId', total: { $sum: '$amount' } } },
    { $sort: { total: -1, _id: 1 } },
  ]);
}

// GET /stats/summary: income, expense and net of the month, plus the overall budget (null when none is set).
export async function monthSummary(userId, month) {
  const [rows, budget] = await Promise.all([
    Transaction.aggregate([{ $match: confirmedInMonth(userId, month) }, { $group: { _id: '$type', total: { $sum: '$amount' } } }]),
    Budget.findOne({ userId, month, categoryId: null }),
  ]);
  const totals = Object.fromEntries(rows.map((row) => [row._id, row.total]));
  const income = totals.income ?? 0;
  const expense = totals.expense ?? 0;
  return { income, expense, net: income - expense, budget: budget && { limit: budget.limit, spent: expense } };
}

// GET /stats/by-category: the pie chart. Each category's total and share of the month (rounded, so the
// shares add up to 100 ± 1), named the way the user sees it: their own name, else the default in their language.
export async function byCategory(userId, month, type) {
  const [rows, categories, user] = await Promise.all([
    totalsByCategory(userId, month, type),
    Category.find({ userId }).lean(), // deleted ones too: they only lose their transactions when deleted
    User.findById(userId).lean(),
  ]);
  const byId = new Map(categories.map((category) => [String(category._id), category]));
  const sum = rows.reduce((total, row) => total + row.total, 0);
  return rows.map(({ _id, total }) => {
    const category = byId.get(String(_id));
    return {
      categoryId: String(_id),
      name: category?.name || category?.names?.[user?.language] || category?.names?.vi || '',
      total,
      percent: Math.round((total * 100) / sum),
    };
  });
}

// GET /stats/daily: the bar chart. One row for every day of the month (empty days are 0), grouped by the
// Vietnamese calendar date with $dateToString's time zone, so 23:30 on the 19th never lands on the 20th.
export async function daily(userId, month) {
  const rows = await Transaction.aggregate([
    { $match: confirmedInMonth(userId, month) },
    {
      $group: {
        _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: 'Asia/Ho_Chi_Minh' } }, type: '$type' },
        total: { $sum: '$amount' },
      },
    },
  ]);
  const [year, mm] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, mm, 0)).getUTCDate(); // day 0 of the next month = last day of this one
  const days = Array.from({ length: daysInMonth }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, '0')}`, income: 0, expense: 0 }));
  for (const { _id, total } of rows) days[Number(_id.date.slice(8)) - 1][_id.type] = total;
  return days;
}
