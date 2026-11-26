import { ChannelUsage } from '../models/ChannelUsage.js';
import { monthKey } from '../utils/vnTime.js';

// docs/02 §2.11.6. Zalo's free plan allows 3,000 messages a month, so as the count grows a kind of message is switched
// off, least important first. The kinds (what `maySend` is asked about):
//   proactive  a message the bot starts (digest, early warning, reports)       off from 2,000
//   assistant  an answer to a question                                          off from 2,400
//   other      commands, help, anything not named here                          off from 2,850
//   capture    the reply to money the user sent: drafts, receipt reading, ok/huy, corrections     always
//   link       linking a chat: the please-link prompt, /link and /start CODE, the claim success    always
const ZALO_OFF_FROM = { proactive: 2000, assistant: 2400, other: 2850, capture: Infinity, link: Infinity };

// May a message of this kind be sent on this platform now? Telegram has no quota, and WhatsApp's thresholds come with
// its counting (card T70). When the count cannot be read the message goes out: a lost reply costs the user more than
// one message over the line, and the failure is logged. A kind that is not in the list is a bug, not a free pass.
// ponytail: read, then send, so two replies at 2,849 can both go out; the 150 messages between 2,850 and 3,000 absorb that.
export async function maySend(platform, kind, now = new Date()) {
  const offFrom = ZALO_OFF_FROM[kind];
  if (offFrom === undefined) throw new Error(`unknown message kind "${kind}"`);
  if (platform !== 'zalo' || offFrom === Infinity) return true;
  try {
    const row = await ChannelUsage.findOne({ platform, month: monthKey(now) }, 'sent').lean();
    return (row?.sent ?? 0) < offFrom;
  } catch (err) {
    console.error(`${platform} send counter could not be read:`, err.message);
    return true;
  }
}

// Adds 1 to this month's count after the platform accepted a message: one atomic $inc on the (platform, month) row,
// created by the first send of a month. Counting is bookkeeping, so a failure is logged and never thrown: the message
// is already gone and the user's draft is already saved.
export async function recordSend(platform, now = new Date()) {
  try {
    await ChannelUsage.updateOne({ platform, month: monthKey(now) }, { $inc: { sent: 1 } }, { upsert: true });
  } catch (err) {
    console.error(`${platform} send counter failed:`, err.message);
  }
}
