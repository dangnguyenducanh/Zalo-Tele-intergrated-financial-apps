import { waitUntil } from '@vercel/functions';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { sendLinked } from '../bot/core.js';
import { telegram } from '../bot/telegram.js';
import { zalo } from '../bot/zalo.js';
import { requireAuth } from '../middleware/auth.js';
import { claimChat, createLinkCode, deleteChatLink, dismissClaimNotice, listChatLinks, previewClaim } from '../services/chatLinks.js';
import { AppError } from '../utils/AppError.js';

const router = Router();
router.use(requireAuth);

const ADAPTERS = { telegram, zalo }; // who tells the chat that a claim linked it
// A claim token travels in the body, never in a URL the request log would keep. Any short string is accepted:
// a website code or garbage is simply not a live claim link (404).
const claimBody = z.object({ token: z.string().min(1).max(100) });

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

router.post('/claim/preview', async (req, res) => {
  res.json(await previewClaim(claimBody.parse(req.body).token));
});

router.post('/claim', async (req, res) => {
  const { id, platform, chatId, displayName, createdAt, viaClaim } = await claimChat(req.user.id, claimBody.parse(req.body).token);
  res.status(201).json({ id, platform, displayName, createdAt, viaClaim });
  // As after a webhook: answer first, then talk to the chat. A failed send is only logged: the chat is linked.
  waitUntil(sendLinked(ADAPTERS[platform], chatId, req.user.id).catch((err) => console.error(`${platform} claim message failed:`, err)));
});

router.patch('/:id/claim-notice', async (req, res) => {
  await dismissClaimNotice(req.user.id, req.params.id);
  res.sendStatus(204);
});

export default router;
