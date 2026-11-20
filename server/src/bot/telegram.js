// Telegram adapter (docs/04 §4.6): turns Telegram updates into bot core calls and talks back through the Bot API.
import { env } from '../config/env.js';
import { handleButton, handleMessage, messagesFor } from './core.js';

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

export const telegram = {
  platform: 'telegram',
  sendText: (chatId, text) => callApi('sendMessage', { chat_id: chatId, text }),
  // The draft with ✅ / ❌ buttons. callback_data is "c:<id>" or "x:<id>" (30 bytes; Telegram allows 64).
  sendDraft(chatId, draft, language) {
    const { buttons } = messagesFor(language);
    const row = [
      { text: buttons.save, callback_data: `c:${draft.id}` },
      { text: buttons.discard, callback_data: `x:${draft.id}` },
    ];
    // ✏️ opens the web Bot inbox. Telegram refuses http:// and localhost links, so only for the deployed app.
    if (env.APP_URL?.startsWith('https://')) row.push({ text: buttons.edit, url: `${env.APP_URL}/bot` });
    return callApi('sendMessage', { chat_id: chatId, text: draft.text, reply_markup: { inline_keyboard: [row] } });
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
    text: message.text ?? '', // photos and stickers have no text and get the help reply
  });
}

// ✅ / ❌ under a draft. On success the draft message is replaced by the result (and loses its buttons);
// otherwise Telegram shows the reason as a short notice. Every press must be answered to stop the spinner.
async function pressButton(query) {
  const [, action, transactionId] = /^([cx]):([0-9a-f]{24})$/.exec(query.data ?? '') ?? [];
  if (!action) return callApi('answerCallbackQuery', { callback_query_id: query.id });

  const result = await handleButton('telegram', String(query.from.id), action === 'c' ? 'confirm' : 'discard', transactionId);
  if (result.ok && query.message) {
    await callApi('editMessageText', { chat_id: query.message.chat.id, message_id: query.message.message_id, text: result.text });
  }
  await callApi('answerCallbackQuery', { callback_query_id: query.id, text: result.ok ? undefined : result.text.slice(0, 200) });
}
