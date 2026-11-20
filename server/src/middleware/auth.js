import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// Checks the "Authorization: Bearer <jwt>" header and sets req.user = { id, role, sid } (docs/04 §4.3).
// No database lookup: a revoked session keeps working until its access token expires (15 min at most).
export function requireAuth(req, res, next) {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError(401, 'UNAUTHENTICATED', 'Login required');

  let claims;
  try {
    claims = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    // The client refreshes on TOKEN_EXPIRED and sends the user to the login page on anything else.
    if (err.name === 'TokenExpiredError') throw new AppError(401, 'TOKEN_EXPIRED', 'Access token expired');
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid access token');
  }
  req.user = { id: claims.sub, role: claims.role, sid: claims.sid };
  next();
}
