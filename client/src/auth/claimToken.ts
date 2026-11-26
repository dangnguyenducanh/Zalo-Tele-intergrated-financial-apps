// The one-time token of a chat's "tap to link" message (docs/02 §2.10.3). It leaves the address bar as soon as it is
// read and waits here while the user logs in: in sessionStorage (this tab only, so it survives a reload of the login
// page), never in a URL or router state again. Forgotten once used, cancelled or dead, and on logout.
const KEY = 'claimToken';
let inMemory: string | null = null; // storage blocked: the token still survives the login redirect

export function keepClaimToken(token: string) {
  inMemory = token;
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // storage blocked: the in-memory copy works until a reload
  }
}

export function readClaimToken(): string | null {
  try {
    return sessionStorage.getItem(KEY) ?? inMemory;
  } catch {
    return inMemory;
  }
}

export function forgetClaimToken() {
  inMemory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing was stored
  }
}

// "/link?t=…" as the app starts: keep the token and rewrite the address (and this history entry) to "/link". This runs
// before the app's first request, which would otherwise send the whole address, token included, as its Referer.
export function takeClaimTokenFromAddressBar() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('t');
  if (!/^\/link\/?$/.test(url.pathname) || !token) return;
  keepClaimToken(token);
  window.history.replaceState(window.history.state, '', '/link');
}
