// Bot core (docs/04 §4.6): everything the Telegram, Zalo and WhatsApp bots do, written once. An adapter maps its
// platform's JSON to the calls below and gives the core a way to talk back:
//   { platform: 'telegram' | 'zalo' | 'whatsapp', sendText(chatId, text), sendDraft(chatId, { id, text }, language),
//     downloadPhoto(photo) → Buffer }
import { env } from '../config/env.js';
import { Category } from '../models/Category.js';
import { ChatLink } from '../models/ChatLink.js';
import { MAX_MONEY, Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import { maySend } from '../services/channelUsage.js';
import { createClaimToken, redeemLinkCode } from '../services/chatLinks.js';
import { listBudgets, monthProgress, PACE_FROM_DAY } from '../services/budgets.js';
import { createReceiptDraft } from '../services/receipts.js';
import { daily, monthSummary } from '../services/stats.js';
import { confirmTransaction, parseTransactions, updateTransaction } from '../services/transactions.js';
import { updateMe } from '../services/users.js';
import { AppError } from '../utils/AppError.js';
import { normalize } from '../utils/normalize.js';
import { monthKey, vnParts } from '../utils/vnTime.js';
import { classify } from './ask.js';
import en from './messages.en.js';
import vi from './messages.vi.js';

export const messagesFor = (language) => (language === 'en' ? en : vi);

// Every text reply goes out through here with its kind (docs/02 §2.11.6): 'capture' (drafts, receipts, ok/huy, corrections)
// and 'link' (linking a chat) always go out; anything else is 'other' and stops when the platform's monthly quota is
// nearly used up. By then the reply's effect (a saved draft, a switched language) has already happened. A draft
// itself goes out through adapter.sendDraft: it is capture, so it is never held back.
async function reply(adapter, chatId, text, kind = 'other') {
  if (await maySend(adapter.platform, kind)) return adapter.sendText(chatId, text);
}

// A chat that is not linked has no language yet, so it gets both. `lines(m)` is one language's lines.
const inBothLanguages = (lines) => [vi, en].map((m) => lines(m).filter(Boolean).join('\n')).join('\n\n');
const pleaseLink = (m) => m.pleaseLink(env.APP_URL ?? '');

// What a chat that is not linked gets for any message: how to link, plus a one-time link that opens the website's
// /link screen for this very chat (docs/02 §2.10.3). A wrong or expired code is said first. Without APP_URL
// there is no address to link to, so no token is made.
async function linkInstructions(platform, { platformUserId, chatId, displayName }, { wrongCode = false } = {}) {
  const claimUrl = env.APP_URL && `${env.APP_URL}/link?t=${await createClaimToken({ platform, platformUserId, chatId, displayName })}`;
  return inBothLanguages((m) => [wrongCode && m.invalidCode, pleaseLink(m), claimUrl && m.tapToLink(claimUrl)]);
}

export const money = (amount, m) => new Intl.NumberFormat(m.locale, { style: 'currency', currency: 'VND' }).format(amount);
const dateText = (date, m) =>
  new Intl.DateTimeFormat(m.locale, { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
// The user's own name for a category, else the default name in the reply language ('vi-VN' → names.vi).
const categoryName = (category, m) => category?.name || category?.names?.[m.locale.slice(0, 2)] || category?.names?.vi || '';

// One transaction as one line of chat text: "Chi 45.000 ₫ · Ăn uống · Tiền mặt · 20/11/2026 · phở".
async function describe(transaction, m) {
  const [category, wallet] = await Promise.all([
    Category.findById(transaction.categoryId).lean(),
    Wallet.findById(transaction.walletId).lean(),
  ]);
  const parts = [`${m[transaction.type]} ${money(transaction.amount, m)}`, categoryName(category, m), wallet?.name, dateText(transaction.occurredAt, m), transaction.note];
  return parts.filter(Boolean).join(' · ');
}

async function messagesOf(link) {
  const user = await User.findById(link.userId).lean();
  return messagesFor(user?.language);
}

// "/start ABC234" → ['start', 'ABC234']; "/today@my_bot" → ['today', '']; "/Hỏi x" → ['hoi', 'x']; anything else → [].
// \p{M} keeps the accent marks of a decomposed "/hỏi" (a letter plus a combining mark) inside the command word.
function readCommand(text) {
  const match = /^\/([\p{L}\p{M}\p{N}_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/u.exec(text.trim());
  return match ? [normalize(match[1]), (match[2] ?? '').trim()] : [];
}

// Every incoming chat message, mapped by the adapter to { platformUserId, chatId, messageId, displayName, text, photo? }.
// `photo` is the platform's reference to a photo in the message (Telegram file_id, Zalo photo_url).
// Without a link, a valid "/start CODE" or "/link CODE" links the chat; anything else gets a claim link, the only
// thing ever stored for an unlinked chat (no message text, no transaction).
// For a linked, active chat the first match wins, in the order of docs/02 §2.11.1: a photo, "/hoi", any other command,
// "ok" / "huy", then classify(): a question or a capture. A question never reaches createDrafts.
export async function handleMessage(adapter, message) {
  const link = await ChatLink.findOne({ platform: adapter.platform, platformUserId: message.platformUserId });
  const [command, arg] = readCommand(message.text);
  if ((command === 'start' || command === 'link') && arg) return reply(adapter, message.chatId, await linkChat(adapter.platform, message, arg, link), 'link');
  if (!link) return reply(adapter, message.chatId, await linkInstructions(adapter.platform, message), 'link');

  const user = await User.findById(link.userId).lean();
  if (user.status === 'locked') return reply(adapter, message.chatId, messagesFor(user.language).locked); // admin lock covers the bots too
  if (message.photo) return readReceipt(adapter, link, user.language, message);
  if (command === 'hoi') return answerQuestion(adapter, message.chatId, user.language);
  if (command) return reply(adapter, message.chatId, await runCommand(link, user, command, arg));
  const word = normalize(message.text);
  if (word === 'ok' || word === 'huy') return reply(adapter, message.chatId, await answerPending(link, word), 'capture');
  // followUp is false until the assistant's answers are remembered per chat (T50).
  if (classify(message.text, { followUp: false }) === 'question') return answerQuestion(adapter, message.chatId, user.language);
  return createDrafts(adapter, link, user.language, message);
}

// A question (a "/hoi …" or a text classify() reads as one) is never money: nothing is drafted or stored. There is no
// question engine yet, so it gets the help text, which lists "/hoi" and the plain commands. 'other' like any help (docs/02 §2.11.6).
function answerQuestion(adapter, chatId, language) {
  return reply(adapter, chatId, messagesFor(language).help);
}

// A button press (Telegram and WhatsApp ✅ / ❌) → { ok, text }. Only the presser's own drafts can be touched.
export async function handleButton(platform, platformUserId, action, transactionId) {
  const link = await ChatLink.findOne({ platform, platformUserId });
  if (!link) return { ok: false, text: inBothLanguages((m) => [pleaseLink(m)]) }; // a button's short notice can't be tapped
  const user = await User.findById(link.userId).lean();
  if (user.status === 'locked') return { ok: false, text: messagesFor(user.language).locked };
  return action === 'confirm' ? confirm(link, transactionId) : discard(link, transactionId);
}

// "/start CODE" or "/link CODE" → the reply text. A chat account stays linked to its first web account.
async function linkChat(platform, message, code, link) {
  if (link) return (await messagesOf(link)).alreadyLinked;
  const { platformUserId, chatId, displayName } = message;
  const created = await redeemLinkCode(code, { platform, platformUserId, chatId, displayName });
  if (!created) return linkInstructions(platform, message, { wrongCode: true });
  return linkedText(created.userId);
}

// "Linked to the account of <name>", in that user's language: the reply to "/link CODE" and the message after a claim.
async function linkedText(userId) {
  const user = await User.findById(userId).lean();
  return messagesFor(user.language).linked(user.name);
}

// After a claim on the website (docs/02 §2.10.3 step 7) the bot tells the chat that it is linked.
export async function sendLinked(adapter, chatId, userId) {
  await reply(adapter, chatId, await linkedText(userId), 'link');
}

// The daily limit of a budget's pace (docs/02 §2.11.2 A2) as money text; null when it has none (before day 5, or the limit is reached).
const dailyText = (pace, m) => (pace?.perDay == null ? null : money(pace.perDay, m));

// The month's budgets as the bot lists them: the overall one, then each category's, fullest first.
function splitBudgets(budgets) {
  return { overall: budgets.find((b) => !b.categoryId), byCategory: budgets.filter((b) => b.categoryId).sort((a, b) => b.percent - a.percent) };
}

// /dubao (docs/02 §2.11.2 A2): where each budget of this month is heading. Express answers it itself (decision D13), so it
// works when the agent service is down. The figures are the ones listBudgets() gives the Budgets chip and /month.
async function forecast(userId, m, now) {
  const month = monthKey(now);
  const { overall, byCategory } = splitBudgets(await listBudgets(userId, month, now));
  if (!overall && byCategory.length === 0) return m.paceNoBudget;
  const progress = monthProgress(month, now);
  if (progress.day < PACE_FROM_DAY) return m.paceTooEarly({ day: progress.day, from: PACE_FROM_DAY });
  const figures = ({ spent, limit, pace }) => ({
    spent: money(spent, m),
    limit: money(limit, m),
    left: money(Math.max(limit - spent, 0), m),
    daysLeft: pace.daysLeft,
    perDay: pace.perDay === null ? null : money(pace.perDay, m),
    projectedEnd: money(pace.projectedEnd, m),
    overDate: pace.overDay === null ? null : m.paceDate(pace.overDay, Number(month.slice(5))),
  });
  return [
    m.paceHeader({ month: `${month.slice(5)}/${month.slice(0, 4)}`, ...progress }),
    overall && m.paceOverall({ name: m.overallBudget, ...figures(overall) }),
    ...(await Promise.all(
      byCategory.map(async (b) => m.paceCategory({ name: categoryName(await Category.findById(b.categoryId).lean(), m), ...figures(b) })),
    )),
  ]
    .filter(Boolean)
    .join('\n');
}

// /today, /month, /dubao, /lang vi|en; anything else (/start, /help, unknown) gets the help text.
// The totals come from the same statistics service as the dashboard, the budgets from the Budgets page's service.
async function runCommand(link, user, command, arg) {
  const m = messagesFor(user.language);
  const now = new Date();
  if (command === 'today') {
    const { expense, income } = (await daily(link.userId, monthKey(now)))[vnParts(now).day - 1];
    return m.today({ date: dateText(now, m), expense: money(expense, m), income: money(income, m) });
  }
  if (command === 'month') {
    const month = monthKey(now);
    const [{ expense, income }, budgets] = await Promise.all([monthSummary(link.userId, month), listBudgets(link.userId, month, now)]);
    const usage = ({ percent, spent, limit, pace }) => ({ percent, spent: money(spent, m), limit: money(limit, m), daily: dailyText(pace, m) });
    const { overall, byCategory } = splitBudgets(budgets);
    return m.month({
      month: `${month.slice(5)}/${month.slice(0, 4)}`,
      expense: money(expense, m),
      income: money(income, m),
      budget: overall && usage(overall),
      categoryBudgets: await Promise.all(byCategory.map(async (b) => ({ name: categoryName(await Category.findById(b.categoryId).lean(), m), ...usage(b) }))),
    });
  }
  if (command === 'dubao') return forecast(link.userId, m, now);
  const language = arg.toLowerCase();
  if (command === 'lang' && (language === 'vi' || language === 'en')) {
    await updateMe(link.userId, { language }); // the same setting as on the web Settings page
    return messagesFor(language).languageSet;
  }
  return m.help;
}

// The draft a typed "ok" / "huy" or a Zalo correction acts on: chatLinks.pendingTransactionId while it is still a
// draft, else the newest draft from this chat that still waits (a message with several lines makes several).
// null when nothing from this chat waits.
async function pendingDraft(link) {
  const waiting = { userId: link.userId, status: 'draft', deletedAt: null };
  const pending = link.pendingTransactionId && (await Transaction.findOne({ _id: link.pendingTransactionId, ...waiting }));
  return pending || Transaction.findOne({ ...waiting, 'chatRef.platform': link.platform, 'chatRef.chatId': link.chatId }).sort({ _id: -1 });
}

// Zalo has no buttons, so a typed "ok" / "huy" acts on the pending draft, newest first. The reply names the next
// draft still waiting, so the user knows what the next "ok" / "huy" will do.
async function answerPending(link, word) {
  const m = await messagesOf(link);
  const draft = await pendingDraft(link);
  if (!draft) return m.nothingPending;
  const { text } = await (word === 'ok' ? confirm : discard)(link, draft._id);
  const next = await pendingDraft(link);
  return next ? `${text}\n${m.nextPending(await describe(next, m))}` : text;
}

// Text → one draft per line with an amount (the same parser as the web quick add), each sent with its buttons.
// chatRef.messageId is "<message id>:<line>", so a message the platform delivers twice hits the unique
// chatRef index and makes no second draft or reply.
// Every line is saved before any reply goes out: a failed reply (Zalo's monthly quota, Telegram 429, a timeout)
// must not lose the lines after it, because the platform already has its 200 and never sends the message again.
async function createDrafts(adapter, link, language, message) {
  const m = messagesFor(language);
  let drafts, noAmountLines;
  try {
    ({ drafts, noAmountLines } = await parseTransactions(link.userId, message.text));
  } catch (err) {
    if (err instanceof AppError && err.code === 'NO_AMOUNT_FOUND') return reply(adapter, message.chatId, m.help);
    throw err;
  }
  // Zalo has no ✏️ button, so a reply that is only an amount ("55k") corrects the waiting draft (docs/02 §2.4).
  if (adapter.platform === 'zalo' && drafts.length === 1 && drafts[0].note === '') {
    const pending = await pendingDraft(link);
    if (pending) return correctDraft(adapter, link, language, message.chatId, pending, drafts[0].amount);
  }
  const saved = [];
  for (const [i, draft] of drafts.entries()) {
    const chatRef = { platform: adapter.platform, chatId: message.chatId, messageId: `${message.messageId}:${i + 1}` };
    try {
      saved.push(await Transaction.create({ ...draft, userId: link.userId, status: 'draft', source: adapter.platform, chatRef }));
    } catch (err) {
      if (err.code === 11000) continue; // delivered again: this line's draft exists already
      throw err;
    }
  }
  if (saved.length === 0) return;
  await ChatLink.updateOne({ _id: link._id }, { pendingTransactionId: saved.at(-1)._id });
  let failed = null;
  for (const transaction of saved) {
    const text = m.draft(await describe(transaction, m));
    await adapter.sendDraft(message.chatId, { id: transaction.id, text }, language).catch((err) => {
      failed ??= err; // still reply to the other lines
    });
  }
  // Lines with no amount, or one over the ceiling, are named so the user knows they were not recorded (BUG-033).
  if (noAmountLines.length > 0) {
    await reply(adapter, message.chatId, m.noAmountLines({ lines: noAmountLines.join(', '), max: money(MAX_MONEY, m) }), 'capture').catch((err) => {
      failed ??= err;
    });
  }
  if (failed) throw failed; // the webhook logs it
}

// A Zalo correction: the new amount goes through the same service as the web Bot inbox edit (PATCH /transactions/:id).
// Note, category, wallet and date stay. The draft is sent again, and "ok" / "huy" still act on it.
async function correctDraft(adapter, link, language, chatId, draft, amount) {
  const m = messagesFor(language);
  const updated = await updateTransaction(link.userId, draft._id, { amount });
  await ChatLink.updateOne({ _id: link._id }, { pendingTransactionId: updated._id });
  return adapter.sendDraft(chatId, { id: updated.id, text: m.draft(await describe(updated, m)) }, language);
}

// A receipt photo (docs/02 §2.6): "Reading receipt…", then KIE (about 20 s), then a draft with its buttons that
// shows merchant · total · category and whether the line items add up. When KIE is down, too slow or finds no
// total, the user is asked to type the amount instead: there is no AI fallback.
async function readReceipt(adapter, link, language, message) {
  const m = messagesFor(language);
  const chatRef = { platform: adapter.platform, chatId: message.chatId, messageId: `${message.messageId}:1` };
  const seen = { 'chatRef.platform': chatRef.platform, 'chatRef.chatId': chatRef.chatId, 'chatRef.messageId': chatRef.messageId };
  if (await Transaction.exists(seen)) return; // delivered again: this photo was read already

  await reply(adapter, message.chatId, m.readingReceipt, 'capture');
  let transaction;
  try {
    const image = await adapter.downloadPhoto(message.photo);
    transaction = await createReceiptDraft(link.userId, image, { source: adapter.platform, chatRef, fileRef: message.photo });
  } catch (err) {
    if (err.code === 11000) return; // the same photo delivered twice at once: the other delivery answers
    const unreadable = err.status === 422 || err.status === 415; // no total found, or not a JPEG/PNG
    await reply(adapter, message.chatId, unreadable ? m.receiptUnreadable : m.receiptUnavailable, 'capture');
    if (err instanceof AppError) return; // KIE down, too slow, not configured, or nothing to read
    throw err; // anything else (a failed download, a bug) is logged by the webhook
  }
  await ChatLink.updateOne({ _id: link._id }, { pendingTransactionId: transaction._id });
  const lines = [m.draft(await describe(transaction, m))];
  const { items, reconciled } = transaction.receipt;
  if (items.length > 0) lines.push(m.receiptItems({ count: items.length, reconciled }));
  await adapter.sendDraft(message.chatId, { id: transaction.id, text: lines.join('\n') }, language);
}

// Confirm a draft through the same service as POST /transactions/:id/confirm, plus the budget warning line.
async function confirm(link, transactionId) {
  const m = await messagesOf(link);
  let result;
  try {
    result = await confirmTransaction(link.userId, transactionId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'ALREADY_CONFIRMED') return { ok: false, text: m.alreadyConfirmed };
    if (err instanceof AppError && err.status === 404) return { ok: false, text: m.notFound };
    throw err;
  }
  await clearPending(link, transactionId);
  const lines = [m.saved(await describe(result.transaction, m))];
  if (result.budgetWarning) lines.push(await warningLine(result.budgetWarning, m));
  return { ok: true, text: lines.join('\n') };
}

// Discard = soft delete, and only of a draft: a saved transaction is changed on the web.
async function discard(link, transactionId) {
  const m = await messagesOf(link);
  const draft = await Transaction.findOneAndUpdate(
    { _id: transactionId, userId: link.userId, status: 'draft', deletedAt: null },
    { deletedAt: new Date() },
  );
  if (!draft) return { ok: false, text: m.notFound };
  await clearPending(link, transactionId);
  return { ok: true, text: m.discarded(await describe(draft, m)) };
}

// The draft a typed "ok"/"huy" would act on is done with.
function clearPending(link, transactionId) {
  return ChatLink.updateOne({ _id: link._id, pendingTransactionId: transactionId }, { pendingTransactionId: null });
}

// budgetWarning from services/budgets.js → "⚠️ Ngân sách "Ăn uống" đã dùng 85% (85.000 ₫ / 100.000 ₫)".
async function warningLine({ categoryId, percent, spent, limit, threshold, pace }, m) {
  const category = categoryId && (await Category.findById(categoryId).lean());
  const name = category ? categoryName(category, m) : m.overallBudget;
  return m.budgetWarning({ name, percent, spent: money(spent, m), limit: money(limit, m), over: threshold === 100, daily: dailyText(pace, m) });
}
