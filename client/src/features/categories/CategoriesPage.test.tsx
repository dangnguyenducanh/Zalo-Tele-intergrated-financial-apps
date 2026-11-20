import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { LAN, resetFake, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';
import type { Category } from './categoriesApi';

// An in-memory /api/categories (MSW). Default copies have names {vi, en}; user-made ones have a name.
let categories: Category[] = [];
let sent: { method: string; body: unknown }[] = [];

const category = (fields: Partial<Category> & Pick<Category, 'id' | 'type'>): Category => ({
  keywords: [],
  icon: '',
  color: '',
  isFallback: false,
  ...fields,
});

beforeEach(() => {
  resetFake(LAN, true); // logged in as Lan, UI in Vietnamese
  categories = [
    category({
      id: 'c1',
      type: 'expense',
      names: { vi: 'Ăn uống', en: 'Food & drinks' },
      keywords: ['pho', 'bun'],
      icon: 'Restaurant',
      color: '#ef6c00',
    }),
    category({ id: 'c2', type: 'expense', names: { vi: 'Khác', en: 'Other' }, icon: 'Category', isFallback: true }),
    category({ id: 'c3', type: 'income', names: { vi: 'Lương', en: 'Salary' }, keywords: ['luong'], icon: 'Payments' }),
  ];
  sent = [];
  server.use(
    http.get('*/api/categories', () => HttpResponse.json(categories)),
    http.post('*/api/categories', async ({ request }) => {
      const body = (await request.json()) as Category;
      sent.push({ method: 'POST', body });
      const created = category({ ...body, id: `c${categories.length + 1}` });
      categories.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch('*/api/categories/:id', async ({ request, params }) => {
      const body = (await request.json()) as Partial<Category>;
      sent.push({ method: 'PATCH', body });
      categories = categories.map((c) => (c.id === params.id ? { ...c, ...body } : c));
      return HttpResponse.json(categories.find((c) => c.id === params.id));
    }),
    http.delete('*/api/categories/:id', ({ params }) => {
      sent.push({ method: 'DELETE', body: params.id });
      categories = categories.filter((c) => c.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

test("TC-F3-04 keyword input strips diacritics: typing 'Phở Bò' saves the chip 'pho bo'", async () => {
  const user = userEvent.setup();
  renderApp('/categories');

  await user.click(await screen.findByRole('button', { name: 'Thêm danh mục' }));
  const dialog = await screen.findByRole('dialog', { name: 'Thêm danh mục chi' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Tên danh mục' }), 'Ăn vặt');
  const keywords = within(dialog).getByRole('combobox', { name: 'Từ khoá cho bot' });
  await user.type(keywords, 'Phở Bò{Enter}');
  expect(within(dialog).getByRole('button', { name: 'pho bo' })).toBeInTheDocument(); // the chip, already normalised
  await user.type(keywords, 'Bánh Mì, ĐẬU{Enter}'); // a comma separates several keywords
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent).toEqual([
    {
      method: 'POST',
      body: { type: 'expense', name: 'Ăn vặt', keywords: ['pho bo', 'banh mi', 'dau'], icon: 'Category', color: '#757575' },
    },
  ]);
  expect(await screen.findByRole('listitem', { name: 'Ăn vặt' })).toHaveTextContent('pho bo');
});

test('TC-F3-06 tabs split expense and income; defaults show names in the UI language; the fallback cannot be deleted', async () => {
  const user = userEvent.setup();
  renderApp('/categories');

  const food = await screen.findByRole('listitem', { name: 'Ăn uống' });
  expect(food).toHaveTextContent('pho');
  expect(within(food).getByRole('button', { name: 'Xoá danh mục Ăn uống' })).toBeInTheDocument();
  const other = screen.getByRole('listitem', { name: 'Khác' });
  expect(within(other).queryByRole('button', { name: /^Xoá/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('listitem', { name: 'Lương' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('tab', { name: 'Thu' }));
  expect(await screen.findByRole('listitem', { name: 'Lương' })).toBeInTheDocument();
  expect(screen.queryByRole('listitem', { name: 'Ăn uống' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Đổi ngôn ngữ sang English' }));
  expect(await screen.findByRole('listitem', { name: 'Salary' })).toBeInTheDocument();
});

test('TC-F3-06 editing a default copy keeps its bilingual name unless renamed; delete moves its transactions to "Khác"', async () => {
  const user = userEvent.setup();
  renderApp('/categories');

  await user.click(within(await screen.findByRole('listitem', { name: 'Ăn uống' })).getByRole('button', { name: 'Sửa danh mục Ăn uống' }));
  const dialog = await screen.findByRole('dialog', { name: 'Sửa danh mục' });
  expect(within(dialog).getByRole('textbox', { name: 'Tên danh mục' })).toHaveValue('Ăn uống');
  await user.type(within(dialog).getByRole('combobox', { name: 'Từ khoá cho bot' }), 'cơm tấm{Enter}');
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  // No `name` sent: the copy keeps names {vi, en}, so it still follows the UI language.
  expect(sent).toEqual([{ method: 'PATCH', body: { keywords: ['pho', 'bun', 'com tam'], icon: 'Restaurant', color: '#ef6c00' } }]);

  await user.click(within(screen.getByRole('listitem', { name: 'Ăn uống' })).getByRole('button', { name: 'Xoá danh mục Ăn uống' }));
  const confirm = await screen.findByRole('dialog', { name: 'Xoá danh mục?' });
  expect(confirm).toHaveTextContent('Các giao dịch của danh mục "Ăn uống" sẽ chuyển sang danh mục "Khác".');
  await user.click(within(confirm).getByRole('button', { name: 'Xoá' }));
  await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Ăn uống' })).not.toBeInTheDocument());
  expect(sent.at(-1)).toEqual({ method: 'DELETE', body: 'c1' });
});
