import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { listSessions, revokeOtherSessions, revokeSession } from '../services/sessions.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(await listSessions(req.user));
});

// Only "log out other devices" is offered; logging out this device is POST /auth/logout.
router.delete('/', async (req, res) => {
  z.object({ others: z.literal('true') }).parse(req.query);
  await revokeOtherSessions(req.user.id, req.user.sid);
  res.sendStatus(204);
});

router.delete('/:id', async (req, res) => {
  await revokeSession(req.user.id, req.params.id); // a malformed id becomes a CastError → 400
  res.sendStatus(204);
});

export default router;
