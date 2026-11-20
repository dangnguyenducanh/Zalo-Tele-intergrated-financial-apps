import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// Where a bot draft came from: used to edit the bot's reply and to ignore a webhook delivered twice.
const chatRefSchema = new mongoose.Schema(
  {
    platform: { type: String, enum: ['telegram', 'zalo'], required: true },
    chatId: { type: String, required: true },
    messageId: { type: String, required: true },
  },
  { _id: false },
);

// What the KIE service read from a receipt photo (docs/04 §4.8). Only receipt drafts have it.
const receiptSchema = new mongoose.Schema(
  {
    merchant: String,
    address: String,
    date: String, // as printed on the receipt, e.g. "20/11/2026"
    total: Number,
    items: [{ _id: false, name: String, quantity: Number, unitPrice: Number, amount: Number }],
    reconciled: Boolean, // the line items add up to the total
    kieMs: Number, // how long KIE took
    fileRef: String, // the chat platform's file reference; the image itself is not stored
  },
  { _id: false },
);

// docs/03 §3.3 `transactions`. Amounts are whole VND; "delete" only sets deletedAt.
const transactionSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: 'User', required: true },
    walletId: { type: ObjectId, ref: 'Wallet', required: true },
    categoryId: { type: ObjectId, ref: 'Category', required: true },
    type: { type: String, enum: ['expense', 'income'], required: true },
    amount: { type: Number, required: true, validate: (v) => Number.isSafeInteger(v) && v > 0 },
    note: { type: String, trim: true, maxlength: 200, default: '' },
    occurredAt: { type: Date, required: true },
    status: { type: String, enum: ['draft', 'confirmed'], default: 'confirmed' }, // bots create drafts
    source: { type: String, enum: ['web', 'telegram', 'zalo', 'receipt'], default: 'web' },
    chatRef: { type: chatRefSchema, default: undefined },
    receipt: { type: receiptSchema, default: undefined },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        return ret;
      },
    },
  },
);

transactionSchema.index({ userId: 1, status: 1, occurredAt: -1 }); // lists, dashboard
transactionSchema.index({ userId: 1, categoryId: 1, occurredAt: -1 }); // budgets, stats by category
transactionSchema.index({ userId: 1, walletId: 1 }); // wallet balance
// A webhook delivered twice cannot create a second draft. chatId is part of the key because Telegram
// numbers messages per chat, so two users' chats both have a message 7.
transactionSchema.index(
  { 'chatRef.platform': 1, 'chatRef.chatId': 1, 'chatRef.messageId': 1 },
  { unique: true, partialFilterExpression: { chatRef: { $exists: true } } },
);

export const Transaction = mongoose.model('Transaction', transactionSchema);
