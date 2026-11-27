import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CODE, fake, LAN, NEW_PASSWORD, PASSWORD, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';
import { readPendingReset, savePendingReset } from './pendingReset';

// docs/07 §7.10.4 "forgot screen": the Login link and the two steps of /forgot-password (API stubbed by MSW).

type User = ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  sessionStorage.clear();
  fake.mailOn = true; // the server has GMAIL_* set
});
afterEach(() => vi.useRealTimers());

const failWith = (code: string, status: number, details?: unknown) => HttpResponse.json({ error: { code, message: 'x', details } }, { status });
const rateLimited = (details?: unknown) => failWith('RATE_LIMITED', 429, details);

const emailBox = () => screen.getByRole('textbox', { name: /^Email/ });
const sendButton = () => screen.getByRole('button', { name: /^Gửi mã/ });
const codeBox = () => screen.getByRole('textbox', { name: 'Mã xác nhận' });
const passwordBox = () => screen.getByLabelText(/^Mật khẩu mới/);
const confirmBox = () => screen.getByLabelText(/^Nhập lại mật khẩu mới/);
const saveButton = () => screen.getByRole('button', { name: 'Đổi mật khẩu' });
const resendButton = () => screen.getByRole('button', { name: /^Gửi lại mã/ });
const step2Heading = () => screen.findByRole('heading', { level: 1, name: 'Nhập mã và mật khẩu mới' });
const storedText = () => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });

async function sendCodeTo(user: User, email: string) {
  await user.type(await screen.findByRole('textbox', { name: /^Email/ }), email);
  await user.click(sendButton());
}

// Step 2 as the user reaches it: through step 1 with the account's address.
async function toStep2(user: User, email = LAN.email) {
  fake.account = { ...LAN };
  const view = renderApp('/forgot-password');
  await sendCodeTo(user, email);
  await step2Heading();
  return view;
}

async function fillNewPassword(user: User, password = NEW_PASSWORD, confirm = password) {
  await user.type(passwordBox(), password);
  await user.type(confirmBox(), confirm);
}

test('TC-F1-61 Login has "Quên mật khẩu?" under the password field, linking to /forgot-password', async () => {
  const user = userEvent.setup();
  const { router } = renderApp('/login');

  const link = await screen.findByRole('link', { name: 'Quên mật khẩu?' });
  expect(link).toHaveAttribute('href', '/forgot-password');
  const password = screen.getByLabelText(/^Mật khẩu/);
  expect(password.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // after the field...
  expect(link.compareDocumentPosition(screen.getByRole('button', { name: 'Đăng nhập' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // ...before the submit button

  await user.click(link);
  expect(await screen.findByRole('heading', { level: 1, name: 'Quên mật khẩu' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/forgot-password');
});

test('TC-F1-62 step 1 is the same for an unknown and a known address, never says whether the account exists, and opens step 2 with its heading focused', async () => {
  const user = userEvent.setup();
  const view = await toStep2(user, 'khong-co@example.com');

  expect(await step2Heading()).toHaveFocus();
  expect(fake.forgotBodies).toEqual([{ email: 'khong-co@example.com' }]);
  expect(fake.reset).toBeNull(); // no account, no code, and the screen cannot tell
  const unknownScreen = document.body.textContent?.replace('khong-co@example.com', 'X');
  expect(unknownScreen).toContain('Nếu email');
  expect(unknownScreen).not.toMatch(/không tồn tại|không có tài khoản|chưa đăng ký/i);
  view.unmount();
  sessionStorage.clear();

  await toStep2(user, LAN.email);
  expect(fake.reset).not.toBeNull();
  expect(document.body.textContent?.replace(LAN.email, 'X')).toBe(unknownScreen); // the same screen, word for word
});

test('TC-F1-62 step 1 checks the address first, and a logged-in visitor goes to the Dashboard', async () => {
  const user = userEvent.setup();
  const first = renderApp('/forgot-password');

  await user.type(await screen.findByRole('textbox', { name: /^Email/ }), 'not-an-email');
  await user.click(sendButton());
  expect(await screen.findByText('Email không hợp lệ')).toBeInTheDocument();
  expect(emailBox()).toHaveFocus();
  expect(fake.forgotBodies).toHaveLength(0);
  first.unmount();

  fake.account = { ...LAN };
  fake.loggedIn = true;
  const { router } = renderApp('/forgot-password');
  expect(await screen.findByRole('heading', { level: 1, name: 'Xin chào, Lan' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
});

test("TC-F1-63 step 1: FEATURE_NOT_CONFIGURED shows this screen's own text and stays on step 1", async () => {
  const user = userEvent.setup();
  fake.mailOn = false; // production without GMAIL_*
  const { router } = renderApp('/forgot-password');

  await sendCodeTo(user, LAN.email);

  expect(await screen.findByRole('alert')).toHaveTextContent('Tính năng đặt lại mật khẩu qua email chưa được thiết lập; hãy liên hệ quản trị viên.');
  expect(router.state.location.pathname).toBe('/forgot-password');
  expect(screen.getByRole('heading', { level: 1, name: 'Quên mật khẩu' })).toBeInTheDocument();
  expect(sendButton()).toBeEnabled();
});

test('TC-F1-63 step 1: a 429 shows the countdown, keeps it over a reload, and Send works again when it ends', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  fake.account = { ...LAN };
  server.use(http.post('*/api/auth/password/forgot', () => rateLimited({ retryAfter: 30 }), { once: true }));
  const first = renderApp('/forgot-password');

  await sendCodeTo(user, LAN.email);
  await waitFor(() => expect(sendButton()).toHaveTextContent(/^Gửi mã \(sau (30|29) giây\)$/));
  expect(sendButton()).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Bạn thao tác quá nhiều lần');

  first.unmount(); // a reload: only sessionStorage is left
  renderApp('/forgot-password');
  expect(await screen.findByRole('textbox', { name: /^Email/ })).toHaveValue(LAN.email);
  expect(sendButton()).toBeDisabled();
  expect(sendButton()).toHaveTextContent(/sau (30|29|28) giây/);

  await act(() => vi.advanceTimersByTimeAsync(31_000));
  expect(sendButton()).toBeEnabled();
  await user.click(sendButton());
  expect(await step2Heading()).toBeInTheDocument();
});

test('TC-F1-64 step 2: the code box does not auto-submit, the help line says what saving does, and the password checks match Register', async () => {
  const user = userEvent.setup();
  await toStep2(user);

  expect(screen.getByText(/Khi đổi mật khẩu, mọi thiết bị sẽ bị đăng xuất/)).toBeInTheDocument();
  expect(codeBox()).toHaveAttribute('inputmode', 'numeric');
  expect(codeBox()).toHaveAttribute('autocomplete', 'one-time-code');
  await user.type(codeBox(), CODE); // 6 digits: nothing is sent
  expect(fake.resetBodies).toHaveLength(0);

  await fillNewPassword(user, '1234567');
  await user.click(saveButton());
  expect(await screen.findByText('Mật khẩu cần ít nhất 8 ký tự')).toBeInTheDocument();
  expect(passwordBox()).toHaveFocus();

  await user.clear(passwordBox());
  await user.clear(confirmBox());
  await fillNewPassword(user, NEW_PASSWORD, 'khac-hoan-toan');
  await user.click(saveButton());
  expect(await screen.findByText('Hai mật khẩu không khớp')).toBeInTheDocument();
  expect(confirmBox()).toHaveFocus();
  expect(fake.resetBodies).toHaveLength(0);
});

test('TC-F1-64 step 2: fewer than 6 digits send nothing and focus the code box', async () => {
  const user = userEvent.setup();
  await toStep2(user);

  await user.type(codeBox(), '12');
  await fillNewPassword(user);
  await user.click(saveButton());

  expect(codeBox()).toHaveAccessibleDescription('Nhập đủ 6 chữ số');
  expect(codeBox()).toHaveFocus();
  expect(fake.resetBodies).toHaveLength(0);
});

test('TC-F1-64 step 2: a 204 goes to /login with the announced message, no auto-login, and only the new password works', async () => {
  const user = userEvent.setup();
  const { router } = await toStep2(user);

  await user.type(codeBox(), CODE);
  await fillNewPassword(user);
  await user.click(saveButton());

  expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeInTheDocument();
  expect(fake.resetBodies).toEqual([{ email: LAN.email, code: CODE, newPassword: NEW_PASSWORD }]);
  expect(router.state.location.pathname).toBe('/login');
  expect(screen.getByRole('status')).toHaveTextContent('Mật khẩu đã được đổi, hãy đăng nhập lại');
  expect(fake.loggedIn).toBe(false);
  expect(screen.queryByRole('heading', { name: /^Xin chào/ })).toBeNull();
  expect(readPendingReset()).toBeNull();
  expect(storedText()).not.toContain(CODE);
  expect(storedText()).not.toContain(NEW_PASSWORD);
  expect(router.state.location.search + router.state.location.hash).toBe('');
  await waitFor(() => expect(router.state.location.state).toBeNull()); // a reload of /login does not show it again

  await user.type(emailBox(), LAN.email);
  await user.type(screen.getByLabelText(/^Mật khẩu/), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email hoặc mật khẩu không đúng'); // the old password is dead
  await user.clear(screen.getByLabelText(/^Mật khẩu/));
  await user.type(screen.getByLabelText(/^Mật khẩu/), NEW_PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Xin chào, Lan' })).toBeInTheDocument();
});

test('TC-F1-64 a reload on step 2 stays on step 2 with the address back, and the code and passwords were never stored', async () => {
  const user = userEvent.setup();
  const first = await toStep2(user);
  await user.type(codeBox(), CODE);
  await fillNewPassword(user);
  expect(storedText()).not.toContain(CODE);
  expect(storedText()).not.toContain(NEW_PASSWORD);

  first.unmount();
  renderApp('/forgot-password');

  expect(await step2Heading()).toBeInTheDocument();
  expect(screen.getByText(new RegExp(LAN.email))).toBeInTheDocument();
  expect(codeBox()).toHaveValue('');
  expect(passwordBox()).toHaveValue('');
});

test('TC-F1-65 step 2: a wrong code shows the tries left, clears the box and focuses it', async () => {
  const user = userEvent.setup();
  await toStep2(user);

  await user.type(codeBox(), '000000');
  await fillNewPassword(user);
  await user.click(saveButton());

  await screen.findByText('Mã không đúng. Còn 4 lần thử.');
  expect(codeBox()).toHaveValue('');
  expect(codeBox()).toHaveFocus();
  expect(codeBox()).toHaveAccessibleDescription(/Còn 4 lần thử/);
  expect(codeBox()).toHaveAttribute('aria-invalid', 'true');
  expect(passwordBox()).toHaveValue(NEW_PASSWORD); // only the code is cleared
  expect(screen.queryByRole('alert')).toBeNull(); // said once, at the box
});

test('TC-F1-65 step 2: CODE_EXPIRED and ACCOUNT_LOCKED show their text and clear the code; Resend is there', async () => {
  const user = userEvent.setup();
  await toStep2(user);
  server.use(http.post('*/api/auth/password/reset', () => failWith('CODE_EXPIRED', 400), { once: true }));

  await user.type(codeBox(), CODE);
  await fillNewPassword(user);
  await user.click(saveButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('Mã đã hết hạn. Hãy gửi mã mới.');
  expect(codeBox()).toHaveValue('');
  expect(codeBox()).toHaveFocus();
  expect(resendButton()).toBeInTheDocument();

  server.use(http.post('*/api/auth/password/reset', () => failWith('ACCOUNT_LOCKED', 403), { once: true }));
  await user.type(codeBox(), CODE);
  await user.click(saveButton());
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Tài khoản của bạn đã bị khoá'));
  expect(codeBox()).toHaveValue('');
});

test('TC-F1-65 step 2: a VALIDATION_ERROR naming newPassword marks the password field', async () => {
  const user = userEvent.setup();
  await toStep2(user);
  server.use(http.post('*/api/auth/password/reset', () => failWith('VALIDATION_ERROR', 400, [{ path: 'newPassword', issue: 'too_small' }]), { once: true }));

  await user.type(codeBox(), CODE);
  await fillNewPassword(user);
  await user.click(saveButton());

  await waitFor(() => expect(passwordBox()).toHaveAttribute('aria-invalid', 'true'));
  expect(passwordBox()).toHaveFocus();
  expect(passwordBox()).toHaveAccessibleDescription(/Từ 8 ký tự/);
});

test('TC-F1-65 step 2: a network error keeps the code and the passwords, and Save retries', async () => {
  const user = userEvent.setup();
  await toStep2(user);
  server.use(http.post('*/api/auth/password/reset', () => HttpResponse.error(), { once: true }));

  await user.type(codeBox(), CODE);
  await fillNewPassword(user);
  await user.click(saveButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('Không kết nối được máy chủ.');
  expect(codeBox()).toHaveValue(CODE);
  expect(passwordBox()).toHaveValue(NEW_PASSWORD);

  await user.click(saveButton());
  expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeInTheDocument();
});

test('TC-F1-65 step 2: Resend is off during the countdown; after it Resend calls forgot again, says a new code was sent and restarts the countdown', async () => {
  const user = userEvent.setup();
  const first = await toStep2(user);
  expect(resendButton()).toBeDisabled();
  expect(resendButton()).toHaveTextContent(/^Gửi lại mã \(sau (60|59) giây\)$/);

  first.unmount(); // a reload after the countdown ended
  savePendingReset({ email: LAN.email, resendAt: Date.now() - 1000, sent: true });
  renderApp('/forgot-password');
  await user.click(await screen.findByRole('button', { name: 'Gửi lại mã' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Đã gửi mã mới. Mã cũ không còn dùng được.');
  expect(fake.forgotBodies).toEqual([{ email: LAN.email }, { email: LAN.email }]); // step 1, then Resend
  expect(resendButton()).toBeDisabled();
  expect(resendButton()).toHaveTextContent(/sau (60|59) giây/);
  expect(readPendingReset()?.resendAt).toBeGreaterThan(Date.now() + 50_000); // a reload keeps it
});

test('TC-F1-65 step 2: a 429 on Resend restarts the countdown from retryAfter, or shows the plain rate-limit text without it', async () => {
  const user = userEvent.setup();
  fake.account = { ...LAN };
  savePendingReset({ email: LAN.email, resendAt: 0, sent: true });
  server.use(http.post('*/api/auth/password/forgot', () => rateLimited({ retryAfter: 30 }), { once: true }));
  const first = renderApp('/forgot-password');

  await user.click(await screen.findByRole('button', { name: 'Gửi lại mã' }));
  await waitFor(() => expect(resendButton()).toHaveTextContent(/sau (30|29) giây/));
  expect(screen.getByRole('status')).toHaveTextContent('Vui lòng đợi một chút trước khi xin mã mới.');
  first.unmount();

  savePendingReset({ email: LAN.email, resendAt: 0, sent: true });
  server.use(http.post('*/api/auth/password/forgot', () => rateLimited(), { once: true }));
  renderApp('/forgot-password');
  await user.click(await screen.findByRole('button', { name: 'Gửi lại mã' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Bạn thao tác quá nhiều lần. Vui lòng thử lại sau ít phút.');
});

test('TC-F1-65 step 2: "Nhập sai email? Đổi email" goes back to step 1 and forgets the entry', async () => {
  const user = userEvent.setup();
  await toStep2(user);

  await user.click(screen.getByRole('button', { name: 'Nhập sai email? Đổi email' }));

  expect(await screen.findByRole('heading', { level: 1, name: 'Quên mật khẩu' })).toBeInTheDocument();
  expect(readPendingReset()).toBeNull();
  expect(sendButton()).toBeEnabled();
});

test('TC-F1-65 switching the language on step 2 re-translates the heading and the labels', async () => {
  const user = userEvent.setup();
  await toStep2(user);
  await user.click(screen.getByRole('button', { name: /EN/ })); // the corner language switch

  expect(await screen.findByRole('heading', { level: 1, name: 'Enter the code and a new password' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Confirmation code' })).toBeInTheDocument();
});
