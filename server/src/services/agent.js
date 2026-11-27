// The one client of the agent service (docs/04 §4.11 "Express side"): POST /v1/turn with the shared secret as a bearer.
// The agent holds the question engine; Express keeps classify, capture and every write. Nothing here is called unless
// agentConfigured() is true, and the callers answer the help text otherwise (docs/04 §4.2).
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { vnParts } from '../utils/vnTime.js';

const WEB_BUDGET_MS = 40_000; // docs/02 §2.11.3: a turn has 40 s on the web and 25 s in a chat
const CHAT_BUDGET_MS = 25_000;

// Both settings are needed (docs/04 §4.2): with one missing the agent is never called.
export const agentConfigured = () => Boolean(env.AGENT_URL && env.AGENT_SECRET);

// The Vietnam date the question is asked on, 'YYYY-MM-DD': the agent works out "hôm nay" from it, not from its own clock.
function vietnamToday() {
  const { year, month, day } = vnParts(new Date());
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// One line with the reason, never the question, the answer or the agent's message: those can hold the user's money (docs/02 §2.11.6, Logs).
function unavailable(reason) {
  console.warn(`[agent] turn failed: ${reason}`);
  return new AppError(503, 'AGENT_UNAVAILABLE', 'The assistant is not answering');
}

// → the agent's answer { route, text, facts, sources, followups, card?, steps, timingsMs }, as it sent it.
// DUPLICATE (409: this requestId was already answered) and AGENT_BUSY (503: the queue is full) pass through. A refused connection,
// a timeout, a 5xx and anything else the agent says (a wrong secret, a body it refuses) are AGENT_UNAVAILABLE: the user cannot fix them.
export async function turn({ trigger = 'chat', userId, channel, threadKey, requestId, text, actionId, skill, language, month }) {
  if (!agentConfigured()) throw new AppError(503, 'FEATURE_NOT_CONFIGURED', 'The assistant is not configured (AGENT_URL, AGENT_SECRET)');

  let res;
  let answer;
  try {
    res = await fetch(`${env.AGENT_URL.replace(/\/$/, '')}/v1/turn`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.AGENT_SECRET}`, 'Content-Type': 'application/json' },
      // allowLlm: the model gate arrives with the model (docs/04 §4.11); until then nothing may call it.
      body: JSON.stringify({ trigger, userId: String(userId), channel, threadKey, requestId, text, actionId, skill, language, month, today: vietnamToday(), allowLlm: false }),
      signal: AbortSignal.timeout(channel === 'web' ? WEB_BUDGET_MS : CHAT_BUDGET_MS), // also covers reading the answer
    });
    answer = await res.json().catch(() => null); // an HTML page from the tunnel is not JSON: it is a failure below
  } catch (err) {
    throw unavailable(err.name); // TimeoutError, TypeError (connection refused) …
  }

  const code = typeof answer?.error?.code === 'string' && /^[A-Z_]{1,40}$/.test(answer.error.code) ? answer.error.code : '-';
  if (res.status === 409 && code === 'DUPLICATE') throw new AppError(409, 'DUPLICATE', 'This request was already answered');
  if (res.status === 503 && code === 'AGENT_BUSY') throw new AppError(503, 'AGENT_BUSY', 'The assistant is busy, try again in a moment');
  if (!res.ok) throw unavailable(`status ${res.status} ${code}`);
  if (typeof answer?.text !== 'string') throw unavailable('status 200 with no answer');
  return answer;
}
