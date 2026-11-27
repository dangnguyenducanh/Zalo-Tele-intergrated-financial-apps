import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { EmailCode } from '../models/EmailCode.js';
import { AppError } from '../utils/AppError.js';

// The 6-digit email codes (docs/02 §2.12.1, docs/03 §3.8). One row per purpose ('signup' | 'reset') and address.
// Shared by sign-up and password reset: it knows codes and limits, nothing about users or mail.

export const RESEND_WAIT_S = 60; // not before 60 s after the last send...
const SENDS_PER_HOUR = 5; // ...and at most 5 sends an hour
const HOUR_MS = 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export const makeCode = () => String(crypto.randomInt(1_000_000)).padStart(6, '0'); // "004215" keeps its zeros
export const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');
// Both sides are SHA-256 hex, so equal length; the comparison takes the same time wherever they differ.
export const sameHash = (a, b) => crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

// Rows match only while another send is allowed: the newest send is 60 s old (or none) and fewer than 5 sends fall in
// the last hour (the row keeps the last 5, oldest first, so the 5th-last one is `sends.0`). In one filter, so the
// check and the write are one atomic step and parallel requests cannot all pass it.
// ponytail: `sends` is oldest first because each send pushes its own clock; two instances a few ms apart can swap the
// last two, which only moves the 60 s wait by that much.
function sendAllowed(purpose, email, now) {
  const wait = new Date(+now - RESEND_WAIT_S * 1000);
  const hour = new Date(+now - HOUR_MS);
  return {
    purpose,
    email,
    sends: mongoose.trusted({ $not: { $elemMatch: { $gt: wait } } }),
    $or: [{ 'sends.4': mongoose.trusted({ $exists: false }) }, { 'sends.0': mongoose.trusted({ $lte: hour }) }],
  };
}

// What a send writes: a new code (tries back to 0, 10 minutes), the send time (last 5 kept), the row's end of life.
function newCode(now) {
  const code = makeCode();
  return {
    code,
    update: {
      $set: { codeHash: hashCode(code), codeExpiresAt: new Date(+now + CODE_TTL_MS), attempts: 0, expiresAt: new Date(+now + HOUR_MS) },
      $push: { sends: { $each: [now], $slice: -SENDS_PER_HOUR } },
    },
  };
}

// 429 for a refused send, with the seconds until the next one is allowed. A row we cannot read any more says 60.
async function tooOften(purpose, email) {
  const row = await EmailCode.findOne({ purpose, email }).select('sends').lean();
  const sends = row?.sends ?? [];
  const now = Date.now();
  let next = sends.length ? +sends.at(-1) + RESEND_WAIT_S * 1000 : now + RESEND_WAIT_S * 1000;
  if (sends.length >= SENDS_PER_HOUR) next = Math.max(next, +sends[0] + HOUR_MS);
  const retryAfter = Math.max(1, Math.ceil((next - now) / 1000));
  return new AppError(429, 'RATE_LIMITED', 'Please wait before asking for another code', { retryAfter });
}

// A new code for the address: creates the row or replaces the code in it, in one atomic upsert that enforces both
// limits. Returns { code, row } (the code is never stored; the caller mails it). A write the filter refuses reaches
// the unique index (the row exists but may not send yet) and is a 429, like any other refused write.
// `signup` is set only by register: it replaces the sign-up data, and with it the earlier tab's token.
export async function issueCode({ purpose, email, signup }) {
  const now = new Date();
  const { code, update } = newCode(now);
  if (signup) update.$set.signup = signup;
  try {
    const row = await EmailCode.findOneAndUpdate(sendAllowed(purpose, email, now), update, { upsert: true, returnDocument: 'after' });
    return { code, row };
  } catch (err) {
    if (err.code === 11000) throw await tooOften(purpose, email);
    throw err;
  }
}

// A new code for a row that already exists (docs/02 §2.12.2 step 6, decision D5): never creates one. Returns
// { code, row }, or null when nothing is pending (no row, or one past its hour that MongoDB has not swept yet), in
// which case nothing is written. Past a limit it is a 429, as in issueCode.
export async function reissueCode({ purpose, email }) {
  const now = new Date();
  const { code, update } = newCode(now);
  const row = await EmailCode.findOneAndUpdate({ ...sendAllowed(purpose, email, now), expiresAt: mongoose.trusted({ $gt: now }) }, update, { returnDocument: 'after' });
  if (row) return { code, row };
  if (!(await EmailCode.exists({ purpose, email, expiresAt: mongoose.trusted({ $gt: now }) }))) return null;
  throw await tooOften(purpose, email);
}

// Takes a failed send's row away, unless a newer send already replaced the code in it.
export const dropIssued = ({ row }) => EmailCode.deleteOne({ _id: row._id, codeHash: row.codeHash });

// The answer for a code that cannot be used any more, and for a reset whose account is gone.
export const codeExpired = () => new AppError(400, 'CODE_EXPIRED', 'This code has expired. Send a new one.');

// Checks a code (docs/02 §2.12.2 step 5). `also` narrows the live row (sign-up adds the token's hash). Returns the row,
// now deleted, when the code is right. Wrong: 400 CODE_INVALID with the tries left. No live row (none, 10 minutes
// gone, 5 tries used, a token that doesn't match), or another request used the right code first: 400 CODE_EXPIRED.
export async function checkCode({ purpose, email, code, also = {} }) {
  // One atomic $inc on a live row: parallel guesses each take their own try, so 5 tries cannot become 50.
  const row = await EmailCode.findOneAndUpdate(
    { purpose, email, ...also, codeExpiresAt: mongoose.trusted({ $gt: new Date() }), attempts: mongoose.trusted({ $lt: MAX_ATTEMPTS }) },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  );
  if (!row) throw codeExpired();
  if (!sameHash(row.codeHash, hashCode(code))) {
    throw new AppError(400, 'CODE_INVALID', 'The code is wrong', { attemptsLeft: Math.max(0, MAX_ATTEMPTS - row.attempts) });
  }
  // Two equal requests both get here; only the one that deletes the row wins.
  const won = await EmailCode.findOneAndDelete({ _id: row._id, codeHash: row.codeHash });
  if (!won) throw codeExpired();
  return won;
}
