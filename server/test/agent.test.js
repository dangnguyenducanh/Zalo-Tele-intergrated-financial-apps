import { HttpResponse, delay } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { agentConfigured, turn } from '../src/services/agent.js';
import { AGENT_SECRET, AGENT_URL, createAgentStub, turnAnswer } from './helpers/agent-stub.js';

// services/agent.js (docs/04 §4.11 "Express side"): the one client of the agent service, against an MSW stub on a dummy host.
const stub = createAgentStub();
const USER = '65f0c0ffee0c0ffee0c0ffee';
const ask = (extra = {}) => ({ userId: USER, channel: 'web', threadKey: 'web', requestId: 'req-1', text: 'tháng này ăn uống hết bao nhiêu', language: 'vi', ...extra });

beforeAll(stub.listen);
afterEach(() => {
  stub.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  env.AGENT_URL = AGENT_URL;
  env.AGENT_SECRET = AGENT_SECRET;
});
afterAll(stub.close);

describe('TC-F14-91 the request: one bearer, one body, the Vietnam date', () => {
  test('TC-F14-91 a turn from the web sends Authorization: Bearer <AGENT_SECRET> and the fields /v1/turn takes, and returns the answer untouched', async () => {
    const card = { kind: 'ask_back', options: [{ n: 1, label: 'Chi theo danh mục' }, { n: 2, label: 'Tổng thu chi' }], extra: { kept: true } };
    stub.handler = () => turnAnswer({ card });

    const answer = await turn(ask({ month: '2026-10' }));

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].authorization).toBe(`Bearer ${AGENT_SECRET}`);
    expect(stub.calls[0].body).toEqual({
      trigger: 'chat',
      userId: USER,
      channel: 'web',
      threadKey: 'web',
      requestId: 'req-1',
      text: 'tháng này ăn uống hết bao nhiêu',
      language: 'vi',
      month: '2026-10',
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      allowLlm: false, // the model gate comes with its own card; until then nothing may call the model
    });
    expect(answer).toEqual(turnAnswer({ card })); // card and every other field exactly as the agent sent them
  });

  test('TC-F14-91 a turn from Telegram sends its own channel, thread and request id; the user id is a string; unset fields are not sent', async () => {
    await turn({ userId: { toString: () => USER }, channel: 'telegram', threadKey: '5551234', requestId: 'telegram:5551234:77', text: 'momo còn bao nhiêu', language: 'en' });

    const { body } = stub.calls[0];
    expect(body).toMatchObject({ trigger: 'chat', userId: USER, channel: 'telegram', threadKey: '5551234', requestId: 'telegram:5551234:77', language: 'en' });
    expect(Object.keys(body)).not.toContain('month');
    expect(Object.keys(body)).not.toContain('skill');
    expect(Object.keys(body)).not.toContain('actionId');
  });

  test('TC-F14-91 today is the Vietnam date: 23:30 +07 on 25/11 sends 2026-11-25, and 00:30 +07 on 26/11 (still 25/11 in UTC) sends 2026-11-26', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T16:30:00Z')); // 23:30 +07
    await turn(ask({ requestId: 'late' }));
    vi.setSystemTime(new Date('2026-11-25T17:30:00Z')); // 00:30 +07 on the 26th
    await turn(ask({ requestId: 'after-midnight' }));

    expect(stub.calls.map((call) => call.body.today)).toEqual(['2026-11-25', '2026-11-26']);
  });

  test('TC-F14-91 a trailing slash on AGENT_URL still reaches /v1/turn', async () => {
    env.AGENT_URL = `${AGENT_URL}/`;
    await turn(ask());
    expect(stub.calls).toHaveLength(1);
  });
});

describe('TC-F14-92 failures, budgets and the unset agent', () => {
  const unavailable = { status: 503, code: 'AGENT_UNAVAILABLE' };

  test('TC-F14-92 DUPLICATE (409) and AGENT_BUSY (503) from the agent pass through as they are', async () => {
    await turn(ask({ requestId: 'twice' }));
    await expect(turn(ask({ requestId: 'twice' }))).rejects.toMatchObject({ status: 409, code: 'DUPLICATE' });

    stub.busy();
    await expect(turn(ask({ requestId: 'busy' }))).rejects.toMatchObject({ status: 503, code: 'AGENT_BUSY' });
  });

  test.each([
    ['a 500', () => HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 })],
    ['a 502 page from the tunnel', () => new HttpResponse('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })],
    ['a 503 that is not AGENT_BUSY', () => HttpResponse.json({ error: { code: 'SOMETHING_ELSE', message: 'x' } }, { status: 503 })],
    ['a 401 (the secrets differ)', () => HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, { status: 401 })],
    ['a 422 (a body the agent refuses)', () => HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'x' } }, { status: 422 })],
    ['a 409 that is not DUPLICATE', () => HttpResponse.json({ error: { code: 'CONFLICT', message: 'x' } }, { status: 409 })],
    ['a 200 that is not JSON', () => new HttpResponse('not json', { status: 200, headers: { 'content-type': 'text/plain' } })],
    ['a 200 whose JSON is not an answer', () => HttpResponse.json(['nope'])],
    ['a refused connection', () => HttpResponse.error()],
  ])('TC-F14-92 %s is AGENT_UNAVAILABLE', async (_name, answer) => {
    stub.handler = answer;
    await expect(turn(ask())).rejects.toMatchObject(unavailable);
  });

  test('TC-F14-92 the budgets are 40 s on the web and 25 s in a chat: the request is given up at them and nowhere earlier', async () => {
    for (const [channel, budget] of [['web', 40_000], ['telegram', 25_000], ['zalo', 25_000], ['whatsapp', 25_000]]) {
      let reached;
      const atAgent = new Promise((resolve) => (reached = resolve));
      stub.handler = async () => {
        reached();
        await delay(100_000);
        return turnAnswer();
      };
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      // AbortSignal.timeout runs on Node's internal timers, which fake timers don't reach, so it is rebuilt on setTimeout.
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException('The operation timed out', 'TimeoutError')), ms);
        return controller.signal;
      });

      let outcome = 'waiting';
      const waiting = turn(ask({ channel, requestId: `slow-${channel}` })).then(
        () => (outcome = 'answered'),
        (err) => (outcome = err.code),
      );
      await atAgent;
      await vi.advanceTimersByTimeAsync(budget - 1_000);
      expect(outcome, `${channel} at ${budget - 1_000} ms`).toBe('waiting');
      await vi.advanceTimersByTimeAsync(2_000);
      await waiting;

      expect(outcome, channel).toBe('AGENT_UNAVAILABLE');
      expect(timeout, channel).toHaveBeenCalledWith(budget);
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  test('TC-F14-92 without AGENT_URL or without AGENT_SECRET the agent is never called: turn() refuses and agentConfigured() is false', async () => {
    expect(agentConfigured()).toBe(true);
    for (const missing of ['AGENT_URL', 'AGENT_SECRET']) {
      delete env[missing];
      expect(agentConfigured(), missing).toBe(false);
      await expect(turn(ask({ requestId: `no-${missing}` })), missing).rejects.toMatchObject({ status: 503, code: 'FEATURE_NOT_CONFIGURED' });
      env[missing] = missing === 'AGENT_URL' ? AGENT_URL : AGENT_SECRET;
    }
    expect(stub.calls).toEqual([]);
  });
});
