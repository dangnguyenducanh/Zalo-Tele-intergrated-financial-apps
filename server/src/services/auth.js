import { createHash, randomBytes } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { copyDefaultCategories } from './categories.js';
import { unlinkAllChats } from './chatLinks.js';
import { checkCode, codeExpired, dropIssued, issueCode, reissueCode, RESEND_WAIT_S } from './emailCodes.js';
import { canSendCodes, maskEmail, sendCode } from './mail.js';
import { endSessionChain, revokeAllSessions } from './sessions.js';
import { createDefaultWallet } from './wallets.js';

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

// Called for every new account: the "Tiền mặt / Cash" default wallet and a copy of every category template.
// Both steps skip users who already have that data, so `npm run seed` can also run it for older accounts.
export async function onUserRegistered(user) {
  await createDefaultWallet(user);
  await copyDefaultCategories(user);
}

// Creates a session row (one per device) and returns the tokens the client gets:
// a 15-minute JWT access token and a 7-day random refresh token for the `rt` cookie.
// A login starts a new chain; a rotation passes on the `chainStartedAt` of the session it replaces.
async function openSession(user, { userAgent, ip }, chainStartedAt = new Date()) {
  const refreshToken = randomBytes(32).toString('base64url');
  const session = await Session.create({
    userId: user._id,
    tokenHash: hashToken(refreshToken),
    userAgent,
    ip,
    chainStartedAt,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
  });
  const accessToken = jwt.sign({ role: user.role, sid: String(session._id) }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL,
    subject: String(user._id),
  });
  return { user, accessToken, refreshToken, session };
}

// Creates the account and opens its first session. Today's register, and the last step of a verified sign-up.
async function createAccount({ name, email, language, passwordHash }, client) {
  let user;
  try {
    user = await User.create({ name, email, language, passwordHash });
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'EMAIL_TAKEN', 'This email is already registered');
    throw err;
  }
  await onUserRegistered(user);
  return openSession(user, client);
}

// Register with mail off (production without the Gmail settings, docs/02 §2.12.4): no code, the account at once.
export async function register({ name, email, password, language }, client) {
  return createAccount({ name, email, language, passwordHash: await hashPassword(password) }, client);
}

// Register with mail on (docs/02 §2.12.2): no user yet, only a pending sign-up and a mailed code. The answer carries a
// random signupToken that only this request gets; the row keeps its hash, and verify needs it (decision D1).
export async function startSignup({ name, email, password, language = 'vi' }) {
  if (await User.exists({ email })) throw new AppError(409, 'EMAIL_TAKEN', 'This email is already registered');
  const signupToken = randomBytes(24).toString('base64url');
  const signup = { name, language, passwordHash: await hashPassword(password), tokenHash: hashToken(signupToken) };
  const issued = await issueCode({ purpose: 'signup', email, signup });
  try {
    await sendCode({ to: email, purpose: 'signup', code: issued.code, language });
  } catch {
    await dropIssued(issued); // nothing is left behind to block a retry; the mailer logged its safe error line
    throw new AppError(503, 'EMAIL_SEND_FAILED', "We couldn't send the email. Try again in a few minutes.");
  }
  return { email: maskEmail(email), resendAfter: RESEND_WAIT_S, signupToken };
}

// The right code, with the token that register returned, creates the account (docs/02 §2.12.2 step 5): the answer is
// today's register answer, and the row is already gone, so a second request with the same code finds nothing.
export async function verifySignup({ email, code, signupToken }, client) {
  const row = await checkCode({ purpose: 'signup', email, code, also: { 'signup.tokenHash': hashToken(signupToken) } });
  const { name, language, passwordHash } = row.signup;
  return createAccount({ name, email, language, passwordHash }, client);
}

// A new code for a pending sign-up. The answer is the same 202 for every address, pending or not, and also when the
// mail fails (decisions D5 and D6), so it never tells who is signing up; only a pending address can answer 429.
export async function resendSignup({ email }) {
  if (!canSendCodes()) throw new AppError(503, 'FEATURE_NOT_CONFIGURED', 'Email codes are not set up');
  const issued = await reissueCode({ purpose: 'signup', email });
  // The mail goes out in the background, so a failing mailer cannot show whether a sign-up was pending. The mailer
  // already logged its safe error line (masked address, error code), so there is nothing more to say here.
  if (issued) waitUntil(sendCode({ to: email, purpose: 'signup', code: issued.code, language: issued.row.signup.language }).catch(() => {}));
  return { resendAfter: RESEND_WAIT_S };
}

// Forgot password (docs/02 §2.12.3): the same 202 for every address. Every address gets a `reset` row with a code and goes
// through the same two database steps (decision D2), so neither the answer, a later wrong code on reset, nor a 429 on the
// second request shows whether the address has an account. Only an active user gets the mail, in the background.
export async function startReset({ email }) {
  if (!canSendCodes()) throw new AppError(503, 'FEATURE_NOT_CONFIGURED', 'Email codes are not set up');
  const issued = await issueCode({ purpose: 'reset', email });
  const user = await User.findOne({ email }).select('status language').lean();
  // The mailer already logged its safe error line (masked address, error code), so there is nothing more to say here.
  if (user?.status === 'active') waitUntil(sendCode({ to: email, purpose: 'reset', code: issued.code, language: user.language }).catch(() => {}));
  return { resendAfter: RESEND_WAIT_S };
}

// Reset (docs/02 §2.12.3): the right code, checked as in sign-up, sets the new password, signs out every device and
// unlinks every chat (decision D3). The code is spent before anything else is looked at: an account that is gone is
// CODE_EXPIRED and a locked one is 403 with nothing changed. No cookie and no token: the user logs in again.
export async function resetPassword({ email, code, newPassword }) {
  await checkCode({ purpose: 'reset', email, code });
  const user = await User.findOne({ email }).select('status').lean();
  if (!user) throw codeExpired();
  if (user.status === 'locked') throw accountLocked();
  const passwordHash = await hashPassword(newPassword);
  // The status is part of the write, so a lock that landed while the hash was made cannot be overwritten.
  const { matchedCount } = await User.updateOne({ _id: user._id, status: 'active' }, { passwordHash });
  if (!matchedCount) throw accountLocked();
  // In this order: login's re-check (BUG-040) sees the new hash first, then every session goes, then the chats.
  await revokeAllSessions(user._id);
  await unlinkAllChats(user._id);
}

export async function login({ email, password }, client) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const passwordOk = await checkPassword(password, user?.passwordHash);
  if (!user || !passwordOk) throw invalidCredentials();
  if (user.status === 'locked') throw accountLocked();
  const opened = await openSession(user, client);

  // BUG-040: the bcrypt check above takes a while, so a password change or an admin lock may have revoked every
  // session before this one existed, and its updateMany could not see it. Both write to the user first, so read the
  // user again now that the session exists: a changed hash means the password just checked is no longer valid (the
  // answer of a fresh login, 401), and a lock means 403. Either way the new session dies with the login.
  // "Log out other devices" leaves the hash alone, so a login overlapping it stays valid: its password is still right.
  // ponytail: ceiling: a lock then unlock inside one bcrypt window, or a login racing a theft revoke-all, keeps its session.
  const now = await User.findById(user._id).select('+passwordHash status').lean();
  const passwordChanged = !now || now.passwordHash !== user.passwordHash;
  if (passwordChanged || now.status === 'locked') {
    await Session.updateOne({ _id: opened.session._id }, { revokedAt: new Date() });
    throw passwordChanged ? invalidCredentials() : accountLocked();
  }
  return opened;
}

// How long after its rotation a refresh token may come back because its answer was lost (BUG-003).
const REUSE_GRACE_MS = 30_000;

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
  if (old) return rotate(old.userId, client, [old._id], chainStart(old));

  const used = await Session.findOne({ tokenHash });
  if (!used) throw invalidRefresh(); // unknown token: just 401
  // BUG-011: an admin lock revokes every session, so a locked user's token is never live here. Say why (403) before
  // the theft check below, which would only revoke the already revoked sessions again.
  if ((await User.findById(used.userId).select('status').lean())?.status === 'locked') throw accountLocked();
  if (!used.replacedBy) throw invalidRefresh(); // expired, or revoked by a logout: just 401

  // A token that was already rotated is back. If that happened moments ago and its replacement was never refreshed,
  // the browser most likely never got the answer (navigation, reload, network drop): revoke the unused
  // replacement and rotate again, so one valid chain remains.
  const replacement =
    now - used.revokedAt <= REUSE_GRACE_MS && (await Session.findOneAndUpdate({ _id: used.replacedBy, revokedAt: null }, { revokedAt: now }));
  if (replacement) return rotate(used.userId, client, [used._id, replacement._id], chainStart(used));

  // Otherwise either the user or a thief holds a copy, and we can't tell which: log out every device of that user.
  await revokeAllSessions(used.userId);
  throw invalidRefresh();
}

// Sessions created before T22 have no chainStartedAt; their own creation time is the best we know.
const chainStart = (session) => session.chainStartedAt ?? session.createdAt;

// Opens the next session and points the revoked ones at it (`replacedBy`), so a later reuse of any of them is caught.
async function rotate(userId, client, revokedIds, chainStartedAt) {
  const user = await User.findById(userId);
  if (!user) throw invalidRefresh();
  if (user.status === 'locked') throw accountLocked();
  const next = await openSession(user, client, chainStartedAt);

  // BUG-006: a "revoke every session" (theft, admin lock) may have run while we were between the claim above and
  // this new session, so its updateMany could not see it. It stamps the user first, so read the stamp again now:
  // if every session was revoked after this chain's login, the chain was meant to die, and the new session with it.
  // ponytail: compares two server clocks; a skew of a few ms only matters for a login made in those same ms.
  // BUG-010: logging out just this device marks every row of its chain, so read the rows this rotation claimed too.
  const now = await User.findById(userId).select('status sessionsRevokedAt').lean();
  const locked = now?.status === 'locked';
  const revokedAll = now?.sessionsRevokedAt && now.sessionsRevokedAt >= chainStartedAt;
  const loggedOut = await Session.exists({ _id: mongoose.trusted({ $in: revokedIds }), chainEndedAt: mongoose.trusted({ $ne: null }) });
  if (!now || locked || revokedAll || loggedOut) {
    await Session.updateOne({ _id: next.session._id }, { revokedAt: new Date() });
    throw locked ? accountLocked() : invalidRefresh();
  }
  await Session.updateMany({ _id: mongoose.trusted({ $in: revokedIds }) }, { replacedBy: next.session._id });
  return next;
}

// Logout is a server-side revoke, not just deleting the cookie in the browser. It ends this device's whole chain,
// so a refresh this device has running at the same moment (another tab) cannot keep it logged in (BUG-010).
export async function logout(refreshToken) {
  if (typeof refreshToken !== 'string' || !refreshToken) return;
  const session = await Session.findOne({ tokenHash: hashToken(refreshToken) });
  if (session) await endSessionChain(session);
}
