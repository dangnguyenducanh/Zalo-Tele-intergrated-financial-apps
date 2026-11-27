import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ProtectedRoute from '@/auth/ProtectedRoute';
import { useAuth } from '@/auth/useAuth';
import { CODE, fake, LAN, PASSWORD, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';
import { readPendingSignup, savePendingSignup, type PendingSignup } from './pendingSignup';
import { authRoutes } from './routes';

// docs/07 §7.10.4: the Register page's 201 / 202 / 503 answers and every state of /verify-email (API stubbed by MSW).

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());

const PENDING: PendingSignup = { email: 'minh@example.com', maskedEmail: 'm***@example.com', name: 'Minh', signupToken: 'token-1', resendAt: 0 };

// The sign-up the server knows about after the 202, as the fake API keeps it, plus the matching sessionStorage entry.
function seedPending(overrides: Partial<PendingSignup> = {}) {
  fake.mailOn = true;
  fake.pending = { name: 'Minh', email: 'minh@example.com', language: 'vi', code: CODE, signupToken: 'token-1', attemptsLeft: 5 };
  savePendingSignup({ ...PENDING, ...overrides });
}

const codeBox = () => screen.getByRole('textbox', { name: 'Mã xác nhận' });
const resendButton = () => screen.getByRole('button', { name: /^Gửi lại mã/ });
const rateLimited = (details?: unknown) => HttpResponse.json({ error: { code: 'RATE_LIMITED', message: 'x', details } }, { status: 429 });
const failWith = (code: string, status: number, details?: unknown) => HttpResponse.json({ error: { code, message: 'x', details } }, { status });

async function fillRegister(user: ReturnType<typeof userEvent.setup>, email = 'minh@example.com') {
  await user.type(await screen.findByRole('textbox', { name: 'Họ tên' }), 'Minh');
  await user.type(screen.getByRole('textbox', { name: 'Email' }), email);
  await user.type(screen.getByLabelText(/^Mật khẩu/), 'password1');
  await user.type(screen.getByLabelText(/^Nhập lại mật khẩu/), 'password1');
  await user.click(screen.getByRole('button', { name: 'Đăng ký' }));
}

const storedText = () => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });

test('TC-F1-35 register: a 201 logs in as today and keeps nothing', async () => {
  const user = userEvent.setup();
  renderApp('/register');
  await fillRegister(user);

  expect(await screen.findByRole('heading', { level: 1, name: 'Xin chào, Minh' })).toBeInTheDocument();
  expect(readPendingSignup()).toBeNull();
  expect(storedText()).not.toContain('password1');
});

test('TC-F1-35 register: a 202 goes to /verify-email with no session, the pending entry and the password in no storage', async () => {
  const user = userEvent.setup();
  fake.mailOn = true;
  const { router } = renderApp('/register');
  await fillRegister(user, 'tuan@example.com');

  expect(await screen.findByRole('heading', { level: 1, name: 'Kiểm tra email của bạn' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/verify-email');
  expect(screen.getByText(/m\*\*\*@example\.com/)).toBeInTheDocument();
  expect(readPendingSignup()).toMatchObject({ email: 'tuan@example.com', maskedEmail: 'm***@example.com', name: 'Minh', signupToken: fake.pending?.signupToken });
  expect(storedText()).not.toContain('password1');
  expect(fake.loggedIn).toBe(false);
});

test('TC-F1-36 register shows EMAIL_SEND_FAILED (503) and a 429 on the form, translated, and stays on /register', async () => {
  const user = userEvent.setup();
  server.use(http.post('*/api/auth/register', () => failWith('EMAIL_SEND_FAILED', 503)));
  const { router } = renderApp('/register');
  await fillRegister(user);
  expect(await screen.findByRole('alert')).toHaveTextContent('Không gửi được email. Vui lòng thử lại sau vài phút.');
  expect(router.state.location.pathname).toBe('/register');
  expect(readPendingSignup()).toBeNull();

  server.use(http.post('*/api/auth/register', () => rateLimited({ retryAfter: 30 })));
  await user.click(screen.getByRole('button', { name: 'Đăng ký' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bạn thao tác quá nhiều lần'));
  expect(router.state.location.pathname).toBe('/register');
});

test('TC-F1-37 verify: six digits send email, code and signupToken once, then the session starts, the entry is removed and the Dashboard opens', async () => {
  const user = userEvent.setup();
  seedPending();
  const { router } = renderApp('/verify-email');

  await user.type(await screen.findByRole('textbox', { name: 'Mã xác nhận' }), CODE); // no Confirm click: the 6th digit submits

  expect(await screen.findByRole('heading', { level: 1, name: 'Xin chào, Minh' })).toBeInTheDocument();
  expect(fake.verifyBodies).toEqual([{ email: 'minh@example.com', code: CODE, signupToken: 'token-1' }]);
  expect(readPendingSignup()).toBeNull();
  expect(router.state.location.pathname).toBe('/'); // not /register: removing the entry must not redirect
  expect(storedText()).not.toContain('token-1');
});

test('TC-F1-38 the code box is a numeric one-time-code input of 6 digits that takes digits only', async () => {
  const user = userEvent.setup();
  seedPending();
  renderApp('/verify-email');

  const box = await screen.findByRole('textbox', { name: 'Mã xác nhận' });
  expect(box).toHaveAttribute('inputmode', 'numeric');
  expect(box).toHaveAttribute('autocomplete', 'one-time-code');
  expect(box).toHaveAttribute('maxlength', '6');
  expect(box).toHaveFocus();

  await user.type(box, '1a2-3');
  expect(box).toHaveValue('123'); // letters and dashes never get in
  expect(fake.verifyBodies).toHaveLength(0);
});

test('TC-F1-38 a pasted " 654 321 " becomes six digits and submits', async () => {
  const user = userEvent.setup();
  seedPending();
  renderApp('/verify-email');

  await screen.findByRole('textbox', { name: 'Mã xác nhận' });
  await user.paste(' 654 321 ');

  await waitFor(() => expect(fake.verifyBodies).toHaveLength(1));
  expect(fake.verifyBodies[0]).toMatchObject({ code: '654321' });
});

test('TC-F1-38 auto-submit on the 6th digit followed by Enter sends one request', async () => {
  const user = userEvent.setup();
  seedPending();
  let calls = 0;
  server.use(
    http.post('*/api/auth/register/verify', async () => {
      calls += 1;
      await delay(100);
      return failWith('CODE_INVALID', 400, { attemptsLeft: 3 });
    }),
  );
  renderApp('/verify-email');

  await user.type(await screen.findByRole('textbox', { name: 'Mã xác nhận' }), '111111{Enter}');

  await screen.findByText('Mã không đúng. Còn 3 lần thử.');
  expect(calls).toBe(1);
});

test('TC-F1-39 a wrong code shows the tries left and refocuses the cleared box', async () => {
  const user = userEvent.setup();
  seedPending();
  renderApp('/verify-email');

  const box = await screen.findByRole('textbox', { name: 'Mã xác nhận' });
  await user.type(box, '000000');

  await screen.findByText('Mã không đúng. Còn 4 lần thử.');
  expect(box).toHaveValue('');
  expect(box).toHaveFocus();
  expect(box).toHaveAccessibleDescription(/Mã không đúng\. Còn 4 lần thử\./);
  expect(box).toHaveAttribute('aria-invalid', 'true');
});

test('TC-F1-39 an expired code offers Resend and a register-again link; a taken email offers login', async () => {
  const user = userEvent.setup();
  seedPending();
  server.use(http.post('*/api/auth/register/verify', () => failWith('CODE_EXPIRED', 400)));
  renderApp('/verify-email');

  const box = await screen.findByRole('textbox', { name: 'Mã xác nhận' });
  await user.type(box, '222222');
  expect(await screen.findByRole('alert')).toHaveTextContent('Mã đã hết hạn. Hãy gửi mã mới.');
  expect(resendButton()).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Đăng ký lại' })).toHaveAttribute('href', '/register');

  server.use(http.post('*/api/auth/register/verify', () => failWith('EMAIL_TAKEN', 409)));
  await user.type(box, '333333');
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Email này đã được dùng cho một tài khoản khác.'));
  expect(screen.getByRole('link', { name: 'Đến trang đăng nhập' })).toHaveAttribute('href', '/login');
  expect(readPendingSignup()).toBeNull(); // docs/05 §5.11.2: the entry is removed
});

test('TC-F1-39 a network error keeps the code and Confirm retries it', async () => {
  const user = userEvent.setup();
  seedPending();
  server.use(http.post('*/api/auth/register/verify', () => HttpResponse.error(), { once: true }));
  renderApp('/verify-email');

  const box = await screen.findByRole('textbox', { name: 'Mã xác nhận' });
  await user.type(box, CODE);
  expect(await screen.findByRole('alert')).toHaveTextContent('Không kết nối được máy chủ.');
  expect(box).toHaveValue(CODE);
  await user.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Xin chào, Minh' })).toBeInTheDocument();
});

test('TC-F1-40 Resend is off during the countdown, and Confirm with fewer than 6 digits sends nothing', async () => {
  const user = userEvent.setup();
  seedPending({ resendAt: Date.now() + 60_000 });
  renderApp('/verify-email');

  await screen.findByRole('textbox', { name: 'Mã xác nhận' });
  expect(resendButton()).toBeDisabled();
  expect(resendButton()).toHaveTextContent(/^Gửi lại mã \(sau (60|59) giây\)$/);

  await user.type(codeBox(), '12');
  await user.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect(codeBox()).toHaveAccessibleDescription('Nhập đủ 6 chữ số');
  expect(codeBox()).toHaveFocus();
  expect(fake.verifyBodies).toHaveLength(0);
});

test('TC-F1-40 after the countdown Resend sends { email }, says a new code was sent and starts the countdown again', async () => {
  const user = userEvent.setup();
  seedPending({ resendAt: Date.now() - 1000 });
  renderApp('/verify-email');

  await user.click(await screen.findByRole('button', { name: 'Gửi lại mã' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Đã gửi mã mới. Mã cũ không còn dùng được.');
  expect(fake.resendBodies).toEqual([{ email: 'minh@example.com' }]);
  expect(resendButton()).toBeDisabled();
  expect(resendButton()).toHaveTextContent(/sau (60|59) giây/);
  expect(readPendingSignup()?.resendAt).toBeGreaterThan(Date.now() + 50_000); // a reload keeps the countdown
});

test('TC-F1-40 a 429 with retryAfter 30 restarts the countdown from 30', async () => {
  const user = userEvent.setup();
  seedPending();
  server.use(http.post('*/api/auth/register/resend', () => rateLimited({ retryAfter: 30 })));
  renderApp('/verify-email');

  await user.click(await screen.findByRole('button', { name: 'Gửi lại mã' }));

  await waitFor(() => expect(resendButton()).toHaveTextContent(/sau (30|29) giây/));
  expect(resendButton()).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Vui lòng đợi một chút trước khi xin mã mới.');
});

test('TC-F1-40 a 429 without retryAfter shows the plain rate-limit text', async () => {
  const user = userEvent.setup();
  seedPending();
  server.use(http.post('*/api/auth/register/resend', () => rateLimited()));
  renderApp('/verify-email');

  await user.click(await screen.findByRole('button', { name: 'Gửi lại mã' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Bạn thao tác quá nhiều lần. Vui lòng thử lại sau ít phút.');
});

test('TC-F1-40 resend FEATURE_NOT_CONFIGURED (503) shows the message and a way to register again', async () => {
  const user = userEvent.setup();
  seedPending();
  server.use(http.post('*/api/auth/register/resend', () => failWith('FEATURE_NOT_CONFIGURED', 503)));
  renderApp('/verify-email');

  await user.click(await screen.findByRole('button', { name: 'Gửi lại mã' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Tính năng này chưa được cấu hình trên máy chủ.');
  expect(screen.getByRole('link', { name: 'Đăng ký lại' })).toHaveAttribute('href', '/register');
});

test('TC-F1-41 "Wrong email? Change it" goes to /register with name and email filled and both passwords empty', async () => {
  const user = userEvent.setup();
  seedPending();
  const { router } = renderApp('/verify-email');

  await user.click(await screen.findByRole('link', { name: 'Nhập sai email? Đổi email' }));

  expect(router.state.location.pathname).toBe('/register');
  expect(await screen.findByRole('textbox', { name: 'Họ tên' })).toHaveValue('Minh');
  expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('minh@example.com');
  expect(screen.getByLabelText(/^Mật khẩu/)).toHaveValue('');
  expect(screen.getByLabelText(/^Nhập lại mật khẩu/)).toHaveValue('');
  expect(readPendingSignup()).toBeNull();
});

test('TC-F1-41 /verify-email with no pending entry goes to /register', async () => {
  const { router } = renderApp('/verify-email'); // opened bare, or in another tab

  expect(await screen.findByRole('heading', { level: 1, name: 'Tạo tài khoản' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/register');
});

test('TC-F1-41 /verify-email for a logged-in user goes to /', async () => {
  seedPending();
  fake.account = LAN;
  fake.loggedIn = true; // a valid refresh cookie, so the app restores the session
  const { router } = renderApp('/verify-email');

  expect(await screen.findByRole('heading', { level: 1, name: 'Xin chào, Lan' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
});

test('TC-F1-42 while a code is checked a status line says so, and the error is tied to the box', async () => {
  const user = userEvent.setup();
  seedPending();
  server.use(
    http.post('*/api/auth/register/verify', async () => {
      await delay(80);
      return failWith('CODE_INVALID', 400, { attemptsLeft: 1 });
    }),
  );
  renderApp('/verify-email');

  await user.type(await screen.findByRole('textbox', { name: 'Mã xác nhận' }), '999999');

  expect(await screen.findByRole('status')).toHaveTextContent('Đang kiểm tra mã…');
  await screen.findByText('Mã không đúng. Còn 1 lần thử.');
  expect(codeBox()).toHaveAccessibleDescription(/Còn 1 lần thử/);
});

test('TC-F1-42 switching the language after a wrong code re-translates the message and the labels', async () => {
  const user = userEvent.setup();
  seedPending();
  renderApp('/verify-email');

  await user.type(await screen.findByRole('textbox', { name: 'Mã xác nhận' }), '000000');
  await screen.findByText('Mã không đúng. Còn 4 lần thử.');
  await user.click(screen.getByRole('button', { name: /EN/ })); // the corner language switch

  expect(await screen.findByText('Wrong code. 4 tries left.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Confirmation code' })).toBeInTheDocument();
});

test('TC-F1-40 Resend turns back on when the 60 s countdown ends, then sends', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  seedPending({ resendAt: Date.now() + 60_000 });
  renderApp('/verify-email');

  await screen.findByRole('textbox', { name: 'Mã xác nhận' });
  expect(resendButton()).toBeDisabled();
  await act(() => vi.advanceTimersByTimeAsync(61_000));
  expect(resendButton()).toBeEnabled();
  expect(resendButton()).toHaveTextContent(/^Gửi lại mã$/);
  await user.click(resendButton());
  await waitFor(() => expect(fake.resendBodies).toEqual([{ email: 'minh@example.com' }]));
});

test('TC-F1-40 Resend turns back on when the 429 retryAfter 30 s countdown ends', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  seedPending();
  server.use(http.post('*/api/auth/register/resend', () => rateLimited({ retryAfter: 30 })));
  renderApp('/verify-email');

  await user.click(await screen.findByRole('button', { name: 'Gửi lại mã' }));
  await waitFor(() => expect(resendButton()).toBeDisabled());
  await act(() => vi.advanceTimersByTimeAsync(31_000));
  expect(resendButton()).toBeEnabled();
});

test('TC-F1-41 logging in drops a pending sign-up left in this tab (logout leaves no state for the next user)', async () => {
  const user = userEvent.setup();
  seedPending();
  renderApp('/login');

  await user.type(await screen.findByRole('textbox', { name: 'Email' }), LAN.email);
  await user.type(screen.getByLabelText(/^Mật khẩu/), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

  await screen.findByRole('heading', { level: 1, name: /^Xin chào/ });
  expect(readPendingSignup()).toBeNull();
});

// Follow-up of T37 (#136): AuthContext.logout drops the entry, so the next person in this tab never sees an address left behind.
test('TC-F1-41 logging out drops a pending sign-up left in this tab', async () => {
  const user = userEvent.setup();
  function LogOut() {
    const { logout } = useAuth();
    return <button onClick={() => void logout()}>Log out</button>;
  }
  fake.loggedIn = true; // a valid refresh cookie: the app opens logged in
  renderApp('/', [{ hydrateFallbackElement: <p>Loading</p>, children: [...authRoutes, { element: <ProtectedRoute />, children: [{ path: '/', element: <LogOut /> }] }] }]);
  const logOut = await screen.findByRole('button', { name: 'Log out' });
  savePendingSignup(PENDING); // a sign-up someone began in this tab and left
  expect(readPendingSignup()).not.toBeNull();

  await user.click(logOut);

  expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeInTheDocument();
  expect(readPendingSignup()).toBeNull();
});
