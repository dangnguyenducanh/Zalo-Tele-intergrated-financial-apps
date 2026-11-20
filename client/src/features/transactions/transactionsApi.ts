import { api } from '@/app/api';

// Response shapes of /api/transactions (docs/04 §4.4, server/src/models/Transaction.js).
export type TransactionType = 'expense' | 'income';
export type TransactionStatus = 'draft' | 'confirmed';

export type Transaction = {
  id: string;
  type: TransactionType;
  amount: number; // whole VND, always positive; the type says which way the money went
  walletId: string;
  categoryId: string;
  occurredAt: string; // ISO date-time
  note: string;
  status: TransactionStatus; // bots and receipts create drafts; the web saves straight away as confirmed
  source: 'web' | 'telegram' | 'zalo' | 'receipt';
};

export type TransactionInput = Pick<Transaction, 'type' | 'amount' | 'walletId' | 'categoryId' | 'occurredAt' | 'note'>;

// POST /transactions/parse: one draft per line that has an amount. The ids are null when the user has no
// wallet, or no fallback category of that type.
export type ParsedDraft = Omit<TransactionInput, 'walletId' | 'categoryId'> & { walletId: string | null; categoryId: string | null };

// GET /transactions query string; every filter is optional (docs/04 §4.4).
export type TransactionQuery = {
  from?: string; // YYYY-MM-DD, Vietnamese calendar day, included
  to?: string;
  type?: string;
  walletId?: string;
  categoryId?: string;
  status?: string;
  q?: string;
  page?: number;
};

export type Paginated<T> = { items: T[]; page: number; limit: number; total: number };

// A transaction changes wallet balances, statistics and budget usage, so every write refreshes them too.
const CHANGED = ['Transaction', 'Wallet', 'Stats', 'Budget'] as const;

export const transactionsApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getTransactions: builder.query<Paginated<Transaction>, TransactionQuery>({
      query: (params) => ({ url: '/transactions', params }),
      providesTags: ['Transaction'],
    }),
    // Read-only preview for the quick-add box: a query (cached per text), even though it is a POST.
    // The result holds wallet/category ids found by alias and keyword, so a change to either re-parses.
    parseTransactions: builder.query<{ drafts: ParsedDraft[] }, string>({
      query: (text) => ({ url: '/transactions/parse', method: 'POST', body: { text } }),
      providesTags: ['Wallet', 'Category'],
    }),
    createTransaction: builder.mutation<Transaction, TransactionInput>({
      query: (body) => ({ url: '/transactions', method: 'POST', body }),
      invalidatesTags: [...CHANGED],
    }),
    updateTransaction: builder.mutation<Transaction, { id: string } & Partial<TransactionInput>>({
      query: ({ id, ...body }) => ({ url: `/transactions/${id}`, method: 'PATCH', body }),
      invalidatesTags: [...CHANGED],
    }),
    deleteTransaction: builder.mutation<void, string>({
      query: (id) => ({ url: `/transactions/${id}`, method: 'DELETE' }),
      invalidatesTags: [...CHANGED],
    }),
    restoreTransaction: builder.mutation<Transaction, string>({
      query: (id) => ({ url: `/transactions/${id}/restore`, method: 'POST' }),
      invalidatesTags: [...CHANGED],
    }),
  }),
});

export const {
  useGetTransactionsQuery,
  useParseTransactionsQuery,
  useLazyParseTransactionsQuery,
  useCreateTransactionMutation,
  useUpdateTransactionMutation,
  useDeleteTransactionMutation,
  useRestoreTransactionMutation,
} = transactionsApi;
