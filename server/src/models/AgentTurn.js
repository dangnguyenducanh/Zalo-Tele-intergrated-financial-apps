import mongoose from 'mongoose';

const { Mixed, ObjectId } = mongoose.Schema.Types;

// docs/03 §3.7 `agentTurns`: one row per turn of the agent service, which writes it. Express only reads it (the drawer's thread and
// the daily count) and sets `clearedAt` ("Xoá"). The collection, its unique (userId, requestId) index and its 30-day TTL belong to
// `python -m agent.setup`, because the agent's MongoDB role has no right to create them, so this model creates nothing:
// no index, and no collection when the app starts.
const agentTurnSchema = new mongoose.Schema(
  {
    userId: { type: ObjectId, ref: 'User' },
    channel: { type: String, enum: ['web', 'telegram', 'zalo', 'whatsapp'] },
    threadKey: String, // "web" for the drawer, the chat's id on a chat app
    requestId: String,
    trigger: { type: String, enum: ['chat', 'confirm', 'schedule', 'event'] },
    command: Boolean, // a chat turn that named its skill (/dubao …): it never counts against the daily cap (D16)
    question: String,
    answer: String, // null until the agent has finished the turn
    route: String,
    facts: [Mixed],
    sources: [String],
    followups: [String],
    card: Mixed, // what the agent sent, passed to the web unchanged
    askBack: Mixed, // { question, options, expiresAt } of a "which one?" turn (docs/02 §2.11.3)
    clearedAt: Date,
    createdAt: Date,
  },
  { collection: 'agentTurns', autoIndex: false, autoCreate: false, versionKey: false },
);

export const AgentTurn = mongoose.model('AgentTurn', agentTurnSchema);
