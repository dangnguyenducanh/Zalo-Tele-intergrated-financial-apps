import { rateLimit } from 'express-rate-limit';
import { canSendCodes } from '../services/mail.js';
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

// Gmail stops an account that sends too many mails to fake or mistyped addresses, and then nobody can sign up, so the
// code mails have their own per-IP guard (docs/02 §2.12.1): 10 requests per IP per 15 minutes on register, resend and
// password/forgot, successful ones included, which is why there is no skipSuccessfulRequests.
// Off when codes are off (production without the Gmail settings), because then nothing is mailed. 429 says when to retry.
// ponytail: in each instance's memory, best-effort like authRateLimit.
export const mailRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skip: () => !canSendCodes(),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) => {
    const retryAfter = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000));
    next(new AppError(429, 'RATE_LIMITED', 'Too many code emails, please try again later', { retryAfter }));
  },
});
