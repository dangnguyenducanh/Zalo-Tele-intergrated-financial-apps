import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, expect, test } from 'vitest';
import { onSessionChange } from '@/auth/session';
import { LAN, resetFake, server } from '@/test/fakeApi';
import { renderApp } from '@/test/renderApp';
import type { Wallet } from './walletsApi';

// An in-memory /api/wallets (MSW) with the docs/04 shapes; balance = initialBalance + this wallet's transactions.
let wallets: Wallet[] = [];
let inUse = new Set<string>(); // wallets with confirmed transactions → DELETE answers 409 WALLET_IN_USE
let sent: { method: string; body: unknown }[] = [];

const wallet = (fields: Partial<Wallet> & Pick<Wallet, 'id' | 'name'>): Wallet => ({
  type: 'cash',
  initialBalance: 0,
  balance: 0,
  aliases: [],
  color: '',
  icon: '',
  archived: false,
  ...fields,
});

beforeEach(() => {
  resetFake(LAN, true); // logged in as Lan, UI in Vietnamese
  wallets = [
    wallet({ id: 'w1', name: 'Tiền mặt', aliases: ['tm', 'cash'], initialBalance: 100000, balance: 120000 }),
    wallet({ id: 'w2', name: 'Thẻ cũ', type: 'credit', archived: true, balance: -50000, initialBalance: -50000 }),
  ];
  inUse = new Set(['w1']);
  sent = [];
  server.use(
    http.get('*/api/wallets', ({ request }) => {
      const all = new URL(request.url).searchParams.get('includeArchived') === 'true';
      return HttpResponse.json(wallets.filter((w) => all || !w.archived));
    }),
    http.post('*/api/wallets', async ({ request }) => {
      const body = (await request.json()) as Wallet;
      sent.push({ method: 'POST', body });
      const created = wallet({ ...body, id: `w${wallets.length + 1}`, balance: body.initialBalance });
      wallets.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch('*/api/wallets/:id', async ({ request, params }) => {
      const body = (await request.json()) as Partial<Wallet>;
      sent.push({ method: 'PATCH', body });
      wallets = wallets.map((w) => (w.id === params.id ? { ...w, ...body } : w));
      return HttpResponse.json(wallets.find((w) => w.id === params.id));
    }),
    http.delete('*/api/wallets/:id', ({ params }) => {
      sent.push({ method: 'DELETE', body: params.id });
      if (inUse.has(String(params.id))) {
        return HttpResponse.json({ error: { code: 'WALLET_IN_USE', message: 'in use' } }, { status: 409 });
      }
      wallets = wallets.filter((w) => w.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

test('TC-F2-06 wallets page shows a card per wallet with its computed balance; archived wallets apart', async () => {
  renderApp('/wallets');

  expect(await screen.findByRole('heading', { level: 1, name: 'Ví' })).toBeInTheDocument();
  const cash = await screen.findByRole('article', { name: 'Tiền mặt' });
  expect(cash).toHaveTextContent(/120\.000\s₫/); // the balance the API computed, not the opening balance
  expect(within(cash).getByText('tm')).toBeInTheDocument(); // bot aliases as chips

  const archived = screen.getByRole('region', { name: 'Ví đã lưu trữ' });
  expect(within(archived).getByRole('article', { name: 'Thẻ cũ' })).toHaveTextContent(/-50\.000\s₫/);
});

test('TC-F2-06 add wallet: validates, sends type, opening balance and normalised aliases; the new card appears', async () => {
  const user = userEvent.setup();
  renderApp('/wallets');

  await user.click(await screen.findByRole('button', { name: 'Thêm ví' }));
  const dialog = await screen.findByRole('dialog', { name: 'Thêm ví' });
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  const name = within(dialog).getByRole('textbox', { name: 'Tên ví' });
  expect(name).toHaveAccessibleDescription('Tên ví từ 1 đến 40 ký tự');
  expect(name).toHaveFocus();
  expect(sent).toEqual([]);

  await user.type(name, 'Momo');
  await user.click(within(dialog).getByRole('radio', { name: 'Ví điện tử' }));
  await user.type(within(dialog).getByRole('textbox', { name: 'Số dư ban đầu (₫)' }), '200.000');
  await user.type(within(dialog).getByRole('combobox', { name: 'Tên gọi tắt cho bot' }), 'Mô Mô{Enter}');
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent).toEqual([{ method: 'POST', body: { name: 'Momo', type: 'ewallet', initialBalance: 200000, aliases: ['mo mo'] } }]);
  // RTK Query refetched the list after the mutation (tag invalidation), so the card shows up by itself.
  expect(await screen.findByRole('article', { name: 'Momo' })).toHaveTextContent(/200\.000\s₫/);
});

test('TC-F2-06 edit a wallet, archive it, and a wallet in use cannot be deleted (explained)', async () => {
  const user = userEvent.setup();
  renderApp('/wallets');

  const cash = await screen.findByRole('article', { name: 'Tiền mặt' });
  await user.click(within(cash).getByRole('button', { name: 'Sửa ví Tiền mặt' }));
  const dialog = await screen.findByRole('dialog', { name: 'Sửa ví' });
  const name = within(dialog).getByRole('textbox', { name: 'Tên ví' });
  expect(name).toHaveValue('Tiền mặt');
  await user.clear(name);
  await user.type(name, 'Ví tiền');
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent.at(-1)).toEqual({
    method: 'PATCH',
    body: { name: 'Ví tiền', type: 'cash', initialBalance: 100000, aliases: ['tm', 'cash'] },
  });

  const renamed = await screen.findByRole('article', { name: 'Ví tiền' });
  await user.click(within(renamed).getByRole('button', { name: 'Xoá ví Ví tiền' }));
  await user.click(within(await screen.findByRole('dialog', { name: 'Xoá ví?' })).getByRole('button', { name: 'Xoá' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Ví đang có giao dịch nên không xoá được. Bạn có thể lưu trữ ví thay vì xoá.');
  expect(screen.getByRole('article', { name: 'Ví tiền' })).toBeInTheDocument();

  await user.click(within(screen.getByRole('article', { name: 'Ví tiền' })).getByRole('button', { name: 'Lưu trữ ví Ví tiền' }));
  expect(sent.at(-1)).toEqual({ method: 'PATCH', body: { archived: true } });
  const archived = screen.getByRole('region', { name: 'Ví đã lưu trữ' });
  expect(await within(archived).findByRole('article', { name: 'Ví tiền' })).toBeInTheDocument();
});

test('TC-F2-08 archiving the default wallet clears the default in the app too, so the Add form stops preselecting it (BUG-016)', async () => {
  resetFake({ ...LAN, defaultWalletId: 'w1' }, true);
  const users: (string | null | undefined)[] = [];
  const stop = onSessionChange((session) => users.push(session?.user.defaultWalletId));
  const user = userEvent.setup();
  renderApp('/wallets');

  await user.click(within(await screen.findByRole('article', { name: 'Tiền mặt' })).getByRole('button', { name: 'Lưu trữ ví Tiền mặt' }));
  await waitFor(() => expect(users.at(-1)).toBeNull()); // the server cleared it as well (TC-F2-07)
  stop();
});

test('TC-F4-13 an opening balance beyond ±10^13 ₫ is marked at the field with the range, and nothing is sent (BUG-032)', async () => {
  const user = userEvent.setup();
  renderApp('/wallets');

  await user.click(await screen.findByRole('button', { name: 'Thêm ví' }));
  const dialog = await screen.findByRole('dialog', { name: 'Thêm ví' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Tên ví' }), 'Thẻ lớn');
  const balance = within(dialog).getByRole('textbox', { name: 'Số dư ban đầu (₫)' });
  await user.type(balance, '-10000000000001');
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));

  expect(balance).toHaveAccessibleDescription(/^Từ -10\.000\.000\.000\.000\s₫ đến 10\.000\.000\.000\.000\s₫$/);
  expect(balance).toHaveFocus();
  expect(sent).toEqual([]);
});

test('TC-F2-11 a negative opening balance is marked at the field unless the type is credit card, and nothing is sent (BUG-038)', async () => {
  const user = userEvent.setup();
  renderApp('/wallets');

  await user.click(await screen.findByRole('button', { name: 'Thêm ví' }));
  const dialog = await screen.findByRole('dialog', { name: 'Thêm ví' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Tên ví' }), 'Di net');
  await user.click(within(dialog).getByRole('radio', { name: 'Ví điện tử' }));
  const balance = within(dialog).getByRole('textbox', { name: 'Số dư ban đầu (₫)' });
  await user.type(balance, '-999.000');
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));

  expect(sent).toEqual([]);
  expect(balance).toHaveAccessibleDescription('Chỉ thẻ tín dụng mới được có số dư âm');
  expect(balance).toHaveFocus();

  await user.click(within(dialog).getByRole('radio', { name: 'Thẻ tín dụng' }));
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent).toEqual([{ method: 'POST', body: { name: 'Di net', type: 'credit', initialBalance: -999000, aliases: [] } }]);
});

test('TC-F2-11 a wallet saved below zero before the rule can still be renamed; a new negative value or type is still marked (BUG-038)', async () => {
  wallets.push(
    wallet({ id: 'w3', name: 'Di net', type: 'ewallet', initialBalance: -999000, balance: -999000 }),
    wallet({ id: 'w4', name: 'Visa', type: 'credit', initialBalance: -500000, balance: -500000 }),
  );
  const user = userEvent.setup();
  renderApp('/wallets');

  // Rename only: the stored type and balance are sent back unchanged, which the server accepts.
  await user.click(within(await screen.findByRole('article', { name: 'Di net' })).getByRole('button', { name: 'Sửa ví Di net' }));
  let dialog = await screen.findByRole('dialog', { name: 'Sửa ví' });
  await user.type(within(dialog).getByRole('textbox', { name: 'Tên ví' }), ' cũ');
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(sent).toEqual([{ method: 'PATCH', body: { name: 'Di net cũ', type: 'ewallet', initialBalance: -999000, aliases: [] } }]);

  // Another negative opening balance on the same e-wallet is a change, so the rule applies.
  await user.click(within(await screen.findByRole('article', { name: 'Di net cũ' })).getByRole('button', { name: 'Sửa ví Di net cũ' }));
  dialog = await screen.findByRole('dialog', { name: 'Sửa ví' });
  let balance = within(dialog).getByRole('textbox', { name: 'Số dư ban đầu (₫)' });
  await user.clear(balance);
  await user.type(balance, '-500000');
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  expect(balance).toHaveAccessibleDescription('Chỉ thẻ tín dụng mới được có số dư âm');
  await user.click(within(dialog).getByRole('button', { name: 'Huỷ' }));

  // A credit card in debt switched to e-wallet keeps its negative balance, so it is marked too.
  await user.click(within(screen.getByRole('article', { name: 'Visa' })).getByRole('button', { name: 'Sửa ví Visa' }));
  dialog = await screen.findByRole('dialog', { name: 'Sửa ví' });
  await user.click(within(dialog).getByRole('radio', { name: 'Ví điện tử' }));
  await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
  balance = within(dialog).getByRole('textbox', { name: 'Số dư ban đầu (₫)' });
  expect(balance).toHaveAccessibleDescription('Chỉ thẻ tín dụng mới được có số dư âm');
  expect(balance).toHaveFocus();
  expect(sent).toHaveLength(1); // only the rename went out
});
