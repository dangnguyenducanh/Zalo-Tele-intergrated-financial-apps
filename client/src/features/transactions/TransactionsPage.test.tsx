import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import type { Category } from '@/features/categories/categoriesApi';
import type { Wallet } from '@/features/wallets/walletsApi';
import { LAN, resetFake, server } from '@/test/fakeApi';
import { api } from '@/app/api';
import { renderApp } from '@/test/renderApp';
import type { Transaction } from './transactionsApi';

// An in-memory /api/transactions, /wallets and /categories (MSW) with the docs/04 shapes.
// The parse handler is a tiny stand-in for the server parser: "<words> <n>k [mm]", one draft per line.

const NOW = '2026-11-20T05:00:00.000Z'; // 12:00 in Vietnam

const wallets: Wallet[] = [
  { id: 'w1', name: 'Tiền mặt', type: 'cash', initialBalance: 0, balance: 0, aliases: ['tm'], color: '', icon: '', archived: false },
  { id: 'w2', name: 'Momo', type: 'ewallet', initialBalance: 0, balance: 0, aliases: ['mm'], color: '', icon: '', archived: false },
  { id: 'w3', name: 'Thẻ cũ', type: 'credit', initialBalance: 0, balance: 0, aliases: [], color: '', icon: '', archived: true },
];
const category = (id: string, type: Category['type'], vi: string, en: string, isFallback = false): Category => ({
  id,
  type,
  names: { vi, en },
  keywords: [],
  icon: 'Category',
  color: '',
  isFallback,
});
const categories = [
  category('c1', 'expense', 'Ăn uống', 'Food & drinks'),
  category('c2', 'expense', 'Khác', 'Other', true),
  category('c3', 'income', 'Lương', 'Salary'),
];

let transactions: (Transaction & { deleted?: boolean })[] = [];
let sent: { method: string; url: string; body?: unknown }[] = [];
let listQueries: URLSearchParams[] = [];
let parseCalls: string[] = [];

const tx = (fields: Partial<Transaction> & Pick<Transaction, 'id' | 'amount' | 'note'>): Transaction => ({
  type: 'expense',
  walletId: 'w1',
  categoryId: 'c1',
  occurredAt: NOW,
  status: 'confirmed',
  source: 'web',
  ...fields,
});

function parseLine(line: string) {
  const amount = line.match(/(\d+)k\b/);
  if (!amount) return null;
  const words = line.split(/\s+/).filter((word) => word !== amount[0] && word !== 'mm');
  return {
    type: 'expense',
    amount: Number(amount[1]) * 1000,
    categoryId: /phở|cafe|bún/.test(line) ? 'c1' : 'c2',
    walletId: / mm\b/.test(line) ? 'w2' : 'w1',
    occurredAt: NOW,
    note: words.join(' '),
  };
}

beforeEach(() => {
  resetFake(LAN, true); // logged in as Lan, UI in Vietnamese
  transactions = [
    tx({ id: 't1', amount: 45000, note: 'phở' }),
    tx({ id: 't2', type: 'income', amount: 15000000, categoryId: 'c3', note: 'lương tháng 11' }),
    tx({ id: 't3', amount: 32000, categoryId: 'c2', walletId: 'w2', note: 'grab', status: 'draft', source: 'telegram' }),
  ];
  sent = [];
  listQueries = [];
  parseCalls = [];
  server.use(
    http.get('*/api/wallets', () => HttpResponse.json(wallets)),
    http.get('*/api/categories', () => HttpResponse.json(categories)),
    http.get('*/api/transactions', ({ request }) => {
      const query = new URL(request.url).searchParams;
      listQueries.push(query);
      const shown = transactions.filter(
        (t) =>
          !t.deleted &&
          ['type', 'walletId', 'categoryId', 'status'].every((key) => !query.get(key) || t[key as keyof Transaction] === query.get(key)) &&
          t.note.includes(query.get('q') ?? ''),
      );
      return HttpResponse.json({ items: shown, page: Number(query.get('page') ?? 1), limit: 20, total: shown.length });
    }),
    http.post('*/api/transactions/parse', async ({ request }) => {
      const { text } = (await request.json()) as { text: string };
      parseCalls.push(text);
      const lines = text.split('\n');
      const results = lines.slice(0, 10).map(parseLine); // like the server: 10 lines at most
      const drafts = results.filter(Boolean);
      if (drafts.length === 0) return HttpResponse.json({ error: { code: 'NO_AMOUNT_FOUND', message: 'no amount' } }, { status: 422 });
      const noAmountLines = results.flatMap((result, i) => (result ? [] : [i + 1]));
      return HttpResponse.json({ drafts, noAmountLines, truncated: lines.length > 10 });
    }),
    http.post('*/api/transactions', async ({ request }) => {
      const body = (await request.json()) as Transaction;
      sent.push({ method: 'POST', url: '/transactions', body });
      const created = tx({ ...body, id: `t${transactions.length + 1}` });
      transactions.unshift(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch('*/api/transactions/:id', async ({ request, params }) => {
      const body = (await request.json()) as Partial<Transaction>;
      sent.push({ method: 'PATCH', url: `/transactions/${params.id}`, body });
      transactions = transactions.map((t) => (t.id === params.id ? { ...t, ...body } : t));
      return HttpResponse.json(transactions.find((t) => t.id === params.id));
    }),
    http.delete('*/api/transactions/:id', ({ params }) => {
      sent.push({ method: 'DELETE', url: `/transactions/${params.id}` });
      transactions = transactions.map((t) => (t.id === params.id ? { ...t, deleted: true } : t));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('*/api/transactions/:id/restore', ({ params }) => {
      sent.push({ method: 'POST', url: `/transactions/${params.id}/restore` });
      transactions = transactions.map((t) => (t.id === params.id ? { ...t, deleted: false } : t));
      return HttpResponse.json(transactions.find((t) => t.id === params.id));
    }),
  );
});

const posted = () => sent.filter((s) => s.method === 'POST' && s.url === '/transactions').map((s) => s.body);
const quickAdd = () => screen.getByRole('textbox', { name: 'Thêm nhanh' });

test('TC-F4-10 lists transactions with category, wallet, signed amount; drafts are marked', async () => {
  renderApp('/transactions');

  expect(await screen.findByRole('heading', { level: 1, name: 'Giao dịch' })).toBeInTheDocument();
  const pho = await screen.findByRole('row', { name: /phở/ });
  await waitFor(() => expect(pho).toHaveTextContent('Ăn uống')); // names come from /categories and /wallets
  expect(pho).toHaveTextContent('Tiền mặt');
  expect(pho).toHaveTextContent(/−45\.000\s₫/);
  expect(screen.getByRole('row', { name: /lương tháng 11/ })).toHaveTextContent(/\+15\.000\.000\s₫/);
  expect(screen.getByRole('row', { name: /grab/ })).toHaveTextContent('Nháp');
  expect(screen.getByText('Tổng: 3 giao dịch')).toBeInTheDocument();
});

test('TC-F4-10 filters come from the URL query string and changes are written back to it', async () => {
  const user = userEvent.setup();
  const { router } = renderApp('/transactions?type=income');

  const filters = await screen.findByRole('search', { name: 'Bộ lọc giao dịch' });
  expect(within(filters).getByRole('combobox', { name: 'Loại' })).toHaveValue('income');
  expect(await screen.findByRole('row', { name: /lương tháng 11/ })).toBeInTheDocument();
  expect(screen.queryByRole('row', { name: /phở/ })).not.toBeInTheDocument();
  expect(listQueries.at(-1)?.get('type')).toBe('income');

  await user.selectOptions(within(filters).getByRole('combobox', { name: 'Loại' }), 'Tất cả');
  await user.selectOptions(within(filters).getByRole('combobox', { name: 'Ví' }), 'Momo');
  expect(router.state.location.search).toBe('?walletId=w2');
  expect(await screen.findByRole('row', { name: /grab/ })).toBeInTheDocument();

  await user.type(within(filters).getByRole('searchbox', { name: 'Tìm theo ghi chú' }), 'gr');
  expect(router.state.location.search).toBe('?walletId=w2&q=gr');
  await waitFor(() => expect(listQueries.at(-1)?.get('q')).toBe('gr')); // after the typing pause, not per key
  expect(listQueries.filter((q) => q.get('q') === 'g')).toEqual([]);

  await user.click(within(filters).getByRole('button', { name: 'Xoá bộ lọc' }));
  expect(router.state.location.search).toBe('');
  expect(await screen.findByRole('row', { name: /phở/ })).toBeInTheDocument();
});

test('TC-F4-10 add with the 45k shortcut and Vietnam time, then edit the amount; the table updates each time', async () => {
  const user = userEvent.setup();
  renderApp('/transactions');
  await screen.findByRole('row', { name: /phở/ });

  await user.click(screen.getByRole('button', { name: 'Thêm giao dịch' }));
  const dialog = await screen.findByRole('dialog', { name: 'Thêm giao dịch' });
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  const amount = within(dialog).getByRole('textbox', { name: 'Số tiền (₫)' });
  expect(amount).toHaveAccessibleDescription('Nhập số tiền lớn hơn 0, ví dụ 45000 hoặc 45k');
  expect(amount).toHaveFocus();
  expect(posted()).toEqual([]);

  await user.type(amount, '45k');
  expect(amount).toHaveAccessibleDescription(/45\.000\s₫/); // the shortcut, read back
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Danh mục' }), 'Ăn uống');
  expect(within(dialog).getByRole('combobox', { name: 'Ví' })).toHaveValue('w1'); // Lan's first wallet
  fireEvent.change(within(dialog).getByLabelText(/^Thời gian/), { target: { value: '2026-11-20T12:30' } });
  await user.type(within(dialog).getByRole('textbox', { name: 'Ghi chú' }), 'bún chả');
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(posted()).toEqual([
    { type: 'expense', amount: 45000, categoryId: 'c1', walletId: 'w1', occurredAt: '2026-11-20T12:30:00+07:00', note: 'bún chả' },
  ]);
  expect(await screen.findByRole('row', { name: /bún chả/ })).toHaveTextContent(/−45\.000\s₫/);

  await user.click(screen.getByRole('button', { name: 'Sửa giao dịch bún chả' }));
  const edit = await screen.findByRole('dialog', { name: 'Sửa giao dịch' });
  const editAmount = within(edit).getByRole('textbox', { name: 'Số tiền (₫)' });
  expect(editAmount).toHaveValue('45.000'); // thousand separators
  await user.clear(editAmount);
  await user.type(editAmount, '50k');
  await user.click(within(edit).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent.at(-1)).toMatchObject({ method: 'PATCH', url: '/transactions/t4', body: { amount: 50000 } });
  await waitFor(() => expect(screen.getByRole('row', { name: /bún chả/ })).toHaveTextContent(/−50\.000\s₫/));
});

test('TC-F4-10 delete hides the row and the snackbar Undo restores it', async () => {
  const user = userEvent.setup();
  renderApp('/transactions');

  await user.click(await screen.findByRole('button', { name: 'Xoá giao dịch phở' }));
  await waitFor(() => expect(screen.queryByRole('row', { name: /phở/ })).not.toBeInTheDocument());
  expect(screen.getByText('Đã xoá giao dịch')).toBeInTheDocument();
  // The focused delete button left with its row, so focus goes to Undo (not <body>) and back to the heading after.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hoàn tác' })).toHaveFocus());

  await user.keyboard('{Enter}');
  expect(await screen.findByRole('row', { name: /phở/ })).toBeInTheDocument();
  expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual(['DELETE /transactions/t1', 'POST /transactions/t1/restore']);
  expect(screen.getByRole('heading', { level: 1, name: 'Giao dịch' })).toHaveFocus();
});

test('TC-F4-10 a page past the last one (its rows were deleted) goes back to the last page', async () => {
  server.use(
    http.get('*/api/transactions', ({ request }) => {
      const page = new URL(request.url).searchParams.get('page');
      if (page === '2') return HttpResponse.json({ items: [], page: 2, limit: 20, total: 3 });
    }),
  );
  const { router } = renderApp('/transactions?page=2');

  expect(await screen.findByRole('row', { name: /phở/ })).toBeInTheDocument();
  expect(router.state.location.search).toBe('?page=1');
});

test('TC-F13-04 quick add previews after a typing pause and Enter saves; the row appears', async () => {
  const user = userEvent.setup();
  renderApp('/transactions');
  await screen.findByRole('row', { name: /grab/ });

  await user.type(quickAdd(), 'phở 45k');
  const preview = await screen.findByRole('list', { name: 'Xem trước' });
  expect(within(preview).getByRole('button', { name: /Đổi −45\.000\s₫/ })).toBeInTheDocument();
  expect(within(preview).getByRole('button', { name: 'Đổi Ăn uống' })).toBeInTheDocument();
  expect(within(preview).getByRole('button', { name: 'Đổi Tiền mặt' })).toBeInTheDocument();
  expect(parseCalls).toEqual(['phở 45k']); // once, after the pause; not once per key
  expect(posted()).toEqual([]); // the preview saves nothing

  await user.keyboard('{Enter}');
  await waitFor(() => expect(quickAdd()).toHaveValue(''));
  expect(posted()).toEqual([{ type: 'expense', amount: 45000, categoryId: 'c1', walletId: 'w1', occurredAt: NOW, note: 'phở' }]);
  expect(await screen.findByText('Đã lưu giao dịch: 1')).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole('row', { name: /phở/ })).toHaveLength(2));
});

test('TC-F13-04 quick add: a second Enter while the first is still parsing saves the line only once', async () => {
  server.use(http.post('*/api/transactions/parse', () => delay(150))); // a slow parse, then the normal handler
  const user = userEvent.setup();
  renderApp('/transactions');
  await screen.findByRole('row', { name: /grab/ });

  await user.type(quickAdd(), 'phở 45k{Enter}{Enter}');
  await user.click(screen.getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(quickAdd()).toHaveValue(''));
  expect(posted()).toHaveLength(1);
});

test('TC-F13-04 quick add: a wallet or category change re-parses the same text (no stale ids)', async () => {
  const user = userEvent.setup();
  const { store } = renderApp('/transactions');

  await user.type(await screen.findByRole('textbox', { name: 'Thêm nhanh' }), 'cafe 30k mm');
  await screen.findByRole('list', { name: 'Xem trước' });
  const calls = () => parseCalls.filter((text) => text === 'cafe 30k mm');
  expect(calls()).toHaveLength(1);
  store.dispatch(api.util.invalidateTags(['Wallet'])); // e.g. the alias "mm" was just added
  await waitFor(() => expect(calls()).toHaveLength(2));
});

test('TC-F13-04 quick add: no amount → inline error in the user language, nothing saved', async () => {
  const user = userEvent.setup();
  renderApp('/transactions');

  await user.type(await screen.findByRole('textbox', { name: 'Thêm nhanh' }), 'abc{Enter}');
  await waitFor(() => expect(quickAdd()).toHaveAccessibleDescription('Không tìm thấy số tiền. Ví dụ: "phở 45k".'));
  expect(quickAdd()).toHaveAttribute('aria-invalid', 'true');
  expect(quickAdd()).toHaveValue('abc');
  expect(posted()).toEqual([]);
});

test('TC-F13-04 quick add: several pasted lines save several transactions, in order', async () => {
  const user = userEvent.setup();
  renderApp('/transactions');

  await user.click(await screen.findByRole('textbox', { name: 'Thêm nhanh' }));
  await user.paste('phở 45k\ncafe 30k mm\nxăng 50k');
  expect(within(await screen.findByRole('list', { name: 'Xem trước' })).getAllByRole('listitem')).toHaveLength(3);
  await user.keyboard('{Enter}');

  await waitFor(() => expect(posted()).toHaveLength(3));
  expect(posted()).toMatchObject([
    { amount: 45000, note: 'phở' },
    { amount: 30000, walletId: 'w2', note: 'cafe' },
    { amount: 50000, categoryId: 'c2', note: 'xăng' },
  ]);
  expect(await screen.findByText('Đã lưu giao dịch: 3')).toBeInTheDocument();
});

test('TC-F13-06 quick add names a line with no amount, or past the 10th, and saves nothing until it is fixed (BUG-017)', async () => {
  const user = userEvent.setup();
  renderApp('/transactions');

  await user.click(await screen.findByRole('textbox', { name: 'Thêm nhanh' }));
  await user.paste('phở 45k\ncafe không tiền\ngrab 30k');
  expect(within(await screen.findByRole('list', { name: 'Xem trước' })).getAllByRole('listitem')).toHaveLength(2);
  await waitFor(() => expect(quickAdd()).toHaveAccessibleDescription('Dòng 2 không có số tiền. Hãy sửa hoặc xoá dòng đó rồi lưu.'));
  await user.keyboard('{Enter}');
  await waitFor(() => expect(quickAdd()).toHaveAttribute('aria-invalid', 'true'));
  expect(quickAdd()).toHaveValue('phở 45k\ncafe không tiền\ngrab 30k'); // nothing the user typed is lost
  expect(posted()).toEqual([]);

  await user.clear(quickAdd());
  await user.paste(Array.from({ length: 11 }, (_, i) => `món ${i + 1}k`).join('\n'));
  await waitFor(() => expect(quickAdd()).toHaveAccessibleDescription('Mỗi lần chỉ lưu được 10 dòng. Hãy lưu phần còn lại sau.'));
  await user.keyboard('{Enter}');
  await waitFor(() => expect(quickAdd()).toHaveAttribute('aria-invalid', 'true'));
  expect(posted()).toEqual([]);
});

const QUESTION_CHIP = 'Đây là câu hỏi · Hỏi Sổ chi tiêu ›'; // docs/05 §5.10.2: pressing it opens the drawer and sends the text

// The server answers a question like this (docs/04 §4.4); the stand-in recognises "bao nhiêu" and "?" and lets every other text fall
// through to the parse handler of beforeEach.
function answerQuestions() {
  server.use(
    http.post('*/api/transactions/parse', async ({ request }) => {
      const { text } = (await request.clone().json()) as { text: string };
      if (!/bao nhiêu|how much|\?$/.test(text)) return undefined;
      parseCalls.push(text);
      return HttpResponse.json({ question: true, drafts: [], noAmountLines: [], truncated: false });
    }),
  );
}

test('TC-F13-09 quick add: a question shows a notice instead of the preview; Enter, Save, Shift+Enter and the full-form button save and open nothing', async () => {
  answerQuestions();
  const user = userEvent.setup();
  renderApp('/transactions');
  await screen.findByRole('row', { name: /grab/ });

  await user.type(quickAdd(), 'tháng 10 thu bao nhiêu');
  expect(await screen.findByRole('button', { name: QUESTION_CHIP })).toBeInTheDocument(); // T51: the notice is the drawer's chip
  expect(screen.queryByRole('list', { name: 'Xem trước' })).not.toBeInTheDocument();
  expect(quickAdd()).toHaveAccessibleDescription('Câu hỏi không được lưu thành giao dịch: Enter và Lưu không lưu gì.');
  expect(quickAdd()).not.toHaveAttribute('aria-invalid', 'true');

  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: 'Lưu' }));
  await user.click(quickAdd());
  await user.keyboard('{Shift>}{Enter}{/Shift}');
  await user.click(screen.getByRole('button', { name: 'Mở form đầy đủ' }));
  await new Promise((resolve) => setTimeout(resolve, 50)); // let any wrongly started save or form show itself
  expect(posted()).toEqual([]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // no form with the question as its note
  expect(quickAdd()).toHaveValue('tháng 10 thu bao nhiêu'); // the box is not cleared
  expect(screen.queryByText(/Đã lưu giao dịch/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: QUESTION_CHIP })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // Enter and Save never open the drawer: only the chip does

  // Typing on makes it a capture again: the notice goes, the preview comes back, and Enter saves.
  await user.clear(quickAdd());
  await user.type(quickAdd(), 'phở 45k');
  expect(await screen.findByRole('list', { name: 'Xem trước' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: QUESTION_CHIP })).not.toBeInTheDocument();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(posted()).toHaveLength(1));
});

test('TC-F13-09 quick add: Enter pressed before the preview has settled saves nothing for a question either, and the box keeps its text', async () => {
  answerQuestions();
  const user = userEvent.setup();
  renderApp('/transactions');
  await screen.findByRole('row', { name: /grab/ });

  await user.type(quickAdd(), 'hôm nay ăn gì?{Enter}');
  expect(await screen.findByRole('button', { name: QUESTION_CHIP })).toBeInTheDocument();
  expect(posted()).toEqual([]);
  expect(quickAdd()).toHaveValue('hôm nay ăn gì?');
  expect(screen.queryByText(/Đã lưu giao dịch/)).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('TC-F13-09 quick add: the question chip and its hint are in English too', async () => {
  resetFake({ ...LAN, language: 'en' }, true);
  answerQuestions();
  const user = userEvent.setup();
  renderApp('/transactions');
  const box = await screen.findByRole('textbox', { name: 'Quick add' });

  await user.type(box, 'how much did I spend in October');
  expect(await screen.findByRole('button', { name: 'This is a question · Ask Sổ chi tiêu ›' })).toBeInTheDocument();
  expect(box).toHaveAccessibleDescription('A question is not saved as a transaction: Enter and Save store nothing.');
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: 'Open full form' }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(posted()).toEqual([]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

// The server's answer for "phở 450\ncafe 45k": a typo hint on the first line, a repeat hint on the second (docs/02 §2.11.2, A6).
function answerWithHints() {
  server.use(
    http.post('*/api/transactions/parse', () =>
      HttpResponse.json({
        drafts: [
          { type: 'expense', amount: 450000, categoryId: 'c1', walletId: 'w1', occurredAt: NOW, note: 'phở', hints: [{ code: 'big', times: 8, median: 55000 }, { code: 'duplicate' }] },
          { type: 'expense', amount: 45000, categoryId: 'c1', walletId: 'w1', occurredAt: NOW, note: 'cafe' },
        ],
        noAmountLines: [],
        truncated: false,
      }),
    ),
  );
}

test('TC-F14-56 quick add: a draft the server flags shows its check lines under its chips; Enter still saves it, without the hints', async () => {
  answerWithHints();
  const user = userEvent.setup();
  renderApp('/transactions');
  await screen.findByRole('row', { name: /grab/ });

  await user.type(quickAdd(), 'phở 450');
  const preview = await screen.findByRole('list', { name: 'Xem trước' });
  const rows = within(preview).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent(/Lớn gấp 8 lần khoản Ăn uống thường ngày \(55\.000\s₫\)\. Gõ nhầm\?/);
  expect(rows[0]).toHaveTextContent('Giống một khoản Ăn uống vừa nhập trong 10 phút qua. Nhập trùng?');
  expect(rows[1]).not.toHaveTextContent('Lớn gấp'); // the second line has no hints
  expect(rows[1]).not.toHaveTextContent('Giống một khoản');

  await user.keyboard('{Enter}');
  await waitFor(() => expect(quickAdd()).toHaveValue(''));
  expect(posted()).toEqual([
    { type: 'expense', amount: 450000, categoryId: 'c1', walletId: 'w1', occurredAt: NOW, note: 'phở' }, // hints are not data to save
    { type: 'expense', amount: 45000, categoryId: 'c1', walletId: 'w1', occurredAt: NOW, note: 'cafe' },
  ]);
});

test('TC-F14-56 quick add: the check lines are in English too, with the category named in English', async () => {
  resetFake({ ...LAN, language: 'en' }, true);
  answerWithHints();
  const user = userEvent.setup();
  renderApp('/transactions');
  const box = await screen.findByRole('textbox', { name: 'Quick add' });

  await user.type(box, 'pho 450');
  const preview = await screen.findByRole('list', { name: 'Preview' });
  expect(within(preview).getAllByRole('listitem')[0]).toHaveTextContent(/8 times your usual Food & drinks amount \(₫55,000\)\. A typo\?/);
  expect(within(preview).getAllByRole('listitem')[0]).toHaveTextContent('Same amount as a recent Food & drinks entry in the last 10 minutes. Entered twice?');
});

test('TC-F13-04 quick add: a chip changes the draft before saving; Shift+Enter opens the full form pre-filled', async () => {
  const user = userEvent.setup();
  renderApp('/transactions');

  await user.type(await screen.findByRole('textbox', { name: 'Thêm nhanh' }), 'phở 45k');
  await user.click(await screen.findByRole('button', { name: 'Đổi Tiền mặt' }));
  const draft = await screen.findByRole('dialog', { name: 'Sửa dòng thêm nhanh' });
  expect(within(draft).getByRole('textbox', { name: 'Số tiền (₫)' })).toHaveValue('45.000');
  await user.selectOptions(within(draft).getByRole('combobox', { name: 'Ví' }), 'Momo');
  await user.click(within(draft).getByRole('button', { name: 'Áp dụng' }));
  expect(await screen.findByRole('button', { name: 'Đổi Momo' })).toBeInTheDocument();
  expect(posted()).toEqual([]); // "Apply" only changes the preview

  await user.click(quickAdd());
  await user.keyboard('{Enter}');
  await waitFor(() => expect(posted()).toEqual([expect.objectContaining({ amount: 45000, walletId: 'w2', note: 'phở' })]));

  await user.type(quickAdd(), 'cafe 30k');
  await user.keyboard('{Shift>}{Enter}{/Shift}');
  const form = await screen.findByRole('dialog', { name: 'Thêm giao dịch' });
  expect(within(form).getByRole('textbox', { name: 'Số tiền (₫)' })).toHaveValue('30.000');
  expect(within(form).getByRole('combobox', { name: 'Danh mục' })).toHaveValue('c1');
  expect(within(form).getByRole('textbox', { name: 'Ghi chú' })).toHaveValue('cafe');
  await user.click(within(form).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(posted()).toHaveLength(2));
  expect(posted()[1]).toEqual({ type: 'expense', amount: 30000, categoryId: 'c1', walletId: 'w1', occurredAt: NOW, note: 'cafe' }); // time untouched → exact
  expect(quickAdd()).toHaveValue('');
});

test('TC-F4-13 an amount over 10^13 ₫ is marked at the field with the maximum, and nothing is sent (BUG-032)', async () => {
  const user = userEvent.setup();
  renderApp('/transactions');
  await screen.findByRole('row', { name: /phở/ });

  await user.click(screen.getByRole('button', { name: 'Thêm giao dịch' }));
  const dialog = await screen.findByRole('dialog', { name: 'Thêm giao dịch' });
  const amount = within(dialog).getByRole('textbox', { name: 'Số tiền (₫)' });
  await user.type(amount, '10000000000001');
  await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Danh mục' }), 'Ăn uống');
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));

  expect(amount).toHaveAccessibleDescription(/^Tối đa 10\.000\.000\.000\.000\s₫$/);
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  expect(amount).toHaveFocus();
  expect(posted()).toEqual([]);
});

// The drawer's own requests (docs/04 §4.4 Assistant): an empty thread, and one canned answer to every question.
function serveAssistant(chats: { message: string; month?: string; requestId: string }[]) {
  server.use(
    http.get('*/api/assistant/thread', () => HttpResponse.json({ turns: [], ai: { remainingToday: 30 } })),
    http.post('*/api/assistant/chat', async ({ request }) => {
      chats.push((await request.json()) as { message: string; requestId: string });
      return HttpResponse.json({ route: 'rules', text: 'Tháng 10 bạn thu 15.000.000 ₫.', facts: [], sources: [], followups: [], remainingToday: 29 });
    }),
  );
}

test('TC-F14-110 the question chip on Transactions opens the drawer and sends the text as its first message; nothing is saved and the box keeps its text', async () => {
  answerQuestions();
  const chats: { message: string; month?: string; requestId: string }[] = [];
  serveAssistant(chats);
  const user = userEvent.setup();
  renderApp('/transactions'); // the button is on the Dashboard only: the chip has to work here too
  await screen.findByRole('row', { name: /grab/ });
  expect(screen.queryByRole('button', { name: 'Hỏi Sổ chi tiêu' })).not.toBeInTheDocument();

  await user.type(quickAdd(), 'tháng 10 thu bao nhiêu');
  const chip = await screen.findByRole('button', { name: QUESTION_CHIP });
  await user.click(chip);

  const dialog = await screen.findByRole('dialog', { name: 'Hỏi Sổ chi tiêu' });
  expect(await within(dialog).findByText('Tháng 10 bạn thu 15.000.000 ₫.')).toBeInTheDocument();
  expect(chats).toHaveLength(1);
  expect(chats[0]).toMatchObject({ message: 'tháng 10 thu bao nhiêu', requestId: expect.any(String) });
  expect(within(dialog).getByText('tháng 10 thu bao nhiêu')).toBeInTheDocument(); // shown as the first message of the thread
  expect(posted()).toEqual([]);

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(chip).toHaveFocus(); // back on what opened it
  expect(quickAdd()).toHaveValue('tháng 10 thu bao nhiêu');
  expect(posted()).toEqual([]);
});

test('TC-F14-110 the chip sends the question once: opening the drawer a second time from the chip sends it again as a new request, and the chip is gone for a capture', async () => {
  answerQuestions();
  const chats: { message: string; month?: string; requestId: string }[] = [];
  serveAssistant(chats);
  const user = userEvent.setup();
  renderApp('/transactions');
  await screen.findByRole('row', { name: /grab/ });
  await user.type(quickAdd(), 'hôm nay ăn gì?');
  await user.click(await screen.findByRole('button', { name: QUESTION_CHIP }));
  await screen.findByText('Tháng 10 bạn thu 15.000.000 ₫.');
  expect(chats).toHaveLength(1); // one press, one request (React StrictMode runs effects twice in development)
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: QUESTION_CHIP }));
  await waitFor(() => expect(chats).toHaveLength(2));
  expect(chats[1]!.requestId).not.toBe(chats[0]!.requestId);

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.clear(quickAdd());
  await user.type(quickAdd(), 'phở 45k');
  expect(await screen.findByRole('list', { name: 'Xem trước' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: QUESTION_CHIP })).not.toBeInTheDocument();
});

test('TC-F14-110 the question chip is a button with its own name, and the drawer is not in the page until it opens', async () => {
  answerQuestions();
  serveAssistant([]);
  const user = userEvent.setup();
  renderApp('/transactions');
  await screen.findByRole('row', { name: /grab/ });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.type(quickAdd(), 'tháng 10 thu bao nhiêu');
  const chip = await screen.findByRole('button', { name: QUESTION_CHIP });
  chip.focus();
  await user.keyboard('{Enter}'); // reachable and usable from the keyboard
  expect(await screen.findByRole('dialog', { name: 'Hỏi Sổ chi tiêu' })).toBeInTheDocument();
});
