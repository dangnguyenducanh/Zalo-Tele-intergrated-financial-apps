import mongoose from 'mongoose';

// The sign-up that is waiting for its code. The password is only ever its bcrypt hash, the token only its SHA-256.
const signupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    language: { type: String, enum: ['vi', 'en'], default: 'vi' },
    passwordHash: { type: String, required: true },
    tokenHash: { type: String, required: true }, // SHA-256 of the signupToken that only the register answer carried (D1)
  },
  { _id: false },
);

// docs/03 §3.8 `emailCodes`: one row per purpose and address. Register upserts the `signup` row, a resend replaces its
// code, and the right code deletes it. The code itself is never stored, only its SHA-256.
const emailCodeSchema = new mongoose.Schema(
  {
    purpose: { type: String, enum: ['signup', 'reset'], required: true },
    email: { type: String, required: true, lowercase: true },
    codeHash: { type: String, required: true },
    codeExpiresAt: { type: Date, required: true }, // now + 10 minutes, set again by each send
    attempts: { type: Number, default: 0 }, // wrong and right tries on this code; the 5th kills it
    sends: { type: [Date], default: [] }, // the last 5 send times, oldest first: the 60 s wait and the 5-an-hour limit
    signup: { type: signupSchema }, // only for purpose 'signup'
    expiresAt: { type: Date, required: true }, // last send + 1 hour; MongoDB deletes the row after it
  },
  { collection: 'emailCodes' },
);

emailCodeSchema.index({ purpose: 1, email: 1 }, { unique: true });
emailCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailCode = mongoose.model('EmailCode', emailCodeSchema);
