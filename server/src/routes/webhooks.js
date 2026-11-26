import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { Router } from 'express';
import { handleTelegramUpdate } from '../bot/telegram.js';
import { handleWhatsAppWebhook } from '../bot/whatsapp.js';
import { handleZaloEvent } from '../bot/zalo.js';
import { env, whatsappConfigured } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// POST /api/webhooks/<platform> (docs/04 §4.6). No JWT: Telegram and Zalo prove themselves with the secret they were
// given in setWebhook (scripts/setWebhooks.js) and send back in a header; WhatsApp signs the body (below).
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

// WhatsApp (docs/04 §4.6). Meta registers the callback URL in its app dashboard and proves itself two ways: a GET
// setup check with our verify token, and a signature on every POST: X-Hub-Signature-256 = "sha256=" + the HMAC-SHA256
// of the raw body (kept by app.js) with the app secret. Without all four WhatsApp settings the webhook is off.
function requireWhatsApp() {
  if (!whatsappConfigured()) throw new AppError(503, 'FEATURE_NOT_CONFIGURED', 'WhatsApp is not configured');
}

router.get('/whatsapp', (req, res) => {
  requireWhatsApp();
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query; // a repeated parameter is an array
  if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string' || !sameSecret(token, env.WHATSAPP_VERIFY_TOKEN)) {
    throw new AppError(403, 'FORBIDDEN', 'Bad verify token');
  }
  res.type('text/plain').send(challenge);
});

router.post('/whatsapp', (req, res) => {
  requireWhatsApp();
  const signed = req.rawBody && `sha256=${createHmac('sha256', env.WHATSAPP_APP_SECRET).update(req.rawBody).digest('hex')}`;
  if (!sameSecret(req.get('X-Hub-Signature-256'), signed)) throw new AppError(401, 'UNAUTHENTICATED', 'Bad webhook signature');
  res.sendStatus(200); // Meta retries anything that is not a 200, so status updates get one too
  inBackground('whatsapp', handleWhatsAppWebhook(req.body));
});

export default router;
