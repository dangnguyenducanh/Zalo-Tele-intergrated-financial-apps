// The sign-up that is waiting for its emailed code (docs/05 §5.11.1). It lives in sessionStorage so a reload of
// /verify-email keeps working, and goes away with the tab. The password is never kept: only what the verify call
// needs (the typed email, the signupToken) and what the screen shows (masked email, name, when Resend opens).
export type PendingSignup = {
  email: string; // as typed, sent back to /auth/register/verify and /auth/register/resend
  maskedEmail: string; // "a***@gmail.com", from the 202
  name: string; // so "Wrong email? Change it" can fill the form again
  signupToken: string; // proves this tab registered (decision D1)
  resendAt: number; // ms timestamp when Resend opens, so a reload keeps the countdown
};

const KEY = 'pendingSignup';

export function readPendingSignup(): PendingSignup | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    const p = value as PendingSignup | null;
    return p && typeof p.email === 'string' && typeof p.signupToken === 'string' ? p : null;
  } catch {
    return null; // storage blocked or the entry is not JSON: treat as nothing pending
  }
}

export function savePendingSignup(pending: PendingSignup) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // storage blocked: the verify screen then sends the user back to /register
  }
}

export function clearPendingSignup() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to remove
  }
}
