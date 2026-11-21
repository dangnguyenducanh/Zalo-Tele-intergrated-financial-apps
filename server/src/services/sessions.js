import mongoose from 'mongoose';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';

// The logged-in user's active sessions for Settings → Sessions; `current` marks the one making the request.
export async function listSessions({ id: userId, sid }) {
  const sessions = await Session.find({ userId, revokedAt: null, expiresAt: mongoose.trusted({ $gt: new Date() }) }).sort({
    lastUsedAt: -1,
  });
  return sessions.map((s) => ({
    id: String(s._id),
    userAgent: s.userAgent,
    ip: s.ip,
    lastUsedAt: s.lastUsedAt,
    current: String(s._id) === sid,
  }));
}

// Logs out one device from Settings. Only the owner's own sessions match, and a device already logged out is
// 404 (docs/04 §4.3 Ownership). The id may be of a row the device has rotated since the list was loaded.
export async function revokeSession(userId, sessionId) {
  const session = await Session.findOne({ _id: sessionId, userId, chainEndedAt: null });
  if (!session) throw new AppError(404, 'NOT_FOUND', 'Session not found');
  await endSessionChain(session);
}

// Logs out the device that `session` belongs to: every row of its rotation chain (BUG-010). The rows are marked
// first: a refresh of that device running at this moment may insert its next session after the second updateMany
// has passed, but it checks the mark after inserting (rotate() in auth.js), so the new session is caught either way.
// ponytail: a chain is found by userId + chainStartedAt; two logins of one user in the same millisecond would share it.
export async function endSessionChain(session) {
  const now = new Date();
  const chainStartedAt = session.chainStartedAt ?? session.createdAt; // rows from before T22 lack it (auth.js chainStart)
  const chain = { userId: session.userId, $or: [{ _id: session._id }, { chainStartedAt }] };
  await Session.updateMany(chain, { chainEndedAt: now });
  await Session.updateMany({ ...chain, revokedAt: null }, { revokedAt: now });
}

// "Log out other devices" and a password change: every session of the user except `keepSessionId` (null: all).
// The stamp on the user is written first (BUG-006, BUG-010): a refresh running at this moment may insert its new
// session after the updateMany below has passed, but it checks the stamp after inserting (rotate() in auth.js), so the
// new session is caught by one or the other. The kept session's chain is first moved past the stamp so it lives on.
export async function revokeOtherSessions(userId, keepSessionId) {
  const now = new Date();
  if (keepSessionId) await Session.updateOne({ _id: keepSessionId, userId }, { chainStartedAt: new Date(now.getTime() + 1) });
  await User.updateOne({ _id: userId }, { sessionsRevokedAt: now });
  await Session.updateMany({ userId, revokedAt: null, _id: mongoose.trusted({ $ne: keepSessionId }) }, { revokedAt: now });
}

// Used when a stolen refresh token is detected and by the admin lock (T15).
export const revokeAllSessions = (userId) => revokeOtherSessions(userId, null);
