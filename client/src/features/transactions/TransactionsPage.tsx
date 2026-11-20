import AddIcon from '@mui/icons-material/Add';
import { Alert, Button, CircularProgress, Pagination, Snackbar, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAppDispatch } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import EmptyState from '@/components/EmptyState';
import QuickAdd from '@/components/QuickAdd';
import { apiErrorMessage } from '@/features/categories/helpers';
import { FILTER_KEYS, type FilterKey, type Filters } from './helpers';
import TransactionDialog from './TransactionDialog';
import TransactionFilters from './TransactionFilters';
import TransactionList from './TransactionList';
import {
  useCreateTransactionMutation,
  useDeleteTransactionMutation,
  useGetTransactionsQuery,
  useRestoreTransactionMutation,
  useUpdateTransactionMutation,
  type Transaction,
  type TransactionInput,
} from './transactionsApi';
import { useDebounced } from './useDebounced';

// /transactions (docs/05 §5.7): quick add, filter bar synced to the URL query string, a paginated table
// (cards on phones), add/edit dialog, and delete with an Undo snackbar (POST /transactions/:id/restore).
export default function TransactionsPage() {
  const { t } = useTranslation('transactions');
  const dispatch = useAppDispatch();
  const [params, setParams] = useSearchParams();
  const filters: Filters = Object.fromEntries(FILTER_KEYS.flatMap((key) => (params.get(key) ? [[key, params.get(key)]] : [])));
  const page = Number(params.get('page')) || 1;
  const q = useDebounced(filters.q, 300); // search after a typing pause, not on every key
  const { data, isLoading, isError, refetch } = useGetTransactionsQuery({ ...filters, q, page });
  const [createTransaction] = useCreateTransactionMutation();
  const [updateTransaction] = useUpdateTransactionMutation();
  const [deleteTransaction] = useDeleteTransactionMutation();
  const [restoreTransaction] = useRestoreTransactionMutation();
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null); // which dialog is open
  const [undoable, setUndoable] = useState<Transaction | null>(null); // the last deleted one, while Undo is offered

  // A filter change replaces the history entry (typing in search must not add one per key) and goes back to page 1.
  function setFilter(key: FilterKey, value: string) {
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }

  function setPage(value: number) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set('page', String(value));
      return next;
    });
  }

  const fail = (error: unknown) => dispatch(showSnackbar({ message: apiErrorMessage(error), severity: 'error' }));

  async function save(fields: TransactionInput) {
    if (editing && editing !== 'new') await updateTransaction({ id: editing.id, ...fields }).unwrap();
    else await createTransaction(fields).unwrap();
    dispatch(showSnackbar({ message: t('saved'), severity: 'success' }));
  }

  async function remove(transaction: Transaction) {
    try {
      await deleteTransaction(transaction.id).unwrap(); // soft delete, so it can come back
      setUndoable(transaction);
    } catch (error) {
      fail(error);
    }
  }

  async function undo() {
    const transaction = undoable;
    setUndoable(null);
    if (!transaction) return;
    try {
      await restoreTransaction(transaction.id).unwrap();
      dispatch(showSnackbar({ message: t('restored'), severity: 'success' }));
    } catch (error) {
      fail(error);
    }
  }

  const filtered = Object.keys(filters).length > 0;
  const pages = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <>
      <title>{`${t('title')} · ${t('common:appName')}`}</title>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ typography: { xs: 'h5', sm: 'h4' } }}>
          {t('title')}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
          {t('add')}
        </Button>
      </Stack>

      <QuickAdd />
      <TransactionFilters filters={filters} onChange={setFilter} onClear={() => setParams({}, { replace: true })} />

      {isLoading && <CircularProgress aria-label={t('common:loading')} sx={{ display: 'block', mx: 'auto', my: 4 }} />}
      {isError && (
        <Alert severity="error" action={<Button onClick={() => void refetch()}>{t('retry')}</Button>}>
          {t('loadError')}
        </Alert>
      )}
      {data && data.total === 0 && (
        <EmptyState headingLevel="h2" heading={t(filtered ? 'noMatch' : 'empty')} description={filtered ? undefined : t('emptyHint')} />
      )}
      {data && data.items.length > 0 && (
        <>
          <Typography sx={{ color: 'text.secondary', mb: 1 }}>{t('total', { count: data.total })}</Typography>
          <TransactionList items={data.items} onEdit={setEditing} onDelete={(transaction) => void remove(transaction)} />
        </>
      )}
      {pages > 1 && (
        <Pagination
          count={pages}
          page={page}
          onChange={(_event, value) => setPage(value)}
          aria-label={t('pagination')}
          getItemAriaLabel={(type, number) => t(`pages.${type}`, { page: number })}
          sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}
        />
      )}

      {editing && (
        <TransactionDialog
          title={t(editing === 'new' ? 'dialog.addTitle' : 'dialog.editTitle')}
          submitLabel={t('dialog.save')}
          initial={editing === 'new' ? undefined : editing}
          onSubmit={save}
          onClose={() => setEditing(null)}
        />
      )}
      {/* Paused while hovered or focused (MUI), so there is time to reach Undo with the keyboard. */}
      <Snackbar
        key={undoable?.id}
        open={undoable !== null}
        autoHideDuration={8000}
        onClose={(_event, reason) => reason !== 'clickaway' && setUndoable(null)}
        message={t('deleted')}
        action={
          <Button color="inherit" size="small" onClick={() => void undo()}>
            {t('undo')}
          </Button>
        }
        sx={{ bottom: { xs: 80, md: 24 } }}
      />
    </>
  );
}
