import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import AdminRoute from '@/auth/AdminRoute';
import ProtectedRoute from '@/auth/ProtectedRoute';
import { authRoutes } from '@/features/auth/routes';
import { fake, LAN, PASSWORD, resetFake } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';

// A route table with one protected page and one admin page, to test the guards on their own.
const guardedRoutes = [
  {
    hydrateFallbackElement: <p>Loading</p>,
    children: [
      ...authRoutes,
      {
        element: <ProtectedRoute />,
        children: [
          { path: '/', element: <h1>Home</h1> },
          { path: '/secret', element: <h1>Secret page</h1> },
          { element: <AdminRoute />, children: [{ path: '/admin/x', element: <h1>Admin page</h1> }] },
        ],
      },
    ],
  },
];

async function logIn(user = userEvent.setup()) {
  await user.type(await screen.findByRole('textbox', { name: 'Email' }), LAN.email);
  await user.type(screen.getByLabelText(/^Mật khẩu/), PASSWORD);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

test('TC-F1-08 on start AuthProvider restores the session from the refresh cookie (silent refresh)', async () => {
  resetFake(LAN, true);
  renderApp('/');

  expect(await screen.findByRole('heading', { level: 1, name: 'Xin chào, Lan' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeInTheDocument();
});

test('TC-F1-08 without a session the app shows /login; logging in opens the app, logging out returns to /login', async () => {
  const user = userEvent.setup();
  const { router } = renderApp('/');

  expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/login');

  await logIn(user);
  expect(await screen.findByRole('heading', { level: 1, name: 'Xin chào, Lan' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');

  await user.click(screen.getByRole('button', { name: 'Tài khoản' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Đăng xuất' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeInTheDocument();
  expect(fake.loggedIn).toBe(false); // the server session was revoked too
});

test('TC-F1-17 ProtectedRoute sends a visitor to /login and back to the page they asked for after login', async () => {
  const { router } = renderApp('/secret', guardedRoutes);

  await logIn();

  expect(await screen.findByRole('heading', { name: 'Secret page' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/secret');
});

test('TC-F1-17 a logged-in user who opens /login or /register is sent to the app', async () => {
  resetFake(LAN, true);
  const { router } = renderApp('/register', guardedRoutes);

  expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/');
});

test('TC-F1-17 AdminRoute shows 403 to a normal user and the page to an admin', async () => {
  resetFake(LAN, true);
  const first = renderApp('/admin/x', guardedRoutes);
  expect(await screen.findByRole('heading', { name: 'Không có quyền truy cập' })).toBeInTheDocument();
  expect(screen.queryByText('Admin page')).not.toBeInTheDocument();
  first.unmount();

  resetFake({ ...LAN, role: 'admin' }, true);
  renderApp('/admin/x', guardedRoutes);
  expect(await screen.findByRole('heading', { name: 'Admin page' })).toBeInTheDocument();
});

test('TC-F1-17 admin pages appear in the navigation only for admins', async () => {
  resetFake({ ...LAN, role: 'admin' }, true);
  renderApp('/');
  const nav = await screen.findByRole('navigation', { name: 'Điều hướng chính' });
  // Phone layout in jsdom: admin pages sit under "More".
  await userEvent.click(within(nav).getByRole('button', { name: 'Thêm' }));
  expect(await screen.findByRole('link', { name: 'Quản trị người dùng' })).toHaveAttribute('href', '/admin/users');
});

test('TC-F12-01 the theme toggle switches to dark, remembers it in localStorage and saves it to the profile', async () => {
  const user = userEvent.setup();
  resetFake(LAN, true);
  renderApp('/');

  await user.click(await screen.findByRole('button', { name: 'Chuyển sang giao diện tối' }));

  expect(screen.getByRole('button', { name: 'Chuyển sang giao diện sáng' })).toBeInTheDocument();
  expect(localStorage.getItem('themeMode')).toBe('dark');
  await waitFor(() => expect(fake.patches).toEqual([{ theme: 'dark' }]));

  // Back to the scheme the OS uses (light here) = follow the system again, nothing pinned.
  await user.click(screen.getByRole('button', { name: 'Chuyển sang giao diện sáng' }));
  expect(localStorage.getItem('themeMode')).toBeNull();
  await waitFor(() => expect(fake.patches).toEqual([{ theme: 'dark' }, { theme: 'system' }]));
});

test('TC-F12-01 the theme saved in the profile is applied after login (follows the user to a new browser)', async () => {
  resetFake({ ...LAN, theme: 'dark' }, true);
  renderApp('/');

  expect(await screen.findByRole('button', { name: 'Chuyển sang giao diện sáng' })).toBeInTheDocument();
  expect(localStorage.getItem('themeMode')).toBe('dark');
});

test('TC-F12-02 switching to English translates the UI, sets <html lang> and saves the language to the profile', async () => {
  const user = userEvent.setup();
  resetFake(LAN, true);
  renderApp('/');

  await user.click(await screen.findByRole('button', { name: 'Đổi ngôn ngữ sang English' }));

  expect(await screen.findByRole('heading', { level: 1, name: 'Hello, Lan' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
  expect(document.documentElement.lang).toBe('en');
  await waitFor(() => expect(fake.patches).toEqual([{ language: 'en' }]));
});

test('TC-F12-02 the language saved in the profile is applied after login', async () => {
  resetFake({ ...LAN, language: 'en' }, true);
  renderApp('/');

  expect(await screen.findByRole('heading', { level: 1, name: 'Hello, Lan' })).toBeInTheDocument();
});

test('TC-F1-08 an unknown URL shows the 404 page with a link home', async () => {
  renderApp('/no-such-page');

  expect(await screen.findByRole('heading', { level: 1, name: 'Không tìm thấy trang' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/');
});
