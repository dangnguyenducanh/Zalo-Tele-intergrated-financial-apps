import { isApiError, type AuthResponse } from '@/types/api';

// The session lives here, outside React, so both AuthContext and the RTK Query base query
// (app/api.ts) can read the access token and share one refresh. The access token is kept in memory
// only; the refresh token is the httpOnly `rt` cookie the browser sends to /api/auth by itself.

// Absolute, so the same code also works under Node's fetch in tests.
export const API_URL = `${window.location.origin}/api`;

export class AuthError extends Error {
  readonly code: string;
  readonly details: unknown; // VALIDATION_ERROR: [{ path, issue }] naming each rejected field
  constructor(code: string, details?: unknown) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

type Listener = (session: AuthResponse | null) => void;

let accessToken: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;
// Why the last refresh ended the session, when the login page must tell the user: 'ACCOUNT_LOCKED' or null (BUG-011).
let refreshFailure: string | null = null;
const listeners = new Set<Listener>();

export const getAccessToken = () => accessToken;
export const getRefreshFailure = () => refreshFailure;

export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSession(session: AuthResponse | null) {
  accessToken = session?.accessToken ?? null;
  if (session) refreshFailure = null;
  listeners.forEach((listener) => listener(session));
}

// POST /api/auth/<path>. Throws AuthError with the API error code (or NETWORK_ERROR).
export async function postAuth<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/auth/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => {
    throw new AuthError('NETWORK_ERROR');
  });
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw isApiError(data) ? new AuthError(data.error.code, data.error.details) : new AuthError('GENERIC');
  return data as T;
}

// The server rotates the refresh cookie on every refresh and treats a second use of the old one as
// theft. Other tabs share the cookie, so a Web Lock makes them take turns: the second tab waits and
// then sends the already-rotated cookie. (No Web Locks, e.g. in jsdom: just post.)
function postRefresh(): Promise<AuthResponse> {
  const post = () => postAuth<AuthResponse>('refresh');
  return 'locks' in navigator ? navigator.locks.request('auth-refresh', post) : post();
}

// Exchanges the refresh cookie for a new access token. Calls made in this tab while a refresh is
// running get the same promise, so two parallel refreshes would not log the user out everywhere.
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= postRefresh()
    .catch((error: unknown) => {
      refreshFailure = error instanceof AuthError && error.code === 'ACCOUNT_LOCKED' ? error.code : null;
      return null;
    })
    .then((session) => {
      setSession(session);
      return session;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
