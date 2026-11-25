import { createHash, randomInt } from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { ChatLink } from '../models/ChatLink.js';
import { LinkCode } from '../models/LinkCode.js';
import { AppError } from '../utils/AppError.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // A–Z and 2–9 without I and O, which look like 1 and 0
const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;

const hashCode = (code) => createHash('sha256').update(code).digest('hex');

// POST /chat-links/code: a random 6-character code for 10 minutes, plus one link per chat app (null when that
// app's setting is missing). Telegram sends "/start CODE" after one tap on Start; WhatsApp opens the chat with
// "/link CODE" already typed; a Zalo bot link carries no data, so the user pastes "/link CODE" there.
export async function createLinkCode(userId) {
  const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await LinkCode.create({ userId, codeHash: hashCode(code), expiresAt });
  const { TELEGRAM_BOT_USERNAME: telegram, WHATSAPP_NUMBER: whatsapp, ZALO_BOT_URL: zalo } = env;
  const links = {
    telegram: telegram ? `https://t.me/${telegram}?start=${code}` : null,
    whatsapp: whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(`/link ${code}`)}` : null,
    zalo: zalo ?? null,
  };
  return { code, expiresAt, links };
}

// GET /chat-links: the user's linked chat accounts, oldest first.
export async function listChatLinks(userId) {
  const links = await ChatLink.find({ userId }).sort({ createdAt: 1, _id: 1 });
  return links.map(({ id, platform, displayName, createdAt }) => ({ id, platform, displayName, createdAt }));
}

// DELETE /chat-links/:id: unlink. The chat can then be linked again, to any account.
export async function deleteChatLink(userId, linkId) {
  const { deletedCount } = await ChatLink.deleteOne({ _id: linkId, userId });
  if (deletedCount === 0) throw new AppError(404, 'NOT_FOUND', 'Chat link not found');
}

// The bot redeems a code for a chat ({ platform, platformUserId, chatId, displayName }).
// Marking the code used and checking it is unused and unexpired is one atomic update, so a code
// works once even if two chats send it at the same moment. Returns the new link, or null for a bad code.
export async function redeemLinkCode(code, chat) {
  const now = new Date();
  const linkCode = await LinkCode.findOneAndUpdate(
    { codeHash: hashCode(code.trim().toUpperCase()), usedAt: null, expiresAt: mongoose.trusted({ $gt: now }) },
    { usedAt: now },
  );
  if (!linkCode) return null;
  return ChatLink.create({ ...chat, userId: linkCode.userId });
}
