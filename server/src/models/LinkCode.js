import mongoose from 'mongoose';

// docs/03 §3.3 `linkCodes`: a one-time code that links a chat to the user who asked for it.
// Only the SHA-256 of the code is stored, like refresh tokens in `sessions`.
const linkCodeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    codeHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true }, // now + 10 minutes
    usedAt: { type: Date, default: null }, // set when a chat redeems it; a used code never works again
  },
  { timestamps: true, collection: 'linkCodes' },
);

linkCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB deletes expired codes itself

export const LinkCode = mongoose.model('LinkCode', linkCodeSchema);
