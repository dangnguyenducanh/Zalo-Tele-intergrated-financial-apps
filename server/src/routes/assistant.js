// The Dashboard drawer's endpoints (docs/02 §2.11.5, docs/04 §4.4 Assistant). A question goes to the agent service through
// services/agent.js; a capture ("phở 45k") never does, it gets the quick-add preview. Express never writes an agentTurns row
// (the agent does): it reads the thread and the daily count, and "Xoá" only sets `clearedAt`.
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { classify } from '../bot/ask.js';
import { messagesFor } from '../bot/core.js';
import { requireAuth } from '../middleware/auth.js';
import { AgentTurn } from '../models/AgentTurn.js';
import { User } from '../models/User.js';
import { agentConfigured, turn } from '../services/agent.js';
import { previewTransactions } from '../services/transactions.js';
import { dayRange } from '../utils/vnTime.js';
import { month } from './budgets.js';

const router = Router();
router.use(requireAuth);

const WEB = { channel: 'web', threadKey: 'web' }; // the drawer's thread (docs/03 §3.7 agentTurns)
const DAILY_CAP = 30; // web questions per user per Vietnam day: CAPS['web'] in agent/graph.py, which does the blocking (docs/02 §2.11.4)
const THREAD_TURNS = 6;
const ASK_BACK_GRACE_MS = 24 * 60 * 60 * 1000; // a lapsed ask-back still gets the "expired" line for a day (docs/02 §2.11.3)
const EXPIRED = { vi: 'Câu hỏi đã hết hạn, hãy hỏi lại', en: 'That question has expired, please ask it again' };

const chatBody = z.object({
  message: z.string().trim().min(1).max(500),
  month: month.optional(),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be an id'), // the drawer's randomUUID(); no ":" so it can never look like a chat reference
});

// The same rule as the agent's cap (docs/02 §2.11.4, D16): this Vietnam day's web chat turns, not the ones that named a skill
// (a command). Rows "Xoá" hid still count, so clearing gives nothing back.
async function remainingToday(userId) {
  const asked = await AgentTurn.countDocuments({
    userId,
    channel: 'web',
    trigger: 'chat',
    command: mongoose.trusted({ $ne: true }),
    createdAt: mongoose.trusted({ $gte: dayRange(new Date()).start }),
  });
  return Math.max(0, DAILY_CAP - asked);
}

// Did the agent's last "which one?" lapse, less than a day ago? (Live, or none: a bare 1-3 is a normal question; the agent runs the
// option.) The latest ask-back of this user's web thread decides, the way the agent reads it; "Xoá"-hidden ones are ignored.
async function askBackLapsed(userId) {
  const now = Date.now();
  const row = await AgentTurn.findOne(
    { userId, ...WEB, clearedAt: null, 'askBack.expiresAt': mongoose.trusted({ $gte: new Date(now - ASK_BACK_GRACE_MS) }) },
    { 'askBack.expiresAt': 1 },
  )
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  return Boolean(row) && row.askBack.expiresAt.getTime() <= now;
}

const toTurn = (row) => ({
  id: String(row._id),
  question: row.question ?? null,
  text: row.answer,
  route: row.route,
  facts: row.facts ?? [],
  sources: row.sources ?? [],
  followups: row.followups ?? [],
  ...(row.card && { card: row.card }), // passed through unchanged
  createdAt: row.createdAt,
});

router.post('/chat', async (req, res) => {
  const { message, month: period, requestId } = chatBody.parse(req.body);
  const userId = req.user.id;
  const user = await User.findById(userId).select('language').lean();
  const language = user?.language === 'en' ? 'en' : 'vi';
  const reply = async (body) => res.json({ ...body, remainingToday: await remainingToday(userId) });

  // A bare 1, 2 or 3 after an ask-back that has run out: never a capture (it would read "2" as 2.000 ₫) and never a new question.
  if (agentConfigured() && /^[1-3]$/.test(message) && (await askBackLapsed(userId))) {
    return reply({ route: 'rules', text: EXPIRED[language], facts: [], sources: [], followups: [] });
  }
  // In the drawer a follow-up is always on (docs/02 §2.11.1 rule 7): a bare number is no amount, "phở 45k" still is one.
  if (classify(message, { followUp: true }) === 'capture') {
    return reply({ route: 'capture', capture: await previewTransactions(userId, message) });
  }
  if (!agentConfigured()) return reply({ route: 'off', text: messagesFor(language).help, facts: [], sources: [], followups: [] });

  const answer = await turn({ userId, ...WEB, requestId, text: message, language, month: period });
  return reply({
    route: answer.route,
    text: answer.text,
    facts: answer.facts ?? [],
    sources: answer.sources ?? [],
    followups: answer.followups ?? [],
    ...(answer.card && { card: answer.card }),
  });
});

router.get('/thread', async (req, res) => {
  const rows = await AgentTurn.find({ userId: req.user.id, ...WEB, clearedAt: null, answer: mongoose.trusted({ $ne: null }) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(THREAD_TURNS)
    .lean();
  res.json({ turns: rows.reverse().map(toTurn), ai: { remainingToday: await remainingToday(req.user.id) } });
});

// "Xoá": hides the thread, the one write Express makes to an agent collection. Rows are never deleted, so the daily count stays.
router.delete('/thread', async (req, res) => {
  await AgentTurn.updateMany({ userId: req.user.id, ...WEB, clearedAt: null }, { clearedAt: new Date() });
  res.sendStatus(204);
});

export default router;
