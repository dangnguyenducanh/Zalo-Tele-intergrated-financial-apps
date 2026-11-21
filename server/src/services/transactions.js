import mongoose from 'mongoose';
import { parseText } from '../bot/parser.js';
import { Category } from '../models/Category.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import { AppError } from '../utils/AppError.js';
import { monthKey, vnDate } from '../utils/vnTime.js';
import { budgetWarning } from './budgets.js';

const notFound = () => new AppError(404, 'NOT_FOUND', 'Transaction not found');

async function findOwnTransaction(userId, transactionId) {
  const transaction = await Transaction.findOne({ _id: transactionId, userId, deletedAt: null });
  if (!transaction) throw notFound();
  return transaction;
}

// The wallet and category a transaction points at must be the user's own and not deleted (else 404), and
// the category must be of the transaction's type: an expense filed under "Lương" would break the statistics.
async function checkReferences(userId, { type, walletId, categoryId }) {
  const [wallet, category] = await Promise.all([
    Wallet.exists({ _id: walletId, userId, deletedAt: null }),
    Category.findOne({ _id: categoryId, userId, deletedAt: null }),
  ]);
  if (!wallet) throw new AppError(404, 'NOT_FOUND', 'Wallet not found', [{ path: 'walletId', issue: 'not_found' }]);
  if (!category) throw new AppError(404, 'NOT_FOUND', 'Category not found', [{ path: 'categoryId', issue: 'not_found' }]);
  if (category.type !== type) {
    throw new AppError(400, 'VALIDATION_ERROR', `categoryId must be an ${type} category`, [{ path: 'categoryId', issue: 'type_mismatch' }]);
  }
}

// "2026-11-20" → the instant that Vietnamese calendar day starts; `nextDay` gives the start of the day after.
function dayStart(day, nextDay = false) {
  const [year, month, date] = day.split('-').map(Number);
  return vnDate(year, month, date + (nextDay ? 1 : 0));
}

// Text search on the note, case-insensitive, with regex characters matched literally.
// ponytail: "pho" does not find "phở"; add a normalized note field if accent-free search is wanted.
const contains = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

// GET /transactions: the user's non-deleted transactions, filtered, sorted and one page at a time.
// `from`/`to` are Vietnamese calendar days and both are included.
export async function listTransactions(userId, { from, to, type, walletId, categoryId, status, source, q, page, limit, sort }) {
  const filter = { userId, deletedAt: null };
  for (const [key, value] of Object.entries({ type, walletId, categoryId, status, source })) {
    if (value) filter[key] = value;
  }
  if (from || to) {
    const range = {};
    if (from) range.$gte = dayStart(from);
    if (to) range.$lt = dayStart(to, true);
    filter.occurredAt = mongoose.trusted(range); // operators the server built itself (see config/db.js)
  }
  if (q) filter.note = contains(q);

  const field = sort.replace(/^-/, '');
  const direction = sort.startsWith('-') ? -1 : 1;
  const [items, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ [field]: direction, _id: direction }) // _id breaks ties, so pages never overlap
      .skip((page - 1) * limit)
      .limit(limit),
    Transaction.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

export const getTransaction = findOwnTransaction;

// POST /transactions: web entries are saved straight away as confirmed.
export async function createTransaction(userId, fields) {
  await checkReferences(userId, fields);
  return Transaction.create({ ...fields, userId, status: 'confirmed', source: 'web' });
}

// PATCH /transactions/:id: works on drafts too (the Bot inbox edits them before confirming).
export async function updateTransaction(userId, transactionId, changes) {
  const transaction = await findOwnTransaction(userId, transactionId);
  transaction.set(changes);
  if (changes.type || changes.walletId || changes.categoryId) await checkReferences(userId, transaction);
  return transaction.save();
}

// DELETE /transactions/:id: soft delete, so the web can offer "Undo" (restore).
export async function deleteTransaction(userId, transactionId) {
  const transaction = await findOwnTransaction(userId, transactionId);
  transaction.deletedAt = new Date();
  await transaction.save();
}

// POST /transactions/:id/restore: undo a delete, unless its wallet has been deleted since.
export async function restoreTransaction(userId, transactionId) {
  const transaction = await Transaction.findOne({ _id: transactionId, userId, deletedAt: mongoose.trusted({ $ne: null }) });
  if (!transaction) throw notFound();
  await checkReferences(userId, transaction);
  transaction.deletedAt = null;
  return transaction.save();
}

const alreadyConfirmed = () => new AppError(409, 'ALREADY_CONFIRMED', 'This transaction is already confirmed');

// POST /transactions/:id/confirm: a bot or receipt draft becomes real money. The bots call it too.
// `changes` are the Bot inbox's edits (same fields as PATCH). They are saved in the same write as the confirm,
// and that write only matches a draft: if the chat confirmed it a moment earlier, nothing changes (409).
// After an expense, `budgetWarning` is added when its category or overall budget for that month is ≥ 80 % used.
export async function confirmTransaction(userId, transactionId, changes = {}) {
  const draft = await findOwnTransaction(userId, transactionId);
  if (draft.status === 'confirmed') throw alreadyConfirmed();
  draft.set(changes);
  await checkReferences(userId, draft); // a draft may point at a wallet deleted since it was made
  await draft.validate();
  const transaction = await Transaction.findOneAndUpdate(
    { _id: draft._id, userId, status: 'draft', deletedAt: null },
    { ...changes, status: 'confirmed' },
    { returnDocument: 'after' },
  );
  if (!transaction) throw alreadyConfirmed(); // confirmed (or discarded) by a chat between the read and this write
  const warning = transaction.type === 'expense' && (await budgetWarning(userId, transaction.categoryId, monthKey(transaction.occurredAt)));
  return warning ? { transaction, budgetWarning: warning } : { transaction };
}

// POST /transactions/parse: the bot parser on the user's own categories and wallets. Nothing is saved.
export async function parseTransactions(userId, text, now = new Date()) {
  const [categories, wallets, user] = await Promise.all([
    Category.find({ userId, deletedAt: null }).sort({ _id: 1 }).lean(),
    Wallet.find({ userId, deletedAt: null, archived: false }).sort({ createdAt: 1, _id: 1 }).lean(),
    User.findById(userId).lean(),
  ]);
  // An archived default (set before archiving cleared it) is ignored, like a deleted one: new money goes to an active wallet.
  const defaultWalletId = wallets.find((wallet) => wallet._id.equals(user?.defaultWalletId))?._id;
  const results = parseText(text, { categories, wallets, defaultWalletId, now }); // null where a line has no amount
  const drafts = results.filter(Boolean);
  if (drafts.length === 0) throw new AppError(422, 'NO_AMOUNT_FOUND', 'No amount found, e.g. "phở 45k"');
  // So the quick add can say which lines would not be saved: line numbers as typed (1 = first line).
  const lineNumbers = text.split(/\r?\n/).flatMap((line, i) => (line.trim() ? [i + 1] : []));
  const noAmountLines = results.flatMap((result, i) => (result ? [] : [lineNumbers[i]]));
  return { drafts, noAmountLines, truncated: lineNumbers.length > results.length }; // the parser reads 10 lines at most
}
