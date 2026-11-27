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
import { agentConfigured, askBackState, hasRecentAnswer, turn } from '../services/agent.js';
import { maySend } from '../services/channelUsage.js';
import { createClaimToken, redeemLinkCode } from '../services/chatLinks.js';
import { budgetWarning, listBudgets, monthProgress, PACE_FROM_DAY } from '../services/budgets.js';
import { learnKeyword, topExpenseCategories } from '../services/categories.js';
import { draftHints } from '../services/draftHints.js';
import { createReceiptDraft } from '../services/receipts.js';
import { daily, monthSummary } from '../services/stats.js';
import { confirmTransaction, deleteTransaction, parseTransactions, restoreTransaction, updateTransaction } from '../services/transactions.js';
import { updateMe } from '../services/users.js';
import { AppError } from '../utils/AppError.js';
import { normalize } from '../utils/normalize.js';
import { monthKey, vnParts } from '../utils/vnTime.js';
import { classifyWithRule } from './ask.js';
import { loneSplit, readFixes, splitBill } from './parser.js';
import en from './messages.en.js';
import vi from './messages.vi.js';

export const messagesFor = (language) => (language === 'en' ? en : vi);

// The chats that get assistant answers: an explicit allowlist (docs/02 §2.11.6), so an adapter added later (WhatsApp) keeps the help text
// until its own card puts it here.
const ASSISTANT_PLATFORMS = ['telegram', 'zalo'];
const ANSWER_MAX = 1500; // characters in an answer: one message, never split (Zalo allows 2000, Telegram 4096)
const TYPING_EVERY_MS = 4000; // Telegram's "typing" fades after about 5 s

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
// "ok" / "huy" / "hoàn tác" / "undo" / "khôi phục" / a lone 1-3 that answers the chat's last ask-back / on Zalo a category name typed under a waiting fallback draft / a lone "chia N" (reserved words), then classify(): a question or a capture. A question never reaches createDrafts: on Telegram and Zalo the agent service answers it (T50).
export async function handleMessage(adapter, message) {
  const link = await ChatLink.findOne({ platform: adapter.platform, platformUserId: message.platformUserId });
  const [command, arg] = readCommand(message.text);
  if ((command === 'start' || command === 'link') && arg) return reply(adapter, message.chatId, await linkChat(adapter.platform, message, arg, link), 'link');
  if (!link) return reply(adapter, message.chatId, await linkInstructions(adapter.platform, message), 'link');

  const user = await User.findById(link.userId).lean();
  if (user.status === 'locked') return reply(adapter, message.chatId, messagesFor(user.language).locked); // admin lock covers the bots too
  if (message.photo) return readReceipt(adapter, link, user.language, message);
  if (command === 'hoi') return askAgent(adapter, link, user.language, message, arg);
  if (command === 'sua') return fixLast(adapter, link, user.language, message.chatId, arg);
  if (command) return reply(adapter, message.chatId, await runCommand(link, user, command, arg));
  const word = normalize(message.text);
  if (word === 'ok' || word === 'huy') return reply(adapter, message.chatId, await answerPending(link, word), 'capture');
  if (word === 'hoan tac' || word === 'undo') return reply(adapter, message.chatId, await undoLast(link), 'capture');
  if (word === 'khoi phuc') return reply(adapter, message.chatId, await restoreLast(link), 'capture');
  if (/^[1-3]$/.test(message.text.trim()) && (await answerChoice(adapter, link, user.language, message))) return; // before any rule that would read the digit as money
  const typed = adapter.categoryOffer === 'type' && (await typedCategory(adapter, link, user.language, message)); // a typed category name answers the offer (A7), before classify and the help reply
  if (typed) return;
  const people = loneSplit(message.text); // before classify, so a follow-up never reads "chia 3" as a question (D11)
  if (people) return splitPending(adapter, link, user.language, message.chatId, people);
  // followUp (an assistant answer went to this chat in the last 10 minutes) only turns rule 8 into rule 7 (docs/02 §2.11.1), so it is looked up
  // for those texts alone: "phở 45k" and every other explicit capture costs no extra read. "55k" corrects a waiting Zalo draft either way.
  const first = classifyWithRule(message.text, { followUp: false });
  const question = first.answer === 'question' || (first.rule === '8' && (await isFollowUp(adapter, link, message.chatId)));
  if (question) return askAgent(adapter, link, user.language, message, message.text);
  return createDrafts(adapter, link, user.language, message);
}

const isFollowUp = async (adapter, link, chatId) =>
  ASSISTANT_PLATFORMS.includes(adapter.platform) && agentConfigured() && hasRecentAnswer(link.userId, adapter.platform, chatId);

// A question (a "/hoi …" or a text classify() reads as one) is never money: nothing is drafted or stored. On Telegram and Zalo it goes to
// the agent service (docs/02 §2.11.3) and its answer is the reply. Anything else gets the help text, which lists "/hoi" and the plain
// commands ('other' like any help, docs/02 §2.11.6): another adapter (WhatsApp), a bare "/hoi", the agent unset, down or busy, and Zalo
// from 2,400 messages a month (T49's `assistant` guard: the agent is not called at all). Capture never waits on the agent.
async function askAgent(adapter, link, language, message, text) {
  const { platform } = adapter;
  const { chatId } = message;
  if (!text.trim() || !ASSISTANT_PLATFORMS.includes(platform) || !agentConfigured() || !(await maySend(platform, 'assistant'))) {
    return reply(adapter, chatId, messagesFor(language).help);
  }
  const stopTyping = keepTyping(adapter, chatId);
  let answer;
  try {
    // requestId = the chat reference: a webhook delivered twice is answered once, because the agent refuses the second as DUPLICATE.
    answer = await turn({ userId: link.userId, channel: platform, threadKey: chatId, requestId: `${platform}:${chatId}:${message.messageId}`, text, language: language === 'en' ? 'en' : 'vi' });
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    if (err.code === 'DUPLICATE') return; // answered already: nothing to send twice
    return reply(adapter, chatId, messagesFor(language).help); // AGENT_UNAVAILABLE or AGENT_BUSY
  } finally {
    stopTyping();
  }
  return sendAnswer(adapter, chatId, answer);
}

// "typing…" every 4 s while the agent works, for adapters that have it (Telegram). Returns the function that stops it, called in `finally`.
// A failed ping is ignored: it is a courtesy and never costs the user their answer.
function keepTyping(adapter, chatId) {
  if (!adapter.sendTyping) return () => {};
  const ping = () => adapter.sendTyping(chatId).catch(() => {});
  ping();
  const timer = setInterval(ping, TYPING_EVERY_MS);
  return () => clearInterval(timer);
}

// The answer as one message of at most 1,500 characters (docs/02 §2.11.6). A longer one is cut at the end of its body, so the sources line
// (its last line, when the agent names sources) always stays.
function oneMessage(text, sources = []) {
  if (Array.from(text).length <= ANSWER_MAX) return text;
  const lineStart = text.lastIndexOf('\n');
  const hasSources = lineStart > 0 && sources.length > 0 && text.slice(lineStart + 1).endsWith(sources.join('; '));
  const body = Array.from(hasSources ? text.slice(0, lineStart) : text);
  const tail = hasSources ? text.slice(lineStart) : '';
  return `${body.slice(0, Math.max(0, ANSWER_MAX - Array.from(tail).length - 1)).join('')}…${tail}`;
}

// The agent's answer, in one message. An ask-back ("which one?") also gets one button per option where the adapter has buttons
// (Telegram); where it has none (Zalo) its text already numbers the options and the user types the number.
async function sendAnswer(adapter, chatId, { text, sources, card }) {
  const body = oneMessage(text, sources);
  const options = card?.kind === 'ask_back' && Array.isArray(card.options) ? card.options : [];
  if (options.length > 0 && adapter.sendChoices && (await maySend(adapter.platform, 'assistant'))) return adapter.sendChoices(chatId, body, options);
  return reply(adapter, chatId, body, 'assistant');
}

// A bare 1, 2 or 3 (typed, or Telegram's q:<n> button) answers the chat's last ask-back (docs/02 §2.11.3). While it is live (10 minutes) the digit
// goes to the agent, which runs that option. For the next 24 hours it gets the "expired" line and is never money, so it never reaches draft
// creation or the Zalo amount correction. Later a typed digit is an ordinary message again (false); an old button never is. True when handled.
async function answerChoice(adapter, link, language, message, { button = false } = {}) {
  const state = ASSISTANT_PLATFORMS.includes(adapter.platform) && agentConfigured() ? await askBackState(link.userId, adapter.platform, message.chatId) : null;
  if (state === 'live') {
    await askAgent(adapter, link, language, message, message.text.trim());
    return true;
  }
  if (state === 'expired' || button) {
    await reply(adapter, message.chatId, messagesFor(language).askBackExpired);
    return true;
  }
  return false;
}

// Telegram's q:<n> button under an ask-back: the same as typing the digit, except that it is never read as money, however old it is.
// Unlinked and locked chats get nothing (a button has no room for the link instructions).
export async function handleChoice(adapter, message) {
  const link = await ChatLink.findOne({ platform: adapter.platform, platformUserId: message.platformUserId });
  const user = link && (await User.findById(link.userId).lean());
  if (!user || user.status === 'locked') return;
  await answerChoice(adapter, link, user.language, message, { button: true });
}

// A button press (Telegram and WhatsApp ✅ / ❌, Telegram's category tap) → { ok, text }. Only the presser's own drafts can be touched.
// A category tap ('learn') also returns `draft` ({ id, language }): the draft stays waiting, so its message gets its ✅ / ❌ back.
export async function handleButton(platform, platformUserId, action, transactionId, categoryId) {
  const link = await ChatLink.findOne({ platform, platformUserId });
  if (!link) return { ok: false, text: inBothLanguages((m) => [pleaseLink(m)]) }; // a button's short notice can't be tapped
  const user = await User.findById(link.userId).lean();
  if (user.status === 'locked') return { ok: false, text: messagesFor(user.language).locked };
  if (action === 'learn') return tapCategory(link, user.language, transactionId, categoryId);
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
    if (pending) return correctDraft(adapter, link, language, message.chatId, pending, { amount: drafts[0].amount }, drafts[0].guessed);
  }
  const saved = [];
  const guessed = new Map(); // draft id → the parser read a bare number as thousands (the draft check is stricter then)
  for (const [i, { guessed: bare, ...draft }] of drafts.entries()) {
    const chatRef = { platform: adapter.platform, chatId: message.chatId, messageId: `${message.messageId}:${i + 1}` };
    try {
      const transaction = await Transaction.create({ ...draft, userId: link.userId, status: 'draft', source: adapter.platform, chatRef });
      guessed.set(transaction.id, bare);
      saved.push(transaction);
    } catch (err) {
      if (err.code === 11000) continue; // delivered again: this line's draft exists already
      throw err;
    }
  }
  if (saved.length === 0) return;
  await ChatLink.updateOne({ _id: link._id }, { pendingTransactionId: saved.at(-1)._id });
  let failed = null;
  for (const transaction of saved) {
    const draft = await draftMessage(adapter, transaction, m, { guessed: guessed.get(transaction.id) });
    await adapter.sendDraft(message.chatId, draft, language).catch((err) => {
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

// A Zalo correction, or a lone "chia N": `changes` (an amount, or an amount and a note) go through the same service as the
// web Bot inbox edit (PATCH /transactions/:id). Category, wallet and date stay. The draft is sent again, checked again
// for a typo or a repeat (A6), and "ok" / "huy" still act on it.
async function correctDraft(adapter, link, language, chatId, draft, changes, guessed = false) {
  const m = messagesFor(language);
  const updated = await updateTransaction(link.userId, draft._id, changes);
  await ChatLink.updateOne({ _id: link._id }, { pendingTransactionId: updated._id });
  return adapter.sendDraft(chatId, await draftMessage(adapter, updated, m, { guessed }), language);
}

// "chia 3" alone (docs/02 §2.11.2, A5): the waiting draft, a receipt draft too, becomes one share of its amount.
// With no draft waiting nothing changes, and the reply says so.
async function splitPending(adapter, link, language, chatId, people) {
  const draft = await pendingDraft(link);
  if (!draft) return reply(adapter, chatId, messagesFor(language).nothingToSplit, 'capture');
  const { amount, note } = splitBill(draft.amount, people, draft.note);
  return correctDraft(adapter, link, language, chatId, draft, { amount, note });
}

// The draft's one line of text, then what to double-check (A6) in the draft message itself, so Zalo pays for no extra send.
// A failed check never costs the draft its reply: it is only advice.
async function draftText(transaction, m, { guessed = false, lines = [] } = {}) {
  const hints = await draftHints(transaction.userId, { amount: transaction.amount, categoryId: transaction.categoryId, id: transaction._id }, { guessed }).catch((err) => {
    console.error('draftHints failed', err);
    return [];
  });
  const name = hints.length > 0 && categoryName(await Category.findById(transaction.categoryId).lean(), m);
  const hintLines = hints.map((hint) => (hint.code === 'big' ? m.hintBig({ name, times: hint.times, median: money(hint.median, m) }) : m.hintDuplicate({ name })));
  return [m.draft(await describe(transaction, m)), ...lines, ...hintLines].join('\n');
}

// What an adapter's sendDraft gets: { id, text, offers }. `offers` are the categories offered under a fallback draft (A7), [] otherwise.
async function draftMessage(adapter, transaction, m, { guessed = false, lines = [] } = {}) {
  const offers = await categoryOffers(adapter, transaction).catch((err) => {
    console.error('categoryOffers failed', err); // only advice: the draft still goes out
    return [];
  });
  const names = offers.map((category) => categoryName(category, m));
  const offerLine = offers.length > 0 && (adapter.categoryOffer === 'tap' ? m.offerTap : m.offerType(names.join(', ')));
  const text = await draftText(transaction, m, { guessed, lines: [...lines, offerLine].filter(Boolean) });
  return { id: transaction.id, text, offers: offers.map((category, i) => ({ id: String(category._id), name: names[i] })) };
}

// A7: an expense draft the parser could not file (it is in the fallback "Khác") offers the user's 3 most used categories.
// Only on platforms that can answer: adapter.categoryOffer is 'tap' (Telegram buttons) or 'type' (Zalo); WhatsApp has neither yet.
async function categoryOffers(adapter, transaction) {
  if (!adapter.categoryOffer || transaction.type !== 'expense' || !(await isFallbackDraft(transaction))) return [];
  return topExpenseCategories(transaction.userId);
}

const isFallbackDraft = async (transaction) => Boolean((await Category.findById(transaction.categoryId).lean())?.isFallback);

// A7: the waiting draft goes to `category` and that category learns the note's first word. The write only matches a draft that
// still sits in the fallback it was read in, so two taps close together cannot both win: the late one changes nothing, learns
// nothing and gets null. The caller has checked `category` (own, same type, not the fallback), so no reference check is needed.
async function moveToCategory(link, m, draft, category) {
  const updated = await Transaction.findOneAndUpdate(
    { _id: draft._id, userId: link.userId, status: 'draft', deletedAt: null, categoryId: draft.categoryId },
    { categoryId: category._id },
    { returnDocument: 'after' },
  );
  if (!updated) return null;
  const name = categoryName(category, m);
  const word = await learnKeyword(link.userId, category._id, draft.note);
  return { updated, line: word ? m.learned({ name, word }) : m.moved({ name }) };
}

// Telegram's `k:<draft>:<category>` tap. The category must be one of this user's own, of the draft's type and not the fallback,
// and the draft must still sit in the fallback: a tap never moves a draft that has a category already, and never reaches another user's data.
async function tapCategory(link, language, transactionId, categoryId) {
  const m = messagesFor(language);
  const draft = await Transaction.findOne({ _id: transactionId, userId: link.userId, status: 'draft', deletedAt: null });
  const category = draft && (await Category.findOne({ _id: categoryId, userId: link.userId, type: draft.type, isFallback: false, deletedAt: null }));
  if (!category) return { ok: false, text: m.notFound };
  if (!(await isFallbackDraft(draft))) return { ok: false, text: m.hasCategory };
  const moved = await moveToCategory(link, m, draft, category);
  if (!moved) return { ok: false, text: m.hasCategory }; // another tap got there first
  const { updated, line } = moved;
  await ChatLink.updateOne({ _id: link._id }, { pendingTransactionId: updated._id });
  return { ok: true, text: await draftText(updated, m, { lines: [line] }), draft: { id: updated.id, language } };
}

// Zalo: a message that is exactly one of the user's category names, while a fallback draft waits, answers the offer.
// false when it is not that (the message then goes on to the other rules).
async function typedCategory(adapter, link, language, message) {
  const draft = await pendingDraft(link);
  if (!draft || draft.type !== 'expense' || !(await isFallbackDraft(draft))) return false;
  const typed = normalize(message.text);
  const categories = await Category.find({ userId: link.userId, type: draft.type, isFallback: false, deletedAt: null }).lean();
  const category = categories.find((c) => [c.name, c.names?.vi, c.names?.en].some((name) => name && normalize(name) === typed));
  if (!category) return false;
  const m = messagesFor(language);
  const moved = await moveToCategory(link, m, draft, category);
  if (!moved) {
    await reply(adapter, message.chatId, m.hasCategory, 'capture'); // another answer got there first
    return true;
  }
  const { updated, line } = moved;
  await ChatLink.updateOne({ _id: link._id }, { pendingTransactionId: updated._id });
  await adapter.sendDraft(message.chatId, await draftMessage(adapter, updated, m, { lines: [line] }), language);
  return true;
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
  const { items, reconciled } = transaction.receipt;
  const lines = items.length > 0 ? [m.receiptItems({ count: items.length, reconciled })] : [];
  await adapter.sendDraft(message.chatId, await draftMessage(adapter, transaction, m, { lines }), language);
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
  await ChatLink.updateOne({ _id: link._id }, { lastConfirmedId: result.transaction._id, lastConfirmedAt: new Date() }); // for "/sua" and "hoàn tác"
  const lines = [m.saved(await describe(result.transaction, m))];
  if (result.budgetWarning) lines.push(await warningLine(result.budgetWarning, m));
  return { ok: true, text: lines.join('\n') };
}

// What "/sua" and "hoàn tác" may touch: a transaction this chat confirmed in the last 15 minutes (docs/02 §2.11.2, A4).
const FIX_WINDOW_MS = 15 * 60 * 1000;

// The waiting draft (the same one "ok" / "huy" act on), else this chat's own last confirm while it is under 15 minutes
// old, still saved and not deleted. null when there is neither. Always this link's own user: the stored id is
// only a pointer, and the query adds userId.
async function fixTarget(link) {
  const draft = await pendingDraft(link);
  if (draft) return draft;
  if (!link.lastConfirmedId || Date.now() - link.lastConfirmedAt > FIX_WINDOW_MS) return null;
  return Transaction.findOne({ _id: link.lastConfirmedId, userId: link.userId, status: 'confirmed', deletedAt: null });
}

// "/sua <changes>": the amount, wallet alias, date or category keyword in the text replace those of the target (see
// fixTarget); the note stays. A draft is sent again with its buttons, like a Zalo correction. A saved transaction gets one
// line, and after an amount change on an expense the budget warning runs again. The same service as the web edit.
async function fixLast(adapter, link, language, chatId, text) {
  const m = messagesFor(language);
  const target = await fixTarget(link);
  if (!target) return reply(adapter, chatId, m.nothingToFix, 'capture');
  const [categories, wallets] = await Promise.all([
    Category.find({ userId: link.userId, deletedAt: null, type: target.type }).lean(),
    Wallet.find({ userId: link.userId, deletedAt: null, archived: false }).lean(),
  ]);
  const { changes, guessed } = readFixes(text, { categories, wallets });
  if (Object.keys(changes).length === 0) return reply(adapter, chatId, m.help, 'capture'); // nothing recognised: no change
  if (target.status === 'draft') return correctDraft(adapter, link, language, chatId, target, changes, guessed);
  const updated = await updateTransaction(link.userId, target._id, changes);
  const lines = [m.fixed(await describe(updated, m))];
  const warning = changes.amount && updated.type === 'expense' && (await budgetWarning(link.userId, updated.categoryId, monthKey(updated.occurredAt)));
  if (warning) lines.push(await warningLine(warning, m));
  return reply(adapter, chatId, lines.join('\n'), 'capture');
}

// "hoàn tác" / "undo": the last transaction this chat confirmed is soft-deleted, as the web's undo snackbar does. The pointer stays,
// so "khôi phục" can bring it back; once it is deleted a second "hoàn tác" finds nothing.
async function undoLast(link) {
  const m = await messagesOf(link);
  const last = link.lastConfirmedId && (await Transaction.findOne({ _id: link.lastConfirmedId, userId: link.userId, deletedAt: null }));
  if (!last) return m.nothingToUndo;
  try {
    await deleteTransaction(link.userId, last._id);
  } catch (err) {
    if (err instanceof AppError) return m.nothingToUndo; // deleted on the web between the two steps
    throw err;
  }
  return m.undone(await describe(last, m));
}

// "khôi phục": the last transaction this chat confirmed, when it was undone, is back. Refused (nothing to restore) when it
// is not deleted, or when its wallet or category was deleted since.
async function restoreLast(link) {
  const m = await messagesOf(link);
  try {
    if (!link.lastConfirmedId) return m.nothingToRestore;
    return m.restored(await describe(await restoreTransaction(link.userId, link.lastConfirmedId), m));
  } catch (err) {
    if (err instanceof AppError) return m.nothingToRestore;
    throw err;
  }
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
