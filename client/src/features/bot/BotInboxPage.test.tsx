import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Category } from '@/features/categories/categoriesApi';
import type { Wallet } from '@/features/wallets/walletsApi';
import { LAN, resetFake, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';
import type { ChatLink, Draft } from './botApi';
import { qrSvgPath } from './qrCode';
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
let codeAnswer: () => Response | Promise<Response>;
let receiptAnswer: () => Response | Promise<Response>;
let uploads: File[] = [];

const CARD = 'Liên kết Telegram / WhatsApp / Zalo'; // the link card's title (docs/05 §5.9.6)
const TG = (code: string) => `https://t.me/test_bot?start=${code}`;
const WA = (code: string) => `https://wa.me/84900000000?text=%2Flink%20${code}`;
const ZALO = 'https://zalo.me/test-bot';
const codeWith = (code: string, links: Partial<Record<'telegram' | 'whatsapp' | 'zalo', string>>, ttl = 600_000) => () =>
  HttpResponse.json(
    { code, expiresAt: new Date(Date.now() + ttl).toISOString(), links: { telegram: null, whatsapp: null, zalo: null, ...links } },
    { status: 201 },
  );

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
  codeAnswer = codeWith('ABC234', { telegram: TG('ABC234'), whatsapp: WA('ABC234'), zalo: ZALO });
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
    // Like the server: optional edits in the body, applied in the same step and only to a draft.
    http.post('*/api/transactions/:id/confirm', async ({ request, params }) => {
      const text = await request.text();
      const body = text ? (JSON.parse(text) as Partial<Draft>) : undefined;
      sent.push({ method: 'POST', url: `/transactions/${params.id}/confirm`, body });
      const found = drafts.find((d) => d.id === params.id);
      if (!found) return fail(404, 'NOT_FOUND');
      if (found.status === 'confirmed') return fail(409, 'ALREADY_CONFIRMED');
      Object.assign(found, body, { status: 'confirmed' });
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

// Holds the next GET /chat-links. Like a slow server, it answers with the list as it was when the request arrived.
function holdNextList() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const held = { asked: false, release: () => release() };
  server.use(
    http.get(
      '*/api/chat-links',
      async () => {
        const read = [...links];
        held.asked = true;
        await gate;
        return HttpResponse.json(read);
      },
      { once: true },
    ),
  );
  return held;
}
// When the bot made a link, on the server's clock: now, or `ms` ago.
const at = (ms = 0) => new Date(Date.now() - ms).toISOString();
const writes = () => sent.filter((s) => s.method !== 'GET').map((s) => `${s.method} ${s.url}`);

test('TC-F9-03 drafts from every source: edit the amount inline, Confirm sends the change with the confirm', async () => {
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
  expect(writes()).toEqual(['POST /transactions/d1/confirm']); // the edit travels with the confirm (TC-F9-06)
  expect(sent[0]?.body).toEqual({ type: 'expense', amount: 50000, categoryId: 'c1', walletId: 'w1', occurredAt: NOW, note: 'phở' });
  // The Confirm button left with its card: focus is on the list heading, not lost to <body>.
  expect(screen.getByRole('heading', { level: 2, name: 'Bản nháp chờ duyệt (2)' })).toHaveFocus();
});

test('TC-F9-03 receipt line items expand; an unchanged draft confirms without edits; Discard asks first', async () => {
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
  expect(sent[0]?.body).toBeUndefined();
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

test('TC-F9-06 a stale card confirmed in the chat meanwhile: a changed amount is refused and the saved transaction keeps its amount (BUG-008)', async () => {
  const user = userEvent.setup();
  renderApp('/bot');
  const pho = await card('phở');

  drafts[0]!.status = 'confirmed'; // ✅ in Telegram saved it at 45.000 while the inbox stayed open
  const amount = within(pho).getByRole('textbox', { name: 'Số tiền (₫)' });
  await user.clear(amount);
  await user.type(amount, '99k');
  await user.click(within(pho).getByRole('button', { name: 'Xác nhận' }));

  expect(await screen.findByText('Giao dịch này đã được xác nhận.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('form', { name: 'phở' })).not.toBeInTheDocument());
  expect(writes()).toEqual(['POST /transactions/d1/confirm']); // one request: no PATCH that could change the saved entry
  expect(drafts[0]).toMatchObject({ amount: 45000, status: 'confirmed' });
});

test('TC-F7-06 link card: the code with a countdown, an app button with its QR and the /link command; unlink an account', async () => {
  const user = userEvent.setup();
  links = [{ id: 'l1', platform: 'telegram', displayName: 'Anh Nguyen', createdAt: NOW }];
  renderApp('/bot');

  const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
  const account = await within(linked).findByRole('listitem');
  expect(account).toHaveTextContent('Telegram · Anh Nguyen');
  expect(account).toHaveTextContent('Liên kết ngày 20 thg 11, 2026');

  await user.click(screen.getByRole('button', { name: 'Tạo mã liên kết' }));
  const linkCard = screen.getByRole('region', { name: CARD });
  expect(within(linkCard).getByText('Tạo mã một lần, có hiệu lực 10 phút, rồi gửi mã cho bot Telegram, WhatsApp hoặc Zalo.')).toBeInTheDocument();
  expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
  expect(document.activeElement).toHaveTextContent(/^Mã liên kếtABC234Hết hạn sau/); // the code replaced the button and has focus
  expect(within(linkCard).getByRole('timer')).toHaveTextContent(/Hết hạn sau (10:00|9:5\d)/);
  // Telegram is linked already, so the card starts on the next app (TC-F7-12).
  expect(within(linkCard).getByRole('link', { name: 'Mở WhatsApp' })).toHaveAttribute('href', WA('ABC234'));
  expect(within(linkCard).getByRole('img', { name: 'Mã QR mở WhatsApp với mã liên kết' })).toBeInTheDocument();
  expect(within(linkCard).getByText('/link ABC234')).toBeInTheDocument();

  await user.click(within(linked).getByRole('button', { name: 'Huỷ liên kết Telegram · Anh Nguyen' }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Huỷ liên kết?' })).getByRole('button', { name: 'Huỷ liên kết' }));
  expect(await within(linked).findByText('Chưa liên kết tài khoản chat nào.')).toBeInTheDocument();
  expect(writes()).toEqual(['DELETE /chat-links/l1']);
  await waitFor(() => expect(within(linked).getByRole('heading', { name: 'Tài khoản đã liên kết' })).toHaveFocus());
});

test('TC-F7-06 link card: an expired code offers a new one; no app button without app settings; 429 is translated', async () => {
  const user = userEvent.setup();
  codeAnswer = codeWith('XYZ789', {}, 1200);
  server.use(http.get('*/api/chat-links', () => fail(500, 'INTERNAL'), { once: true }));
  renderApp('/bot');

  const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
  expect(await within(linked).findByText('Không tải được danh sách tài khoản.')).toBeInTheDocument();
  await user.click(within(linked).getByRole('button', { name: 'Thử lại' }));
  expect(await within(linked).findByText('Chưa liên kết tài khoản chat nào.')).toBeInTheDocument();
  expect(within(linked).queryByText('Không tải được danh sách tài khoản.')).not.toBeInTheDocument();

  await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
  expect(await screen.findByText('XYZ789')).toBeInTheDocument();
  expect(screen.getByText('/link XYZ789')).toBeInTheDocument(); // typing the command works in any chat
  const linkCard = screen.getByRole('region', { name: CARD });
  expect(within(linkCard).queryByRole('link')).not.toBeInTheDocument();
  expect(within(linkCard).queryByRole('group', { name: 'Ứng dụng chat' })).not.toBeInTheDocument();
  expect(within(linkCard).queryByRole('img', { name: /^Mã QR/ })).not.toBeInTheDocument();
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

// BUG-031: the status line and the error are translated when shown, so they follow a language switch.
test('TC-F10-06 the receipt status and error switch to English with the rest of the page', async () => {
  const user = userEvent.setup();
  renderApp('/bot');
  await card('phở');
  const photo = new File([new Uint8Array(8)], 'IMG_0001.jpg', { type: 'image/jpeg' });

  await user.upload(screen.getByLabelText('Chọn ảnh hoá đơn'), photo);
  expect(await screen.findByRole('status')).toHaveTextContent('Đã tạo bản nháp từ hoá đơn.');
  receiptAnswer = () => fail(502, 'KIE_UNAVAILABLE');
  await user.upload(screen.getByLabelText('Chọn ảnh hoá đơn'), photo);
  expect(await screen.findByText('Dịch vụ đọc hoá đơn đang tạm ngưng. Vui lòng thử lại sau.')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Đổi ngôn ngữ sang English/ }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Bot inbox' })).toBeInTheDocument();
  expect(screen.getByText('The receipt reader is unavailable. Please try again later.')).toBeInTheDocument();

  receiptAnswer = () => HttpResponse.json({ transaction: drafts[0] }, { status: 201 });
  await user.upload(screen.getByLabelText('Choose receipt photo'), photo);
  expect(await screen.findByRole('status')).toHaveTextContent('A draft was created from the receipt.');
  await user.click(screen.getByRole('button', { name: /Change language to Tiếng Việt/ }));
  expect(await screen.findByRole('status')).toHaveTextContent('Đã tạo bản nháp từ hoá đơn.');
});

test('TC-F7-06 one click makes one code: Generate is disabled until it arrives, and the code does not wait for the link list', async () => {
  const user = userEvent.setup();
  renderApp('/bot');
  const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
  expect(await within(linked).findByText('Chưa liên kết tài khoản chat nào.')).toBeInTheDocument();

  let answerCode = () => {};
  const slowCode = new Promise<void>((resolve) => (answerCode = resolve)); // e.g. a cold start
  let posts = 0;
  codeAnswer = async () => {
    posts++;
    await slowCode;
    return codeWith('ABC234', { telegram: TG('ABC234') })();
  };
  const list = holdNextList(); // and the list stays slow after the code has arrived
  const generate = screen.getByRole('button', { name: 'Tạo mã liên kết' });
  await user.click(generate);
  await waitFor(() => expect(posts).toBe(1));
  expect(generate).toBeDisabled();

  answerCode();
  expect(await screen.findByText('ABC234')).toBeInTheDocument();
  await waitFor(() => expect(list.asked).toBe(true));
  expect(screen.queryByRole('button', { name: /^Tạo mã/ })).not.toBeInTheDocument(); // nothing left to press twice
  expect(posts).toBe(1);
  list.release();
});

test('TC-F7-06 a failed code request is translated when shown: its message follows a language switch (BUG-031)', async () => {
  const user = userEvent.setup();
  codeAnswer = () => fail(500, 'INTERNAL');
  renderApp('/bot');
  await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
  const linkCard = screen.getByRole('region', { name: CARD });
  expect(await within(linkCard).findByText('Máy chủ gặp sự cố. Vui lòng thử lại sau.')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Đổi ngôn ngữ sang English/ }));
  expect(await screen.findByText('The server ran into a problem. Please try again later.')).toBeInTheDocument();
  expect(screen.queryByText('Máy chủ gặp sự cố. Vui lòng thử lại sau.')).not.toBeInTheDocument();
});

// BUG-030: Telegram allows a 64-character first name with no spaces; it must wrap inside the card, not widen the page.
test('TC-F7-09 a long linked-chat name with no spaces may break anywhere, so it stays inside the card', async () => {
  const name = 'Nguyễn_Thị_Phương_Thảo_Official_Shop_Mỹ_Phẩm_Chính_Hãng_Giá_Rẻ';
  links = [{ id: 'l1', platform: 'telegram', displayName: name, createdAt: NOW }];
  renderApp('/bot');

  const text = await screen.findByText(`Telegram · ${name}`);
  expect(getComputedStyle(text).overflowWrap).toBe('anywhere');
});

test('TC-F9-04 opening the inbox again shows drafts confirmed in the chat meanwhile as gone (BUG-004)', async () => {
  const { router } = renderApp('/bot');
  expect(await screen.findByRole('heading', { level: 2, name: 'Bản nháp chờ duyệt (3)' })).toBeInTheDocument();

  // The user leaves the inbox, types "ok" in Zalo (the server confirms the draft), then comes back in the app.
  await act(() => router.navigate('/wallets'));
  drafts = drafts.map((d) => (d.id === 'd1' ? { ...d, status: 'confirmed' } : d));
  await act(() => router.navigate('/bot'));

  expect(await screen.findByRole('heading', { level: 2, name: 'Bản nháp chờ duyệt (2)' })).toBeInTheDocument();
  expect(screen.queryByRole('form', { name: 'phở' })).not.toBeInTheDocument();
});

// Zalo's QR only opens the bot (its link carries no code), so its name says just that.
const qrPathOf = (card: HTMLElement, app: string) =>
  within(card)
    .getByRole('img', { name: app === 'Zalo' ? 'Mã QR mở bot Zalo' : `Mã QR mở ${app} với mã liên kết` })
    .querySelector('path')
    ?.getAttribute('d');

test('TC-F7-12 link card: only configured apps are offered; the picker switches the button, the step and the QR', async () => {
  const user = userEvent.setup();
  codeAnswer = codeWith('ABC234', { telegram: TG('ABC234'), zalo: ZALO }); // no WHATSAPP_NUMBER on the server
  renderApp('/bot');
  await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));

  const linkCard = screen.getByRole('region', { name: CARD });
  const picker = await within(linkCard).findByRole('group', { name: 'Ứng dụng chat' });
  expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(['Telegram', 'Zalo']);
  expect(within(picker).getByRole('button', { name: 'Telegram' })).toHaveAttribute('aria-pressed', 'true'); // nothing linked: the first app
  expect(within(linkCard).getByRole('link', { name: 'Mở Telegram' })).toHaveAttribute('href', TG('ABC234'));
  expect(within(linkCard).getByText('Bấm nút bên dưới, rồi bấm Start (Bắt đầu) trong Telegram.')).toBeInTheDocument();
  expect(qrPathOf(linkCard, 'Telegram')).toBe(qrSvgPath(TG('ABC234')).path); // the QR holds the same link as the button

  await user.click(within(picker).getByRole('button', { name: 'Zalo' }));
  expect(within(picker).getByRole('button', { name: 'Zalo' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(linkCard).queryByRole('link', { name: 'Mở Telegram' })).not.toBeInTheDocument();
  expect(within(linkCard).getByRole('link', { name: 'Chép mã & mở Zalo' })).toHaveAttribute('href', ZALO);
  expect(within(linkCard).getByRole('link', { name: 'Chép mã & mở Zalo' })).toHaveAttribute('target', '_blank');
  expect(within(linkCard).getByText('Nút bên dưới chép /link ABC234 và mở bot Zalo: dán vào ô chat rồi gửi.')).toBeInTheDocument();
  expect(qrPathOf(linkCard, 'Zalo')).toBe(qrSvgPath(ZALO).path);
  expect(within(linkCard).getByText('ABC234')).toBeInTheDocument(); // the code stays on screen: the phone still needs it for Zalo
});

test('TC-F7-12 link card: with all three apps it starts on Telegram; picking WhatsApp swaps the button and QR and keeps focus on the picker', async () => {
  const user = userEvent.setup();
  renderApp('/bot');
  await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
  const linkCard = screen.getByRole('region', { name: CARD });
  const picker = await within(linkCard).findByRole('group', { name: 'Ứng dụng chat' });
  expect(within(picker).getAllByRole('button').map((b) => b.textContent)).toEqual(['Telegram', 'WhatsApp', 'Zalo']);
  expect(within(picker).getByRole('button', { name: 'Telegram' })).toHaveAttribute('aria-pressed', 'true');

  const whatsapp = within(picker).getByRole('button', { name: 'WhatsApp' });
  await user.click(whatsapp);
  expect(whatsapp).toHaveFocus();
  expect(within(linkCard).getByRole('link', { name: 'Mở WhatsApp' })).toHaveAttribute('href', WA('ABC234'));
  expect(qrPathOf(linkCard, 'WhatsApp')).toBe(qrSvgPath(WA('ABC234')).path);
});

test('TC-F7-12 link card: Telegram linked and no WhatsApp on the server: it starts on Zalo', async () => {
  const user = userEvent.setup();
  links = [{ id: 'l1', platform: 'telegram', displayName: 'Anh', createdAt: NOW }];
  codeAnswer = codeWith('ABC234', { telegram: TG('ABC234'), zalo: ZALO });
  renderApp('/bot');
  await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
  const picker = await screen.findByRole('group', { name: 'Ứng dụng chat' });
  await waitFor(() => expect(within(picker).getByRole('button', { name: 'Zalo' })).toHaveAttribute('aria-pressed', 'true'));
  expect(screen.getByRole('link', { name: 'Chép mã & mở Zalo' })).toHaveAttribute('href', ZALO);
});

test('TC-F7-12 link card: the default app is the first one not linked yet, else the first shown', async () => {
  const user = userEvent.setup();
  links = [
    { id: 'l1', platform: 'telegram', displayName: 'Anh', createdAt: NOW },
    { id: 'l2', platform: 'zalo', displayName: 'Anh', createdAt: NOW },
  ];
  renderApp('/bot');
  await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
  const picker = await screen.findByRole('group', { name: 'Ứng dụng chat' });
  await waitFor(() => expect(within(picker).getByRole('button', { name: 'WhatsApp' })).toHaveAttribute('aria-pressed', 'true'));
  expect(screen.getByRole('link', { name: 'Mở WhatsApp' })).toHaveAttribute('href', WA('ABC234'));
  expect(screen.getByText('Tin nhắn /link ABC234 đã được gõ sẵn: chỉ cần bấm Gửi.')).toBeInTheDocument();
});

test('TC-F7-12 link card: with every shown app linked already, it starts on the first one shown', async () => {
  const user = userEvent.setup();
  links = [
    { id: 'l1', platform: 'telegram', displayName: 'Anh', createdAt: NOW },
    { id: 'l2', platform: 'zalo', displayName: 'Anh', createdAt: NOW },
  ];
  codeAnswer = codeWith('DEF567', { telegram: TG('DEF567'), zalo: ZALO });
  renderApp('/bot');
  await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
  const picker = await screen.findByRole('group', { name: 'Ứng dụng chat' });
  expect(within(picker).getByRole('button', { name: 'Telegram' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('link', { name: 'Mở Telegram' })).toHaveAttribute('href', TG('DEF567'));
});

test('TC-F7-13 Zalo: "Copy & open Zalo" puts /link CODE on the clipboard; when copying fails the card says so and keeps the command', async () => {
  const user = userEvent.setup(); // gives jsdom a working clipboard
  codeAnswer = codeWith('ABC234', { zalo: ZALO });
  renderApp('/bot');
  await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));

  const linkCard = screen.getByRole('region', { name: CARD });
  const zalo = await within(linkCard).findByRole('link', { name: 'Chép mã & mở Zalo' });
  expect(within(linkCard).queryByRole('group', { name: 'Ứng dụng chat' })).not.toBeInTheDocument(); // one app: no picker
  expect(zalo).toHaveAttribute('href', ZALO);
  expect(zalo).toHaveAttribute('target', '_blank');
  expect(qrPathOf(linkCard, 'Zalo')).toBe(qrSvgPath(ZALO).path);
  expect(within(linkCard).getByText('ABC234')).toBeVisible();
  await user.click(zalo);
  expect(await navigator.clipboard.readText()).toBe('/link ABC234');
  expect((await within(linkCard).findByText('Đã chép /link ABC234')).closest('[role="status"]')).not.toBeNull();

  // Clipboard blocked (permission denied, or no clipboard on a plain-http page): never a dead end.
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
  await user.click(zalo);
  expect(writeText).toHaveBeenCalledWith('/link ABC234');
  const failure = await within(linkCard).findByText('Không chép được. Hãy tự chép tin nhắn bên dưới rồi gửi cho bot Zalo.');
  expect(failure.closest('[role="status"]')).not.toBeNull();
  const command = within(linkCard).getByText('/link ABC234');
  expect(command).toBeVisible();
  expect(getComputedStyle(command).userSelect).not.toBe('none');
});

test('TC-F7-14 the card says "Linked ✓ <app> · <name>" as soon as the 5 s check finds the new link', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    links = [{ id: 'l0', platform: 'zalo', displayName: 'Lan Zalo', createdAt: NOW }]; // linked before: not "new"
    renderApp('/bot');
    await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
    const linkCard = screen.getByRole('region', { name: CARD });
    expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(within(linkCard).queryByText(/Đã liên kết ✓/)).not.toBeInTheDocument();

    links = [...links, { id: 'l1', platform: 'telegram', displayName: 'Anh Nguyen', createdAt: at() }]; // the bot redeemed the code
    await act(() => vi.advanceTimersByTimeAsync(5000));
    const done = await within(linkCard).findByText('Đã liên kết ✓ Telegram · Anh Nguyen');
    expect(done.closest('[tabindex="-1"]')).toHaveFocus(); // the spent code left; focus follows the news, not <body>
    expect(within(linkCard).queryByText('ABC234')).not.toBeInTheDocument();
    expect(within(linkCard).getByRole('button', { name: 'Tạo mã mới' })).toBeInTheDocument(); // to link another app

    let checks = 0; // the spent code needs no more checks
    server.use(http.get('*/api/chat-links', () => (checks++, HttpResponse.json(links))));
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(checks).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F7-14 "Linked ✓" is announced in a status region and leaves focus in the draft the user is editing', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp('/bot');
    const amount = within(await card('phở')).getByRole('textbox', { name: 'Số tiền (₫)' });
    await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
    const linkCard = screen.getByRole('region', { name: CARD });
    expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
    const regions = within(linkCard).getAllByRole('status'); // already there before the news, so it gets read out
    await user.click(amount); // while the phone sends the code, the user goes on with a draft

    links = [{ id: 'l1', platform: 'telegram', displayName: 'Anh Nguyen', createdAt: at() }];
    await act(() => vi.advanceTimersByTimeAsync(5000));
    const done = await within(linkCard).findByText('Đã liên kết ✓ Telegram · Anh Nguyen');
    expect(regions).toContain(done.closest('[role="status"]'));
    expect(within(linkCard).queryByRole('alert')).not.toBeInTheDocument();
    expect(amount).toHaveFocus();
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F7-14 a chat linked in another tab while the page sat idle is not "Linked ✓" for the new code', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp('/bot');
    const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
    expect(await within(linked).findByText('Chưa liên kết tài khoản chat nào.')).toBeInTheDocument();

    links = [{ id: 'l1', platform: 'telegram', displayName: 'Other Tab', createdAt: at(60_000) }]; // linked on another device a minute ago
    await user.click(screen.getByRole('button', { name: 'Tạo mã liên kết' }));
    const linkCard = screen.getByRole('region', { name: CARD });
    expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
    expect(await within(linkCard).findByRole('link', { name: 'Mở WhatsApp' })).toBeInTheDocument(); // Telegram is linked now
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(within(linkCard).queryByText(/Đã liên kết ✓/)).not.toBeInTheDocument();
    expect(within(linkCard).getByText('ABC234')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F7-14 an expired, unused code is not "Linked ✓" when an unlink reloads the list with a link made elsewhere', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    links = [{ id: 'l0', platform: 'telegram', displayName: 'Old TG', createdAt: NOW }];
    codeAnswer = codeWith('ABC234', { telegram: TG('ABC234'), zalo: ZALO }, 3000);
    renderApp('/bot');
    const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
    await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
    const linkCard = screen.getByRole('region', { name: CARD });
    expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(await within(linkCard).findByText('Mã đã hết hạn. Hãy tạo mã mới.')).toBeInTheDocument();

    links = [...links, { id: 'l1', platform: 'zalo', displayName: 'Phone Zalo', createdAt: new Date().toISOString() }]; // linked elsewhere later
    await user.click(within(linked).getByRole('button', { name: 'Huỷ liên kết Telegram · Old TG' })); // the unlink reloads the list
    await user.click(within(await screen.findByRole('dialog', { name: 'Huỷ liên kết?' })).getByRole('button', { name: 'Huỷ liên kết' }));
    expect(await within(linked).findByText(/Zalo · Phone Zalo/)).toBeInTheDocument();
    await waitFor(() => expect(within(linked).getByRole('heading', { name: 'Tài khoản đã liên kết' })).toHaveFocus());
    expect(within(linkCard).queryByText(/Đã liên kết ✓/)).not.toBeInTheDocument();
    expect(within(linkCard).getByText('Mã đã hết hạn. Hãy tạo mã mới.')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F7-14 a code redeemed after the last 5 s check is "Linked ✓" once it expires, and not for the next code', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    codeAnswer = codeWith('ABC234', { telegram: TG('ABC234') }, 3000); // expires before the first 5 s check
    renderApp('/bot');
    const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
    await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
    const linkCard = screen.getByRole('region', { name: CARD });
    expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
    links = [{ id: 'l1', platform: 'telegram', displayName: 'Anh', createdAt: new Date().toISOString() }]; // redeemed just before it expired
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(await within(linkCard).findByText('Đã liên kết ✓ Telegram · Anh')).toBeInTheDocument(); // the last check at expiry
    expect(within(linkCard).queryByText('Mã đã hết hạn. Hãy tạo mã mới.')).not.toBeInTheDocument();
    expect(within(linked).getByText(/Telegram · Anh/)).toBeInTheDocument();

    codeAnswer = codeWith('XYZ567', { telegram: TG('XYZ567') });
    await user.click(within(linkCard).getByRole('button', { name: 'Tạo mã mới' }));
    expect(await within(linkCard).findByText('XYZ567')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(within(linkCard).queryByText(/Đã liên kết ✓/)).not.toBeInTheDocument();
    expect(within(linkCard).getByText('XYZ567')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F7-14 "Linked ✓", then unlink that account: no "Linked ✓" any more, Generate is offered', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp('/bot');
    const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
    await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
    const linkCard = screen.getByRole('region', { name: CARD });
    expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
    links = [{ id: 'l1', platform: 'telegram', displayName: 'Anh Nguyen', createdAt: new Date().toISOString() }];
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(await within(linkCard).findByText('Đã liên kết ✓ Telegram · Anh Nguyen')).toBeInTheDocument();

    await user.click(within(linked).getByRole('button', { name: 'Huỷ liên kết Telegram · Anh Nguyen' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Huỷ liên kết?' })).getByRole('button', { name: 'Huỷ liên kết' }));
    expect(await within(linked).findByText('Chưa liên kết tài khoản chat nào.')).toBeInTheDocument();
    expect(within(linkCard).queryByText(/Đã liên kết ✓/)).not.toBeInTheDocument();
    expect(await within(linkCard).findByRole('button', { name: 'Tạo mã liên kết' })).toBeInTheDocument(); // once the dialog has closed
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F7-14 a chat linked while an older list request is still running is not "Linked ✓" for the new code', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const firstLoad = holdNextList(); // the page's first list request, read before the link below exists
    renderApp('/bot');
    const generate = await screen.findByRole('button', { name: 'Tạo mã liên kết' });
    await waitFor(() => expect(firstLoad.asked).toBe(true));
    links = [{ id: 'l1', platform: 'telegram', displayName: 'Phone TG', createdAt: at(1000) }]; // linked on the phone
    await user.click(generate);
    const linkCard = screen.getByRole('region', { name: CARD });
    expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();

    firstLoad.release();
    // A new list request follows the old one at once (not only at the next 5 s check), so the card starts on WhatsApp.
    expect(await within(linkCard).findByRole('link', { name: 'Mở WhatsApp' })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(within(linkCard).queryByText(/Đã liên kết ✓/)).not.toBeInTheDocument();
    expect(within(linkCard).getByText('ABC234')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F7-14 the last check at expiry is sent even when an older list request is still running', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    codeAnswer = codeWith('ABC234', { telegram: TG('ABC234') }, 3000); // expires before the first 5 s check
    renderApp('/bot');
    const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
    expect(await within(linked).findByText('Chưa liên kết tài khoản chat nào.')).toBeInTheDocument();
    const running = holdNextList(); // the request made right after the code: still running when it expires
    await user.click(screen.getByRole('button', { name: 'Tạo mã liên kết' }));
    const linkCard = screen.getByRole('region', { name: CARD });
    expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
    await waitFor(() => expect(running.asked).toBe(true));
    links = [{ id: 'l1', platform: 'telegram', displayName: 'Anh', createdAt: at() }]; // redeemed after that request was read
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(within(linkCard).getByText('Mã đã hết hạn. Hãy tạo mã mới.')).toBeInTheDocument();

    running.release();
    expect(await within(linkCard).findByText('Đã liên kết ✓ Telegram · Anh')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F7-14 "Create a new code" while the last check is still running: an older link is not "Linked ✓" for the new code', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    codeAnswer = codeWith('ABC234', { telegram: TG('ABC234') }, 3000);
    renderApp('/bot');
    await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
    const linkCard = screen.getByRole('region', { name: CARD });
    expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1000)); // the list request made after the code is done
    const lastCheck = holdNextList();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    await waitFor(() => expect(lastCheck.asked).toBe(true));

    links = [{ id: 'l1', platform: 'telegram', displayName: 'Phone TG', createdAt: at() }]; // after ABC234 expired
    await act(() => vi.advanceTimersByTimeAsync(1000));
    codeAnswer = codeWith('XYZ567', { telegram: TG('XYZ567') });
    await user.click(within(linkCard).getByRole('button', { name: 'Tạo mã mới' }));
    expect(await within(linkCard).findByText('XYZ567')).toBeInTheDocument();
    lastCheck.release();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(within(linkCard).queryByText(/Đã liên kết ✓/)).not.toBeInTheDocument();
    expect(within(linkCard).getByText('XYZ567')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F7-14 one failed list request after the code does not turn "Linked ✓" off; the starting app comes from the list the page has', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    links = [{ id: 'l0', platform: 'telegram', displayName: 'Anh', createdAt: NOW }];
    renderApp('/bot');
    const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
    expect(await within(linked).findByText('Telegram · Anh')).toBeInTheDocument();
    let failed = 0;
    server.use(http.get('*/api/chat-links', () => (failed++, fail(500, 'INTERNAL')), { once: true }));
    await user.click(screen.getByRole('button', { name: 'Tạo mã liên kết' }));
    const linkCard = screen.getByRole('region', { name: CARD });
    expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
    expect(await within(linked).findByText('Không tải được danh sách tài khoản.')).toBeInTheDocument();
    expect(failed).toBe(1);
    expect(within(linkCard).getByRole('link', { name: 'Mở WhatsApp' })).toBeInTheDocument(); // Telegram is linked

    links = [...links, { id: 'l1', platform: 'zalo', displayName: 'Lan Zalo', createdAt: at() }]; // the bot redeemed the code
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(await within(linkCard).findByText('Đã liên kết ✓ Zalo · Lan Zalo')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('TC-F7-14 the app the user opened stays picked when a late list says it was linked already', async () => {
  const user = userEvent.setup();
  const firstLoad = holdNextList();
  links = [{ id: 'l0', platform: 'telegram', displayName: 'Anh', createdAt: NOW }];
  renderApp('/bot');
  await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
  const open = await screen.findByRole('link', { name: 'Mở Telegram' }); // no list yet: the first app
  await user.click(open);
  firstLoad.release();
  const linked = screen.getByRole('region', { name: 'Tài khoản đã liên kết' });
  expect(await within(linked).findByText('Telegram · Anh')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Mở Telegram' })).toBeInTheDocument();
});

// bug-prevention §1: Linked accounts and the link card name a chat with one shared function.
test('TC-F7-14 a chat with an empty name is named the same in "Linked ✓" and in Linked accounts', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp('/bot');
    const linked = await screen.findByRole('region', { name: 'Tài khoản đã liên kết' });
    await user.click(await screen.findByRole('button', { name: 'Tạo mã liên kết' }));
    const linkCard = screen.getByRole('region', { name: CARD });
    expect(await within(linkCard).findByText('ABC234')).toBeInTheDocument();
    links = [{ id: 'l1', platform: 'zalo', displayName: '', createdAt: at() }]; // Zalo may send no display name
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(await within(linkCard).findByText('Đã liên kết ✓ Zalo · zalo')).toBeInTheDocument();
    expect(within(linked).getByText('Zalo · zalo')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
