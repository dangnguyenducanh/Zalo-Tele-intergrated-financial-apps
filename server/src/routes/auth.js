import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rateLimit.js';
import * as auth from '../services/auth.js';
import { getUser } from '../services/users.js';

const router = Router();

const email = z.string().trim().toLowerCase().pipe(z.email());
export const newPassword = z.string().min(8).max(72); // bcrypt only uses the first 72 bytes
const registerBody = z.object({
  name: z.string().trim().min(1).max(60),
  email,
  password: newPassword,
  language: z.enum(['vi', 'en']).optional(),
});
const loginBody = z.object({ email, password: z.string().min(1) });

// The refresh token travels only in this cookie, and the browser sends it only to /api/auth (docs/04 §4.3).
const REFRESH_COOKIE = 'rt';
const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth' };

// Shown on the Settings → Sessions list, so the user can recognise each device.
const clientOf = (req) => ({ userAgent: req.get('user-agent') ?? '', ip: req.ip ?? '' });

function sendLogin(res, status, { user, accessToken, refreshToken }) {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions, maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000 });
  res.status(status).json({ accessToken, user });
}

router.post('/register', authRateLimit, async (req, res) => {
  sendLogin(res, 201, await auth.register(registerBody.parse(req.body), clientOf(req)));
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
