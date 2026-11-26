import { createHash, randomBytes, randomInt } from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { ChatLink } from '../models/ChatLink.js';
import { LinkCode } from '../models/LinkCode.js';
import { AppError } from '../utils/AppError.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // A–Z and 2–9 without I and O, which look like 1 and 0
const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;

const hashSecret = (secret) => createHash('sha256').update(secret).digest('hex');

// POST /chat-links/code: a random 6-character code for 10 minutes, plus one link per chat app (null when that
// app's setting is missing). Telegram sends "/start CODE" after one tap on Start; WhatsApp opens the chat with
// "/link CODE" already typed; a Zalo bot link carries no data, so the user pastes "/link CODE" there.
export async function createLinkCode(userId) {
  const code = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await LinkCode.create({ userId, codeHash: hashSecret(code), expiresAt });
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
  return links.map(({ id, platform, displayName, createdAt, viaClaim, claimNoticeDismissedAt }) => ({
    id,
    platform,
    displayName,
    createdAt,
    viaClaim,
    claimNoticeDismissedAt,
  }));
}

// DELETE /chat-links/:id: unlink. The chat can then be linked again, to any account, with a new code or claim link:
// a claim link it got before it was linked (say with a website code) must not work again.
export async function deleteChatLink(userId, linkId) {
  const link = await ChatLink.findOne({ _id: linkId, userId });
  if (!link) throw new AppError(404, 'NOT_FOUND', 'Chat link not found');
  // The claim link goes first: a Confirm running right now looks for its row after linking (claimChat).
  await LinkCode.deleteOne({ 'chat.platform': link.platform, 'chat.platformUserId': link.platformUserId });
  await link.deleteOne();
}

// PATCH /chat-links/:id/claim-notice: the user has seen the "Not you? [Unlink]" notice of a claim-made link.
export async function dismissClaimNotice(userId, linkId) {
  const { matchedCount } = await ChatLink.updateOne({ _id: linkId, userId }, { claimNoticeDismissedAt: new Date() });
  if (matchedCount === 0) throw new AppError(404, 'NOT_FOUND', 'Chat link not found');
}

// The bot redeems a code for a chat ({ platform, platformUserId, chatId, displayName }).
// Marking the code used and checking it is unused and unexpired is one atomic update, so a code
// works once even if two chats send it at the same moment. Only rows with a userId are codes: a claim
// link never works here. Returns the new link, or null for a bad code.
export async function redeemLinkCode(code, chat) {
  const now = new Date();
  const linkCode = await LinkCode.findOneAndUpdate(
    {
      codeHash: hashSecret(code.trim().toUpperCase()),
      userId: mongoose.trusted({ $exists: true }),
      usedAt: null,
      expiresAt: mongoose.trusted({ $gt: now }),
    },
    { usedAt: now },
  );
  if (!linkCode) return null;
  return ChatLink.create({ ...chat, userId: linkCode.userId });
}

// A claim link for a chat that is not linked (docs/02 §2.10.3): 24 random bytes as 32 base64url characters,
// 10 minutes, single use, stored as a hash with the chat. One atomic upsert replaces the chat's older link, so
// a chat has at most one live link. Returns the token; it exists nowhere else.
export async function createClaimToken({ platform, platformUserId, chatId, displayName }) {
  const token = randomBytes(24).toString('base64url');
  await LinkCode.updateOne(
    { 'chat.platform': platform, 'chat.platformUserId': platformUserId },
    {
      'chat.chatId': chatId,
      'chat.displayName': displayName,
      codeHash: hashSecret(token),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      usedAt: null,
    },
    { upsert: true },
  );
  return token;
}

// The row a token opens while it can still be claimed. Only rows with a chat: a website code never matches.
// A token is hashed as received (base64url is case-sensitive).
const liveClaim = (token) => ({
  codeHash: hashSecret(token),
  'chat.platformUserId': mongoose.trusted({ $exists: true }),
  usedAt: null,
  expiresAt: mongoose.trusted({ $gt: new Date() }),
});
const invalidToken = () => new AppError(404, 'LINK_TOKEN_INVALID', 'This link has expired or was already used');

// POST /chat-links/claim/preview: which chat the token would link. Spends nothing, so Cancel leaves it to expire.
export async function previewClaim(token) {
  const claim = await LinkCode.findOne(liveClaim(token)).lean();
  if (!claim) throw invalidToken();
  return { platform: claim.chat.platform, displayName: claim.chat.displayName };
}

// POST /chat-links/claim: one atomic update spends the token (so it works once), then the chat is linked to
// this user. A chat that got linked meanwhile is refused by the unique chatLinks index; the token stays spent.
// A chat that was linked and unlinked meanwhile has no claim row any more, so the new link is taken back.
export async function claimChat(userId, token) {
  const claim = await LinkCode.findOneAndUpdate(liveClaim(token), { usedAt: new Date() }).lean();
  if (!claim) throw invalidToken();
  let link;
  try {
    link = await ChatLink.create({ ...claim.chat, userId, viaClaim: true });
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'CHAT_ALREADY_LINKED', 'This chat is already linked to an account');
    throw err;
  }
  if (await LinkCode.exists({ _id: claim._id })) return link;
  await link.deleteOne();
  throw invalidToken();
}
