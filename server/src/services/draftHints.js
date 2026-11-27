import mongoose from 'mongoose';
import { Transaction } from '../models/Transaction.js';
import { confirmedInRange } from './stats.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90; // the "usual" amount of a category: its median over the last 90 days
const MIN_SAMPLES = 5; // fewer than that is not a usual amount yet
const BIG_TIMES = 5; // an amount this many times the median is probably a typo ("phở 450")…
const BIG_TIMES_GUESSED = 3; // …or 3 times when the parser guessed thousands from a bare number
const DUPLICATE_MS = 10 * 60 * 1000;

// Up to 2 warnings about a draft that is about to be shown (docs/02 §2.11.2, A6), as codes the chat and the web turn into
// text in the user's language: { code: 'big', times, median } and { code: 'duplicate' }. `draft` is { amount, categoryId, id? }:
// `id` is the draft itself, which is not a duplicate of itself. `guessed`: the parser read a bare number as thousands.
export async function draftHints(userId, { amount, categoryId, id }, { now = new Date(), guessed = false } = {}) {
  if (!categoryId) return []; // the user has no category of that type: nothing to compare with
  const [median, duplicate] = await Promise.all([categoryMedian(userId, categoryId, now), hasDuplicate(userId, { amount, categoryId, id }, now)]);
  const limit = guessed ? BIG_TIMES_GUESSED : BIG_TIMES;
  const hints = [];
  if (median && amount >= limit * median.value) hints.push({ code: 'big', times: Math.floor(amount / median.value), median: median.value });
  if (duplicate) hints.push({ code: 'duplicate' });
  return hints;
}

// The median amount of the category's confirmed transactions of the last 90 days, or null with fewer than 5.
async function categoryMedian(userId, categoryId, now) {
  const rows = await Transaction.aggregate([
    { $match: { ...confirmedInRange(userId, new Date(now.getTime() - WINDOW_DAYS * DAY_MS), now), categoryId: new mongoose.Types.ObjectId(String(categoryId)) } },
    { $project: { _id: 0, amount: 1 } },
  ]);
  if (rows.length < MIN_SAMPLES) return null;
  const amounts = rows.map((row) => row.amount).sort((a, b) => a - b);
  const middle = amounts.length >> 1;
  return { value: amounts.length % 2 ? amounts[middle] : Math.round((amounts[middle - 1] + amounts[middle]) / 2) };
}

// Another transaction (a draft or a saved one) with the same amount and category made in the last 10 minutes.
function hasDuplicate(userId, { amount, categoryId, id }, now) {
  const filter = { userId, amount, categoryId, deletedAt: null, createdAt: mongoose.trusted({ $gte: new Date(now.getTime() - DUPLICATE_MS) }) }; // operators the server built itself (config/db.js)
  if (id) filter._id = mongoose.trusted({ $lt: id }); // the draft's own row, and drafts made after it, are not "earlier"
  return Transaction.exists(filter);
}
