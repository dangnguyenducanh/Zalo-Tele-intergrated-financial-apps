// Telegram adapter (docs/04 §4.6): turns Telegram updates into bot core calls and talks back through the Bot API.
import { env } from '../config/env.js';
import { handleButton, handleChoice, handleMessage, messagesFor } from './core.js';

// Calls one Bot API method (https://core.telegram.org/bots/api) and returns its `result`.
// The error never contains the URL, because the URL contains the bot token.
async function callApi(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.error_code} ${data.description}`);
  return data.result;
}

// ✅ / ❌ under a draft. callback_data is "c:<id>" or "x:<id>" (26 bytes; Telegram allows 64).
function draftRow(draftId, language) {
  const { buttons } = messagesFor(language);
  const row = [
    { text: buttons.save, callback_data: `c:${draftId}` },
    { text: buttons.discard, callback_data: `x:${draftId}` },
  ];
  // ✏️ opens the web Bot inbox. Telegram refuses http:// and localhost links, so only for the deployed app.
  if (env.APP_URL?.startsWith('https://')) row.push({ text: buttons.edit, url: `${env.APP_URL}/bot` });
  return row;
}

export const telegram = {
  platform: 'telegram',
  categoryOffer: 'tap', // a Khác/Other draft offers its categories as buttons (A7)
  sendText: (chatId, text) => callApi('sendMessage', { chat_id: chatId, text }),
  // The draft with ✅ / ❌ buttons, and for a draft in Khác/Other a button per offered category: "k:<draft>:<category>" (51 bytes).
  sendDraft(chatId, draft, language) {
    const offered = draft.offers?.length > 0 ? [draft.offers.map(({ id, name }) => ({ text: name, callback_data: `k:${draft.id}:${id}` }))] : [];
    return callApi('sendMessage', { chat_id: chatId, text: draft.text, reply_markup: { inline_keyboard: [draftRow(draft.id, language), ...offered] } });
  },
  // "typing…" while the agent works (core.js sends it every 4 s and stops it when the answer is out).
  sendTyping: (chatId) => callApi('sendChatAction', { chat_id: chatId, action: 'typing' }),
  // An ask-back: the agent's numbered text with one button per option, "q:<n>" (3 bytes; Telegram allows 64).
  sendChoices: (chatId, text, options) =>
    callApi('sendMessage', { chat_id: chatId, text, reply_markup: { inline_keyboard: options.map(({ n, label }) => [{ text: `${n}. ${label}`, callback_data: `q:${n}` }]) } }),
  // A photo's file_id → getFile → its bytes (bots may download files up to 20 MB).
  async downloadPhoto(fileId) {
    const { file_path: path } = await callApi('getFile', { file_id: fileId });
    const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`); // no URL: it contains the token
    return Buffer.from(await res.arrayBuffer());
  },
};

// One webhook update. Only private chats: in a group, other people would see the money.
export async function handleTelegramUpdate(update) {
  if (update.callback_query) return pressButton(update.callback_query);
  const message = update.message;
  if (message?.chat?.type !== 'private' || !message.from) return;
  const { first_name: first, last_name: last, username } = message.from;
  await handleMessage(telegram, {
    platformUserId: String(message.from.id),
    chatId: String(message.chat.id),
    messageId: String(message.message_id),
    displayName: [first, last].filter(Boolean).join(' ') || username || '',
    text: message.text ?? '', // stickers and other messages without text get the help reply
    photo: message.photo?.at(-1)?.file_id, // Telegram sends each photo in several sizes, the largest last
  });
}

// ✅ / ❌ / a category under a draft. On success the draft message is replaced by the result (and loses its buttons);
// otherwise Telegram shows the reason as a short notice. Every press must be answered to stop the spinner.
async function pressButton(query) {
  const choice = /^q:([1-3])$/.exec(query.data ?? '');
  if (choice) return pressChoice(query, choice[1]);
  const [, action, transactionId, categoryId] = /^([cxk]):([0-9a-f]{24})(?::([0-9a-f]{24}))?$/.exec(query.data ?? '') ?? [];
  if (!action || (action === 'k') !== Boolean(categoryId)) return callApi('answerCallbackQuery', { callback_query_id: query.id });

  const result = await handleButton('telegram', String(query.from.id), { c: 'confirm', x: 'discard', k: 'learn' }[action], transactionId, categoryId);
  if (result.ok && query.message) {
    // A category tap leaves the draft waiting, so its message keeps ✅ / ❌ (and no category buttons: it has one now).
    const keyboard = result.draft && { inline_keyboard: [draftRow(result.draft.id, result.draft.language)] };
    await callApi('editMessageText', { chat_id: query.message.chat.id, message_id: query.message.message_id, text: result.text, reply_markup: keyboard });
  }
  await callApi('answerCallbackQuery', { callback_query_id: query.id, text: result.ok ? undefined : result.text.slice(0, 200) });
}

// "q:1" … "q:3" under an ask-back: the number is the user's next message. The spinner stops first, because the answer can take up to 25 s.
// The press has no message id of its own, so its callback id (the same on a redelivery) is the request id: pressed twice, answered once.
async function pressChoice(query, digit) {
  await callApi('answerCallbackQuery', { callback_query_id: query.id });
  if (!query.message) return;
  await handleChoice(telegram, { platformUserId: String(query.from.id), chatId: String(query.message.chat.id), messageId: `cb${query.id}`, displayName: '', text: digit });
}
