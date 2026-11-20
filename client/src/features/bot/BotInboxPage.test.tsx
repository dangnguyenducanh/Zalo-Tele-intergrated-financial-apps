import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Category } from '@/features/categories/categoriesApi';
import type { Wallet } from '@/features/wallets/walletsApi';
import { LAN, resetFake, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';
import type { ChatLink, Draft } from './botApi';
import { resizeImage } from './resizeImage';

// /bot against an in-memory /api/transactions (drafts), /chat-links and /receipts (MSW), docs/04 shapes.
// jsdom has no canvas, so resizeImage is replaced here; the real one runs in the browser test (e2e/bot.spec.ts).
vi.mock('./resizeImage', () => ({ resizeImage: vi.fn() }));

const NOW = '2026-11-20T05:00:00.000Z'; // 12:00 in Vietnam

const wallet = (id: string, name: string): Wallet => ({ id, name, type: 'cash', initialBalance: 0, balance: 0, aliases: [], color: '', icon: '', archived: false });
const category = (id: string, type: Category['type'], vi: string): Category => ({
  id,
  type,
  names: { vi, en: vi },
  keywords: [],
  icon: 'Category',
  color: '',
  isFallback: false,
});
const wallets = [wallet('w1', 'Tiền mặt'), wallet('w2', 'Momo')];
const categories = [category('c1', 'expense', 'Ăn uống'), category('c2', 'expense', 'Khác'), category('c3', 'income', 'Lương')];

const draft = (fields: Partial<Draft> & Pick<Draft, 'id' | 'amount' | 'note' | 'source'>): Draft => ({
  type: 'expense',
  walletId: 'w1',
  categoryId: 'c1',
  occurredAt: NOW,
  status: 'draft',
  ...fields,
});

let drafts: (Draft & { deleted?: boolean })[] = [];
let links: ChatLink[] = [];
let sent: { method: string; url: string; body?: unknown }[] = [];
let confirmAnswer: { budgetWarning?: { percent: number; threshold: 80 | 100 } } = {};
let codeAnswer: () => Response;
let receiptAnswer: () => Response | Promise<Response>;
let uploads: File[] = [];

const fail = (status: number, code: string) => HttpResponse.json({ error: { code, message: code } }, { status });

beforeEach(() => {
  resetFake(LAN, true); // logged in as Lan, UI in Vietnamese
  drafts = [
    draft({ id: 'd1', amount: 45000, note: 'phở', source: 'telegram' }),
    draft({
      id: 'd2',
      amount: 116000,
      note: 'Bách Hoá Xanh',
      source: 'receipt',
      categoryId: 'c2',
      receipt: {
        merchant: 'Bách Hoá Xanh',
        total: 116000,
        reconciled: true,
        items: [
          { name: 'Sữa tươi', quantity: 2, unitPrice: 30000, amount: 60000 },
          { name: 'Bánh mì', quantity: 1, unitPrice: 56000, amount: 56000 },
        ],
      },
    }),
    draft({ id: 'd3', type: 'income', amount: 15000000, note: 'lương', source: 'zalo', categoryId: 'c3', walletId: 'w2' }),
  ];
  links = [];
  sent = [];
  uploads = [];
  confirmAnswer = {};
  codeAnswer = () =>
    HttpResponse.json({ code: 'ABC234', expiresAt: new Date(Date.now() + 600_000).toISOString(), telegramDeepLink: 'https://t.me/test_bot?start=ABC234' }, { status: 201 });
  receiptAnswer = () => HttpResponse.json({ transaction: draft({ id: 'd9', amount: 50000, note: 'Circle K', source: 'receipt' }) }, { status: 201 });
  vi.mocked(resizeImage).mockReset().mockResolvedValue(new Blob(['small jpeg'], { type: 'image/jpeg' }));

  server.use(
    http.get('*/api/wallets', () => HttpResponse.json(wallets)),
    http.get('*/api/categories', () => HttpResponse.json(categories)),
    http.get('*/api/transactions', ({ request }) => {
      const status = new URL(request.url).searchParams.get('status');
      const items = drafts.filter((d) => !d.deleted && (!status || d.status === status));
      return HttpResponse.json({ items, page: 1, limit: 100, total: items.length });
    }),
    http.patch('*/api/transactions/:id', async ({ request, params }) => {
      const body = (await request.json()) as Partial<Draft>;
      sent.push({ method: 'PATCH', url: `/transactions/${params.id}`, body });
      drafts = drafts.map((d) => (d.id === params.id ? { ...d, ...body } : d));
      return HttpResponse.json(drafts.find((d) => d.id === params.id));
    }),
    http.delete('*/api/transactions/:id', ({ params }) => {
      sent.push({ method: 'DELETE', url: `/transactions/${params.id}` });
      drafts = drafts.map((d) => (d.id === params.id ? { ...d, deleted: true } : d));
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('*/api/transactions/:id/confirm', ({ params }) => {
      sent.push({ method: 'POST', url: `/transactions/${params.id}/confirm` });
      const found = drafts.find((d) => d.id === params.id);
      if (!found) return fail(404, 'NOT_FOUND');
      if (found.status === 'confirmed') return fail(409, 'ALREADY_CONFIRMED');
      found.status = 'confirmed';
      return HttpResponse.json({ transaction: found, ...confirmAnswer });
    }),
    http.get('*/api/chat-links', () => HttpResponse.json(links)),
    http.post('*/api/chat-links/code', () => codeAnswer()),
    http.delete('*/api/chat-links/:id', ({ params }) => {
      sent.push({ method: 'DELETE', url: `/chat-links/${params.id}` });
      links = links.filter((link) => link.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('*/api/receipts', async ({ request }) => {
      uploads.push((await request.formData()).get('image') as File);
      return receiptAnswer();
    }),
  );
});

const card = (name: string) => screen.findByRole('form', { name });
const writes = () => sent.filter((s) => s.method !== 'GET').map((s) => `${s.method} ${s.url}`);

test('TC-F9-03 drafts from every source: edit the amount inline, Confirm saves the change then confirms', async () => {
  const user = userEvent.setup();
  renderApp('/bot');

  expect(await screen.findByRole('heading', { level: 1, name: 'Hộp thư bot' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { level: 2, name: 'Bản nháp chờ duyệt (3)' })).toBeInTheDocument();
  const pho = await card('phở');
  expect(within(pho).getByText('Telegram')).toBeInTheDocument(); // source label next to its icon
  expect(within(await card('lương')).getByText('Zalo')).toBeInTheDocument();
  expect(within(await card('Bách Hoá Xanh')).getByText('Hoá đơn')).toBeInTheDocument();
  await waitFor(() => expect(within(pho).getByRole('combobox', { name: 'Danh mục' })).toHaveDisplayValue('Ăn uống'));
  expect(within(pho).getByRole('combobox', { name: 'Ví' })).toHaveDisplayValue('Tiền mặt');

  // A wrong amount is caught on the page: nothing is sent and focus goes to the field.
  const amount = within(pho).getByRole('textbox', { name: 'Số tiền (₫)' });
  expect(amount).toHaveValue('45.000');
  await user.clear(amount);
  await user.click(within(pho).getByRole('button', { name: 'Xác nhận' }));
  expect(amount).toHaveFocus();
  expect(amount).toHaveAttribute('aria-invalid', 'true');
  expect(writes()).toEqual([]);

  await user.type(amount, '50k');
  expect(amount).toHaveAccessibleDescription(/= 50\.000\s₫/);
  await user.click(within(pho).getByRole('button', { name: 'Xác nhận' }));

  expect(await screen.findByText('Đã lưu giao dịch')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('form', { name: 'phở' })).not.toBeInTheDocument());
  expect(writes()).toEqual(['PATCH /transactions/d1', 'POST /transactions/d1/confirm']); // the edit first, then confirm
  expect(sent[0]?.body).toEqual({ type: 'expense', amount: 50000, categoryId: 'c1', walletId: 'w1', occurredAt: NOW, note: 'phở' });
  // The Confirm button left with its card: focus is on the list heading, not lost to <body>.
  expect(screen.getByRole('heading', { level: 2, name: 'Bản nháp chờ duyệt (2)' })).toHaveFocus();
});

test('TC-F9-03 receipt line items expand; an unchanged draft confirms without a PATCH; Discard asks first', async () => {
  const user = userEvent.setup();
  confirmAnswer = { budgetWarning: { percent: 85, threshold: 80 } };
  renderApp('/bot');

  const receipt = await card('Bách Hoá Xanh');
  const summary = within(receipt).getByText('2 dòng hàng · khớp tổng tiền');
  expect(within(receipt).getByText(/Sữa tươi/)).not.toBeVisible(); // closed <details>
  await user.click(summary);
  expect(within(receipt).getByText(/Sữa tươi/)).toBeVisible();
  expect(within(receipt).getByText(/Sữa tươi/)).toHaveTextContent(/Sữa tươi · 2 × 30\.000\s₫ · 60\.000\s₫/);

  await user.click(within(await card('lương')).getByRole('button', { name: 'Xác nhận' }));
  expect(await screen.findByText('Đã lưu. Bạn đã dùng 85% ngân sách tháng này.')).toBeInTheDocument();
  expect(writes()).toEqual(['POST /transactions/d3/confirm']);
  expect(screen.getByRole('heading', { level: 2, name: /^Bản nháp chờ duyệt/ })).toHaveFocus();

  await user.click(within(receipt).getByRole('button', { name: 'Bỏ' }));
  const dialog = await screen.findByRole('dialog', { name: 'Bỏ bản nháp?' });
  expect(dialog).toHaveTextContent('Bản nháp "Bách Hoá Xanh" sẽ bị xoá');
  await user.click(within(dialog).getByRole('button', { name: 'Bỏ' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Bách Hoá Xanh' })).not.toBeInTheDocument());
  expect(writes()).toEqual(['POST /transactions/d3/confirm', 'DELETE /transactions/d2']);
  expect(await screen.findByText('Đã bỏ bản nháp')).toBeInTheDocument();
  // The page is aria-hidden until the dialog's closing animation ends, hence waitFor.
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Bản nháp chờ duyệt (1)' })).toHaveFocus());
});

test('TC-F9-02 a draft already confirmed in the chat: Confirm shows the translated 409 and the draft leaves the list', async () => {
  const user = userEvent.setup();
  renderApp('/bot');
  const pho = await card('phở');

  drafts[0]!.status = 'confirmed'; // the user pressed ✅ in Telegram while the page was open
  await user.click(within(pho).getByRole('button', { name: 'Xác nhận' }));

  expect(await screen.findByText('Giao dịch này đã được xác nhận.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('form', { name: 'phở' })).not.toBeInTheDocument());
  expect(writes()).toEqual(['POST /transactions/d1/confirm']);
  expect(screen.getByRole('heading', { level: 2, name: 'Bản nháp chờ duyệt (2)' })).toHaveFocus();
});

test('TC-F7-06 link card: the code with a countdown, the Telegram link + QR and the Zalo command; unlink an account', async () => {
  const user = userEvent.setup();
  links = [{ id: 'l1', platform: 'telegram', displayName: 'Anh Nguyen', createdAt: NOW }];
  renderApp('/bot');

  const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
  const account = await within(linked).findByRole('listitem');
  expect(account).toHaveTextContent('Telegram · Anh Nguyen');
  expect(account).toHaveTextContent('Liên kết ngày 20 thg 11, 2026');

  await user.click(screen.getByRole('button', { name: 'Tạo mã liên kết' }));
  const linkCard = screen.getByRole('region', { name: 'Liên kết Telegram / Zalo' });
  expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
  expect(document.activeElement).toHaveTextContent(/^Mã liên kếtABC234Hết hạn sau/); // the code replaced the button and has focus
  expect(within(linkCard).getByRole('timer')).toHaveTextContent(/Hết hạn sau (10:00|9:5\d)/);
  expect(within(linkCard).getByRole('link', { name: 'Mở Telegram' })).toHaveAttribute('href', 'https://t.me/test_bot?start=ABC234');
  expect(within(linkCard).getByRole('img', { name: 'Mã QR mở bot Telegram với mã liên kết' })).toBeInTheDocument();
  expect(within(linkCard).getByText('/link ABC234')).toBeInTheDocument();

  await user.click(within(linked).getByRole('button', { name: 'Huỷ liên kết Telegram · Anh Nguyen' }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Huỷ liên kết?' })).getByRole('button', { name: 'Huỷ liên kết' }));
  expect(await within(linked).findByText('Chưa liên kết tài khoản chat nào.')).toBeInTheDocument();
  expect(writes()).toEqual(['DELETE /chat-links/l1']);
  await waitFor(() => expect(within(linked).getByRole('heading', { name: 'Tài khoản đã liên kết' })).toHaveFocus());
});

test('TC-F7-06 link card: an expired code offers a new one; no Telegram link without a bot name; 429 is translated', async () => {
  const user = userEvent.setup();
  codeAnswer = () => HttpResponse.json({ code: 'XYZ789', expiresAt: new Date(Date.now() + 1200).toISOString(), telegramDeepLink: null }, { status: 201 });
  server.use(http.get('*/api/chat-links', () => fail(500, 'INTERNAL'), { once: true }));
  renderApp('/bot');

  const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
  expect(await within(linked).findByText('Không tải được danh sách tài khoản.')).toBeInTheDocument();
  await user.click(within(linked).getByRole('button', { name: 'Thử lại' }));
  expect(await within(linked).findByText('Chưa liên kết tài khoản chat nào.')).toBeInTheDocument();
  expect(within(linked).queryByText('Không tải được danh sách tài khoản.')).not.toBeInTheDocument();

  await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
  expect(await screen.findByText('XYZ789')).toBeInTheDocument();
  expect(screen.getByText('/link XYZ789')).toBeInTheDocument(); // Zalo works without the Telegram bot name
  expect(screen.queryByRole('link', { name: 'Mở Telegram' })).not.toBeInTheDocument();
  expect(await screen.findByText('Mã đã hết hạn. Hãy tạo mã mới.', {}, { timeout: 3000 })).toBeInTheDocument();
  expect(screen.queryByText('XYZ789')).not.toBeInTheDocument();

  codeAnswer = () => fail(429, 'RATE_LIMITED');
  await user.click(screen.getByRole('button', { name: 'Tạo mã mới' }));
  expect(await screen.findByText('Bạn thao tác quá nhiều lần. Vui lòng thử lại sau ít phút.')).toBeInTheDocument();
});

test('TC-F10-05 upload: the resized photo is sent as field "image", a status shows while KIE reads, errors are translated', async () => {
  const user = userEvent.setup({ applyAccept: false }); // "All files" in the picker can still give a PDF
  let answer: (response: Response) => void = () => {};
  receiptAnswer = () => new Promise<Response>((resolve) => (answer = resolve));
  renderApp('/bot');
  await card('phở');

  const photo = new File([new Uint8Array(8)], 'IMG_0001.jpg', { type: 'image/jpeg' });
  await user.upload(screen.getByLabelText('Chọn ảnh hoá đơn'), photo);
  expect(resizeImage).toHaveBeenCalledWith(photo);
  expect(await screen.findByRole('status')).toHaveTextContent('Đang đọc hoá đơn… (khoảng 20–40 giây)');
  expect(screen.getByRole('button', { name: /Chọn ảnh hoá đơn/ })).toBeDisabled(); // one receipt at a time
  await waitFor(() => expect(uploads).toHaveLength(1));
  expect(uploads[0]?.type).toBe('image/jpeg');
  expect(await uploads[0]?.text()).toBe('small jpeg'); // the resized blob, not the original photo

  drafts.unshift(draft({ id: 'd9', amount: 50000, note: 'Circle K', source: 'receipt' }));
  answer(HttpResponse.json({ transaction: drafts[0] }, { status: 201 }));
  expect(await screen.findByRole('status')).toHaveTextContent('Đã tạo bản nháp từ hoá đơn.');
  expect(await card('Circle K')).toBeInTheDocument(); // the list refetched

  receiptAnswer = () => fail(422, 'RECEIPT_UNREADABLE');
  await user.upload(screen.getByLabelText('Chọn ảnh hoá đơn'), photo);
  expect(await screen.findByText('Không đọc được tổng tiền trên hoá đơn. Vui lòng nhập tay.')).toBeInTheDocument();

  vi.mocked(resizeImage).mockRejectedValueOnce(new Error('not an image'));
  await user.upload(screen.getByLabelText('Chọn ảnh hoá đơn'), new File(['%PDF'], 'bill.pdf', { type: 'application/pdf' }));
  expect(await screen.findByText('Chỉ hỗ trợ ảnh JPEG hoặc PNG.')).toBeInTheDocument();
  expect(uploads).toHaveLength(2); // the PDF never reached the server
});
