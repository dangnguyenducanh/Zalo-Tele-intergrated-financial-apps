import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { alpha, Alert, Box, Button, Card, CardActions, CardContent, CircularProgress, Grid, IconButton, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import ConfirmDialog from '@/components/ConfirmDialog';
import EmptyState from '@/components/EmptyState';
import MonthPicker from '@/components/MonthPicker';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { apiErrorMessage } from '@/features/categories/helpers';
import { formatMoney } from '@/i18n/format';
import BudgetDialog from './BudgetDialog';
import { budgetLevel, useCopyBudgetsMutation, useDeleteBudgetMutation, useGetBudgetsQuery, type Budget } from './budgetsApi';

const LEVEL_COLOR = { ok: 'success', warn: 'warning', over: 'error' } as const; // theme palette keys

// "2026-11" → "2026-10" (January goes back to December of the year before).
function previousMonth(month: string): string {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 2, 1)).toISOString().slice(0, 7);
}

// /budgets (docs/05 §5.7): the month picked in the shared MonthPicker, a progress bar per budget with a text
// label (colour is never the only signal), add/edit/delete, and "Copy from last month" (POST /budgets/copy).
export default function BudgetsPage() {
  const { t } = useTranslation('budgets');
  const dispatch = useAppDispatch();
  const month = useAppSelector((s) => s.ui.month);
  const language = useAppSelector((s) => s.ui.language);
  // currentData, not data: data can still be the previous month's answer while this one loads.
  const { currentData: budgets, isFetching, isError, refetch } = useGetBudgetsQuery(month);
  const { data: categories = [] } = useGetCategoriesQuery();
  const [copyBudgets, copying] = useCopyBudgetsMutation();
  const [deleteBudget] = useDeleteBudgetMutation();
  const [editing, setEditing] = useState<Budget | 'new' | null>(null); // which dialog is open
  const [deleting, setDeleting] = useState<Budget | null>(null);

  const nameOf = (budget: Budget) => {
    if (!budget.categoryId) return t('overall');
    const category = categories.find((c) => c.id === budget.categoryId);
    return category ? categoryName(category, language) : '';
  };
  const fail = (error: unknown) => dispatch(showSnackbar({ message: apiErrorMessage(error), severity: 'error' }));

  async function copyLastMonth() {
    try {
      const { created } = await copyBudgets({ from: previousMonth(month), to: month }).unwrap();
      const message = created > 0 ? t('copied', { count: created }) : t('nothingToCopy');
      dispatch(showSnackbar({ message, severity: created > 0 ? 'success' : 'info' }));
    } catch (error) {
      fail(error);
    }
  }

  async function remove(budget: Budget) {
    try {
      await deleteBudget(budget.id).unwrap();
      dispatch(showSnackbar({ message: t('deleted'), severity: 'success' }));
    } catch (error) {
      fail(error);
    }
  }

  return (
    <>
      <title>{`${t('title')} · ${t('common:appName')}`}</title>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        <Typography variant="h4" component="h1" sx={{ typography: { xs: 'h5', sm: 'h4' } }}>
          {t('title')}
        </Typography>
        <MonthPicker />
      </Stack>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, mb: 3 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
          {t('add')}
        </Button>
        <Button variant="outlined" startIcon={<ContentCopyIcon />} loading={copying.isLoading} onClick={() => void copyLastMonth()}>
          {t('copy')}
        </Button>
      </Stack>

      {isFetching && !budgets && <CircularProgress aria-label={t('common:loading')} sx={{ display: 'block', mx: 'auto', my: 4 }} />}
      {isError && (
        <Alert severity="error" action={<Button onClick={() => void refetch()}>{t('retry')}</Button>}>
          {t('loadError')}
        </Alert>
      )}
      {budgets?.length === 0 && <EmptyState headingLevel="h2" heading={t('empty')} description={t('emptyHint')} />}

      <Grid container spacing={2}>
        {budgets?.map((budget) => (
          <BudgetCard
            key={budget.id}
            budget={budget}
            name={nameOf(budget)}
            onEdit={() => setEditing(budget)}
            onDelete={() => setDeleting(budget)}
          />
        ))}
      </Grid>

      {editing && (
        <BudgetDialog
          month={month}
          budget={editing === 'new' ? undefined : { value: editing, name: nameOf(editing) }}
          taken={budgets?.map((b) => b.categoryId) ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteConfirm.title')}
        message={t('deleteConfirm.message', { name: deleting ? nameOf(deleting) : '' })}
        confirmLabel={t('deleteConfirm.confirm')}
        destructive
        onConfirm={() => {
          const budget = deleting;
          setDeleting(null);
          if (budget) void remove(budget);
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

type CardProps = { budget: Budget; name: string; onEdit: () => void; onDelete: () => void };

function BudgetCard({ budget, name, onEdit, onDelete }: CardProps) {
  const { t } = useTranslation('budgets');
  const language = useAppSelector((s) => s.ui.language);
  const level = budgetLevel(budget);
  const money = (amount: number) => formatMoney(amount, language);
  const left = budget.limit - budget.spent;
  const nameId = `budget-${budget.id}`;
  return (
    <Grid size={{ xs: 12, sm: 6 }}>
      <Card component="article" aria-labelledby={nameId} variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6" component="h2" id={nameId} noWrap sx={{ minWidth: 0 }}>
              {name}
            </Typography>
            {/* The level in words beside a coloured dot: colour is never the only signal, and the text keeps full contrast. */}
            <Stack
              direction="row"
              spacing={0.75}
              sx={{ alignItems: 'center', flexShrink: 0, px: 1.25, py: 0.25, borderRadius: '999px', bgcolor: 'panel2' }}
            >
              <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: `${LEVEL_COLOR[level]}.main` }} />
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {t(`level.${level}`)}
              </Typography>
            </Stack>
          </Stack>
          {/* Native <progress> (modern-web-guidance `progress`): role="progressbar" for free. Its bar and fill are
              styled through the engine pseudo-elements; accent-color still paints it where those are not supported. */}
          <Box
            component="progress"
            value={Math.min(budget.spent, budget.limit)}
            max={budget.limit}
            aria-labelledby={nameId}
            aria-describedby={`${nameId}-usage`}
            sx={(theme) => {
              const fill = theme.palette[LEVEL_COLOR[level]].main;
              const track = alpha(theme.palette.text.primary, 0.08);
              return {
                display: 'block',
                width: '100%',
                height: 8,
                my: 1.75,
                border: 0,
                borderRadius: '999px',
                overflow: 'hidden',
                appearance: 'none',
                accentColor: fill,
                bgcolor: track,
                '&::-webkit-progress-bar': { backgroundColor: track, borderRadius: '999px' },
                '&::-webkit-progress-value': { backgroundColor: fill, borderRadius: '999px' },
                '&::-moz-progress-bar': { backgroundColor: fill, borderRadius: '999px' },
              };
            }}
          />
          <Typography id={`${nameId}-usage`} variant="body2">
            {t('usage', { spent: money(budget.spent), limit: money(budget.limit), percent: budget.percent })}
          </Typography>
          <Typography variant="body2" sx={left < 0 ? { color: 'error.main', fontWeight: 600 } : { color: 'text.secondary' }}>
            {left < 0 ? t('over', { amount: money(-left) }) : t('left', { amount: money(left) })}
          </Typography>
        </CardContent>
        <CardActions sx={{ px: 1.5, pt: 0 }}>
          <IconButton aria-label={t('actions.edit', { name })} onClick={onEdit}>
            <EditIcon />
          </IconButton>
          <IconButton aria-label={t('actions.delete', { name })} onClick={onDelete}>
            <DeleteIcon />
          </IconButton>
        </CardActions>
      </Card>
    </Grid>
  );
}
