import mongoose from 'mongoose';
import { Session } from '../models/Session.js';
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

// Logs out one device. Only the owner's own active sessions match; anything else is 404 (docs/04 §4.3 Ownership).
export async function revokeSession(userId, sessionId) {
  const { matchedCount } = await Session.updateOne({ _id: sessionId, userId, revokedAt: null }, { revokedAt: new Date() });
  if (matchedCount === 0) throw new AppError(404, 'NOT_FOUND', 'Session not found');
}

// "Log out other devices": every session of the user except `keepSessionId`.
export async function revokeOtherSessions(userId, keepSessionId) {
  await Session.updateMany({ userId, revokedAt: null, _id: mongoose.trusted({ $ne: keepSessionId }) }, { revokedAt: new Date() });
}

// Used when a stolen refresh token is detected (and later by the admin lock, T15).
export async function revokeAllSessions(userId) {
  await Session.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
}
