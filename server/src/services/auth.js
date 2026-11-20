import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { revokeAllSessions } from './sessions.js';

const BCRYPT_COST = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
// A real bcrypt hash of a throw-away password: login compares against it when the email is unknown,
// so "unknown email" takes as long as "wrong password" and the timing does not reveal who has an account.
const DUMMY_HASH = '$2b$10$nZLRGvMmaECOVJTNdT6XruGeWGF6LOrfuRA85JyPcK9PsaPgfxZWm';

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Wrong email or password');
const invalidRefresh = () => new AppError(401, 'INVALID_REFRESH', 'Please log in again');
const accountLocked = () => new AppError(403, 'ACCOUNT_LOCKED', 'This account is locked');

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_COST);
export const checkPassword = (password, hash) => bcrypt.compare(password, hash ?? DUMMY_HASH);

// Refresh tokens are stored only as this hash, so a database leak does not hand out working tokens.
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// Called once for every new account. T05 fills it with the default wallet and categories.
export async function onUserRegistered(_user) {}

// Creates a session row (one per device) and returns the tokens the client gets:
// a 15-minute JWT access token and a 7-day random refresh token for the `rt` cookie.
async function openSession(user, { userAgent, ip }) {
  const refreshToken = randomBytes(32).toString('base64url');
  const session = await Session.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    userAgent,
    ip,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
  });
  const accessToken = jwt.sign({ role: user.role, sid: String(session._id) }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL,
    subject: String(user._id),
  });
  return { user, accessToken, refreshToken, session };
}

export async function register({ name, email, password, language }, client) {
  let user;
  try {
    user = await User.create({ name, email, language, passwordHash: await hashPassword(password) });
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'EMAIL_TAKEN', 'This email is already registered');
    throw err;
  }
  await onUserRegistered(user);
  return openSession(user, client);
}

export async function login({ email, password }, client) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const passwordOk = await checkPassword(password, user?.passwordHash);
  if (!user || !passwordOk) throw invalidCredentials();
  if (user.status === 'locked') throw accountLocked();
  return openSession(user, client);
}

// Rotation (docs/04 §4.3): every refresh revokes the presented session and opens a new one.
export async function refresh(refreshToken, client) {
  if (typeof refreshToken !== 'string' || !refreshToken) throw invalidRefresh();
  const tokenHash = hashToken(refreshToken);
  const now = new Date();

  // Claim the session atomically, so two requests with the same token cannot both rotate it.
  const old = await Session.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: mongoose.trusted({ $gt: now }) },
    { revokedAt: now, lastUsedAt: now },
  );
  if (!old) {
    // A token that was already rotated is being used again: either the user or a thief holds a copy.
    // We can't tell which, so log out every device of that user. (Tokens revoked by logout just get 401.)
    const used = await Session.findOne({ tokenHash });
    if (used?.replacedBy) await revokeAllSessions(used.userId);
    throw invalidRefresh();
  }

  const user = await User.findById(old.userId);
  if (!user) throw invalidRefresh();
  if (user.status === 'locked') throw accountLocked();
  const next = await openSession(user, client);
  await Session.updateOne({ _id: old._id }, { replacedBy: next.session._id });
  return next;
}

// Logout is a server-side revoke, not just deleting the cookie in the browser.
export async function logout(refreshToken) {
  if (typeof refreshToken !== 'string' || !refreshToken) return;
  await Session.updateOne({ tokenHash: hashToken(refreshToken), revokedAt: null }, { revokedAt: new Date() });
}
