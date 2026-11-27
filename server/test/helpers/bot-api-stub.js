// Outbound HTTP for the E2E API server (BUG-002), like the MSW mocks in the Vitest suites: the Telegram and
// Zalo Bot APIs, the WhatsApp Graph API and the agent service are answered here, so an E2E run never messages a real chat or calls a
// real agent, even with real tokens in the environment. Any other host except localhost fails with a network error, so a new
// outbound call cannot slip in.
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse, passthrough } from 'msw';
import { setupServer } from 'msw/node';
import { AgentTurn } from '../../src/models/AgentTurn.js';
import { AGENT_SECRET, AGENT_URL } from './agent-stub.js';

// Every stubbed Bot API call as { platform, method, chatId }. Never the token: it is in the URL (Telegram, Zalo) or a header (WhatsApp).
export const botCalls = [];

// What the bots said, one JSON line per reply, for a Playwright spec that needs it: the claim link of an unlinked
// chat exists nowhere else (client/e2e/link.spec.ts builds the same path). One file per API port (per worktree).
const repliesFile = () => process.env.PORT && join(tmpdir(), `e2e-bot-replies-${process.env.PORT}.jsonl`);

// Answers one Bot API method the way the platform does: { ok: true, result: <the sent message> }.
const answer =
  (platform) =>
  async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    const chatId = body.chat_id === undefined ? null : String(body.chat_id); // answerCallbackQuery has no chat
    botCalls.push({ platform, method: params.method, chatId });
    if (repliesFile() && body.text) appendFileSync(repliesFile(), `${JSON.stringify({ platform, chatId, text: body.text })}\n`);
    console.info(`[bot-api-stub] ${platform} ${params.method} chat=${chatId}`);
    const message = { message_id: botCalls.length, date: Math.floor(Date.now() / 1000), chat: { id: body.chat_id }, text: body.text };
    return HttpResponse.json({ ok: true, result: message });
  };

// WhatsApp's Graph API: POST /<version>/<phone number ID>/messages to a `recipient` (the user's BSUID), answered with the sent message's id.
async function answerWhatsApp({ request }) {
  const body = await request.json().catch(() => ({}));
  const chatId = body.recipient === undefined ? null : String(body.recipient);
  botCalls.push({ platform: 'whatsapp', method: 'messages', chatId });
  const text = body.text?.body ?? body.interactive?.body?.text;
  if (repliesFile() && text) appendFileSync(repliesFile(), `${JSON.stringify({ platform: 'whatsapp', chatId, text })}\n`);
  console.info(`[bot-api-stub] whatsapp messages chat=${chatId}`);
  return HttpResponse.json({ messaging_product: 'whatsapp', contacts: [{ input: chatId, user_id: chatId }], messages: [{ id: `wamid.stub${botCalls.length}` }] });
}

// ---- The agent service (docs/07 §7.9.5 *drawer E2E*) ----
// POST /v1/turn answers fixed texts, keyed by the question, and writes the agentTurns row like the real agent, so the drawer's thread,
// "Xoá", the daily count and the ask-back state are the real Express code on real rows. A Playwright spec switches the stub to "down"
// (500) or "busy" (503 AGENT_BUSY) by writing that word to the file below, one file per API port like the bot replies.
export const agentModeFile = () => join(tmpdir(), `e2e-agent-${process.env.PORT ?? '4100'}.txt`);

function agentMode() {
  try {
    return readFileSync(agentModeFile(), 'utf8').trim();
  } catch {
    return 'ok'; // no file, no switch
  }
}

const agentError = (status, code) => HttpResponse.json({ error: { code, message: code } }, { status });
const AGENT_EXAMPLES = ['tháng này ăn uống hết bao nhiêu?', 'momo còn bao nhiêu?', 'tổng kết tuần này'];
const ASK_BACK_OPTIONS = [
  { n: 1, label: 'Thu chi theo kỳ · tháng này' },
  { n: 2, label: 'Chi theo danh mục · Ăn uống' },
];

// What the stub says to a question; numbers are made up, the E2E proves the screens (the numbers are the skill eval's job, §7.9.6).
export function cannedAnswer(text) {
  const question = String(text ?? '').trim().toLowerCase();
  const rules = (extra) => ({ route: 'rules', facts: [], sources: [], followups: [], card: null, ...extra });
  if (question === 'tháng 10 thu bao nhiêu')
    return rules({
      text: 'Tháng 10 bạn thu 15.000.000 ₫.',
      facts: [{ id: 'f1', label: 'Thu 10/2026', display: '15.000.000 ₫' }],
      sources: ['Giao dịch đã xác nhận 1/10–31/10/2026'],
      followups: ['Còn tháng 9?', 'Chi tiêu tháng 10?'],
    });
  if (question === 'tháng này ăn uống hết bao nhiêu?')
    return rules({
      text: 'Tháng này bạn chi 45.000 ₫ cho ăn uống.',
      facts: [{ id: 'f1', label: 'Ăn uống tháng này', display: '45.000 ₫' }],
      sources: ['Giao dịch đã xác nhận trong tháng này'],
      followups: ['Còn tháng trước?'],
    });
  if (question === 'tổng kết tuần')
    return { route: 'agent', text: 'Tuần này bạn chi ít hơn tuần trước.', facts: [], sources: ['So sánh cùng kỳ'], followups: [], card: null };
  if (question === 'chi tiêu' || question === 'chi tiêu hết hạn') {
    const text = ['Bạn muốn hỏi ý nào?', ...ASK_BACK_OPTIONS.map((o) => `${o.n}. ${o.label}`), 'Trả lời 1-2 trong 10 phút.'].join('\n');
    return rules({ text, card: { kind: 'ask_back', options: ASK_BACK_OPTIONS } });
  }
  if (/^[1-3]$/.test(question)) return rules({ text: `Bạn chọn ý ${question}: Ăn uống tháng này 45.000 ₫.`, sources: ['Giao dịch đã xác nhận trong tháng này'] });
  return rules({ text: ['Mình trả lời được các câu hỏi về thu chi của bạn, ví dụ:', ...AGENT_EXAMPLES.map((e) => `- ${e}`)].join('\n') });
}

async function answerTurn({ request }) {
  const mode = agentMode();
  if (mode === 'busy') return agentError(503, 'AGENT_BUSY');
  if (mode === 'down') return agentError(500, 'INTERNAL');
  if (request.headers.get('authorization') !== `Bearer ${AGENT_SECRET}`) return agentError(401, 'UNAUTHORIZED');
  const body = await request.json();
  if (await AgentTurn.exists({ userId: body.userId, requestId: body.requestId })) return agentError(409, 'DUPLICATE'); // the row is the memory, as in the agent
  const answer = cannedAnswer(body.text);
  const asksBack = answer.card?.kind === 'ask_back';
  const lapsed = body.text === 'chi tiêu hết hạn'; // an ask-back whose ten minutes are over, to meet "Câu hỏi đã hết hạn"
  await AgentTurn.create({
    userId: body.userId,
    channel: body.channel,
    threadKey: body.threadKey,
    requestId: body.requestId,
    trigger: body.trigger,
    command: false,
    question: body.text,
    answer: answer.text,
    route: answer.route,
    facts: answer.facts,
    sources: answer.sources,
    followups: answer.followups,
    ...(asksBack && { card: answer.card, askBack: { question: 'Bạn muốn hỏi ý nào?', options: ASK_BACK_OPTIONS, expiresAt: new Date(Date.now() + (lapsed ? -11 : 10) * 60 * 1000) } }),
    clearedAt: null,
    createdAt: new Date(),
  });
  console.info('[bot-api-stub] agent turn answered'); // never the question
  return HttpResponse.json({ ...answer, steps: [], timingsMs: [] });
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

// Starts intercepting fetch and node:http in this process. Returns the MSW server (close() stops it).
export function stubOutboundHttp() {
  if (repliesFile()) rmSync(repliesFile(), { force: true });
  const server = setupServer(
    http.post('https://api.telegram.org/:bot/:method', answer('telegram')),
    http.post('https://bot-api.zaloplatforms.com/:bot/:method', answer('zalo')),
    http.post('https://graph.facebook.com/:version/:phoneNumberId/messages', answerWhatsApp),
    http.post(`${AGENT_URL}/v1/turn`, answerTurn),
    // Anything else: this machine passes through (the KIE service runs on 127.0.0.1), any other host fails
    // with a network error, so the caller's fetch throws and the reason is in the server log.
    http.all('*', ({ request }) => {
      const { hostname } = new URL(request.url);
      if (LOCAL_HOSTS.has(hostname)) return passthrough();
      console.error(`[bot-api-stub] blocked outbound request to ${hostname}: stub it in server/test/helpers/bot-api-stub.js`);
      return HttpResponse.error();
    }),
  );
  server.listen();
  return server;
}
