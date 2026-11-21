// Bot core (docs/04 §4.6): everything the Telegram and Zalo bots do, written once. An adapter maps its
// platform's JSON to the calls below and gives the core a way to talk back:
//   { platform: 'telegram' | 'zalo', sendText(chatId, text), sendDraft(chatId, { id, text }, language),
//     downloadPhoto(photo) → Buffer }
import { env } from '../config/env.js';
import { Category } from '../models/Category.js';
import { ChatLink } from '../models/ChatLink.js';
import { MAX_MONEY, Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import { redeemLinkCode } from '../services/chatLinks.js';
import { listBudgets } from '../services/budgets.js';
import { createReceiptDraft } from '../services/receipts.js';
import { daily, monthSummary } from '../services/stats.js';
import { confirmTransaction, parseTransactions, updateTransaction } from '../services/transactions.js';
import { updateMe } from '../services/users.js';
import { AppError } from '../utils/AppError.js';
import { normalize } from '../utils/normalize.js';
import { monthKey, vnParts } from '../utils/vnTime.js';
import en from './messages.en.js';
import vi from './messages.vi.js';

export const messagesFor = (language) => (language === 'en' ? en : vi);

// A chat that is not linked has no language yet, so it gets both.
const pleaseLink = () => `${vi.pleaseLink(env.APP_URL ?? '')}\n\n${en.pleaseLink(env.APP_URL ?? '')}`;

const money = (amount, m) => new Intl.NumberFormat(m.locale, { style: 'currency', currency: 'VND' }).format(amount);
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

// "/start ABC234" → ['start', 'ABC234']; "/today@my_bot" → ['today', '']; anything else → [].
function readCommand(text) {
  const match = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  return match ? [match[1].toLowerCase(), (match[2] ?? '').trim()] : [];
}

// Every incoming chat message, mapped by the adapter to { platformUserId, chatId, messageId, displayName, text, photo? }.
// `photo` is the platform's reference to a photo in the message (Telegram file_id, Zalo photo_url).
// Without a link, only "/start CODE" and "/link CODE" do something; nothing is ever stored for an unlinked chat.
export async function handleMessage(adapter, message) {
  const link = await ChatLink.findOne({ platform: adapter.platform, platformUserId: message.platformUserId });
  const [command, arg] = readCommand(message.text);
  if ((command === 'start' || command === 'link') && arg) return adapter.sendText(message.chatId, await linkChat(adapter.platform, message, arg, link));
  if (!link) return adapter.sendText(message.chatId, pleaseLink());

  const user = await User.findById(link.userId).lean();
  if (user.status === 'locked') return adapter.sendText(message.chatId, messagesFor(user.language).locked); // admin lock covers the bots too
  if (message.photo) return readReceipt(adapter, link, user.language, message);
  if (command) return adapter.sendText(message.chatId, await runCommand(link, user, command, arg));
  const word = normalize(message.text);
  if (word === 'ok' || word === 'huy') return adapter.sendText(message.chatId, await answerPending(link, word));
  return createDrafts(adapter, link, user.language, message);
}

// A button press (Telegram ✅ / ❌) → { ok, text }. Only the presser's own drafts can be touched.
export async function handleButton(platform, platformUserId, action, transactionId) {
  const link = await ChatLink.findOne({ platform, platformUserId });
  if (!link) return { ok: false, text: pleaseLink() };
  const user = await User.findById(link.userId).lean();
  if (user.status === 'locked') return { ok: false, text: messagesFor(user.language).locked };
  return action === 'confirm' ? confirm(link, transactionId) : discard(link, transactionId);
}

// "/start CODE" or "/link CODE" → the reply text. A chat account stays linked to its first web account.
async function linkChat(platform, { platformUserId, chatId, displayName }, code, link) {
  if (link) return (await messagesOf(link)).alreadyLinked;
  const created = await redeemLinkCode(code, { platform, platformUserId, chatId, displayName });
  if (!created) return `${vi.invalidCode}\n\n${en.invalidCode}`;
  const user = await User.findById(created.userId).lean();
  return messagesFor(user.language).linked(user.name);
}

// /today, /month, /lang vi|en; anything else (/start, /help, unknown) gets the help text.
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
    const [{ expense, income }, budgets] = await Promise.all([monthSummary(link.userId, month), listBudgets(link.userId, month)]);
    const usage = ({ percent, spent, limit }) => ({ percent, spent: money(spent, m), limit: money(limit, m) });
    const overall = budgets.find((b) => !b.categoryId);
    const byCategory = budgets.filter((b) => b.categoryId).sort((a, b) => b.percent - a.percent); // fullest first
    return m.month({
      month: `${month.slice(5)}/${month.slice(0, 4)}`,
      expense: money(expense, m),
      income: money(income, m),
      budget: overall && usage(overall),
      categoryBudgets: await Promise.all(byCategory.map(async (b) => ({ name: categoryName(await Category.findById(b.categoryId).lean(), m), ...usage(b) }))),
    });
  }
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
    if (err instanceof AppError && err.code === 'NO_AMOUNT_FOUND') return adapter.sendText(message.chatId, m.help);
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
    await adapter.sendText(message.chatId, m.noAmountLines({ lines: noAmountLines.join(', '), max: money(MAX_MONEY, m) })).catch((err) => {
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

  await adapter.sendText(message.chatId, m.readingReceipt);
  let transaction;
  try {
    const image = await adapter.downloadPhoto(message.photo);
    transaction = await createReceiptDraft(link.userId, image, { source: adapter.platform, chatRef, fileRef: message.photo });
  } catch (err) {
    if (err.code === 11000) return; // the same photo delivered twice at once: the other delivery answers
    const unreadable = err.status === 422 || err.status === 415; // no total found, or not a JPEG/PNG
    await adapter.sendText(message.chatId, unreadable ? m.receiptUnreadable : m.receiptUnavailable);
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
async function warningLine({ categoryId, percent, spent, limit, threshold }, m) {
  const category = categoryId && (await Category.findById(categoryId).lean());
  const name = category ? categoryName(category, m) : m.overallBudget;
  return m.budgetWarning({ name, percent, spent: money(spent, m), limit: money(limit, m), over: threshold === 100 });
}
