import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { checkPassword, hashPassword, onUserRegistered } from './auth.js';
import { revokeOtherSessions } from './sessions.js';

const userNotFound = () => new AppError(404, 'NOT_FOUND', 'User not found');

export async function getUser(userId) {
  const user = await User.findById(userId);
  if (!user) throw userNotFound();
  return user;
}

// PATCH /users/me. `changes` was already filtered by zod to name, language, theme and defaultWalletId.
export async function updateMe(userId, changes) {
  if (changes.defaultWalletId) await assertOwnWallet(userId, changes.defaultWalletId);
  const user = await User.findByIdAndUpdate(userId, changes, { returnDocument: 'after', runValidators: true });
  if (!user) throw userNotFound();
  return user;
}

// The default wallet must be one of the user's own, non-deleted wallets. The Wallet model arrives with T05,
// so this reads the `wallets` collection (docs/03 §3.3) directly.
async function assertOwnWallet(userId, walletId) {
  const wallet = await mongoose.connection.collection('wallets').findOne({
    _id: new mongoose.Types.ObjectId(walletId),
    userId: new mongoose.Types.ObjectId(userId),
    deletedAt: null,
  });
  if (!wallet) throw new AppError(404, 'NOT_FOUND', 'Wallet not found');
}

// PATCH /users/me/password: needs the current password, then logs out every other device.
export async function changePassword({ id: userId, sid }, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !(await checkPassword(currentPassword, user.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong password');
  }
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  await revokeOtherSessions(userId, sid);
}

// `npm run seed` creates the admin; `npm run seed:test` also creates userA and userB (docs/07 §7.2).
// Accounts come from the environment and are only created when missing, so running it twice is safe.
export async function seedUsers(source, { test = false } = {}) {
  const accounts = [{ envPrefix: 'SEED_ADMIN', name: 'Admin', role: 'admin' }];
  if (test) accounts.push({ envPrefix: 'TEST_USER_A', name: 'User A', role: 'user' }, { envPrefix: 'TEST_USER_B', name: 'User B', role: 'user' });

  for (const { envPrefix, name, role } of accounts) {
    const email = source[`${envPrefix}_EMAIL`]?.toLowerCase();
    const password = source[`${envPrefix}_PASSWORD`];
    if (!email || !password) {
      console.info(`seed: ${envPrefix}_EMAIL / ${envPrefix}_PASSWORD not set, skipped`);
    } else if (await User.exists({ email })) {
      console.info(`seed: ${envPrefix} user already exists`);
    } else {
      const user = await User.create({ email, name, role, passwordHash: await hashPassword(password) });
      await onUserRegistered(user);
      console.info(`seed: created ${envPrefix} user`);
    }
  }
}
