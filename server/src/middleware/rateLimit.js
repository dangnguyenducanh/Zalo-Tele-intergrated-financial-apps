import { rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/AppError.js';

// Brute-force guard on /auth/login and /auth/register (docs/04 §4.3): after 10 failed attempts from one IP
// within 15 minutes, every further attempt answers 429 until the window ends. Successful calls do not count,
// so people sharing one IP (a family, a class, the demo) are never blocked by normal logins.
// ponytail: the counter lives in each Vercel instance's memory (best-effort); use a MongoDB store if it must be exact.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many attempts, please try again later')),
});
