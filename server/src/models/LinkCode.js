import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// The chat a claim link belongs to; the fields mean the same as in chatLinks, whose model checks them when the link
// is made (its platform list is the only one).
const chatSchema = new mongoose.Schema(
  {
    platform: { type: String, required: true },
    platformUserId: { type: String, required: true },
    chatId: { type: String, required: true },
    displayName: { type: String, default: '' },
  },
  { _id: false },
);

// docs/03 §3.3 `linkCodes`: a one-time secret that links a chat to a web account. Two kinds of row:
//   a code (`userId`): made on the website, sent to the bot as "/link CODE";
//   a claim link (`chat`): made by the bot for a chat that is not linked, confirmed on the website's /link screen.
// Only the SHA-256 is stored, like refresh tokens in `sessions`.
const linkCodeSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: 'User' },
    chat: { type: chatSchema },
    codeHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true }, // now + 10 minutes
    usedAt: { type: Date, default: null }, // set when it is redeemed or claimed; a used one never works again
  },
  { timestamps: true, collection: 'linkCodes' },
);

linkCodeSchema.pre('validate', function () {
  if (Boolean(this.userId) === Boolean(this.chat)) this.invalidate('userId', 'a linkCodes row has exactly one of userId and chat');
});

linkCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB deletes expired rows itself
// One claim link per chat: the bot's upsert replaces the older one, even when two messages arrive at once.
linkCodeSchema.index(
  { 'chat.platform': 1, 'chat.platformUserId': 1 },
  { unique: true, partialFilterExpression: { 'chat.platformUserId': { $exists: true } } },
);

export const LinkCode = mongoose.model('LinkCode', linkCodeSchema);
