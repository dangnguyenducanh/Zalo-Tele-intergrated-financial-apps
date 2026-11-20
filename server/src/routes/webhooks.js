import { createHash, timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { Router } from 'express';
import { handleTelegramUpdate } from '../bot/telegram.js';
import { handleZaloEvent } from '../bot/zalo.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// POST /api/webhooks/<platform> (docs/04 §4.6). No JWT: the platform proves itself with the secret it was
// given in setWebhook (scripts/setWebhooks.js) and sends back in a header.
const router = Router();

// Constant-time compare. Both sides are hashed first so they have the same length, which timingSafeEqual needs.
export function sameSecret(received, expected) {
  if (!received || !expected) return false;
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

// The platform gets its 200 at once; the work (database, replies) carries on inside waitUntil, which keeps
// the Vercel function alive until it ends (outside Vercel the promise simply runs). Failures are only logged.
function inBackground(platform, work) {
  waitUntil(work.catch((err) => console.error(`${platform} webhook update failed:`, err)));
}

router.post('/telegram', (req, res) => {
  if (!sameSecret(req.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Bad webhook secret');
  }
  res.sendStatus(200);
  inBackground('telegram', handleTelegramUpdate(req.body));
});

router.post('/zalo', (req, res) => {
  if (!sameSecret(req.get('X-Bot-Api-Secret-Token'), env.ZALO_WEBHOOK_SECRET)) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Bad webhook secret');
  }
  res.sendStatus(200);
  inBackground('zalo', handleZaloEvent(req.body));
});

export default router;
