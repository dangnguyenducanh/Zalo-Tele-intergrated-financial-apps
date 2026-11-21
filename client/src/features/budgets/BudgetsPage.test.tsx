import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import type { Category } from '@/features/categories/categoriesApi';
import { LAN, resetFake, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';
import type { Budget } from './budgetsApi';

// An in-memory /api/budgets and /api/categories (MSW) with the docs/04 shapes. `spent` is fixed per budget,
// as if the server had summed the month's confirmed expenses.

const monthOf = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
const THIS_MONTH = monthOf(new Date()); // the month the app opens on (uiSlice)
const NEXT_MONTH = (() => {
  const [year = 0, month = 1] = THIS_MONTH.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
})();

const category = (id: string, type: Category['type'], vi: string, isFallback = false): Category => ({
  id,
  type,
  names: { vi, en: vi },
  keywords: [],
  icon: 'Category',
  color: '',
  isFallback,
});
const categories = [
  category('c1', 'expense', 'Ăn uống'),
  category('c2', 'expense', 'Đi lại'),
  category('c3', 'expense', 'Mua sắm'),
  category('c4', 'income', 'Lương'),
  category('c5', 'expense', 'Khác', true),
];

let budgets: Budget[] = [];
let sent: { method: string; url: string; body?: unknown }[] = [];

const budget = (id: string, month: string, categoryId: string | null, limit: number, spent = 0): Budget => ({
  id,
  month,
  categoryId,
  limit,
  spent,
  percent: Math.round((spent * 100) / limit),
});

beforeEach(() => {
  resetFake(LAN, true); // logged in as Lan, UI in Vietnamese
  budgets = [
    budget('b1', THIS_MONTH, 'c1', 1_000_000, 500_000), // 50 % → green
    budget('b2', THIS_MONTH, 'c2', 1_000_000, 900_000), // 90 % → amber
    budget('b3', THIS_MONTH, 'c3', 1_000_000, 800_000), // exactly 80 % → amber
    budget('b0', THIS_MONTH, null, 2_000_000, 2_400_000), // 120 % → red
  ];
  sent = [];
  server.use(
    http.get('*/api/categories', () => HttpResponse.json(categories)),
    // Overall budget first, like the server (it sorts by categoryId, and null comes first).
    http.get('*/api/budgets', ({ request }) => {
      const month = new URL(request.url).searchParams.get('month');
      const list = budgets.filter((b) => b.month === month);
      return HttpResponse.json([...list.filter((b) => !b.categoryId), ...list.filter((b) => b.categoryId)]);
    }),
    http.post('*/api/budgets/copy', async ({ request }) => {
      const body = (await request.json()) as { from: string; to: string };
      sent.push({ method: 'POST', url: '/budgets/copy', body });
      const taken = new Set(budgets.filter((b) => b.month === body.to).map((b) => b.categoryId));
      const copies = budgets.filter((b) => b.month === body.from && !taken.has(b.categoryId));
      budgets.push(...copies.map((b, i) => budget(`copy${i}`, body.to, b.categoryId, b.limit)));
      return HttpResponse.json({ created: copies.length }, { status: 201 });
    }),
    http.post('*/api/budgets', async ({ request }) => {
      const body = (await request.json()) as Pick<Budget, 'month' | 'categoryId' | 'limit'>;
      sent.push({ method: 'POST', url: '/budgets', body });
      const created = budget(`b${budgets.length + 1}`, body.month, body.categoryId, body.limit);
      budgets.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch('*/api/budgets/:id', async ({ request, params }) => {
      const body = (await request.json()) as { limit: number };
      sent.push({ method: 'PATCH', url: `/budgets/${String(params.id)}`, body });
      budgets = budgets.map((b) => (b.id === params.id ? budget(b.id, b.month, b.categoryId, body.limit, b.spent) : b));
      return HttpResponse.json(budgets.find((b) => b.id === params.id));
    }),
    http.delete('*/api/budgets/:id', ({ params }) => {
      sent.push({ method: 'DELETE', url: `/budgets/${String(params.id)}` });
      budgets = budgets.filter((b) => b.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

test('TC-F5-06 budgets screen: a progress bar per budget, with the percent and a text label for its colour', async () => {
  renderApp('/budgets');

  expect(await screen.findByRole('heading', { level: 1, name: 'Ngân sách' })).toBeInTheDocument();
  const cards = await screen.findAllByRole('article');
  expect(cards.map((card) => within(card).getByRole('heading').textContent)).toEqual(['Tổng chi tiêu', 'Ăn uống', 'Đi lại', 'Mua sắm']);

  const food = screen.getByRole('article', { name: 'Ăn uống' });
  expect(food).toHaveTextContent(/Đã chi 500\.000\s₫ \/ 1\.000\.000\s₫ \(50%\)/);
  expect(food).toHaveTextContent('Trong hạn mức');
  expect(food).toHaveTextContent(/Còn 500\.000\s₫/);
  const bar = within(food).getByRole('progressbar', { name: 'Ăn uống' });
  expect(bar).toHaveAttribute('value', '500000');
  expect(bar).toHaveAttribute('max', '1000000');

  expect(screen.getByRole('article', { name: 'Đi lại' })).toHaveTextContent('Sắp hết');
  expect(screen.getByRole('article', { name: 'Mua sắm' })).toHaveTextContent('Sắp hết'); // 80 % is already amber
  const overall = screen.getByRole('article', { name: 'Tổng chi tiêu' });
  expect(overall).toHaveTextContent('Vượt ngân sách');
  expect(overall).toHaveTextContent(/Vượt 400\.000\s₫/);
  expect(within(overall).getByRole('progressbar')).toHaveAttribute('value', '2000000'); // full, not past the end
});

test('TC-F5-06 add validates the limit and offers only categories without a budget; edit changes the limit; delete asks first', async () => {
  const user = userEvent.setup();
  renderApp('/budgets');

  await user.click(await screen.findByRole('button', { name: 'Thêm ngân sách' }));
  const add = await screen.findByRole('dialog', { name: 'Thêm ngân sách' });
  const select = within(add).getByRole('combobox', { name: 'Danh mục' });
  // Overall, Ăn uống, Đi lại and Mua sắm already have one; income categories never do.
  expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Khác']);
  await user.click(within(add).getByRole('button', { name: 'Lưu' }));
  const limit = within(add).getByRole('textbox', { name: 'Hạn mức (₫)' });
  expect(limit).toHaveAccessibleDescription('Nhập số tiền lớn hơn 0, ví dụ 2tr hoặc 2.000.000');
  expect(limit).toHaveFocus();
  expect(sent).toEqual([]);

  await user.type(limit, '300k');
  await user.click(within(add).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent).toEqual([{ method: 'POST', url: '/budgets', body: { month: THIS_MONTH, categoryId: 'c5', limit: 300_000 } }]);
  expect(await screen.findByRole('article', { name: 'Khác' })).toHaveTextContent(/Đã chi 0\s₫ \/ 300\.000\s₫ \(0%\)/);

  const food = screen.getByRole('article', { name: 'Ăn uống' });
  await user.click(within(food).getByRole('button', { name: 'Sửa ngân sách Ăn uống' }));
  const edit = await screen.findByRole('dialog', { name: 'Sửa ngân sách' });
  expect(within(edit).queryByRole('combobox')).not.toBeInTheDocument(); // month and category are what the budget is
  const editLimit = within(edit).getByRole('textbox', { name: 'Hạn mức (₫)' });
  expect(editLimit).toHaveValue('1.000.000');
  await user.clear(editLimit);
  await user.type(editLimit, '1tr5');
  await user.click(within(edit).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent.at(-1)).toEqual({ method: 'PATCH', url: '/budgets/b1', body: { limit: 1_500_000 } });
  await waitFor(() => expect(screen.getByRole('article', { name: 'Ăn uống' })).toHaveTextContent(/\/ 1\.500\.000\s₫ \(33%\)/));

  await user.click(within(screen.getByRole('article', { name: 'Đi lại' })).getByRole('button', { name: 'Xoá ngân sách Đi lại' }));
  const confirm = await screen.findByRole('dialog', { name: 'Xoá ngân sách?' });
  await user.click(within(confirm).getByRole('button', { name: 'Xoá' }));
  await waitFor(() => expect(screen.queryByRole('article', { name: 'Đi lại' })).not.toBeInTheDocument());
  expect(sent.at(-1)).toEqual({ method: 'DELETE', url: '/budgets/b2' });
});

test('TC-F5-06 an empty month: add an overall budget, then copy the rest from last month', async () => {
  const user = userEvent.setup();
  renderApp('/budgets');

  await screen.findByRole('article', { name: 'Ăn uống' });
  await user.click(screen.getByRole('button', { name: 'Tháng sau' })); // the shared MonthPicker
  expect(await screen.findByRole('heading', { name: 'Tháng này chưa có ngân sách' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Thêm ngân sách' }));
  const add = await screen.findByRole('dialog', { name: 'Thêm ngân sách' });
  expect(within(add).getByRole('combobox', { name: 'Danh mục' })).toHaveDisplayValue('Tổng chi tiêu (mọi danh mục)');
  await user.type(within(add).getByRole('textbox', { name: 'Hạn mức (₫)' }), '2tr');
  await user.click(within(add).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent).toEqual([{ method: 'POST', url: '/budgets', body: { month: NEXT_MONTH, categoryId: null, limit: 2_000_000 } }]);

  await user.click(await screen.findByRole('button', { name: 'Chép từ tháng trước' }));
  expect(await screen.findByText('Đã chép ngân sách: 3')).toBeInTheDocument(); // the overall budget was already there
  expect(sent.at(-1)).toEqual({ method: 'POST', url: '/budgets/copy', body: { from: THIS_MONTH, to: NEXT_MONTH } });
  expect(await screen.findByRole('article', { name: 'Ăn uống' })).toHaveTextContent(/Đã chi 0\s₫ \/ 1\.000\.000\s₫/);
  expect(screen.getAllByRole('article')).toHaveLength(4);
});

test('TC-F4-13 a budget limit over 10^13 ₫ is marked at the field with the maximum, and nothing is sent (BUG-032)', async () => {
  const user = userEvent.setup();
  renderApp('/budgets');

  await user.click(await screen.findByRole('button', { name: 'Thêm ngân sách' }));
  const add = await screen.findByRole('dialog', { name: 'Thêm ngân sách' });
  const limit = within(add).getByRole('textbox', { name: 'Hạn mức (₫)' });
  await user.type(limit, '10000001tr');
  await user.click(within(add).getByRole('button', { name: 'Lưu' }));

  expect(limit).toHaveAccessibleDescription(/^Tối đa 10\.000\.000\.000\.000\s₫$/);
  expect(limit).toHaveFocus();
  expect(sent).toEqual([]);
});
