import type { ParsedDraft, TransactionInput } from '@/features/transactions/transactionsApi';

// The save path of a preview line, shared by the QuickAdd box and the drawer's capture card (docs/05 §5.10.1): only a line with a
// wallet and a category can be saved, and what is sent is the transaction, not the hints the preview carried.
export const isComplete = (draft: ParsedDraft): draft is TransactionInput => Boolean(draft.walletId && draft.categoryId);
export const toInput = ({ type, amount, walletId, categoryId, occurredAt, note }: TransactionInput): TransactionInput => ({ type, amount, walletId, categoryId, occurredAt, note });
