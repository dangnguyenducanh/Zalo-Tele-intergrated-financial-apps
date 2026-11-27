import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit, mailRateLimit } from '../middleware/rateLimit.js';
import * as auth from '../services/auth.js';
import { canSendCodes } from '../services/mail.js';
import { getUser } from '../services/users.js';

const router = Router();

const email = z.string().trim().toLowerCase().pipe(z.email());
// bcrypt only reads the first 72 bytes and ignores the rest. A Vietnamese letter takes 2–3 bytes, so the limit
// counts bytes, not characters (BUG-009); the client checks the same rule (features/auth/validation.ts).
export const newPassword = z
  .string()
  .min(8)
  .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, 'Password is longer than 72 bytes');
const registerBody = z.object({
  name: z.string().trim().min(1).max(60),
  email,
  password: newPassword,
  language: z.enum(['vi', 'en']).optional(),
});
const loginBody = z.object({ email, password: z.string().min(1) });
const verifyBody = z.object({ email, code: z.string().regex(/^\d{6}$/), signupToken: z.string().min(1).max(256) });
const resendBody = z.object({ email });

// The refresh token travels only in this cookie, and the browser sends it only to /api/auth (docs/04 §4.3).
const REFRESH_COOKIE = 'rt';
const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth' };

// Shown on the Settings → Sessions list, so the user can recognise each device.
const clientOf = (req) => ({ userAgent: req.get('user-agent') ?? '', ip: req.ip ?? '' });

function sendLogin(res, status, { user, accessToken, refreshToken }) {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions, maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 });
  res.status(status).json({ accessToken, user });
}

// With mail on: 202 and a code in the user's inbox, no account yet. With mail off: today's 201 and a session.
router.post('/register', authRateLimit, mailRateLimit, async (req, res) => {
  const body = registerBody.parse(req.body);
  if (!canSendCodes()) return sendLogin(res, 201, await auth.register(body, clientOf(req)));
  res.status(202).json(await auth.startSignup(body));
});

// No per-IP limit (decision D7): the 5 tries per code and the token that only the registering tab holds are the guard.
router.post('/register/verify', async (req, res) => {
  sendLogin(res, 201, await auth.verifySignup(verifyBody.parse(req.body), clientOf(req)));
});

router.post('/register/resend', mailRateLimit, async (req, res) => {
  res.status(202).json(await auth.resendSignup(resendBody.parse(req.body)));
});

router.post('/login', authRateLimit, async (req, res) => {
  sendLogin(res, 200, await auth.login(loginBody.parse(req.body), clientOf(req)));
});

router.post('/refresh', async (req, res) => {
  sendLogin(res, 200, await auth.refresh(req.cookies[REFRESH_COOKIE], clientOf(req)));
});

router.post('/logout', async (req, res) => {
  await auth.logout(req.cookies[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.sendStatus(204);
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await getUser(req.user.id) });
});

export default router;
