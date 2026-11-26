// WhatsApp adapter (docs/04 §4.6, docs/02 §2.10.4): turns WhatsApp Cloud API webhook bodies into bot core calls and
// talks back through the Graph API (https://developers.facebook.com/documentation/business-messaging/whatsapp).
// A chat is keyed by the user's business-scoped user ID (BSUID): Meta leaves the phone number out for users with a
// username, so the phone number is never read, stored or used to reply. Replies go to `recipient`, never to `to`.
import { env } from '../config/env.js';
import { handleButton, handleMessage, messagesFor } from './core.js';

const GRAPH_VERSION = 'v26.0'; // the one place the Graph API version is pinned (docs/04 §4.6)
const TEXT_LIMIT = 4096; // characters in a text message
const BODY_LIMIT = 1024; // characters in the body of a button message

// One Graph API call (the access token is only in the Authorization header). The error never contains the token.
async function callGraph(what, path, body) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, ...(body && { 'content-type': 'application/json' }) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp ${what} failed: ${res.status} ${data.error?.code} ${data.error?.message}`);
  return data;
}

// Sends one message to a BSUID. `content` is the part that differs: { type: 'text', text } or { type: 'interactive', interactive }.
const send = (chatId, content) =>
  callGraph('send', `${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    recipient: chatId,
    ...content,
  });

// A reply longer than WhatsApp allows becomes several messages, cut at the last line break that fits so a line is
// not split, else at the limit. Characters are counted as WhatsApp does (a symbol outside the BMP is one).
function pieces(text, limit) {
  const chars = Array.from(text);
  const out = [];
  while (chars.length > limit) {
    const lineBreak = chars.lastIndexOf('\n', limit);
    const cut = lineBreak > 0 ? lineBreak : limit;
    out.push(chars.splice(0, cut).join(''));
    if (chars[0] === '\n') chars.shift();
  }
  out.push(chars.join(''));
  return out;
}

export const whatsapp = {
  platform: 'whatsapp',
  async sendText(chatId, text) {
    for (const part of pieces(text, TEXT_LIMIT)) await send(chatId, { type: 'text', text: { body: part } });
  },
  // The draft with ✅ / ❌ / ✏️ reply buttons. The button ids are Telegram's callback data: "c:<id>", "x:<id>" and
  // "e:<id>" (27 characters; WhatsApp allows 256). ✏️ is answered with the Bot inbox address, so without APP_URL it is left out.
  sendDraft(chatId, draft, language) {
    const { buttons } = messagesFor(language);
    const row = [
      { id: `c:${draft.id}`, title: buttons.save },
      { id: `x:${draft.id}`, title: buttons.discard },
    ];
    if (env.APP_URL) row.push({ id: `e:${draft.id}`, title: buttons.edit });
    return send(chatId, {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: Array.from(draft.text).slice(0, BODY_LIMIT).join('') },
        action: { buttons: row.map((reply) => ({ type: 'reply', reply })) },
      },
    });
  },
  // A photo's media id → its short-lived URL → the bytes. Both calls need the access token.
  async downloadPhoto(mediaId) {
    const { url } = await callGraph('media lookup', encodeURIComponent(mediaId));
    if (!url?.startsWith('https://')) throw new Error('WhatsApp media lookup returned no https URL');
    const res = await fetch(url, { headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`WhatsApp media download failed: ${res.status}`); // no URL: it is a one-time address
    return Buffer.from(await res.arrayBuffer());
  },
};

const list = (value) => (Array.isArray(value) ? value : []);

// One webhook body (entry[].changes[].value). `messages[]` are handled in order; `statuses[]` (sent, delivered,
// read) and other fields are ignored. One failed message does not stop the ones after it; the first error is thrown
// at the end, and the webhook logs it.
export async function handleWhatsAppWebhook(body) {
  let failed = null;
  for (const entry of list(body?.entry)) {
    for (const change of list(entry?.changes)) {
      if (change?.field !== 'messages') continue;
      for (const message of list(change.value?.messages)) {
        await handleOne(change.value, message).catch((err) => {
          failed ??= err;
        });
      }
    }
  }
  if (failed) throw failed;
}

async function handleOne(value, message) {
  if (typeof message?.id !== 'string' || message.group_id) return; // groups: other people would see the money
  const userId = message.from_user_id;
  if (typeof userId !== 'string' || !userId) {
    console.warn(`whatsapp message ${message.id} ignored: no business-scoped user ID`); // the phone number is never a key
    return;
  }
  const contact = list(value.contacts).find((c) => c?.user_id === userId); // a batch can hold several senders
  if (message.type === 'interactive' && message.interactive?.type === 'button_reply') return pressButton(userId, message.interactive.button_reply?.id);

  await handleMessage(whatsapp, {
    platformUserId: userId,
    chatId: userId,
    messageId: message.id,
    displayName: contact?.profile?.name ?? '',
    text: message.type === 'text' ? String(message.text?.body ?? '') : '', // other types get the help reply
    photo: message.type === 'image' ? message.image?.id : undefined,
  });
}

// ✅ / ❌ / ✏️ under a draft. WhatsApp can't edit a sent message, so the result is a new message. ✏️ only points at the web.
async function pressButton(userId, buttonId) {
  const [, action, transactionId] = /^([cxe]):([0-9a-f]{24})$/.exec(buttonId ?? '') ?? [];
  if (!action) return;
  if (action === 'e') return env.APP_URL && whatsapp.sendText(userId, `${env.APP_URL}/bot`);
  const result = await handleButton('whatsapp', userId, action === 'c' ? 'confirm' : 'discard', transactionId);
  await whatsapp.sendText(userId, result.text);
}
