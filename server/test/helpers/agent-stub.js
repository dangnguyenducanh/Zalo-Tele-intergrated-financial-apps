import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

// An MSW stub of the agent service's API (docs/07 §7.9.4) on the NODE_ENV=test default of AGENT_URL (config/env.js).
// POST /v1/turn records every call, answers like the real service, and refuses a second request with the same
// (userId, requestId) as 409 DUPLICATE, because only the agent deduplicates. A test changes what it answers with
// `stub.handler = (body) => HttpResponse | object`, or makes it fail with `stub.busy()`, `stub.down()`.
// Any other host is a test bug: it throws, as in the bot tests (BUG-002).
export const AGENT_URL = 'http://agent.test';
export const AGENT_SECRET = 'test-agent-secret';

export const turnAnswer = (extra = {}) => ({
  route: 'rules',
  text: 'Chi tiêu tháng này: 1.000.000 ₫',
  facts: [{ id: 'f1', label: 'Chi tiêu 11/2026', display: '1.000.000 ₫' }],
  sources: ['Nguồn: Tổng thu chi 11/2026'],
  followups: ['Còn tháng trước?'],
  steps: ['ingress', 'save_turn'],
  timingsMs: [{ node: 'ingress', ms: 1 }],
  ...extra,
});

const error = (status, code) => HttpResponse.json({ error: { code, message: code } }, { status });

export function createAgentStub() {
  const calls = []; // { authorization, body } of every /v1/turn request, duplicates included
  const seen = new Set();
  const stub = {
    calls,
    handler: () => turnAnswer(),
    busy: () => (stub.handler = () => error(503, 'AGENT_BUSY')),
    down: () => (stub.handler = () => error(500, 'INTERNAL')),
  };
  const server = setupServer(
    http.post(`${AGENT_URL}/v1/turn`, async ({ request }) => {
      const body = await request.json();
      calls.push({ authorization: request.headers.get('authorization'), body });
      const key = `${body.userId}:${body.requestId}`;
      if (seen.has(key)) return error(409, 'DUPLICATE'); // checked and set in one synchronous step: two at once cannot both pass
      seen.add(key);
      const answer = await stub.handler(body);
      return answer instanceof Response ? answer : HttpResponse.json(answer);
    }),
  );
  return Object.assign(stub, {
    listen: () =>
      server.listen({
        // Supertest talks to the app on 127.0.0.1; any other unmocked host is a test bug.
        onUnhandledFrame: ({ frame }) => {
          const { hostname } = new URL(frame.data.request.url);
          if (hostname !== '127.0.0.1' && hostname !== 'localhost') throw new Error(`unmocked request to ${hostname}`);
        },
      }),
    // Between tests: the recorded calls, the remembered requestIds and the answer go back to the start.
    reset: () => {
      calls.length = 0;
      seen.clear();
      stub.handler = () => turnAnswer();
      server.resetHandlers();
    },
    close: () => server.close(),
    use: (...handlers) => server.use(...handlers),
  });
}
