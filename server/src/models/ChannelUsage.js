import mongoose from 'mongoose';

// docs/03 §3.7 `channelUsage`: how many messages the app has sent on a chat app with a monthly quota (Zalo's free
// plan allows 3,000), one row per platform and Vietnam month. services/channelUsage.js counts and reads it.
const channelUsageSchema = new mongoose.Schema(
  {
    platform: { type: String, enum: ['zalo', 'whatsapp'], required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ }, // 'YYYY-MM' in Vietnam time, like budgets.month
    sent: { type: Number, required: true, min: 0 },
  },
  { collection: 'channelUsage' },
);

// One row per platform and month: the counting upsert can never make a second one, even when two messages go out at once.
channelUsageSchema.index({ platform: 1, month: 1 }, { unique: true });

export const ChannelUsage = mongoose.model('ChannelUsage', channelUsageSchema);
