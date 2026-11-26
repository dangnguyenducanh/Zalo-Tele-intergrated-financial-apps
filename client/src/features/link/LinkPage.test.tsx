import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { forgetClaimToken, readClaimToken, takeClaimTokenFromAddressBar } from '@/auth/claimToken';
import type { ChatLink } from '@/features/bot/botApi';
import { LAN, PASSWORD, resetFake, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';

// /link (docs/05 §5.9.2) and the "Not you? [Unlink]" notice on /bot (§5.9.3) against the docs/04 claim endpoints (MSW).

const TOKEN = 'Qm9iLWNsYWltLXRva2VuXzAxMjM0NTY3'; // 32 base64url characters, like the bot's
const NOW = '2026-11-20T05:00:00.000Z';
const QUESTION = 'Liên kết Zalo · Anh với Lan (lan@example.com)?';
const WARNING =
  'Chỉ bấm Xác nhận nếu chính bạn vừa nhắn tin cho bot. Cuộc chat được liên kết có thể xem chi tiêu và ghi tiền vào tài khoản này.';
const EXPIRED = 'Đường link đã hết hạn hoặc đã được dùng. Gửi một tin nhắn bất kỳ cho bot để nhận link mới.';
const TAKEN = 'Cuộc chat này đã được liên kết với một tài khoản.';

let links: ChatLink[] = [];
let calls: { method: string; url: string; body?: unknown }[] = [];
let previewAnswers: (() => Response)[] = [];
let claimAnswers: (() => Response)[] = [];

const fail = (status: number, code: string) => () => HttpResponse.json({ error: { code, message: code } }, { status });
const previewOk = () => HttpResponse.json({ platform: 'zalo', displayName: 'Anh' });
const claimOk = () => {
  links = [{ id: 'l1', platform: 'zalo', displayName: 'Anh', createdAt: NOW, viaClaim: true, claimNoticeDismissedAt: null }];
  return HttpResponse.json({ id: 'l1', platform: 'zalo', displayName: 'Anh', createdAt: NOW, viaClaim: true }, { status: 201 });
};
// Each request takes the next answer; the last one stays.
const next = (answers: (() => Response)[]) => (answers.length > 1 ? answers.shift()! : answers[0]!)();

async function record(request: Request) {
  const text = await request.text();
  calls.push({ method: request.method, url: new URL(request.url).pathname + new URL(request.url).search, body: text ? JSON.parse(text) : undefined });
}
const sent = (path: string) => calls.filter((call) => call.url === path);

beforeEach(() => {
  resetFake(LAN, true); // logged in as Lan, UI in Vietnamese
  sessionStorage.clear();
  forgetClaimToken();
  links = [];
  calls = [];
  previewAnswers = [previewOk];
  claimAnswers = [claimOk];
  server.use(
    http.post('*/api/chat-links/claim/preview', async ({ request }) => {
      await record(request);
      return next(previewAnswers);
    }),
    http.post('*/api/chat-links/claim', async ({ request }) => {
      await record(request);
      return next(claimAnswers);
    }),
    // What /bot loads.
    http.get('*/api/chat-links', () => HttpResponse.json(links)),
    http.get('*/api/wallets', () => HttpResponse.json([])),
    http.get('*/api/categories', () => HttpResponse.json([])),
    http.get('*/api/transactions', () => HttpResponse.json({ items: [], page: 1, limit: 100, total: 0 })),
  );
});

const heading = (text: string) => screen.findByRole('heading', { level: 1, name: text });

test('TC-F7-20 /link: the token leaves the address bar; the screen names the chat and the account, warns, and Confirm links', async () => {
  const user = userEvent.setup();
  const { router } = renderApp(`/link?t=${TOKEN}`);

  const question = await heading(QUESTION);
  expect(question).toHaveFocus();
  expect(router.state.location).toMatchObject({ pathname: '/link', search: '' });
  expect(calls).toEqual([{ method: 'POST', url: '/api/chat-links/claim/preview', body: { token: TOKEN } }]); // in the body, not the URL
  expect(screen.getByText(WARNING)).toBeVisible();
  const confirm = screen.getByRole('button', { name: 'Xác nhận' });
  expect(confirm).toHaveAccessibleDescription(WARNING);
  expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // the warning is page content, not a live alert

  // A language switch in the middle translates the whole screen.
  await user.click(screen.getByRole('button', { name: /^EN/ }));
  expect(await heading('Link Zalo · Anh to Lan (lan@example.com)?')).toBeInTheDocument();
  expect(screen.getByText('Only confirm if you just messaged the bot yourself. The chat you link can see your spending and record money in this account.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /^VI/ }));

  await user.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  expect(await heading('Hộp thư bot')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/bot');
  expect(screen.getByText('Đã liên kết ✓ Zalo · Anh')).toBeInTheDocument();
  expect(sent('/api/chat-links/claim')).toEqual([{ method: 'POST', url: '/api/chat-links/claim', body: { token: TOKEN } }]);
  expect(readClaimToken()).toBeNull();
  expect(await screen.findByRole('group', { name: /Chat mới được liên kết từ đường link chat/ })).toBeInTheDocument();
});

test('TC-F7-20 /link logged out: log in first, then back to /link; the token never goes through the login page', async () => {
  resetFake(LAN, false);
  const user = userEvent.setup();
  const { router } = renderApp(`/link?t=${TOKEN}`);

  expect(await heading('Đăng nhập')).toBeInTheDocument();
  expect(router.state.location).toMatchObject({ pathname: '/login', search: '', state: { from: '/link' } });
  expect(JSON.stringify(router.state.location)).not.toContain(TOKEN);
  expect(calls).toEqual([]); // nothing is asked before the login
  expect(sessionStorage.getItem('claimToken')).toBe(TOKEN); // survives a reload of the login page, in this tab only

  await user.type(screen.getByRole('textbox', { name: /Email/ }), LAN.email);
  await user.type(screen.getByLabelText(/^Mật khẩu/), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

  expect(await heading(QUESTION)).toBeInTheDocument();
  expect(router.state.location).toMatchObject({ pathname: '/link', search: '' });
  expect(calls).toEqual([{ method: 'POST', url: '/api/chat-links/claim/preview', body: { token: TOKEN } }]);
});

test('TC-F7-20 Cancel goes to /bot without claiming and forgets the token', async () => {
  const user = userEvent.setup();
  const { router } = renderApp(`/link?t=${TOKEN}`);
  await user.click(await screen.findByRole('button', { name: 'Huỷ' }));
  expect(await heading('Hộp thư bot')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/bot');
  expect(sent('/api/chat-links/claim')).toEqual([]);
  expect(readClaimToken()).toBeNull();
});

test.each([
  ['a used or expired token (preview 404)', fail(404, 'LINK_TOKEN_INVALID'), claimOk, false, EXPIRED],
  ['a token spent before Confirm (claim 404)', previewOk, fail(404, 'LINK_TOKEN_INVALID'), true, EXPIRED],
  ['a chat linked meanwhile (claim 409)', previewOk, fail(409, 'CHAT_ALREADY_LINKED'), true, TAKEN],
])('TC-F7-20 /link with %s says so, with "Go to Bot inbox"', async (_name, preview, claim, pressConfirm, message) => {
  previewAnswers = [preview];
  claimAnswers = [claim];
  const user = userEvent.setup();
  const { router } = renderApp(`/link?t=${TOKEN}`);
  if (pressConfirm) await user.click(await screen.findByRole('button', { name: 'Xác nhận' }));
  expect(await heading(message)).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Xác nhận' })).not.toBeInTheDocument();
  await waitFor(() => expect(readClaimToken()).toBeNull()); // dead: not kept for later
  await user.click(screen.getByRole('link', { name: 'Đến Hộp thư bot' }));
  expect(await heading('Hộp thư bot')).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/bot');
});

test('TC-F7-20 /link opened with no token says the link has expired, and asks the server nothing', async () => {
  renderApp('/link');
  expect(await heading(EXPIRED)).toBeInTheDocument();
  expect(calls).toEqual([]);
});

test('TC-F7-20 a failed preview is an error with Retry; a failed claim keeps Confirm; the token is kept for both', async () => {
  previewAnswers = [fail(500, 'INTERNAL'), previewOk];
  claimAnswers = [() => HttpResponse.error(), claimOk];
  const user = userEvent.setup();
  const { router } = renderApp(`/link?t=${TOKEN}`);

  expect(await heading('Máy chủ gặp sự cố. Vui lòng thử lại sau.')).toBeInTheDocument();
  expect(readClaimToken()).toBe(TOKEN);
  await user.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await heading(QUESTION)).toBeInTheDocument();
  expect(sent('/api/chat-links/claim/preview')).toHaveLength(2);

  await user.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Không kết nối được máy chủ.');
  expect(router.state.location.pathname).toBe('/link');
  expect(readClaimToken()).toBe(TOKEN);
  // The message follows a language switch (translated when shown, BUG-031).
  await user.click(screen.getByRole('button', { name: /^EN/ }));
  expect(await screen.findByText(/Cannot reach the server/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  // Wait for /bot first: /link has its own snackbar, and its copy of the message is thrown away on the way there.
  expect(await heading('Bot inbox')).toBeInTheDocument();
  expect(screen.getByText('Linked ✓ Zalo · Anh')).toBeInTheDocument();
});

test('TC-F7-20 an explicit logout forgets a pending claim token, so the next person does not get it', async () => {
  sessionStorage.setItem('claimToken', TOKEN);
  const user = userEvent.setup();
  renderApp('/bot');
  await user.click(await screen.findByRole('button', { name: 'Tài khoản' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Đăng xuất' }));
  expect(await heading('Đăng nhập')).toBeInTheDocument();
  expect(readClaimToken()).toBeNull();
});

test('TC-F7-20 at start-up the token leaves the address bar before any request is made; other pages are left alone', () => {
  window.history.pushState(null, '', `/bot?t=${TOKEN}`);
  takeClaimTokenFromAddressBar();
  expect(window.location.search).toBe(`?t=${TOKEN}`);
  expect(readClaimToken()).toBeNull();

  window.history.pushState(null, '', `/link?t=${TOKEN}`);
  const entries = window.history.length;
  takeClaimTokenFromAddressBar();
  expect(window.location.pathname + window.location.search).toBe('/link');
  expect(window.history.length).toBe(entries); // replaced, so Back never shows the token
  expect(readClaimToken()).toBe(TOKEN);
  window.history.pushState(null, '', '/');
});

// ---------- the "Not you? [Unlink]" notice ----------
const claimed = (id: string, platform: ChatLink['platform'], displayName: string, claimNoticeDismissedAt: string | null = null): ChatLink => ({
  id,
  platform,
  displayName,
  createdAt: NOW,
  viaClaim: true,
  claimNoticeDismissedAt,
});
const byCode: ChatLink = { id: 'l3', platform: 'telegram', displayName: 'By Code', createdAt: NOW, viaClaim: false, claimNoticeDismissedAt: null };
const notices = () => screen.queryAllByRole('group', { name: /Chat mới được liên kết từ đường link chat/ });
const accountsHeading = () => screen.getByRole('heading', { level: 2, name: 'Tài khoản đã liên kết' });

function dismissAnswers(status: number) {
  server.use(
    http.patch('*/api/chat-links/:id/claim-notice', async ({ request, params }) => {
      await record(request);
      if (status === 500) return fail(500, 'INTERNAL')();
      if (status === 404) links = links.filter((link) => link.id !== params.id); // unlinked on another device
      else links = links.map((link) => (link.id === params.id ? { ...link, claimNoticeDismissedAt: NOW } : link));
      return status === 404 ? fail(404, 'NOT_FOUND')() : new HttpResponse(null, { status: 204 });
    }),
    http.delete('*/api/chat-links/:id', async ({ request, params }) => {
      await record(request);
      links = links.filter((link) => link.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

test('TC-F7-22 the notice shows only for a claim-made link not yet dismissed; Dismiss hides it for good', async () => {
  const longName = 'Nguyễn_Thị_Phương_Thảo_Official_Shop_Mỹ_Phẩm_Chính_Hãng_Giá_Rẻ';
  links = [claimed('l1', 'zalo', longName), claimed('l2', 'telegram', 'Seen', NOW), byCode];
  dismissAnswers(204);
  const user = userEvent.setup();
  renderApp('/bot');

  const notice = await screen.findByRole('group', { name: /Chat mới được liên kết/ });
  expect(notices()).toHaveLength(1);
  expect(notice).toHaveTextContent(`Chat mới được liên kết từ đường link chat: Zalo · ${longName}. Không phải bạn?`);
  expect(within(notice).getByText(`Zalo · ${longName}`).closest('.MuiAlert-message')).toHaveStyle({ overflowWrap: 'anywhere' });
  expect(within(notice).getByRole('button', { name: `Huỷ liên kết Zalo · ${longName}` })).toHaveTextContent('Huỷ liên kết');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // page content, not a live region

  await user.click(within(notice).getByRole('button', { name: `Đóng thông báo về Zalo · ${longName}` }));
  await waitFor(() => expect(notices()).toHaveLength(0));
  expect(calls).toEqual([{ method: 'PATCH', url: '/api/chat-links/l1/claim-notice', body: undefined }]);
  expect(accountsHeading()).toHaveFocus(); // not lost to <body>
});

test("TC-F7-22 the notice's Unlink asks first, unlinks the chat and takes the notice with it", async () => {
  links = [claimed('l1', 'zalo', 'Anh'), byCode];
  dismissAnswers(204);
  const user = userEvent.setup();
  renderApp('/bot');

  const notice = await screen.findByRole('group', { name: /Chat mới được liên kết/ });
  await user.click(within(notice).getByRole('button', { name: 'Huỷ liên kết Zalo · Anh' }));
  const dialog = await screen.findByRole('dialog', { name: 'Huỷ liên kết?' });
  expect(calls).toEqual([]);
  await user.click(within(dialog).getByRole('button', { name: 'Huỷ liên kết' }));

  await waitFor(() => expect(notices()).toHaveLength(0));
  expect(calls).toEqual([{ method: 'DELETE', url: '/api/chat-links/l1', body: undefined }]);
  await waitFor(() => expect(accountsHeading()).toHaveFocus());
  expect(screen.queryByText('Zalo · Anh')).not.toBeInTheDocument();
});

test('TC-F7-22 Dismiss on a link unlinked meanwhile just reloads the list; another failure says so and keeps the notice', async () => {
  links = [claimed('l1', 'zalo', 'Anh')];
  dismissAnswers(500);
  const user = userEvent.setup();
  renderApp('/bot');
  await user.click(await screen.findByRole('button', { name: 'Đóng thông báo về Zalo · Anh' }));
  expect(await screen.findByText('Máy chủ gặp sự cố. Vui lòng thử lại sau.')).toBeInTheDocument();
  expect(notices()).toHaveLength(1);

  dismissAnswers(404);
  await user.click(screen.getByRole('button', { name: 'Đóng thông báo về Zalo · Anh' }));
  await waitFor(() => expect(notices()).toHaveLength(0));
  expect(screen.queryByText('Không tìm thấy dữ liệu.')).not.toBeInTheDocument();
});
