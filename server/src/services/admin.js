import mongoose from 'mongoose';
import { Category } from '../models/Category.js';
import { ChatLink } from '../models/ChatLink.js';
import { Session } from '../models/Session.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { seedCategoryTemplates } from './categories.js';
import { revokeAllSessions } from './sessions.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const notFound = (what) => new AppError(404, 'NOT_FOUND', `${what} not found`);

// "a.b" typed in the search box is matched literally, not as a regular expression.
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /admin/users: newest accounts first. `q` matches part of the name or the email, ignoring case.
export async function listUsers({ q, role, status, page, limit }) {
  const filter = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i'); // a RegExp object, so sanitizeFilter leaves it alone
    filter.$or = [{ name: pattern }, { email: pattern }];
  }
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  return { items, total };
}

// PATCH /admin/users/:id {role?, status?}. Locking also logs the user out everywhere (docs/04 §4.3):
// their refresh tokens stop working at once, and their last access token expires within 15 minutes.
export async function updateUser(userId, changes) {
  const user = await User.findById(userId);
  if (!user) throw notFound('User');

  // The system must keep at least one active admin, or nobody could manage it any more.
  // ponytail: count-then-save, so two admins demoting each other at the same instant could both pass.
  const removesAnAdmin = user.role === 'admin' && user.status === 'active' && (changes.role === 'user' || changes.status === 'locked');
  if (removesAnAdmin && (await User.countDocuments({ role: 'admin', status: 'active' })) <= 1) {
    throw new AppError(409, 'LAST_ADMIN', 'The last administrator cannot be locked or demoted');
  }

  user.set(changes);
  await user.save();
  if (changes.status === 'locked') await revokeAllSessions(user._id);
  return user;
}

// Templates are the categories with userId null; register copies them (services/categories.js), so
// editing a template only changes what users who register later get (docs/03 §3.3).
async function findTemplate(templateId) {
  const template = await Category.findOne({ _id: templateId, userId: null, deletedAt: null });
  if (!template) throw notFound('Category template');
  return template;
}

// Before `npm run seed` the database has no templates and register uses the built-in defaults. Store
// those first, so the admin edits the real default set and a first new template never replaces it.
async function ensureTemplates() {
  if (!(await Category.exists({ userId: null }))) await seedCategoryTemplates();
}

export async function listTemplates({ type }) {
  await ensureTemplates();
  const filter = { userId: null, deletedAt: null };
  if (type) filter.type = type;
  return Category.find(filter).sort({ type: 1, isFallback: 1, _id: 1 });
}

export async function createTemplate(fields) {
  await ensureTemplates();
  return Category.create({ ...fields, userId: null });
}

export async function updateTemplate(templateId, changes) {
  const template = await findTemplate(templateId);
  template.set(changes);
  return template.save();
}

// Soft delete. Users who already have a copy keep it. The fallback templates stay, because every
// new user needs one "Khác / Other" per type for the transactions of categories they delete.
export async function deleteTemplate(templateId) {
  const template = await findTemplate(templateId);
  if (template.isFallback) throw new AppError(409, 'FALLBACK_CATEGORY', 'The fallback category cannot be deleted');
  template.deletedAt = new Date();
  await template.save();
}

// { telegram: 2, zalo: 0 } from aggregation rows like [{ _id: 'telegram', count: 2 }].
const countsByKey = (rows, keys) => Object.fromEntries(keys.map((key) => [key, rows.find((row) => row._id === key)?.count ?? 0]));

// GET /admin/stats: counts only. The admin never sees anyone's transactions (docs/02 §2.1).
export async function systemStats() {
  const weekAgo = new Date(Date.now() - 7 * DAY_MS);
  const [users, activeUserIds, links, transactions] = await Promise.all([
    User.countDocuments(),
    Session.distinct('userId', { lastUsedAt: mongoose.trusted({ $gte: weekAgo }) }), // logged in or refreshed
    ChatLink.aggregate([{ $group: { _id: '$platform', count: { $sum: 1 } } }]),
    Transaction.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$source', count: { $sum: 1 } } }]),
  ]);
  return {
    users,
    activeUsers7d: activeUserIds.length,
    chatLinks: countsByKey(links, ['telegram', 'zalo', 'whatsapp']),
    transactionsBySource: countsByKey(transactions, ['web', 'telegram', 'zalo', 'whatsapp', 'receipt']),
  };
}
