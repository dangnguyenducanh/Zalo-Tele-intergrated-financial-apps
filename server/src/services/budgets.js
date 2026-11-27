import mongoose from 'mongoose';
import { Budget } from '../models/Budget.js';
import { Category } from '../models/Category.js';
import { AppError } from '../utils/AppError.js';
import { monthKey, monthRange, vnParts } from '../utils/vnTime.js';
import { totalsByCategory } from './stats.js';

const budgetNotFound = () => new AppError(404, 'NOT_FOUND', 'Budget not found');
const OVERALL = 'overall'; // key of the month's total spending in spentInMonth()

// How much was spent in the month: Map(categoryId → Σ confirmed expenses), plus OVERALL → all expenses.
async function spentInMonth(userId, month) {
  const rows = await totalsByCategory(userId, month, 'expense');
  const spent = new Map(rows.map((row) => [String(row._id), row.total]));
  spent.set(OVERALL, rows.reduce((total, row) => total + row.total, 0));
  return spent;
}

// ---- Pace (docs/02 §2.11.2, A2) ---------------------------------------------------------------------------------
// One pace figure for the Budgets chip, /dubao, /month, the confirm warning and the agent's get_budget_pace. The agent
// service has its own copy; both are tested on shared/fixtures/pace.json, so they cannot drift apart.
export const PACE_FROM_DAY = 5; // a straight-line projection from fewer days overstates early-month spending such as rent
const DAY_MS = 24 * 60 * 60 * 1000;

// What is left to spend, and where the month is heading, for a budget `spent` of `limit` on day `day` of a month of
// `daysInMonth` days (today counts as a day left). Whole dong; null before day 5.
//   daysLeft: days from today to the month's end · perDay: the most to spend each of them, or null once the limit is
//   reached (never negative) · projectedEnd: spent / day × daysInMonth, rounded half up · overDay: the first day the
//   projection is over the limit, or null when it never is this month.
// The products stay exact while spent × daysInMonth × 2 is below 2^53 (spent below about 1.4 × 10^14 ₫); the figure is an estimate anyway.
export function pace({ spent, limit, day, daysInMonth }) {
  if (day < PACE_FROM_DAY) return null;
  const daysLeft = daysInMonth - day + 1;
  const perDay = spent >= limit ? null : Math.floor((limit - spent) / daysLeft);
  const projectedEnd = Math.floor((2 * spent * daysInMonth + day) / (2 * day));
  let overDay = null;
  if (spent > 0 && spent < limit) {
    const first = Math.floor((limit * day) / spent) + 1; // the first day spent / day × that day is over the limit
    if (first <= daysInMonth) overDay = first;
  }
  return { daysLeft, perDay, projectedEnd, overDay };
}

// Where `now` is in the budget's month: { day, daysInMonth } while `month` is the current Vietnam month, else null
// (a past or a future month has no "today").
export function monthProgress(month, now = new Date()) {
  if (monthKey(now) !== month) return null;
  const { start, end } = monthRange(month);
  return { day: vnParts(now).day, daysInMonth: Math.round((end - start) / DAY_MS) };
}

// A budget as the API returns it: its fields plus `spent`, `percent` used (rounded; may pass 100) and its `pace`
// (null outside the current Vietnam month and before day 5).
function withUsage(budget, spentByCategory, now) {
  const spent = spentByCategory.get(budget.categoryId ? String(budget.categoryId) : OVERALL) ?? 0;
  const progress = monthProgress(budget.month, now);
  return { ...budget.toJSON(), spent, percent: Math.round((spent * 100) / budget.limit), pace: progress && pace({ spent, limit: budget.limit, ...progress }) };
}

// The month's budgets, overall budget first. A deleted category's budget is left out: its transactions
// moved to the fallback category, so there is nothing left for it to track.
async function liveBudgets(userId, month) {
  const [budgets, categoryIds] = await Promise.all([
    Budget.find({ userId, month }).sort({ categoryId: 1, _id: 1 }),
    Category.find({ userId, deletedAt: null }).distinct('_id'),
  ]);
  const live = new Set(categoryIds.map(String));
  return budgets.filter((budget) => budget.categoryId === null || live.has(String(budget.categoryId)));
}

async function findOwnBudget(userId, budgetId) {
  const budget = await Budget.findOne({ _id: budgetId, userId });
  if (!budget) throw budgetNotFound();
  return budget;
}

// A budget limits spending, so its category must be one of the user's own expense categories.
async function checkCategory(userId, categoryId) {
  const category = await Category.findOne({ _id: categoryId, userId, deletedAt: null });
  if (!category) throw new AppError(404, 'NOT_FOUND', 'Category not found', [{ path: 'categoryId', issue: 'not_found' }]);
  if (category.type !== 'expense') {
    throw new AppError(400, 'VALIDATION_ERROR', 'categoryId must be an expense category', [{ path: 'categoryId', issue: 'type_mismatch' }]);
  }
}

// GET /budgets?month: the month's budgets with how much of each is used.
export async function listBudgets(userId, month, now = new Date()) {
  const [budgets, spent] = await Promise.all([liveBudgets(userId, month), spentInMonth(userId, month)]);
  return budgets.map((budget) => withUsage(budget, spent, now));
}

// POST /budgets. The unique index (docs/03) turns a second budget for the same category and month into 409.
export async function createBudget(userId, { month, categoryId, limit }) {
  if (categoryId) await checkCategory(userId, categoryId);
  let budget;
  try {
    budget = await Budget.create({ userId, month, categoryId, limit });
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'BUDGET_EXISTS', 'This month already has a budget for this category');
    throw err;
  }
  return withUsage(budget, await spentInMonth(userId, month), new Date());
}

// POST /budgets/copy: "copy last month". Budgets the target month already has are kept as they are.
export async function copyBudgets(userId, { from, to }) {
  const [source, existing] = await Promise.all([liveBudgets(userId, from), Budget.find({ userId, month: to })]);
  const taken = new Set(existing.map((budget) => String(budget.categoryId))); // 'null' for the overall budget
  const copies = source
    .filter((budget) => !taken.has(String(budget.categoryId)))
    .map(({ categoryId, limit }) => ({ userId, month: to, categoryId, limit }));
  await Budget.insertMany(copies);
  return { created: copies.length };
}

// PATCH /budgets/:id: only the limit changes; month and category are what the budget is.
export async function updateBudget(userId, budgetId, { limit }) {
  const budget = await findOwnBudget(userId, budgetId);
  budget.limit = limit;
  await budget.save();
  return withUsage(budget, await spentInMonth(userId, budget.month), new Date());
}

export async function deleteBudget(userId, budgetId) {
  const { deletedCount } = await Budget.deleteOne({ _id: budgetId, userId });
  if (deletedCount === 0) throw budgetNotFound();
}

// For the bots (T11) and /confirm after an expense is confirmed: the category's budget or the overall budget
// of that month once it is at least 80 % used, as { ...budget, spent, percent, pace, threshold: 80 | 100 }.
// When both are, the fuller one. null when neither budget exists or is that full.
export async function budgetWarning(userId, categoryId, month, now = new Date()) {
  const [budgets, spent] = await Promise.all([
    Budget.find({ userId, month, categoryId: mongoose.trusted({ $in: [categoryId, null] }) }),
    spentInMonth(userId, month),
  ]);
  const fullest = budgets
    .map((budget) => withUsage(budget, spent, now))
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit)[0];
  if (!fullest || fullest.spent * 100 < fullest.limit * 80) return null; // exact, not the rounded percent
  return { ...fullest, threshold: fullest.spent >= fullest.limit ? 100 : 80 };
}
