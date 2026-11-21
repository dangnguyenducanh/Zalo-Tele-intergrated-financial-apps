import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { LAN, resetFake, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';
import type { User } from '@/types/api';
import type { CategoryTemplate } from './adminApi';

// The admin pages against an in-memory stand-in for /api/admin/* (MSW). Lan is the logged-in admin.
const ADMIN: User = { ...LAN, role: 'admin' };
const MINH: User = { ...LAN, id: 'u2', name: 'Minh', email: 'minh@example.com' };

let users: User[];
let templates: CategoryTemplate[];
const requests: { method: string; url: URL; body?: unknown }[] = [];
const sent = (method: string) => requests.filter((r) => r.method === method);

const template = (id: string, vi: string, more: Partial<CategoryTemplate> = {}): CategoryTemplate => ({
  id,
  type: 'expense',
  names: { vi, en: vi },
  keywords: [],
  icon: '',
  color: '#ef6c00',
  isFallback: false,
  ...more,
});

beforeEach(() => {
  users = [ADMIN, MINH];
  templates = [
    template('c1', 'Ăn uống', { names: { vi: 'Ăn uống', en: 'Food & drinks' }, keywords: ['pho', 'cafe'] }),
    template('c2', 'Khác', { names: { vi: 'Khác', en: 'Other' }, isFallback: true }),
    template('c3', 'Lương', { type: 'income' }),
  ];
  requests.length = 0;
  resetFake(ADMIN, true);
  const log = async (request: Request) => {
    const body = request.method === 'GET' || request.method === 'DELETE' ? undefined : await request.json();
    requests.push({ method: request.method, url: new URL(request.url), body });
    return body as Record<string, unknown>;
  };
  server.use(
    http.get('*/api/admin/stats', () =>
      HttpResponse.json({ users: 2, activeUsers7d: 1, chatLinks: { telegram: 3, zalo: 1 }, transactionsBySource: { web: 10, telegram: 5, zalo: 0, receipt: 2 } }),
    ),
    http.get('*/api/admin/users', async ({ request }) => {
      await log(request);
      const q = new URL(request.url).searchParams.get('q') ?? '';
      const items = users.filter((u) => u.name.toLowerCase().includes(q.toLowerCase()));
      return HttpResponse.json({ items, total: items.length });
    }),
    http.patch('*/api/admin/users/:id', async ({ request, params }) => {
      const changes = await log(request);
      if (params.id === ADMIN.id) return HttpResponse.json({ error: { code: 'LAST_ADMIN', message: 'last admin' } }, { status: 409 });
      users = users.map((u) => (u.id === params.id ? { ...u, ...changes } : u));
      return HttpResponse.json(users.find((u) => u.id === params.id));
    }),
    http.get('*/api/admin/categories', async ({ request }) => {
      await log(request);
      return HttpResponse.json(templates.filter((t) => t.type === new URL(request.url).searchParams.get('type')));
    }),
    http.post('*/api/admin/categories', async ({ request }) => {
      const created = { ...template('c9', ''), ...(await log(request)) } as CategoryTemplate;
      templates.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch('*/api/admin/categories/:id', async ({ request, params }) => {
      const changes = await log(request);
      templates = templates.map((t) => (t.id === params.id ? { ...t, ...changes } : t));
      return HttpResponse.json(templates.find((t) => t.id === params.id));
    }),
    http.delete('*/api/admin/categories/:id', async ({ request, params }) => {
      await log(request);
      templates = templates.filter((t) => t.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

test('TC-F11-08 users page: stats, search, lock behind a confirm dialog, and LAST_ADMIN translated', async () => {
  const user = userEvent.setup();
  renderApp('/admin/users');

  expect(await screen.findByRole('heading', { level: 1, name: 'Quản trị người dùng' })).toBeInTheDocument();
  const chats = (await screen.findByText('Chat đã liên kết')).parentElement!;
  expect(chats).toHaveTextContent('4');
  expect(chats).toHaveTextContent('Telegram 3 · Zalo 1');

  const table = await screen.findByRole('region', { name: 'Số người dùng tìm thấy: 2' });
  expect(within(table).getByRole('rowheader', { name: /Lan \(bạn\)/ })).toBeInTheDocument();

  // Filters are sent when the search form is submitted; empty ones are left out.
  await user.type(screen.getByRole('searchbox', { name: 'Tìm theo tên hoặc email' }), 'minh');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Trạng thái' }), 'Đang hoạt động');
  await user.click(screen.getByRole('button', { name: 'Tìm' }));
  await screen.findByRole('region', { name: 'Số người dùng tìm thấy: 1' });
  const lastQuery = sent('GET').at(-1)!.url.searchParams;
  expect(Object.fromEntries(lastQuery)).toEqual({ q: 'minh', status: 'active', page: '1', limit: '20' });

  // Lock: nothing is sent until the dialog is confirmed.
  await user.click(screen.getByRole('button', { name: 'Khoá Minh' }));
  const dialog = await screen.findByRole('dialog', { name: 'Khoá tài khoản này?' });
  expect(dialog).toHaveTextContent('Minh (minh@example.com) sẽ bị đăng xuất trên mọi thiết bị');
  expect(sent('PATCH')).toHaveLength(0);
  await user.click(within(dialog).getByRole('button', { name: 'Khoá' }));
  expect(await screen.findByText('Đã khoá Minh và đăng xuất trên mọi thiết bị.')).toBeInTheDocument();
  expect(sent('PATCH')[0]!.body).toEqual({ status: 'locked' });
  expect(await screen.findByRole('button', { name: 'Mở khoá Minh' })).toBeInTheDocument(); // the list refetched
  expect(within(screen.getByRole('row', { name: /Minh/ })).getByText('Đã khoá')).toBeInTheDocument();

  // The server refuses to demote the last admin; the page shows the translated error code.
  await user.clear(screen.getByRole('searchbox'));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Trạng thái' }), 'Tất cả');
  await user.click(screen.getByRole('button', { name: 'Tìm' }));
  await user.click(await screen.findByRole('button', { name: 'Bỏ quyền quản trị Lan' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bỏ quyền quản trị' }));
  expect(await screen.findByText('Không thể khoá hoặc hạ quyền quản trị viên cuối cùng.')).toBeInTheDocument();
});

// BUG-015: one failed GET /admin/users must not leave the list stuck; Retry and Tìm both load it again.
test('TC-F11-09 users page: a failed load offers Retry, and pressing Tìm again with the same search reloads it', async () => {
  const user = userEvent.setup();
  const failOnce = () =>
    server.use(http.get('*/api/admin/users', () => HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }), { once: true }));
  failOnce();
  renderApp('/admin/users');

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Đã có lỗi xảy ra. Vui lòng thử lại.');
  expect(screen.queryByText('Đang tải…')).not.toBeInTheDocument(); // not "loading" while showing an error
  await user.click(within(alert).getByRole('button', { name: 'Thử lại' }));
  await screen.findByRole('region', { name: 'Số người dùng tìm thấy: 2' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  // The same search again (nothing changed in the form) still asks the server.
  failOnce();
  await user.click(screen.getByRole('button', { name: 'Tìm' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: /Số người dùng tìm thấy/ })).not.toBeInTheDocument(); // no stale rows under the error
  await user.click(screen.getByRole('button', { name: 'Tìm' }));
  await screen.findByRole('region', { name: 'Số người dùng tìm thấy: 2' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('TC-F11-08 users page: an action that empties the current page goes back to the last page', async () => {
  const user = userEvent.setup();
  // 20 other active users fill page 1, so Minh is alone on page 2 of the "active" list.
  const others = Array.from({ length: 20 }, (_, i): User => ({ ...MINH, id: `x${i}`, name: `Người ${i}` }));
  server.use(
    http.get('*/api/admin/users', ({ request }) => {
      requests.push({ method: 'GET', url: new URL(request.url) });
      const page = Number(new URL(request.url).searchParams.get('page'));
      const active = [...others, ...users.filter((u) => u.id === MINH.id && u.status === 'active')];
      return HttpResponse.json({ items: active.slice((page - 1) * 20, page * 20), total: active.length });
    }),
  );
  renderApp('/admin/users');

  await screen.findByRole('region', { name: 'Số người dùng tìm thấy: 21' });
  await user.click(screen.getByRole('button', { name: 'Trang 2' }));
  await user.click(await screen.findByRole('button', { name: 'Khoá Minh' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Khoá' }));

  // Locking Minh leaves 20 active users, one page: the page shows page 1, not "no users".
  expect(await screen.findByRole('rowheader', { name: /Người 0/ })).toBeInTheDocument();
  expect(sent('GET').at(-1)!.url.searchParams.get('page')).toBe('1');
  expect(screen.queryByRole('button', { name: 'Trang 2' })).not.toBeInTheDocument();
});

test('TC-F11-08 default categories page: tabs, add, edit and delete; the fallback has no delete button', async () => {
  const user = userEvent.setup();
  renderApp('/admin/categories');

  expect(await screen.findByRole('heading', { level: 1, name: 'Danh mục mặc định' })).toBeInTheDocument();
  expect(await screen.findByRole('rowheader', { name: /Ăn uống/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Xoá Ăn uống' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sửa Khác' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Xoá Khác' })).not.toBeInTheDocument();

  // Add: the new template gets the type of the open tab; keywords are split at commas.
  await user.click(screen.getByRole('button', { name: 'Thêm danh mục' }));
  const add = await screen.findByRole('dialog', { name: 'Danh mục chi mới' });
  expect(within(add).getByRole('textbox', { name: 'Tên tiếng Việt' })).toHaveFocus();
  await user.type(within(add).getByRole('textbox', { name: 'Tên tiếng Việt' }), 'Thú cưng');
  await user.type(within(add).getByRole('textbox', { name: 'Tên tiếng Anh' }), 'Pets');
  // A keyword longer than the server's 40 characters is stopped in the browser with a translated message.
  const keywords = within(add).getByRole('textbox', { name: 'Từ khoá cho bot' });
  await user.type(keywords, `pate, ${'x'.repeat(41)}`);
  await user.click(within(add).getByRole('button', { name: 'Lưu' }));
  expect(keywords).toBeInvalid();
  expect((keywords as HTMLInputElement).validationMessage).toBe('Tối đa 50 từ khoá, mỗi từ khoá tối đa 40 ký tự.');
  expect(sent('POST')).toHaveLength(0);
  await user.clear(keywords);
  await user.type(keywords, 'Pate, hạt ,, cát');
  expect(keywords).toBeValid();
  await user.click(within(add).getByRole('button', { name: 'Lưu' }));
  expect(await screen.findByRole('rowheader', { name: /Thú cưng/ })).toBeInTheDocument();
  expect(sent('POST')[0]!.body).toEqual({
    type: 'expense',
    names: { vi: 'Thú cưng', en: 'Pets' },
    keywords: ['Pate', 'hạt', 'cát'],
    icon: '',
    color: '#9e9e9e',
  });

  // Edit starts from the saved values.
  await user.click(screen.getByRole('button', { name: 'Sửa Ăn uống' }));
  const edit = await screen.findByRole('dialog', { name: 'Sửa danh mục mặc định' });
  expect(within(edit).getByRole('textbox', { name: 'Từ khoá cho bot' })).toHaveValue('pho, cafe');
  const english = within(edit).getByRole('textbox', { name: 'Tên tiếng Anh' });
  await user.clear(english);
  await user.type(english, 'Food');
  await user.click(within(edit).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent('PATCH')[0]!.body).toMatchObject({ names: { vi: 'Ăn uống', en: 'Food' }, keywords: ['pho', 'cafe'], color: '#ef6c00' });

  // Delete asks first.
  await user.click(screen.getByRole('button', { name: 'Xoá Ăn uống' }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Xoá danh mục mặc định này?' })).getByRole('button', { name: 'Xoá' }));
  await waitFor(() => expect(screen.queryByRole('rowheader', { name: /Ăn uống/ })).not.toBeInTheDocument());
  expect(sent('DELETE')[0]!.url.pathname).toBe('/api/admin/categories/c1');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); // closing animation done

  // The income tab loads the income templates.
  await user.click(screen.getByRole('tab', { name: 'Thu' }));
  expect(await screen.findByRole('rowheader', { name: /Lương/ })).toBeInTheDocument();
  expect(sent('GET').at(-1)!.url.searchParams.get('type')).toBe('income');
});
