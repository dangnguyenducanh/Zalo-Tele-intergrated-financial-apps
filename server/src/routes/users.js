import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { changePassword, updateMe } from '../services/users.js';
import { newPassword } from './auth.js';

const router = Router();
router.use(requireAuth);

// Unknown fields (role, email, status, …) are dropped by zod, so they can never be changed here.
const profileBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  language: z.enum(['vi', 'en']).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  defaultWalletId: z.string().regex(/^[0-9a-f]{24}$/i, 'must be an id').nullable().optional(),
});
const passwordBody = z.object({ currentPassword: z.string().min(1), newPassword });

router.patch('/me', async (req, res) => {
  res.json({ user: await updateMe(req.user.id, profileBody.parse(req.body)) });
});

router.patch('/me/password', async (req, res) => {
  await changePassword(req.user, passwordBody.parse(req.body));
  res.sendStatus(204);
});

export default router;
