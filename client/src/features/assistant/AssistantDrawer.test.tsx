import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import type { Category } from '@/features/categories/categoriesApi';
import type { Wallet } from '@/features/wallets/walletsApi';
import i18n from '@/i18n';
import { LAN, resetFake, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';
import type { ChatInput, ChatAnswer, ThreadTurn } from './assistantApi';

// The "Hỏi Sổ chi tiêu" drawer on the Dashboard, against an in-memory /api/assistant (MSW) with the docs/04 §4.4 shapes
// (docs/07 §7.9.5 *drawer*, *drawer errors*, ask-back). The Dashboard's own requests answer with empty data.

const THIS_MONTH = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
const NOW = '2026-11-20T05:00:00.000Z';

const wallets: Wallet[] = [{ id: 'w1', name: 'Tiền mặt', type: 'cash', initialBalance: 0, balance: 0, aliases: [], color: '', icon: '', archived: false }];
const categories: Category[] = [{ id: 'c1', type: 'expense', names: { vi: 'Ăn uống', en: 'Food & drinks' }, keywords: [], icon: 'Category', color: '', isFallback: false }];

// What the server answers for a question the rules read (route "rules"): the text, the numbers behind it, its sources, 2 follow-ups.
const answer = (extra: Partial<ChatAnswer> = {}): ChatAnswer => ({
  route: 'rules',
  text: 'Tháng 11 bạn chi 2.150.000 ₫ cho ăn uống.',
  facts: [{ id: 'f1', label: 'Ăn uống 11/2026', display: '2.150.000 ₫' }],
  sources: ['Giao dịch đã xác nhận 1/11–25/11/2026'],
  followups: ['Còn tháng trước?', 'Danh mục nào nhiều nhất?'],
  remainingToday: 29,
  ...extra,
});

const turn = (id: string, question: string, extra: Partial<ThreadTurn> = {}): ThreadTurn => ({
  id,
  question,
  text: `Trả lời cho "${question}"`,
  route: 'rules',
  facts: [],
  sources: [],
  followups: [],
  createdAt: NOW,
  ...extra,
});

let thread: ThreadTurn[];
let remaining: number;
let chats: ChatInput[]; // every body POSTed to /assistant/chat
let threadGets: number;
let deletes: number;
let savedTransactions: unknown[];
let reply: (body: ChatInput) => Response | ChatAnswer | Promise<Response | ChatAnswer>;

beforeEach(() => {
  resetFake(LAN, true); // logged in as Lan, UI in Vietnamese
  thread = [];
  remaining = 30;
  chats = [];
  threadGets = 0;
  deletes = 0;
  savedTransactions = [];
  reply = () => answer();
  const empty = { income: 0, expense: 0, net: 0, budget: null };
  server.use(
    http.get('*/api/wallets', () => HttpResponse.json(wallets)),
    http.get('*/api/categories', () => HttpResponse.json(categories)),
    http.get('*/api/budgets', () => HttpResponse.json([])),
    http.get('*/api/stats/summary', () => HttpResponse.json(empty)),
    http.get('*/api/stats/by-category', () => HttpResponse.json([])),
    http.get('*/api/stats/daily', ({ request }) => {
      const month = new URL(request.url).searchParams.get('month') ?? THIS_MONTH;
      return HttpResponse.json(Array.from({ length: 28 }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, '0')}`, income: 0, expense: 0 })));
    }),
    http.get('*/api/transactions', () => HttpResponse.json({ items: [], page: 1, limit: 20, total: 0 })),
    http.post('*/api/transactions', async ({ request }) => {
      const body = await request.json();
      savedTransactions.push(body);
      return HttpResponse.json({ id: `t${savedTransactions.length}`, status: 'confirmed', source: 'web', ...(body as object) }, { status: 201 });
    }),
    http.get('*/api/assistant/thread', () => {
      threadGets += 1;
      return HttpResponse.json({ turns: thread, ai: { remainingToday: remaining } });
    }),
    http.delete('*/api/assistant/thread', () => {
      deletes += 1;
      thread = [];
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('*/api/assistant/chat', async ({ request }) => {
      const body = (await request.json()) as ChatInput;
      chats.push(body);
      const result = await reply(body);
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
  );
});

const failure = (status: number, code: string) => HttpResponse.json({ error: { code, message: code } }, { status });
const question = () => screen.getByRole('textbox', { name: 'Câu hỏi của bạn' });

async function openDrawer() {
  const user = userEvent.setup();
  renderApp('/');
  const opener = await screen.findByRole('button', { name: 'Hỏi Sổ chi tiêu' });
  await user.click(opener);
  const dialog = await screen.findByRole('dialog', { name: 'Hỏi Sổ chi tiêu' });
  await within(dialog).findByRole('group', { name: 'Câu hỏi gợi ý' }); // the thread has loaded (empty)
  return { user, opener, dialog };
}

test('TC-F14-111 the drawer opens from the Dashboard button: titled, the input is focused, 4 starter chips, a starter sends its text with the month and a requestId', async () => {
  const { user, dialog } = await openDrawer();

  expect(within(dialog).getByRole('heading', { name: 'Hỏi Sổ chi tiêu' })).toBeInTheDocument();
  expect(question()).toHaveFocus();
  expect(question()).toHaveAttribute('placeholder', 'Hỏi về chi tiêu của bạn…');
  expect(question()).toHaveAccessibleDescription('Enter để gửi, Shift+Enter để xuống dòng.');
  const starters = within(within(dialog).getByRole('group', { name: 'Câu hỏi gợi ý' })).getAllByRole('button');
  expect(starters.map((chip) => chip.textContent)).toEqual([
    'Tháng này ăn uống hết bao nhiêu?',
    'Tháng này so với tháng trước?',
    'Số dư các ví',
    'Ngân sách tháng này',
  ]);
  expect(within(dialog).getByText('Còn 30 câu hỏi hôm nay')).toBeInTheDocument();

  await user.click(within(dialog).getByRole('button', { name: 'Tháng này ăn uống hết bao nhiêu?' }));
  expect(await within(dialog).findByText('Tháng 11 bạn chi 2.150.000 ₫ cho ăn uống.')).toBeInTheDocument();
  expect(chats).toHaveLength(1);
  expect(chats[0]).toEqual({ message: 'Tháng này ăn uống hết bao nhiêu?', month: THIS_MONTH, requestId: expect.stringMatching(/^[A-Za-z0-9_-]{1,64}$/) });
  expect(within(dialog).queryByRole('group', { name: 'Câu hỏi gợi ý' })).not.toBeInTheDocument(); // the thread is not empty any more
  expect(within(dialog).getByText('Còn 29 câu hỏi hôm nay')).toBeInTheDocument(); // the server's number, not a client count
});

test('TC-F14-111 an answer shows its badge, its numbers behind a "Số liệu" button and its sources line; the thread loads oldest first', async () => {
  thread = [
    turn('a1', 'tháng này ăn uống hết bao nhiêu?', {
      text: 'Tháng 11 bạn chi 2.150.000 ₫ cho ăn uống.',
      facts: [{ id: 'f1', label: 'Ăn uống 11/2026', display: '2.150.000 ₫' }],
      sources: ['Giao dịch đã xác nhận 1/11–25/11/2026'],
      followups: ['Còn tháng trước?'],
    }),
    turn('a2', 'tóm tắt tuần này', { route: 'agent', text: 'Tuần này bạn chi ít hơn tuần trước.', followups: ['So với tháng trước?'] }),
  ];
  remaining = 28;
  renderApp('/');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Hỏi Sổ chi tiêu' }));
  const log = await screen.findByRole('log', { name: 'Cuộc trò chuyện' });

  const text = log.textContent ?? '';
  expect(text.indexOf('tháng này ăn uống hết bao nhiêu?')).toBeGreaterThan(-1);
  expect(text.indexOf('tháng này ăn uống hết bao nhiêu?')).toBeLessThan(text.indexOf('tóm tắt tuần này')); // oldest first
  expect(within(log).getAllByText('Theo mẫu')).toHaveLength(1); // route rules
  expect(within(log).getAllByText('AI')).toHaveLength(1); // route agent
  expect(within(log).getByText('Trả lời bởi mô hình chạy trên máy chủ của Sổ chi tiêu')).toBeInTheDocument(); // what "AI" means, for a screen reader
  expect(within(log).getByText('Nguồn: Giao dịch đã xác nhận 1/11–25/11/2026')).toBeInTheDocument();
  expect(screen.getByText('Còn 28 câu hỏi hôm nay')).toBeInTheDocument();

  // The numbers are a real list behind a button; the button says whether it is open.
  expect(within(log).queryByRole('list', { name: 'Số liệu' })).not.toBeInTheDocument();
  const toggle = within(log).getByRole('button', { name: 'Số liệu' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(within(within(log).getByRole('list', { name: 'Số liệu' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    expect.stringMatching(/^Ăn uống 11\/2026: 2\.150\.000\s₫$/),
  ]);

  // Follow-ups only under the newest answer.
  expect(within(log).getByRole('button', { name: 'So với tháng trước?' })).toBeInTheDocument();
  expect(within(log).queryByRole('button', { name: 'Còn tháng trước?' })).not.toBeInTheDocument();
});

test('TC-F14-111 a follow-up chip sends its text as the next message, and the older answer loses its chips', async () => {
  const { user, dialog } = await openDrawer();
  await user.click(within(dialog).getByRole('button', { name: 'Số dư các ví' }));
  await user.click(await within(dialog).findByRole('button', { name: 'Còn tháng trước?' }));
  await waitFor(() => expect(chats.map((chat) => chat.message)).toEqual(['Số dư các ví', 'Còn tháng trước?']));
  expect(chats[0]!.requestId).not.toBe(chats[1]!.requestId); // each message is its own request
  await waitFor(() => expect(within(dialog).getAllByText('Tháng 11 bạn chi 2.150.000 ₫ cho ăn uống.')).toHaveLength(2));
  expect(within(dialog).getAllByRole('button', { name: 'Còn tháng trước?' })).toHaveLength(1); // only under the newest answer
});

test('TC-F14-111 Enter sends the typed question, Shift+Enter adds a line, and the input is cleared once it is answered', async () => {
  const { user, dialog } = await openDrawer();
  await user.type(question(), 'dòng một{Shift>}{Enter}{/Shift}dòng hai');
  expect(question()).toHaveValue('dòng một\ndòng hai');
  expect(chats).toEqual([]);
  await user.keyboard('{Enter}');
  expect(await within(dialog).findByText('Tháng 11 bạn chi 2.150.000 ₫ cho ăn uống.')).toBeInTheDocument();
  expect(chats[0]!.message).toBe('dòng một\ndòng hai');
  expect(question()).toHaveValue('');
});

test('TC-F14-111 a slow answer shows the pending bubble; Dừng aborts it, adds no answer and gives the question back to the input', async () => {
  reply = () => delay('infinite') as never;
  const { user, dialog } = await openDrawer();
  await user.type(question(), 'tháng này tiêu bao nhiêu?{Enter}');

  const pending = await within(dialog).findByText('Đang trả lời…');
  expect(pending.closest('[aria-busy="true"]')).not.toBeNull();
  await user.click(within(dialog).getByRole('button', { name: 'Dừng' }));

  await waitFor(() => expect(within(dialog).queryByText('Đang trả lời…')).not.toBeInTheDocument());
  expect(within(dialog).queryByRole('button', { name: 'Dừng' })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument(); // a stop is not an error
  expect(question()).toHaveValue('tháng này tiêu bao nhiêu?');
  expect(within(dialog).queryByText(/Tháng 11 bạn chi/)).not.toBeInTheDocument();
});

test('TC-F14-111 Xoá calls DELETE /assistant/thread, empties the drawer to its starter chips and keeps the count', async () => {
  thread = [turn('a1', 'số dư các ví')];
  remaining = 27;
  renderApp('/');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Hỏi Sổ chi tiêu' }));
  const dialog = await screen.findByRole('dialog', { name: 'Hỏi Sổ chi tiêu' });
  expect(await within(dialog).findByText('Trả lời cho "số dư các ví"')).toBeInTheDocument();

  await user.click(within(dialog).getByRole('button', { name: 'Xoá' }));
  await waitFor(() => expect(deletes).toBe(1));
  expect(await within(dialog).findByRole('group', { name: 'Câu hỏi gợi ý' })).toBeInTheDocument();
  expect(within(dialog).queryByText('Trả lời cho "số dư các ví"')).not.toBeInTheDocument();
  expect(within(dialog).getByText('Còn 27 câu hỏi hôm nay')).toBeInTheDocument(); // clearing gives no question back (docs/02 §2.11.6)
});

test('TC-F14-111 a capture typed in the drawer shows the preview card and saves nothing until Lưu is pressed; the card then says it saved', async () => {
  reply = () => ({
    route: 'capture',
    capture: {
      drafts: [{ type: 'expense', amount: 45_000, walletId: 'w1', categoryId: 'c1', occurredAt: NOW, note: 'phở', hints: [{ code: 'duplicate' }] }],
      noAmountLines: [],
      truncated: false,
    },
    remainingToday: 30,
  });
  const { user, dialog } = await openDrawer();
  await user.type(question(), 'phở 45k{Enter}');

  const card = await within(dialog).findByRole('group', { name: 'Giao dịch từ câu này' });
  expect(card).toHaveTextContent(/−45\.000\s₫/);
  expect(card).toHaveTextContent('Ăn uống');
  expect(card).toHaveTextContent('Tiền mặt');
  expect(card).toHaveTextContent('Giống một khoản Ăn uống vừa nhập trong 10 phút qua. Nhập trùng?');
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(savedTransactions).toEqual([]); // typing and sending save nothing

  await user.click(within(card).getByRole('button', { name: 'Lưu' }));
  expect(await within(dialog).findByText('Đã lưu giao dịch: 1')).toBeInTheDocument();
  expect(savedTransactions).toEqual([{ type: 'expense', amount: 45_000, walletId: 'w1', categoryId: 'c1', occurredAt: NOW, note: 'phở' }]); // hints are not data
  expect(within(card).queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument(); // one press, one save
  expect(within(dialog).getByText('Còn 30 câu hỏi hôm nay')).toBeInTheDocument(); // a capture is not a question
});

test('TC-F14-111 a capture with a wallet or category missing, or a line with no amount, cannot be saved from the card', async () => {
  reply = () => ({
    route: 'capture',
    capture: { drafts: [{ type: 'expense', amount: 45_000, walletId: null, categoryId: 'c1', occurredAt: NOW, note: 'phở' }], noAmountLines: [2], truncated: false },
    remainingToday: 30,
  });
  const { user, dialog } = await openDrawer();
  await user.type(question(), 'phở 45k{Shift>}{Enter}{/Shift}cafe{Enter}');
  const card = await within(dialog).findByRole('group', { name: 'Giao dịch từ câu này' });
  expect(card).toHaveTextContent('Dòng 2 không có số tiền. Hãy sửa hoặc xoá dòng đó rồi lưu.');
  expect(within(card).getByRole('button', { name: 'Lưu' })).toBeDisabled();
  expect(card).toHaveTextContent('Chưa có ví');
  expect(savedTransactions).toEqual([]);
});

test('TC-F14-111 Esc closes the drawer and focus goes back to the button that opened it; a finished answer is announced once, and loading the thread announces nothing', async () => {
  thread = [turn('a1', 'số dư các ví', { text: 'Tổng số dư: 1.000.000 ₫' })];
  const { user, opener, dialog } = await (async () => {
    const user = userEvent.setup();
    renderApp('/');
    const opener = await screen.findByRole('button', { name: 'Hỏi Sổ chi tiêu' });
    await user.click(opener);
    return { user, opener, dialog: await screen.findByRole('dialog', { name: 'Hỏi Sổ chi tiêu' }) };
  })();
  await within(dialog).findByText('Tổng số dư: 1.000.000 ₫');
  const live = within(dialog).getByRole('status'); // the one visually hidden polite live region
  expect(live).toHaveTextContent(''); // the reloaded thread is not read out

  await user.type(question(), 'tháng này ăn uống hết bao nhiêu?{Enter}');
  await within(dialog).findAllByText('Tháng 11 bạn chi 2.150.000 ₫ cho ăn uống.');
  await waitFor(() => expect(live).toHaveTextContent('Tháng 11 bạn chi 2.150.000 ₫ cho ăn uống.'));
  expect(within(dialog).getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('log', { name: 'Cuộc trò chuyện' })).toHaveAttribute('aria-live', 'off'); // the live region speaks, so the list does not read it twice

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Hỏi Sổ chi tiêu' })).not.toBeInTheDocument());
  expect(opener).toHaveFocus();
});

test('TC-F14-111 the close button closes the drawer; reopening loads the thread again', async () => {
  const { user, opener, dialog } = await openDrawer();
  expect(threadGets).toBe(1);
  await user.click(within(dialog).getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(opener).toHaveFocus();
  thread = [turn('a1', 'số dư các ví')];
  await user.click(opener);
  expect(await screen.findByText('Trả lời cho "số dư các ví"')).toBeInTheDocument();
  expect(threadGets).toBe(2);
});

test('TC-F14-111 the drawer is in English for an English user: button, title, starters, count, badge', async () => {
  resetFake({ ...LAN, language: 'en' }, true);
  thread = [turn('a1', 'wallet balances', { text: 'Total balance: 1,000,000 ₫', sources: ['Wallets 25/11/2026'] })];
  remaining = 1;
  renderApp('/');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Ask Sổ chi tiêu' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ask Sổ chi tiêu' });
  expect(await within(dialog).findByText('Total balance: 1,000,000 ₫')).toBeInTheDocument();
  expect(within(dialog).getByText('Template')).toBeInTheDocument();
  expect(within(dialog).getByText('Source: Wallets 25/11/2026')).toBeInTheDocument();
  expect(within(dialog).getByText('1 question left today')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Your question' })).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Clear' }));
  expect(await within(dialog).findByRole('group', { name: 'Suggested questions' })).toBeInTheDocument();
});

// ---- drawer errors (docs/05 §5.10.1 "States that are not an answer") ----

test('TC-F14-112 the agent is down (503 AGENT_UNAVAILABLE): an error bubble announced once, the question stays in the input, Thử lại resends the same requestId', async () => {
  reply = () => failure(503, 'AGENT_UNAVAILABLE');
  const { user, dialog } = await openDrawer();
  await user.type(question(), 'số dư các ví{Enter}');

  const bubble = await within(dialog).findByText('Trợ lý đang bận bảo trì, thử lại sau');
  expect(bubble).toBeInTheDocument();
  expect(within(dialog).getByText('Trang Tổng quan và Giao dịch vẫn hiện số liệu của bạn.')).toBeInTheDocument();
  expect(question()).toHaveValue('số dư các ví');
  expect(within(dialog).getByRole('status')).toHaveTextContent('Trợ lý đang bận bảo trì, thử lại sau');
  expect(within(dialog).getByText('Còn 30 câu hỏi hôm nay')).toBeInTheDocument(); // a failed turn changes no number

  reply = () => answer(); // the agent is back
  await user.click(within(dialog).getByRole('button', { name: 'Thử lại' }));
  expect(await within(dialog).findByText('Tháng 11 bạn chi 2.150.000 ₫ cho ăn uống.')).toBeInTheDocument();
  expect(chats).toHaveLength(2);
  expect(chats[1]).toEqual(chats[0]); // the same message, month and requestId: a question the server answered is not answered twice
  expect(within(dialog).queryByText('Trợ lý đang bận bảo trì, thử lại sau')).not.toBeInTheDocument();
  expect(question()).toHaveValue('');
});

test('TC-F14-112 the agent is busy (503 AGENT_BUSY) shows its own text with Thử lại', async () => {
  reply = () => failure(503, 'AGENT_BUSY');
  const { user, dialog } = await openDrawer();
  await user.click(within(dialog).getByRole('button', { name: 'Số dư các ví' }));
  expect(await within(dialog).findByText('Trợ lý đang trả lời nhiều người, thử lại sau vài giây')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  expect(within(dialog).queryByText('Trang Tổng quan và Giao dịch vẫn hiện số liệu của bạn.')).not.toBeInTheDocument();
  expect(question()).toHaveValue('Số dư các ví'); // a chip's question also waits in the input
});

test('TC-F14-112 a network error and an HTML 502 show the same bubble as service down', async () => {
  reply = () => HttpResponse.error();
  const { user, dialog } = await openDrawer();
  await user.type(question(), 'số dư các ví{Enter}');
  expect(await within(dialog).findByText('Trợ lý đang bận bảo trì, thử lại sau')).toBeInTheDocument();

  reply = () => new HttpResponse('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
  await user.click(within(dialog).getByRole('button', { name: 'Thử lại' }));
  await waitFor(() => expect(chats).toHaveLength(2));
  expect(await within(dialog).findByText('Trợ lý đang bận bảo trì, thử lại sau')).toBeInTheDocument();
  expect(within(dialog).getAllByText('Trợ lý đang bận bảo trì, thử lại sau')).toHaveLength(1); // the new bubble replaces the old one
});

test('TC-F14-112 Thử lại after a 409 DUPLICATE (the server had answered) reloads the thread instead of showing an error', async () => {
  reply = (body) => {
    if (chats.length === 1) return failure(503, 'AGENT_UNAVAILABLE');
    thread = [turn('a1', body.message, { text: 'Câu trả lời đã có sẵn' })]; // the first attempt did get answered
    return failure(409, 'DUPLICATE');
  };
  const { user, dialog } = await openDrawer();
  await user.type(question(), 'số dư các ví{Enter}');
  await within(dialog).findByText('Trợ lý đang bận bảo trì, thử lại sau');
  const before = threadGets;

  await user.click(within(dialog).getByRole('button', { name: 'Thử lại' }));
  expect(await within(dialog).findByText('Câu trả lời đã có sẵn')).toBeInTheDocument();
  expect(threadGets).toBe(before + 1);
  expect(chats[1]!.requestId).toBe(chats[0]!.requestId);
  expect(within(dialog).queryByText('Câu hỏi này đã được gửi rồi.')).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
});

test('TC-F14-112 an error that is not the agent (400) shows the server message and no Thử lại', async () => {
  reply = () => failure(422, 'NO_AMOUNT_FOUND');
  const { user, dialog } = await openDrawer();
  await user.type(question(), 'phở{Shift>}{Enter}{/Shift}cafe{Enter}');
  expect(await within(dialog).findByText('Không tìm thấy số tiền. Ví dụ: "phở 45k".')).toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
});

test('TC-F14-112 at the cap the drawer says so in place of the hint and still sends: a question gets the cap answer, a capture still gets its card', async () => {
  remaining = 0;
  reply = (body) =>
    body.message === 'phở 45k'
      ? { route: 'capture', capture: { drafts: [{ type: 'expense', amount: 45_000, walletId: 'w1', categoryId: 'c1', occurredAt: NOW, note: 'phở' }], noAmountLines: [], truncated: false }, remainingToday: 0 }
      : { route: 'capped', text: 'Hôm nay bạn đã hỏi đủ 30 câu', facts: [], sources: [], followups: [], remainingToday: 0 };
  const { user, dialog } = await openDrawer();
  expect(within(dialog).getByText('Hôm nay bạn đã hỏi đủ 30 câu, mai hỏi tiếp nhé')).toBeInTheDocument();
  expect(within(dialog).getByText('Lệnh /today và /month trong Telegram và Zalo vẫn dùng được.')).toBeInTheDocument();
  expect(within(dialog).getByText('Còn 0 câu hỏi hôm nay')).toBeInTheDocument(); // the count is shown whenever the drawer is open
  expect(question()).toHaveAccessibleDescription(/Hôm nay bạn đã hỏi đủ 30 câu/); // it replaces the key hint

  await user.type(question(), 'số dư các ví{Enter}');
  expect(await within(dialog).findByText('Hôm nay bạn đã hỏi đủ 30 câu')).toBeInTheDocument(); // the agent's cap line
  expect(within(dialog).getByText('Theo mẫu')).toBeInTheDocument();

  await user.type(question(), 'phở 45k{Enter}');
  expect(await within(dialog).findByRole('group', { name: 'Giao dịch từ câu này' })).toBeInTheDocument();
});

test('TC-F14-112 a thread that does not load says so with Thử lại, which loads it again; asking still works meanwhile', async () => {
  let failing = true;
  server.use(
    http.get('*/api/assistant/thread', () => {
      threadGets += 1;
      return failing ? failure(500, 'INTERNAL') : HttpResponse.json({ turns: [turn('a1', 'số dư các ví')], ai: { remainingToday: 12 } });
    }),
  );
  const user = userEvent.setup();
  renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'Hỏi Sổ chi tiêu' }));
  const dialog = await screen.findByRole('dialog', { name: 'Hỏi Sổ chi tiêu' });
  expect(await within(dialog).findByText('Không tải được các câu hỏi trước đó.')).toBeInTheDocument();
  expect(within(dialog).queryByText(/câu hỏi hôm nay/)).not.toBeInTheDocument(); // no made-up count

  failing = false;
  await user.click(within(dialog).getByRole('button', { name: 'Thử lại' }));
  expect(await within(dialog).findByText('Trả lời cho "số dư các ví"')).toBeInTheDocument();
  expect(within(dialog).getByText('Còn 12 câu hỏi hôm nay')).toBeInTheDocument();
  expect(within(dialog).queryByText('Không tải được các câu hỏi trước đó.')).not.toBeInTheDocument();
  expect(threadGets).toBe(2);
});

test('TC-F14-112 an answer still shows when the thread did not load, and a language switch changes an error bubble that is on screen', async () => {
  server.use(http.get('*/api/assistant/thread', () => failure(500, 'INTERNAL')));
  reply = (body) => (body.message === 'số dư các ví' ? answer() : failure(503, 'AGENT_UNAVAILABLE'));
  const user = userEvent.setup();
  renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'Hỏi Sổ chi tiêu' }));
  const dialog = await screen.findByRole('dialog', { name: 'Hỏi Sổ chi tiêu' });
  await user.type(await within(dialog).findByRole('textbox', { name: 'Câu hỏi của bạn' }), 'số dư các ví{Enter}');
  expect(await within(dialog).findByText('Tháng 11 bạn chi 2.150.000 ₫ cho ăn uống.')).toBeInTheDocument(); // the cache is started by the answer
  expect(within(dialog).getByText('Còn 29 câu hỏi hôm nay')).toBeInTheDocument();

  await user.type(within(dialog).getByRole('textbox', { name: 'Câu hỏi của bạn' }), 'câu khác{Enter}');
  expect(await within(dialog).findByText('Trợ lý đang bận bảo trì, thử lại sau')).toBeInTheDocument();
  await act(() => i18n.changeLanguage('en')); // BUG-031: keys and errors are in state, text is made at render
  expect(await within(dialog).findByText('The assistant is under maintenance, please try again later')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('TC-F14-112 the error bubbles are in English for an English user', async () => {
  resetFake({ ...LAN, language: 'en' }, true);
  reply = () => failure(503, 'AGENT_UNAVAILABLE');
  const user = userEvent.setup();
  renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'Ask Sổ chi tiêu' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ask Sổ chi tiêu' });
  await user.type(await within(dialog).findByRole('textbox', { name: 'Your question' }), 'wallet balances{Enter}');
  expect(await within(dialog).findByText('The assistant is under maintenance, please try again later')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

// ---- ask-back (docs/02 §2.11.3: the agent asks "which one?" with numbered options) ----

const askBack = (extra: Partial<ChatAnswer> = {}): ChatAnswer =>
  answer({
    text: 'Bạn muốn hỏi ý nào?\n1. Thu chi theo kỳ · tháng này\n2. Chi theo danh mục · Ăn uống\nTrả lời 1-2 trong 10 phút.',
    facts: [],
    sources: [],
    followups: [],
    card: {
      kind: 'ask_back',
      options: [
        { n: 1, label: 'Thu chi theo kỳ · tháng này' },
        { n: 2, label: 'Chi theo danh mục · Ăn uống' },
      ],
    },
    ...extra,
  });

test('TC-F14-113 an ask-back answer shows each option as a button with its full label; pressing one sends its number as the next message', async () => {
  reply = (body) => (body.message === 'chi tiêu' ? askBack() : answer({ text: 'Ăn uống tháng này: 2.150.000 ₫' }));
  const { user, dialog } = await openDrawer();
  await user.type(question(), 'chi tiêu{Enter}');

  const choices = await within(dialog).findByRole('group', { name: 'Chọn một ý' });
  expect(within(choices).getAllByRole('button').map((button) => button.textContent)).toEqual(['Thu chi theo kỳ · tháng này', 'Chi theo danh mục · Ăn uống']);
  await user.click(within(choices).getByRole('button', { name: 'Chi theo danh mục · Ăn uống' }));

  await waitFor(() => expect(chats.map((chat) => chat.message)).toEqual(['chi tiêu', '2']));
  expect(await within(dialog).findByText('Ăn uống tháng này: 2.150.000 ₫')).toBeInTheDocument();
  expect(within(dialog).queryByRole('group', { name: 'Chọn một ý' })).not.toBeInTheDocument(); // answered: the buttons go
  expect(within(dialog).queryByRole('group', { name: 'Giao dịch từ câu này' })).not.toBeInTheDocument();
});

test('TC-F14-113 an ask-back that comes back with the reloaded thread shows its buttons too; only the newest one has them', async () => {
  const oldAsk = turn('a1', 'chi tiêu', { text: 'Bạn muốn hỏi ý nào?\n1. Cũ\n2. Cũ hơn', card: { kind: 'ask_back', options: [{ n: 1, label: 'Cũ' }, { n: 2, label: 'Cũ hơn' }] } });
  const newAsk = turn('a2', 'ngân sách', {
    text: 'Bạn muốn hỏi ý nào?\n1. Ngân sách tháng này\n2. Ngân sách ăn uống',
    card: { kind: 'ask_back', options: [{ n: 1, label: 'Ngân sách tháng này' }, { n: 2, label: 'Ngân sách ăn uống' }] },
  });
  thread = [oldAsk, newAsk];
  renderApp('/');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Hỏi Sổ chi tiêu' }));
  const dialog = await screen.findByRole('dialog', { name: 'Hỏi Sổ chi tiêu' });

  await user.click(await within(dialog).findByRole('button', { name: 'Ngân sách ăn uống' }));
  await waitFor(() => expect(chats.map((chat) => chat.message)).toEqual(['2']));
  expect(within(dialog).queryByRole('button', { name: 'Cũ hơn' })).not.toBeInTheDocument(); // a stale ask-back is not pressable
});

test('TC-F14-113 a typed 2 is sent as a plain message and never becomes a capture card or a saved transaction', async () => {
  reply = (body) => (body.message === 'chi tiêu' ? askBack() : answer({ text: 'Ăn uống tháng này: 2.150.000 ₫' }));
  const { user, dialog } = await openDrawer();
  await user.type(question(), 'chi tiêu{Enter}');
  await within(dialog).findByRole('group', { name: 'Chọn một ý' });

  await user.type(question(), '2{Enter}');
  expect(await within(dialog).findByText('Ăn uống tháng này: 2.150.000 ₫')).toBeInTheDocument();
  expect(chats.map((chat) => chat.message)).toEqual(['chi tiêu', '2']);
  expect(within(dialog).queryByRole('group', { name: 'Giao dịch từ câu này' })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Lưu' })).not.toBeInTheDocument();
  expect(savedTransactions).toEqual([]);
});

test('TC-F14-113 a lapsed ask-back answers "Câu hỏi đã hết hạn" as a normal answer with no buttons and no card', async () => {
  reply = (body) => (body.message === '2' ? answer({ text: 'Câu hỏi đã hết hạn, hãy hỏi lại', facts: [], sources: [], followups: [] }) : askBack());
  const { user, dialog } = await openDrawer();
  await user.type(question(), 'chi tiêu{Enter}');
  await within(dialog).findByRole('group', { name: 'Chọn một ý' });
  await user.type(question(), '2{Enter}');
  expect(await within(dialog).findByText('Câu hỏi đã hết hạn, hãy hỏi lại')).toBeInTheDocument();
  expect(within(dialog).queryByRole('group', { name: 'Giao dịch từ câu này' })).not.toBeInTheDocument();
  expect(savedTransactions).toEqual([]);
});

test('TC-F14-113 the ask-back buttons have English labels too and send their number', async () => {
  resetFake({ ...LAN, language: 'en' }, true);
  thread = [turn('a1', 'spending', { text: 'Which one do you mean?\n1. Income and spending\n2. Spending by category', card: { kind: 'ask_back', options: [{ n: 1, label: 'Income and spending' }, { n: 2, label: 'Spending by category' }] } })];
  const user = userEvent.setup();
  renderApp('/');
  await user.click(await screen.findByRole('button', { name: 'Ask Sổ chi tiêu' }));
  const choices = await screen.findByRole('group', { name: 'Pick one' });
  await user.click(within(choices).getByRole('button', { name: 'Income and spending' }));
  await waitFor(() => expect(chats.map((chat) => chat.message)).toEqual(['1']));
});

// ---- starters ----

const skillFiles = import.meta.glob<string>('../../../../agent/skills/*.yaml', { query: '?raw', import: 'default', eager: true });

test('TC-F14-114 every Vietnamese starter chip is an example of a skill that ships in agent/skills', async () => {
  const examples = Object.values(skillFiles).flatMap((yaml) => {
    const block = yaml.split(/^examples:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
    return [...block.matchAll(/^\s+-\s+"?(.+?)"?\s*$/gm)].map((match) => match[1]!);
  });
  expect(examples.length).toBeGreaterThanOrEqual(24); // 8 skills with 3 examples each: the files were found
  const same = (a: string, b: string) => a.replace(/[?!.]$/, '').toLowerCase() === b.replace(/[?!.]$/, '').toLowerCase();
  const { user, dialog } = await openDrawer();
  void user;
  const starters = within(within(dialog).getByRole('group', { name: 'Câu hỏi gợi ý' })).getAllByRole('button');
  expect(starters).toHaveLength(4);
  for (const chip of starters) expect(examples.some((example) => same(example, chip.textContent ?? '')), `"${chip.textContent}" is no skill example`).toBe(true);
});
