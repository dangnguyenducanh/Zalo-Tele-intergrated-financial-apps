import mongoose from 'mongoose';
import { Category } from '../models/Category.js';
import { Transaction } from '../models/Transaction.js';
import { DEFAULT_CATEGORIES } from '../seed/templates.js';
import { AppError } from '../utils/AppError.js';
import { normalize } from '../utils/normalize.js';
import { confirmedInRange } from './stats.js';

const categoryNotFound = () => new AppError(404, 'NOT_FOUND', 'Category not found');

// The fields a template passes on to each user's copy.
const copyOf = ({ type, names, keywords, icon, color, isFallback }) => ({ type, names, keywords, icon, color, isFallback });

// GET /categories: the user's own categories; per type the fallback ("Khác / Other") comes last.
export function listCategories(userId, { type } = {}) {
  const filter = { userId, deletedAt: null };
  if (type) filter.type = type;
  return Category.find(filter).sort({ type: 1, isFallback: 1, _id: 1 });
}

async function findOwnCategory(userId, categoryId) {
  const category = await Category.findOne({ _id: categoryId, userId, deletedAt: null });
  if (!category) throw categoryNotFound();
  return category;
}

// The names a category shows: its own name, or for an unrenamed default copy both language names.
const namesOf = (category) => (category.name ? [category.name] : [category.names?.vi, category.names?.en]);

// One name per type, ignoring upper/lower case ("ăn uống" = "Ăn uống"). A user has ~15 categories, so compare here.
async function assertNameFree(userId, type, name, exceptId) {
  const wanted = name.toLowerCase();
  const sameType = await Category.find({ userId, type, deletedAt: null });
  const taken = sameType.some((c) => !c._id.equals(exceptId) && namesOf(c).some((n) => n?.toLowerCase() === wanted));
  if (taken) throw new AppError(409, 'NAME_TAKEN', 'You already have a category with this name');
}

export async function createCategory(userId, fields) {
  await assertNameFree(userId, fields.type, fields.name);
  return Category.create({ ...fields, userId });
}

// PATCH: name, keywords, icon, colour. The type and the fallback flag stay fixed (routes/categories.js).
export async function updateCategory(userId, categoryId, changes) {
  const category = await findOwnCategory(userId, categoryId);
  if (changes.name) await assertNameFree(userId, category.type, changes.name, category._id);
  category.set(changes);
  return category.save();
}

// Soft delete. Its transactions (any status) move to the fallback category of the same type, so none are
// orphaned. The fallback itself cannot be deleted: it is where everything else ends up.
export async function deleteCategory(userId, categoryId) {
  const category = await findOwnCategory(userId, categoryId);
  if (category.isFallback) throw new AppError(409, 'FALLBACK_CATEGORY', 'The fallback category cannot be deleted');
  const fallback = await Category.findOne({ userId, type: category.type, isFallback: true, deletedAt: null });
  if (!fallback) throw new AppError(409, 'FALLBACK_CATEGORY', 'No fallback category to move the transactions to');

  // The Transaction model arrives with T07, so update its collection by name (docs/03 §3.3).
  await mongoose.connection
    .collection('transactions')
    .updateMany({ userId: category.userId, categoryId: category._id }, { $set: { categoryId: fallback._id } });
  category.deletedAt = new Date();
  await category.save();
}

// Part of onUserRegistered: copy every template (userId null) to the new user. Before `npm run seed` has
// stored templates the built-in defaults are used, so a new account always gets categories and fallbacks.
// Skipped when the user already has categories, so `npm run seed` can run it again for older accounts.
export async function copyDefaultCategories(user) {
  if (await Category.exists({ userId: user._id })) return;
  const templates = await Category.find({ userId: null, deletedAt: null }).sort({ _id: 1 }).lean();
  const source = templates.length > 0 ? templates : DEFAULT_CATEGORIES;
  await Category.insertMany(source.map((template) => ({ ...copyOf(template), userId: user._id })));
}

// `npm run seed`: store the default templates once. Later runs leave them alone, so admin edits survive.
export async function seedCategoryTemplates() {
  if (await Category.exists({ userId: null })) {
    console.info('seed: category templates already exist');
    return;
  }
  await Category.insertMany(DEFAULT_CATEGORIES.map((template) => ({ ...copyOf(template), userId: null })));
  console.info(`seed: created ${DEFAULT_CATEGORIES.length} category templates`);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KEYWORD_MAX = 50; // the same ceiling as the Categories page (routes/categories.js)

// A7: the categories a Khác/Other draft offers: the user's expense categories (not the fallback) by how many confirmed
// expenses each has had in the last 90 days, most first; when fewer than 3 have any, the rest follow in creation order.
export async function topExpenseCategories(userId, { now = new Date(), count = 3 } = {}) {
  const [used, own] = await Promise.all([
    Transaction.aggregate([
      { $match: { ...confirmedInRange(userId, new Date(now.getTime() - 90 * DAY_MS), now), type: 'expense' } },
      { $group: { _id: '$categoryId', n: { $sum: 1 } } },
      { $sort: { n: -1, _id: 1 } },
    ]),
    Category.find({ userId, type: 'expense', isFallback: false, deletedAt: null }).sort({ _id: 1 }).lean(),
  ]);
  const byId = new Map(own.map((category) => [String(category._id), category]));
  const ranked = used.map((row) => byId.get(String(row._id))).filter(Boolean);
  return [...ranked, ...own.filter((category) => !ranked.includes(category))].slice(0, count);
}

// A7: the first word of `note` (lower-case, no diacritics) becomes a keyword of the category, unless another of the user's
// categories has it already or the word is only digits. Returns the word when it was added, else null. The ownership check
// runs on every call, so a word learned meanwhere else is never taken over.
export async function learnKeyword(userId, categoryId, note) {
  const word = normalize(note).split(/[^a-z0-9]+/).find(Boolean);
  if (!word || /^\d+$/.test(word)) return null;
  const taken = await Category.exists({ userId, deletedAt: null, keywords: word, _id: mongoose.trusted({ $ne: categoryId }) });
  if (taken) return null;
  const { modifiedCount } = await Category.updateOne({ _id: categoryId, userId, [`keywords.${KEYWORD_MAX - 1}`]: mongoose.trusted({ $exists: false }) }, { $addToSet: { keywords: word } });
  return modifiedCount > 0 ? word : null;
}
