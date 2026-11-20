// Outbound HTTP for the E2E API server (BUG-002), like the MSW mocks in the Vitest suites: the Telegram and
// Zalo Bot APIs are answered here, so an E2E run never messages a real chat, even with a real token in the
// environment. Any other host except localhost fails with a network error, so a new outbound call cannot slip in.
import { http, HttpResponse, passthrough } from 'msw';
import { setupServer } from 'msw/node';

// Every stubbed Bot API call as { platform, method, chatId }. Never the token: it is part of the URL.
export const botCalls = [];

// Answers one Bot API method the way the platform does: { ok: true, result: <the sent message> }.
const answer =
  (platform) =>
  async ({ params, request }) => {
    const body = await request.json().catch(() => ({}));
    const chatId = body.chat_id === undefined ? null : String(body.chat_id); // answerCallbackQuery has no chat
    botCalls.push({ platform, method: params.method, chatId });
    console.info(`[bot-api-stub] ${platform} ${params.method} chat=${chatId}`);
    const message = { message_id: botCalls.length, date: Math.floor(Date.now() / 1000), chat: { id: body.chat_id }, text: body.text };
    return HttpResponse.json({ ok: true, result: message });
  };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

// Starts intercepting fetch and node:http in this process. Returns the MSW server (close() stops it).
export function stubOutboundHttp() {
  const server = setupServer(
    http.post('https://api.telegram.org/:bot/:method', answer('telegram')),
    http.post('https://bot-api.zaloplatforms.com/:bot/:method', answer('zalo')),
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
