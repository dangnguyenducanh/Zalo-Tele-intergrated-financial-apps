import { api } from '@/app/api';
import type { Transaction } from '@/features/transactions/transactionsApi';

// Response shapes of /api/chat-links and /api/receipts, and of drafts (docs/04 §4.4, server/src/models/Transaction.js).
export type ChatLink = { id: string; platform: 'telegram' | 'zalo'; displayName: string; createdAt: string };

// POST /chat-links/code. telegramDeepLink is null when the server has no TELEGRAM_BOT_USERNAME.
export type LinkCode = { code: string; expiresAt: string; telegramDeepLink: string | null };

export type ReceiptItem = { name: string; quantity?: number; unitPrice?: number; amount?: number };

// A draft is a transaction with status "draft". Receipt drafts also carry what KIE read from the photo.
export type Draft = Transaction & {
  receipt?: { merchant?: string; total?: number; items: ReceiptItem[]; reconciled?: boolean };
};

export type BudgetWarning = { percent: number; threshold: 80 | 100 };

// Confirming changes balances, statistics and budgets, like any transaction write (see transactionsApi.ts).
const CHANGED = ['Transaction', 'Wallet', 'Stats', 'Budget'] as const;

export const botApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getChatLinks: builder.query<ChatLink[], void>({
      query: () => '/chat-links',
      providesTags: ['ChatLink'],
    }),
    createLinkCode: builder.mutation<LinkCode, void>({
      query: () => ({ url: '/chat-links/code', method: 'POST' }),
    }),
    deleteChatLink: builder.mutation<void, string>({
      query: (id) => ({ url: `/chat-links/${id}`, method: 'DELETE' }),
      invalidatesTags: ['ChatLink'],
    }),
    // ponytail: the newest 100 drafts, no paging; add it if an inbox ever holds more.
    getDrafts: builder.query<{ items: Draft[]; total: number }, void>({
      query: () => ({ url: '/transactions', params: { status: 'draft', limit: 100 } }),
      providesTags: ['Transaction', 'Draft'],
    }),
    // Tags are invalidated after an error answer too, so a draft already confirmed in the chat (409) leaves the list.
    confirmDraft: builder.mutation<{ transaction: Transaction; budgetWarning?: BudgetWarning }, string>({
      query: (id) => ({ url: `/transactions/${id}/confirm`, method: 'POST' }),
      invalidatesTags: [...CHANGED],
    }),
    // multipart/form-data with the resized photo in field "image" → a new receipt draft.
    uploadReceipt: builder.mutation<{ transaction: Draft }, Blob>({
      query: (image) => {
        const body = new FormData();
        body.append('image', image, 'receipt.jpg');
        return { url: '/receipts', method: 'POST', body };
      },
      invalidatesTags: ['Transaction'],
    }),
  }),
});

export const {
  useGetChatLinksQuery,
  useCreateLinkCodeMutation,
  useDeleteChatLinkMutation,
  useGetDraftsQuery,
  useConfirmDraftMutation,
  useUploadReceiptMutation,
} = botApi;
