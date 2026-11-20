import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { createLinkCode, deleteChatLink, listChatLinks } from '../services/chatLinks.js';
import { AppError } from '../utils/AppError.js';

const router = Router();
router.use(requireAuth);

// At most 5 link codes per user in 10 minutes (docs/04: 429), so nobody can fill linkCodes with live codes.
// ponytail: in-memory per Vercel instance, like the login limit (best-effort).
const codeLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => req.user.id,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many link codes, please try again later')),
});

router.post('/code', codeLimit, async (req, res) => {
  res.status(201).json(await createLinkCode(req.user.id));
});

router.get('/', async (req, res) => {
  res.json(await listChatLinks(req.user.id));
});

router.delete('/:id', async (req, res) => {
  await deleteChatLink(req.user.id, req.params.id); // a malformed id becomes a CastError → 400
  res.sendStatus(204);
});

export default router;
