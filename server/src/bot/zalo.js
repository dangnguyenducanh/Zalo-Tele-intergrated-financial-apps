// Zalo adapter (docs/04 §4.6): turns Zalo Bot Platform events into bot core calls and talks back with sendMessage.
// Zalo has no buttons, so a draft ends with the "ok / huy" hint and the core resolves the typed answer.
import { env } from '../config/env.js';
import { handleMessage, messagesFor } from './core.js';

// Calls one Bot API method (https://bot.zaloplatforms.com/docs) and returns its `result`.
// The error never contains the URL, because the URL contains the bot token.
async function callApi(method, body) {
  const res = await fetch(`https://bot-api.zaloplatforms.com/bot${env.ZALO_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Zalo ${method} failed: ${data.error_code} ${data.description}`);
  return data.result;
}

// Replies stay far below Zalo's 2000-char limit: a note is at most 200 chars, names at most 40.
export const zalo = {
  platform: 'zalo',
  sendText: (chatId, text) => callApi('sendMessage', { chat_id: chatId, text }),
  sendDraft: (chatId, draft, language) => zalo.sendText(chatId, `${draft.text}\n${messagesFor(language).replyHint}`),
  // A photo arrives as a plain URL, so downloading it is one GET.
  async downloadPhoto(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Zalo photo download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
};

// One webhook event: { event_name, message } (some Zalo docs show it wrapped in { ok, result }, so both are read).
// Only text and photos in a private chat: in a group, other people would see the money. Stickers, voice
// and unsupported messages are ignored.
export async function handleZaloEvent(body) {
  const { event_name: eventName, message } = body?.result ?? body ?? {};
  const isText = eventName === 'message.text.received';
  const isPhoto = eventName === 'message.image.received';
  if (!(isText || isPhoto) || !message?.from || message.chat?.chat_type !== 'PRIVATE') return;
  await handleMessage(zalo, {
    platformUserId: String(message.from.id),
    chatId: String(message.chat.id),
    messageId: String(message.message_id),
    displayName: message.from.display_name ?? '',
    text: isText ? (message.text ?? '') : '',
    photo: isPhoto ? (message.photo_url ?? message.photo) : undefined, // older payloads used `photo`
  });
}
