// Bot core (docs/04 §4.6): everything the Telegram and Zalo bots do, written once. An adapter maps its
// platform's JSON to the calls below and gives the core a way to talk back:
//   { platform: 'telegram' | 'zalo', sendText(chatId, text), sendDraft(chatId, { id, text }, language) }
import { env } from '../config/env.js';
import { Category } from '../models/Category.js';
import { ChatLink } from '../models/ChatLink.js';
import { Transaction } from '../models/Transaction.js';
import { User } from '../models/User.js';
import { Wallet } from '../models/Wallet.js';
import { redeemLinkCode } from '../services/chatLinks.js';
import { daily, monthSummary } from '../services/stats.js';
import { confirmTransaction, parseTransactions } from '../services/transactions.js';
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

// Every incoming chat message, mapped by the adapter to { platformUserId, chatId, messageId, displayName, text }.
// Without a link, only "/start CODE" and "/link CODE" do something; nothing is ever stored for an unlinked chat.
export async function handleMessage(adapter, message) {
  const link = await ChatLink.findOne({ platform: adapter.platform, platformUserId: message.platformUserId });
  const [command, arg] = readCommand(message.text);
  if ((command === 'start' || command === 'link') && arg) return adapter.sendText(message.chatId, await linkChat(adapter.platform, message, arg, link));
  if (!link) return adapter.sendText(message.chatId, pleaseLink());

  const user = await User.findById(link.userId).lean();
  if (user.status === 'locked') return adapter.sendText(message.chatId, messagesFor(user.language).locked); // admin lock covers the bots too
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
// The totals come from the same statistics service as the dashboard.
async function runCommand(link, user, command, arg) {
  const m = messagesFor(user.language);
  const now = new Date();
  if (command === 'today') {
    const { expense, income } = (await daily(link.userId, monthKey(now)))[vnParts(now).day - 1];
    return m.today({ date: dateText(now, m), expense: money(expense, m), income: money(income, m) });
  }
  if (command === 'month') {
    const month = monthKey(now);
    const { expense, income, budget } = await monthSummary(link.userId, month);
    return m.month({
      month: `${month.slice(5)}/${month.slice(0, 4)}`,
      expense: money(expense, m),
      income: money(income, m),
      budget: budget && { percent: Math.round((budget.spent * 100) / budget.limit), spent: money(budget.spent, m), limit: money(budget.limit, m) },
    });
  }
  const language = arg.toLowerCase();
  if (command === 'lang' && (language === 'vi' || language === 'en')) {
    await updateMe(link.userId, { language }); // the same setting as on the web Settings page
    return messagesFor(language).languageSet;
  }
  return m.help;
}

// Zalo has no buttons, so a typed "ok" / "huy" acts on the latest draft (chatLinks.pendingTransactionId).
async function answerPending(link, word) {
  if (!link.pendingTransactionId) return (await messagesOf(link)).nothingPending;
  const action = word === 'ok' ? confirm : discard;
  return (await action(link, link.pendingTransactionId)).text;
}

// Text → one draft per line with an amount (the same parser as the web quick add), each sent with its buttons.
// chatRef.messageId is "<message id>:<line>", so a message the platform delivers twice hits the unique
// chatRef index and makes no second draft or reply.
async function createDrafts(adapter, link, language, message) {
  const m = messagesFor(language);
  let drafts;
  try {
    ({ drafts } = await parseTransactions(link.userId, message.text));
  } catch (err) {
    if (err instanceof AppError && err.code === 'NO_AMOUNT_FOUND') return adapter.sendText(message.chatId, m.help);
    throw err;
  }
  for (const [i, draft] of drafts.entries()) {
    const chatRef = { platform: adapter.platform, chatId: message.chatId, messageId: `${message.messageId}:${i + 1}` };
    let transaction;
    try {
      transaction = await Transaction.create({ ...draft, userId: link.userId, status: 'draft', source: adapter.platform, chatRef });
    } catch (err) {
      if (err.code === 11000) continue; // delivered again: this line's draft exists already
      throw err;
    }
    await ChatLink.updateOne({ _id: link._id }, { pendingTransactionId: transaction._id });
    await adapter.sendDraft(message.chatId, { id: transaction.id, text: m.draft(await describe(transaction, m)) }, language);
  }
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
