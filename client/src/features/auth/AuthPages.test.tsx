import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { fake, LAN, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';

test('TC-F1-16 login shows translated field errors, focuses the first one and sends nothing', async () => {
  const user = userEvent.setup();
  const login = vi.fn(() => HttpResponse.json({}));
  server.use(http.post('*/api/auth/login', login));
  renderApp('/login');

  await user.click(await screen.findByRole('button', { name: 'Đăng nhập' }));

  const email = screen.getByRole('textbox', { name: 'Email' });
  expect(email).toHaveAccessibleDescription('Vui lòng nhập thông tin này');
  expect(email).toHaveAttribute('aria-invalid', 'true');
  expect(email).toHaveFocus();
  await user.type(email, 'not-an-email');
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(email).toHaveAccessibleDescription('Email không hợp lệ');
  expect(login).not.toHaveBeenCalled();
});

test('TC-F1-16 login shows the server error code translated, and the show/hide password button works', async () => {
  const user = userEvent.setup();
  renderApp('/login');

  await user.type(await screen.findByRole('textbox', { name: 'Email' }), LAN.email);
  const password = screen.getByLabelText(/^Mật khẩu/);
  await user.type(password, 'wrong-password');
  expect(password).toHaveAttribute('type', 'password');
  await user.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
  expect(password).toHaveAttribute('type', 'text');
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Email hoặc mật khẩu không đúng.');
});

test('TC-F1-16 an unknown or network error falls back to a generic translated message', async () => {
  const user = userEvent.setup();
  server.use(http.post('*/api/auth/login', () => HttpResponse.error()));
  renderApp('/login');

  await user.type(await screen.findByRole('textbox', { name: 'Email' }), LAN.email);
  await user.type(screen.getByLabelText(/^Mật khẩu/), 'whatever1');
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Không kết nối được máy chủ.');
});

test('TC-F1-16 register checks name, password length and confirmation before calling the API', async () => {
  const user = userEvent.setup();
  renderApp('/register');

  await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'minh@example.com');
  await user.type(screen.getByLabelText(/^Mật khẩu/), 'short');
  await user.type(screen.getByLabelText(/^Nhập lại mật khẩu/), 'different');
  await user.click(screen.getByRole('button', { name: 'Đăng ký' }));

  expect(screen.getByRole('textbox', { name: 'Họ tên' })).toHaveAccessibleDescription('Họ tên từ 1 đến 60 ký tự');
  expect(screen.getByLabelText(/^Mật khẩu/)).toHaveAccessibleDescription('Mật khẩu cần ít nhất 8 ký tự');
  expect(screen.getByLabelText(/^Nhập lại mật khẩu/)).toHaveAccessibleDescription('Hai mật khẩu không khớp');
  expect(fake.account?.email).toBe(LAN.email); // nobody was registered
});

test('TC-F1-16 register shows EMAIL_TAKEN translated, then succeeds with a new email in the chosen language', async () => {
  const user = userEvent.setup();
  renderApp('/register');

  await user.type(await screen.findByRole('textbox', { name: 'Họ tên' }), 'Minh');
  const email = screen.getByRole('textbox', { name: 'Email' });
  await user.type(email, LAN.email);
  await user.type(screen.getByLabelText(/^Mật khẩu/), 'password1');
  await user.type(screen.getByLabelText(/^Nhập lại mật khẩu/), 'password1');
  await user.click(screen.getByRole('button', { name: 'Đăng ký' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email này đã được dùng cho một tài khoản khác.');

  await user.clear(email);
  await user.type(email, 'minh@example.com');
  await user.click(screen.getByRole('button', { name: 'Đăng ký' }));

  expect(await screen.findByRole('heading', { level: 1, name: 'Xin chào, Minh' })).toBeInTheDocument();
  await waitFor(() => expect(fake.account).toMatchObject({ email: 'minh@example.com', language: 'vi' }));
});

// BUG-012: the register form must reject what the API rejects, before sending, and say which field is wrong.
test('TC-F1-24 register flags e-mails and passwords the API would reject on their own field and sends nothing', async () => {
  const user = userEvent.setup();
  const register = vi.fn(() => HttpResponse.json({}, { status: 201 }));
  server.use(http.post('*/api/auth/register', register));
  renderApp('/register');

  const email = await screen.findByRole('textbox', { name: 'Email' });
  const password = screen.getByLabelText(/^Mật khẩu/);
  expect(password).toHaveAccessibleDescription('Từ 8 ký tự, tối đa 72 ký tự không dấu (chữ có dấu tính 2–3 ký tự)');
  await user.type(screen.getByRole('textbox', { name: 'Họ tên' }), 'Minh');
  for (const bad of ['nguyễn-1@example.com', 'a@b.c', 'a..b@example.com', 'a@example.com.', 'user@exämple.com', 'x@example.co1']) {
    await user.clear(email); // clear() leaves the focus here; paste() is one input event, not one per key
    await user.paste(bad);
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }));
    expect(email).toHaveAccessibleDescription('Email không hợp lệ');
  }

  await user.clear(email);
  await user.type(email, 'minh@example.com');
  // 73 plain characters, then 48 Vietnamese ones (84 bytes): both are longer than bcrypt reads (BUG-009).
  for (const tooLong of ['a'.repeat(73), `${'ư'.repeat(36)}a1b2c3d4e5f6`]) {
    await user.clear(password);
    await user.paste(tooLong);
    await user.clear(screen.getByLabelText(/^Nhập lại mật khẩu/));
    await user.paste(tooLong);
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }));
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAccessibleDescription('Mật khẩu quá dài: tối đa 72 ký tự không dấu (chữ có dấu tính 2–3 ký tự)');
  }
  expect(register).not.toHaveBeenCalled();
});

test('TC-F1-24 a VALIDATION_ERROR from the API marks the field it names', async () => {
  const user = userEvent.setup();
  server.use(
    http.post('*/api/auth/register', () =>
      HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: [{ path: 'email', issue: 'invalid_format' }] } }, { status: 400 }),
    ),
  );
  renderApp('/register');

  await user.type(await screen.findByRole('textbox', { name: 'Họ tên' }), 'Minh');
  await user.type(screen.getByRole('textbox', { name: 'Email' }), 'minh@example.com');
  await user.type(screen.getByLabelText(/^Mật khẩu/), 'password1');
  await user.type(screen.getByLabelText(/^Nhập lại mật khẩu/), 'password1');
  await user.click(screen.getByRole('button', { name: 'Đăng ký' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.');
  const email = screen.getByRole('textbox', { name: 'Email' });
  expect(email).toHaveAttribute('aria-invalid', 'true');
  expect(email).toHaveAccessibleDescription('Email không hợp lệ');
  expect(email).toHaveFocus();
  expect(screen.getByLabelText(/^Mật khẩu/)).toHaveAttribute('aria-invalid', 'false');
});

// BUG-011: an admin lock makes the refresh answer 403 ACCOUNT_LOCKED; the login page must say so.
test('TC-F1-23 a locked account that reloads the app lands on the login page with the locked message', async () => {
  server.use(http.post('*/api/auth/refresh', () => HttpResponse.json({ error: { code: 'ACCOUNT_LOCKED', message: 'x' } }, { status: 403 })));
  renderApp('/');

  expect(await screen.findByRole('alert')).toHaveTextContent('Tài khoản của bạn đã bị khoá. Vui lòng liên hệ quản trị viên.');
  expect(screen.getByRole('heading', { name: 'Đăng nhập' })).toBeInTheDocument();
});
