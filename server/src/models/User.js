import mongoose from 'mongoose';

// docs/03 §3.3 `users`. The password hash is never loaded unless a query asks for it with
// .select('+passwordHash'), and it is dropped from every JSON response.
const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    status: { type: String, enum: ['active', 'locked'], default: 'active' },
    language: { type: String, enum: ['vi', 'en'], default: 'vi' },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    defaultWalletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet', default: null },
    // When every session was last revoked (theft or admin lock). A refresh that was already under way checks it (BUG-006).
    sessionsRevokedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.passwordHash;
        delete ret.sessionsRevokedAt;
        return ret;
      },
    },
  },
);

export const User = mongoose.model('User', userSchema);
