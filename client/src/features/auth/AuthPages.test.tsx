import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { fake, LAN, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';

test('TC-F1-12 login shows translated field errors, focuses the first one and sends nothing', async () => {
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

test('TC-F1-12 login shows the server error code translated, and the show/hide password button works', async () => {
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

test('TC-F1-12 an unknown or network error falls back to a generic translated message', async () => {
  const user = userEvent.setup();
  server.use(http.post('*/api/auth/login', () => HttpResponse.error()));
  renderApp('/login');

  await user.type(await screen.findByRole('textbox', { name: 'Email' }), LAN.email);
  await user.type(screen.getByLabelText(/^Mật khẩu/), 'whatever1');
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Không kết nối được máy chủ.');
});

test('TC-F1-12 register checks name, password length and confirmation before calling the API', async () => {
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

test('TC-F1-12 register shows EMAIL_TAKEN translated, then succeeds with a new email in the chosen language', async () => {
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
