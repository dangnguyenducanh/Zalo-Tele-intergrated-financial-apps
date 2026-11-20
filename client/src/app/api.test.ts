import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { getAccessToken, onSessionChange, refreshSession, setSession } from '@/auth/session';
import { LAN, server } from '@/test/fakeApi';
import { api } from './api';
import { makeStore } from './store';

// A throwaway endpoint to exercise the base query.
const pingApi = api.injectEndpoints({
  endpoints: (builder) => ({ ping: builder.query<{ ok: boolean }, number>({ query: (n) => `/ping?n=${n}` }) }),
});

const tokenExpired = () => HttpResponse.json({ error: { code: 'TOKEN_EXPIRED', message: 'jwt expired' } }, { status: 401 });

test('TC-F1-15 parallel requests with an expired token share ONE refresh, then all retry with the new token', async () => {
  let refreshCalls = 0;
  server.use(
    http.post('*/api/auth/refresh', () => {
      refreshCalls += 1;
      return HttpResponse.json({ accessToken: 'fresh', user: LAN });
    }),
    http.get('*/api/ping', ({ request }) =>
      request.headers.get('Authorization') === 'Bearer fresh' ? HttpResponse.json({ ok: true }) : tokenExpired(),
    ),
  );
  setSession({ accessToken: 'stale', user: LAN });
  const store = makeStore();

  const results = await Promise.all([1, 2, 3].map((n) => store.dispatch(pingApi.endpoints.ping.initiate(n))));

  expect(results.map((r) => r.data)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
  expect(refreshCalls).toBe(1);
  expect(getAccessToken()).toBe('fresh');
});

test('TC-F1-15 when the refresh fails the session ends, so the app goes back to /login', async () => {
  server.use(http.get('*/api/ping', tokenExpired)); // the default refresh handler answers 401 INVALID_REFRESH
  setSession({ accessToken: 'stale', user: LAN });
  const listener = vi.fn();
  const unsubscribe = onSessionChange(listener);

  const result = await makeStore().dispatch(pingApi.endpoints.ping.initiate(1));

  expect(result.error).toMatchObject({ status: 401 });
  expect(getAccessToken()).toBeNull();
  expect(listener).toHaveBeenCalledWith(null);
  unsubscribe();
});

test('TC-F1-15 other errors are returned as they are, without a refresh', async () => {
  const refresh = vi.fn(() => HttpResponse.json({ accessToken: 'fresh', user: LAN }));
  server.use(
    http.post('*/api/auth/refresh', refresh),
    http.get('*/api/ping', () => HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403 })),
  );
  setSession({ accessToken: 'valid', user: LAN });

  const result = await makeStore().dispatch(pingApi.endpoints.ping.initiate(1));

  expect(result.error).toMatchObject({ status: 403, data: { error: { code: 'FORBIDDEN' } } });
  expect(refresh).not.toHaveBeenCalled();
});

test('TC-F1-15 the refresh runs inside a Web Lock, so two tabs never send the same refresh cookie at once', async () => {
  const request = vi.fn((_name: string, callback: () => Promise<unknown>) => callback());
  vi.stubGlobal('navigator', { ...navigator, locks: { request } });
  server.use(http.post('*/api/auth/refresh', () => HttpResponse.json({ accessToken: 'fresh', user: LAN })));

  const session = await refreshSession();
  vi.unstubAllGlobals();

  expect(request).toHaveBeenCalledWith('auth-refresh', expect.any(Function));
  expect(session?.accessToken).toBe('fresh');
});
