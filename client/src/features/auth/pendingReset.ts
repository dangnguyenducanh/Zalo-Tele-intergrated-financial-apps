// The password reset that is waiting for its emailed code (docs/05 §5.11.4). It lives in sessionStorage so a reload of
// /forgot-password stays on the same step, and goes away with the tab. Only the typed address and when Send/Resend opens
// are kept: never the code or a password.
export type PendingReset = {
  email: string; // as typed, sent back to /auth/password/forgot and /auth/password/reset
  resendAt: number; // ms timestamp when Send/Resend opens again, so a reload keeps the countdown
  sent: boolean; // true: the 202 came, show step 2. false: only a 429 (a wait to sit out), still on step 1
};

const KEY = 'pendingReset';

export function readPendingReset(): PendingReset | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    const p = value as PendingReset | null;
    return p && typeof p.email === 'string' && typeof p.resendAt === 'number' ? { email: p.email, resendAt: p.resendAt, sent: p.sent === true } : null;
  } catch {
    return null; // storage blocked or the entry is not JSON: start at step 1
  }
}

export function savePendingReset(pending: PendingReset) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // storage blocked: a reload then starts again at step 1
  }
}

export function clearPendingReset() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to remove
  }
}
