import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// docs/03 §3.3 `chatLinks`: a Telegram, Zalo or WhatsApp chat account linked to one web account. Unlinking deletes the row.
const chatLinkSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    platform: { type: String, enum: ['telegram', 'zalo', 'whatsapp'], required: true },
    platformUserId: { type: String, required: true }, // the sender: Telegram/Zalo `from.id`, WhatsApp's business-scoped user ID (never the phone number)
    chatId: { type: String, required: true }, // where the bot replies
    displayName: { type: String, default: '' }, // shown on the Bot inbox
    pendingTransactionId: { type: ObjectId, ref: 'Transaction', default: null }, // the draft a typed "ok"/"huy" acts on
    lastConfirmedId: { type: ObjectId, ref: 'Transaction', default: null }, // the transaction this chat confirmed last: "/sua" edits it for 15 minutes, "hoàn tác" deletes it
    lastConfirmedAt: { type: Date, default: null }, // when, for that 15-minute window
    viaClaim: { type: Boolean, default: false }, // made by a claim link: the Bot inbox asks "Not you? [Unlink]"
    claimNoticeDismissedAt: { type: Date, default: null }, // when the user dismissed that notice
  },
  { timestamps: true, collection: 'chatLinks' },
);

// One web account per chat account: a second link for the same sender fails with E11000.
chatLinkSchema.index({ platform: 1, platformUserId: 1 }, { unique: true });
chatLinkSchema.index({ userId: 1 });

export const ChatLink = mongoose.model('ChatLink', chatLinkSchema);
