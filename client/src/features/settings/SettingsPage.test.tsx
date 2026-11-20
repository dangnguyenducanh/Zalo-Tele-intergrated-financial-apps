import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { fake, LAN, PASSWORD, resetFake, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';
import { describeDevice } from './device';
import type { Session } from './settingsApi';

// An in-memory /api/sessions, /api/users/me/password and /api/wallets (MSW) with the docs/04 shapes.
// PATCH /api/users/me comes from test/fakeApi.ts and records its bodies in fake.patches.
const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let sessions: Session[] = [];
let sent: { method: string; url: string; body?: unknown }[] = [];

beforeEach(() => {
  resetFake({ ...LAN, defaultWalletId: 'w1' }, true); // logged in as Lan, UI in Vietnamese
  sessions = [
    { id: 's1', userAgent: CHROME_WINDOWS, ip: '203.0.113.5', lastUsedAt: '2026-11-20T03:00:00.000Z', current: true }, // 10:00 in Vietnam
    { id: 's2', userAgent: SAFARI_IPHONE, ip: '198.51.100.7', lastUsedAt: '2026-11-19T12:30:00.000Z', current: false },
    { id: 's3', userAgent: 'curl/8.5.0', ip: '192.0.2.9', lastUsedAt: '2026-11-01T01:00:00.000Z', current: false },
  ];
  sent = [];
  server.use(
    http.get('*/api/wallets', () =>
      HttpResponse.json([
        { id: 'w1', name: 'Tiền mặt', type: 'cash', initialBalance: 0, balance: 0, aliases: [], color: '', icon: '', archived: false },
        { id: 'w2', name: 'Momo', type: 'ewallet', initialBalance: 0, balance: 0, aliases: [], color: '', icon: '', archived: false },
      ]),
    ),
    http.get('*/api/sessions', () => HttpResponse.json(sessions)),
    http.delete('*/api/sessions/:id', ({ request, params }) => {
      sent.push({ method: 'DELETE', url: new URL(request.url).pathname });
      sessions = sessions.filter((s) => s.id !== params.id || s.current);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('*/api/sessions', ({ request }) => {
      const url = new URL(request.url);
      sent.push({ method: 'DELETE', url: url.pathname + url.search });
      if (url.searchParams.get('others') !== 'true') return HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'x' } }, { status: 400 });
      sessions = sessions.filter((s) => s.current);
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch('*/api/users/me/password', async ({ request }) => {
      const body = (await request.json()) as { currentPassword: string; newPassword: string };
      sent.push({ method: 'PATCH', url: '/api/users/me/password', body });
      if (body.currentPassword !== PASSWORD) return HttpResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: 'x' } }, { status: 401 });
      sessions = sessions.filter((s) => s.current); // the server logs out every other device
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

test('TC-F1-10 settings lists the logged-in devices, marks this one, and logs out one device or all the others', async () => {
  const user = userEvent.setup();
  renderApp('/settings');

  expect(await screen.findByRole('heading', { level: 1, name: 'Cài đặt' })).toBeInTheDocument();
  const section = screen.getByRole('region', { name: 'Thiết bị đang đăng nhập' });
  const list = await within(section).findByRole('list', { name: 'Thiết bị đang đăng nhập' });
  const items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(items[0]).toHaveTextContent('Chrome · Windows');
  expect(items[0]).toHaveTextContent(/203\.0\.113\.5 · dùng lần cuối .*10:00/); // shown in Vietnam time
  expect(within(items[0]!).getByText('Thiết bị này')).toBeInTheDocument();
  expect(within(items[0]!).queryByRole('button')).not.toBeInTheDocument(); // this device logs out from the account menu
  expect(items[2]).toHaveTextContent('Thiết bị không rõ');

  // One device: asks first, then DELETE /sessions/:id; the list refetches and focus stays on the section.
  await user.click(within(section).getByRole('button', { name: 'Đăng xuất Safari · iOS' }));
  const dialog = await screen.findByRole('dialog', { name: 'Đăng xuất thiết bị?' });
  expect(dialog).toHaveTextContent('Safari · iOS sẽ phải đăng nhập lại.');
  await user.click(within(dialog).getByRole('button', { name: 'Đăng xuất' }));
  await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
  expect(sent).toEqual([{ method: 'DELETE', url: '/api/sessions/s2' }]);
  expect(await screen.findByText('Đã đăng xuất Safari · iOS')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Thiết bị đang đăng nhập' })).toHaveFocus();

  // All the others: cancel does nothing, confirm sends DELETE /sessions?others=true.
  await user.click(within(section).getByRole('button', { name: 'Đăng xuất các thiết bị khác' }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Đăng xuất các thiết bị khác?' })).getByRole('button', { name: 'Huỷ' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent).toHaveLength(1);
  await user.click(within(section).getByRole('button', { name: 'Đăng xuất các thiết bị khác' }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Đăng xuất các thiết bị khác?' })).getByRole('button', { name: 'Đăng xuất' }));
  expect(await within(section).findByText('Chỉ có thiết bị này đang đăng nhập.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent.at(-1)).toEqual({ method: 'DELETE', url: '/api/sessions?others=true' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  expect(within(section).queryByRole('button', { name: 'Đăng xuất các thiết bị khác' })).not.toBeInTheDocument();
});

test('TC-F1-10 a device list that fails to load shows the error and Try again loads it', async () => {
  const user = userEvent.setup();
  server.use(http.get('*/api/sessions', () => HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }), { once: true }));
  renderApp('/settings');

  const section = await screen.findByRole('region', { name: 'Thiết bị đang đăng nhập' });
  expect(await within(section).findByText('Không tải được danh sách thiết bị.')).toBeInTheDocument();
  await user.click(within(section).getByRole('button', { name: 'Thử lại' }));
  expect(await within(section).findAllByRole('listitem')).toHaveLength(3);
});

test('TC-F1-18 device names come from the user agent', () => {
  expect(describeDevice(CHROME_WINDOWS)).toBe('Chrome · Windows');
  expect(describeDevice(SAFARI_IPHONE)).toBe('Safari · iOS');
  expect(describeDevice('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Mobile Safari/537.36')).toBe(
    'Chrome · Android',
  );
  expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36 Edg/142.0')).toBe(
    'Edge · macOS',
  );
  expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0')).toBe('Firefox · Linux');
  expect(describeDevice('curl/8.5.0')).toBe('');
});

test('TC-F1-18 profile: the name is checked, then name and default wallet are saved and the new name shows in the account menu', async () => {
  const user = userEvent.setup();
  renderApp('/settings');

  const form = await screen.findByRole('form', { name: 'Hồ sơ' });
  expect(within(form).getByRole('textbox', { name: 'Họ tên' })).toHaveValue('Lan');
  const wallet = within(form).getByRole('combobox', { name: 'Ví mặc định' });
  await waitFor(() => expect(wallet).toHaveDisplayValue('Tiền mặt'));
  expect(screen.getByText('Đăng nhập bằng lan@example.com')).toBeInTheDocument();

  await user.clear(within(form).getByRole('textbox', { name: 'Họ tên' }));
  await user.click(within(form).getByRole('button', { name: 'Lưu hồ sơ' }));
  expect(within(form).getByRole('textbox', { name: 'Họ tên' })).toHaveFocus();
  expect(within(form).getByRole('textbox', { name: 'Họ tên' })).toHaveAccessibleDescription('Họ tên từ 1 đến 60 ký tự');
  expect(fake.patches).toEqual([]);

  await user.type(within(form).getByRole('textbox', { name: 'Họ tên' }), '  Lan Anh ');
  await user.selectOptions(wallet, 'Momo');
  await user.click(within(form).getByRole('button', { name: 'Lưu hồ sơ' }));
  expect(await screen.findByText('Đã lưu hồ sơ')).toBeInTheDocument();
  expect(fake.patches).toEqual([{ name: 'Lan Anh', defaultWalletId: 'w2' }]);

  // AuthContext got the saved user, so the app bar shows the new name without logging in again.
  await user.click(screen.getByRole('button', { name: 'Tài khoản' }));
  expect(within(await screen.findByRole('menu')).getByText('Lan Anh')).toBeInTheDocument();
});

test('TC-F1-18 password: fields are checked, a wrong current password is shown on its field, success clears the form and the device list', async () => {
  const user = userEvent.setup();
  renderApp('/settings');

  const form = await screen.findByRole('form', { name: 'Đổi mật khẩu' });
  const current = within(form).getByLabelText(/^Mật khẩu hiện tại/);
  const next = within(form).getByLabelText(/^Mật khẩu mới/);
  const confirm = within(form).getByLabelText(/^Nhập lại mật khẩu mới/);
  expect(current).toHaveAttribute('autocomplete', 'current-password');
  expect(next).toHaveAttribute('autocomplete', 'new-password');

  await user.click(within(form).getByRole('button', { name: 'Đổi mật khẩu' }));
  expect(current).toHaveFocus();
  expect(current).toHaveAccessibleDescription('Vui lòng nhập thông tin này');
  expect(next).toHaveAccessibleDescription('Mật khẩu mới cần từ 8 đến 72 ký tự');

  await user.type(current, 'wrong-password');
  await user.type(next, 'new-secret-1');
  await user.type(confirm, 'new-secret-2');
  await user.click(within(form).getByRole('button', { name: 'Đổi mật khẩu' }));
  expect(confirm).toHaveFocus();
  expect(confirm).toHaveAccessibleDescription('Hai mật khẩu không khớp');
  expect(sent).toEqual([]);

  await user.clear(confirm);
  await user.type(confirm, 'new-secret-1');
  await user.click(within(form).getByRole('button', { name: 'Đổi mật khẩu' }));
  await waitFor(() => expect(current).toHaveAccessibleDescription('Mật khẩu hiện tại không đúng'));
  expect(current).toHaveFocus();

  await user.clear(current);
  await user.type(current, PASSWORD);
  await user.click(within(form).getByRole('button', { name: 'Đổi mật khẩu' }));
  expect(await screen.findByText('Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.')).toBeInTheDocument();
  expect(sent.at(-1)).toEqual({ method: 'PATCH', url: '/api/users/me/password', body: { currentPassword: PASSWORD, newPassword: 'new-secret-1' } });
  expect(current).toHaveValue('');
  expect(next).toHaveValue('');
  // The server logged out the other devices; the list refetched by itself (RTK Query tag `Session`).
  const section = screen.getByRole('region', { name: 'Thiết bị đang đăng nhập' });
  expect(await within(section).findByText('Chỉ có thiết bị này đang đăng nhập.')).toBeInTheDocument();
});

test('TC-F12-01 settings: Dark applies only on Save, then at once, in localStorage and in the profile', async () => {
  const user = userEvent.setup();
  const { store } = renderApp('/settings');

  const form = await screen.findByRole('form', { name: 'Tuỳ chọn' });
  const themes = within(form).getByRole('group', { name: 'Giao diện' });
  expect(within(themes).getByRole('radio', { name: 'Theo hệ thống' })).toBeChecked();

  await user.click(within(themes).getByRole('radio', { name: 'Tối' }));
  expect(store.getState().ui.themeMode).toBe('system'); // a radio alone does not submit the form

  await user.click(within(form).getByRole('button', { name: 'Lưu tuỳ chọn' }));
  expect(store.getState().ui.themeMode).toBe('dark');
  expect(localStorage.getItem('themeMode')).toBe('dark');
  expect(screen.getByRole('button', { name: 'Chuyển sang giao diện sáng' })).toBeInTheDocument();
  await waitFor(() => expect(fake.patches).toEqual([{ language: 'vi', theme: 'dark' }]));
  expect(await screen.findByText('Đã lưu tuỳ chọn')).toBeInTheDocument();

  // The app bar toggle changes the same setting, and the radios follow it.
  await user.click(screen.getByRole('button', { name: 'Chuyển sang giao diện sáng' }));
  expect(within(themes).getByRole('radio', { name: 'Theo hệ thống' })).toBeChecked();
});

test('TC-F12-02 settings: English translates the page on Save and saves the language to the profile', async () => {
  const user = userEvent.setup();
  renderApp('/settings');

  const form = await screen.findByRole('form', { name: 'Tuỳ chọn' });
  await user.click(within(within(form).getByRole('group', { name: 'Ngôn ngữ' })).getByRole('radio', { name: 'English' }));
  await user.click(within(form).getByRole('button', { name: 'Lưu tuỳ chọn' }));

  expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  expect(document.documentElement.lang).toBe('en');
  expect(within(screen.getByRole('form', { name: 'Preferences' })).getByRole('radio', { name: 'English' })).toBeChecked();
  await waitFor(() => expect(fake.patches).toEqual([{ language: 'en', theme: 'system' }]));
  expect(await screen.findByText('Preferences saved')).toBeInTheDocument();
});

test('TC-F12-02 settings: when the profile cannot be saved the choice still applies on this device, with a warning', async () => {
  const user = userEvent.setup();
  server.use(http.patch('*/api/users/me', () => HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 })));
  renderApp('/settings');

  const form = await screen.findByRole('form', { name: 'Tuỳ chọn' });
  await user.click(within(form).getByRole('radio', { name: 'English' }));
  await user.click(within(form).getByRole('button', { name: 'Lưu tuỳ chọn' }));

  expect(await screen.findByText('Could not save this choice to your account. It still applies on this device.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
});
