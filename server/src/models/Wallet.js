import mongoose from 'mongoose';
import { MAX_MONEY } from './Transaction.js';

// docs/03 §3.3 `wallets`. The current balance is not stored: services/wallets.js computes it from the
// confirmed transactions every time it is read.
const walletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    type: { type: String, enum: ['cash', 'bank', 'ewallet', 'credit'], required: true },
    initialBalance: { type: Number, default: 0, validate: (v) => Number.isSafeInteger(v) && Math.abs(v) <= MAX_MONEY }, // may be negative (credit card)
    aliases: { type: [String], default: [] }, // bot shortcuts such as "mm", stored like the parser reads them
    color: { type: String, default: '' },
    icon: { type: String, default: '' },
    archived: { type: Boolean, default: false },
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

walletSchema.index({ userId: 1, deletedAt: 1 });
// One name per user among wallets that are not deleted, ignoring upper/lower case ("Cash" = "cash").
walletSchema.index(
  { userId: 1, name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null }, collation: { locale: 'vi', strength: 2 } },
);

export const Wallet = mongoose.model('Wallet', walletSchema);
