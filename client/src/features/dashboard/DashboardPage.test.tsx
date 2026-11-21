import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import type { Category } from '@/features/categories/categoriesApi';
import type { Transaction } from '@/features/transactions/transactionsApi';
import { LAN, resetFake, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';
import type { CategoryTotal, DayTotal, MonthSummary } from './statsApi';

// An in-memory /api/stats, /transactions, /categories and /wallets (MSW) with the docs/04 shapes.
// This month has numbers; every other month is empty and has no overall budget.

const THIS_MONTH = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);

const category = (id: string, vi: string): Category => ({ id, type: 'expense', names: { vi, en: vi }, keywords: [], icon: 'Category', color: '', isFallback: false });
const categories = [category('c1', 'Ăn uống'), category('c2', 'Đi lại')];

const summary: MonthSummary = { income: 15_000_000, expense: 2_400_000, net: 12_600_000, budget: { limit: 3_000_000, spent: 2_400_000 } };
const byCategory: CategoryTotal[] = [
  { categoryId: 'c1', name: 'Ăn uống', total: 1_500_000, percent: 63 },
  { categoryId: 'c2', name: 'Đi lại', total: 900_000, percent: 38 },
];
const daily = (month: string, rows: Record<number, Partial<DayTotal>> = {}): DayTotal[] =>
  Array.from({ length: 30 }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, '0')}`, income: 0, expense: 0, ...rows[i + 1] }));

const tx = (id: string, amount: number, note: string, status: Transaction['status'] = 'confirmed'): Transaction => ({
  id,
  type: 'expense',
  amount,
  walletId: 'w1',
  categoryId: 'c1',
  occurredAt: `${THIS_MONTH}-12T05:00:00.000Z`,
  note,
  status,
  source: status === 'draft' ? 'telegram' : 'web',
});
const confirmed = Array.from({ length: 7 }, (_, i) => tx(`t${i + 1}`, (i + 1) * 10_000, `món ${i + 1}`));
const drafts = [tx('d1', 32_000, 'grab', 'draft'), tx('d2', 50_000, 'cafe', 'draft')];

let statsMonths: string[] = []; // the month of every /stats request, in order

beforeEach(() => {
  resetFake(LAN, true); // logged in as Lan, UI in Vietnamese
  statsMonths = [];
  const monthOf = (request: Request) => {
    const month = new URL(request.url).searchParams.get('month') ?? '';
    statsMonths.push(month);
    return month;
  };
  server.use(
    http.get('*/api/wallets', () => HttpResponse.json([])),
    http.get('*/api/categories', () => HttpResponse.json(categories)),
    http.get('*/api/stats/summary', ({ request }) =>
      HttpResponse.json(monthOf(request) === THIS_MONTH ? summary : { income: 0, expense: 0, net: 0, budget: null }),
    ),
    http.get('*/api/stats/by-category', ({ request }) => HttpResponse.json(monthOf(request) === THIS_MONTH ? byCategory : [])),
    http.get('*/api/stats/daily', ({ request }) => {
      const month = monthOf(request);
      return HttpResponse.json(month === THIS_MONTH ? daily(month, { 1: { income: 15_000_000 }, 12: { expense: 2_000_000 }, 20: { expense: 400_000 } }) : daily(month));
    }),
    http.get('*/api/transactions', ({ request }) => {
      const status = new URL(request.url).searchParams.get('status');
      const items = status === 'draft' ? drafts : confirmed;
      return HttpResponse.json({ items, page: 1, limit: 20, total: items.length });
    }),
  );
});

test('TC-F6-05 dashboard: greeting, four month cards, charts with text summaries, drafts banner, latest 5', async () => {
  renderApp('/');

  expect(await screen.findByRole('heading', { level: 1, name: 'Xin chào, Lan' })).toBeInTheDocument();
  expect(await screen.findByRole('article', { name: 'Thu nhập' })).toHaveTextContent(/15\.000\.000\s₫/);
  expect(screen.getByRole('article', { name: 'Chi tiêu' })).toHaveTextContent(/2\.400\.000\s₫/);
  expect(screen.getByRole('article', { name: 'Chênh lệch (thu − chi)' })).toHaveTextContent(/12\.600\.000\s₫/);
  const budget = screen.getByRole('article', { name: 'Ngân sách còn lại' });
  expect(budget).toHaveTextContent(/600\.000\s₫/);
  expect(budget).toHaveTextContent(/Hạn mức 3\.000\.000\s₫/);

  const pie = screen.getByRole('figure', { name: 'Chi tiêu theo danh mục' });
  expect(within(pie).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    expect.stringMatching(/^Ăn uống: 1\.500\.000\s₫ \(63%\)$/),
    expect.stringMatching(/^Đi lại: 900\.000\s₫ \(38%\)$/),
  ]);
  // This month against last month in weekly columns (TC-NF-14): day 12 is in week 2, day 20 in week 3.
  const compare = screen.getByRole('figure', { name: 'Chi tiêu tháng này' });
  expect(compare).toHaveTextContent(/Tháng này chi 2\.400\.000\s₫, nhiều hơn tháng trước 2\.400\.000\s₫\. Tuần cao nhất: tuần 2, 2\.000\.000\s₫\./);
  await userEvent.setup().click(within(compare).getByRole('button', { name: 'Thu nhập' }));
  expect(screen.getByRole('figure', { name: 'Thu nhập tháng này' })).toHaveTextContent(/Tháng này thu 15\.000\.000\s₫.*Tuần cao nhất: tuần 1, 15\.000\.000\s₫\./);

  expect(await screen.findByText('Có 2 giao dịch nháp đang chờ xác nhận.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Xem các bản nháp' })).toHaveAttribute('href', '/bot');

  const latest = await screen.findByRole('list', { name: 'Giao dịch gần đây' });
  expect(within(latest).getAllByRole('listitem')).toHaveLength(5);
  expect(latest).toHaveTextContent(/món 1.*−10\.000\s₫/);
  expect(screen.getByRole('link', { name: 'Xem tất cả' })).toHaveAttribute('href', '/transactions');
});

test('TC-F6-05 switching the month reloads the cards and charts; an empty month says so and offers to set a budget', async () => {
  const user = userEvent.setup();
  renderApp('/');

  expect(await screen.findByRole('article', { name: 'Thu nhập' })).toHaveTextContent(/15\.000\.000\s₫/);
  await user.click(screen.getByRole('button', { name: 'Tháng trước' }));

  await waitFor(() => expect(screen.getByRole('article', { name: 'Thu nhập' })).toHaveTextContent(/^Thu nhập0\s₫$/));
  expect(statsMonths.at(-1)).not.toBe(THIS_MONTH);
  const budget = screen.getByRole('article', { name: 'Ngân sách còn lại' });
  expect(budget).toHaveTextContent('Chưa đặt ngân sách tổng');
  expect(within(budget).getByRole('link', { name: 'Đặt hạn mức' })).toHaveAttribute('href', '/budgets');
  expect(screen.getByRole('figure', { name: 'Chi tiêu theo danh mục' })).toHaveTextContent('Tháng này chưa có khoản chi nào.');
  expect(screen.getByRole('figure', { name: 'Chi tiêu tháng này' })).toHaveTextContent('Hai tháng này chưa có giao dịch nào.');
});

test('TC-F6-05 a failed statistics request shows a translated error with Retry', async () => {
  let fail = true;
  server.use(
    http.get('*/api/stats/summary', () =>
      fail ? HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 }) : HttpResponse.json(summary),
    ),
  );
  const user = userEvent.setup();
  renderApp('/');

  const alert = await screen.findByText('Không tải được số liệu của tháng.');
  fail = false;
  await user.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('article', { name: 'Thu nhập' })).toHaveTextContent(/15\.000\.000\s₫/);
  expect(screen.queryByText('Không tải được số liệu của tháng.')).not.toBeInTheDocument();
});
