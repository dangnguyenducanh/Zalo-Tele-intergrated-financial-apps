import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import { DEFAULT_WALLET } from '../seed/templates.js';
import { AppError } from '../utils/AppError.js';

const walletNotFound = () => new AppError(404, 'NOT_FOUND', 'Wallet not found');
const nameTaken = () => new AppError(409, 'NAME_TAKEN', 'You already have a wallet with this name');

// The Transaction model arrives with T07; until then (and after) we read its collection by name (docs/03 §3.3).
const transactions = () => mongoose.connection.collection('transactions');
const objectId = (id) => new mongoose.Types.ObjectId(String(id));

// One aggregation over the user's confirmed, non-deleted transactions → Map(walletId → income − expense).
async function netByWallet(userId) {
  const rows = await transactions()
    .aggregate([
      { $match: { userId: objectId(userId), status: 'confirmed', deletedAt: null } },
      {
        $group: {
          _id: '$walletId',
          net: { $sum: { $cond: [{ $eq: ['$type', 'income'] }, '$amount', { $multiply: ['$amount', -1] }] } },
        },
      },
    ])
    .toArray();
  return new Map(rows.map((row) => [String(row._id), row.net]));
}

// Current balance = initialBalance + Σincome − Σexpense. It is computed on every read, never stored.
const withBalance = (wallet, net) => ({ ...wallet.toJSON(), balance: wallet.initialBalance + (net.get(String(wallet._id)) ?? 0) });

async function findOwnWallet(userId, walletId) {
  const wallet = await Wallet.findOne({ _id: walletId, userId, deletedAt: null });
  if (!wallet) throw walletNotFound();
  return wallet;
}

// Saves the wallet and turns a duplicate name (unique index, docs/03) into 409 NAME_TAKEN.
async function saveWallet(wallet) {
  try {
    return await wallet.save();
  } catch (err) {
    if (err.code === 11000) throw nameTaken();
    throw err;
  }
}

// GET /wallets: archived wallets are hidden from pickers unless asked for.
export async function listWallets(userId, { includeArchived = false } = {}) {
  const filter = { userId, deletedAt: null };
  if (!includeArchived) filter.archived = false;
  const [wallets, net] = await Promise.all([Wallet.find(filter).sort({ createdAt: 1, _id: 1 }), netByWallet(userId)]);
  return wallets.map((wallet) => withBalance(wallet, net));
}

export async function getWallet(userId, walletId) {
  const [wallet, net] = await Promise.all([findOwnWallet(userId, walletId), netByWallet(userId)]);
  return withBalance(wallet, net);
}

export async function createWallet(userId, fields) {
  const wallet = await saveWallet(new Wallet({ ...fields, userId }));
  return withBalance(wallet, new Map()); // a new wallet has no transactions yet
}

export async function updateWallet(userId, walletId, changes) {
  const wallet = await findOwnWallet(userId, walletId);
  wallet.set(changes);
  await saveWallet(wallet);
  return withBalance(wallet, await netByWallet(userId));
}

// Soft delete, refused while a confirmed transaction still uses the wallet (its balance would vanish).
export async function deleteWallet(userId, walletId) {
  const wallet = await findOwnWallet(userId, walletId);
  const inUse = await transactions().findOne({ userId: objectId(userId), walletId: wallet._id, status: 'confirmed', deletedAt: null });
  if (inUse) throw new AppError(409, 'WALLET_IN_USE', 'This wallet still has transactions');
  wallet.deletedAt = new Date();
  await wallet.save();
  // The bot must not keep adding to a deleted wallet: without a default it falls back to another wallet.
  await User.updateOne({ _id: userId, defaultWalletId: wallet._id }, { defaultWalletId: null });
}

// Part of onUserRegistered: the "Tiền mặt / Cash" wallet, named in the user's language, becomes the default.
// Skipped when the user already has wallets, so `npm run seed` can run it again for older accounts.
export async function createDefaultWallet(user) {
  if (await Wallet.exists({ userId: user._id })) return;
  const { names, ...fields } = DEFAULT_WALLET;
  const wallet = await Wallet.create({ ...fields, name: names[user.language] ?? names.vi, userId: user._id, initialBalance: 0 });
  user.defaultWalletId = wallet._id;
  await user.save();
}
