import { api } from '@/app/api';

// Response shapes of /api/wallets (docs/04 §4.4, server/src/models/Wallet.js).
export type WalletType = 'cash' | 'bank' | 'ewallet' | 'credit';

export type Wallet = {
  id: string;
  name: string;
  type: WalletType;
  initialBalance: number; // opening balance, whole VND (may be negative for a credit card)
  balance: number; // computed by the server: initialBalance + confirmed income − confirmed expense
  aliases: string[]; // bot shortcuts such as "mm", lower-case without diacritics
  color: string;
  icon: string;
  archived: boolean;
};

export type WalletInput = Pick<Wallet, 'name' | 'type' | 'initialBalance' | 'aliases'>;

// Every wallet mutation invalidates the `Wallet` tag, so every screen that shows wallets refetches them.
export const walletsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getWallets: builder.query<Wallet[], { includeArchived?: boolean } | void>({
      query: (arg) => ({ url: '/wallets', params: arg?.includeArchived ? { includeArchived: 'true' } : undefined }),
      providesTags: ['Wallet'],
    }),
    createWallet: builder.mutation<Wallet, WalletInput>({
      query: (body) => ({ url: '/wallets', method: 'POST', body }),
      invalidatesTags: ['Wallet'],
    }),
    updateWallet: builder.mutation<Wallet, { id: string } & Partial<WalletInput & Pick<Wallet, 'archived'>>>({
      query: ({ id, ...body }) => ({ url: `/wallets/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Wallet'],
    }),
    deleteWallet: builder.mutation<void, string>({
      query: (id) => ({ url: `/wallets/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Wallet'],
    }),
  }),
});

export const { useGetWalletsQuery, useCreateWalletMutation, useUpdateWalletMutation, useDeleteWalletMutation } = walletsApi;
