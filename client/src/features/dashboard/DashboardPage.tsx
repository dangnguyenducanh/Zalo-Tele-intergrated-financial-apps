import { Alert, Box, Button, CircularProgress, Grid, LinearProgress, Link, Paper, Stack, Typography } from '@mui/material';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';
import { useAppSelector } from '@/app/hooks';
import { useAuth } from '@/auth/useAuth';
import MoneyText from '@/components/MoneyText';
import MonthPicker from '@/components/MonthPicker';
import QuickAdd from '@/components/QuickAdd';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { DEFAULT_COLOR } from '@/features/categories/icons';
import { signedMoney } from '@/features/transactions/helpers';
import { useGetTransactionsQuery } from '@/features/transactions/transactionsApi';
import { useGetWalletsQuery } from '@/features/wallets/walletsApi';
import { formatDate, formatMoney } from '@/i18n/format';
import { moneySx } from '@/theme/theme';
import { CategoryBreakdown, DailyBars } from './Charts';
import { useGetByCategoryQuery, useGetDailyQuery, useGetSummaryQuery, type MonthSummary } from './statsApi';

// "/" (docs/05 §5.7): quick add, the shared MonthPicker, the month's four figures in one strip, daily bars and a
// ranked category breakdown (each with a text summary), a "drafts waiting" banner linking to the bot inbox, and
// the latest 5 transactions as ledger rows. Every query is tagged, so a quick add, a budget change or a new month
// refreshes the numbers by itself.
export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const month = useAppSelector((s) => s.ui.month);
  // currentData, not data: while another month loads, data still holds the previous month's numbers.
  const summary = useGetSummaryQuery(month);
  const byCategory = useGetByCategoryQuery(month);
  const daily = useGetDailyQuery(month);
  const { data: drafts } = useGetTransactionsQuery({ status: 'draft' }); // only `total` is used
  const stats = [summary, byCategory, daily];
  const failed = stats.some((query) => query.isError);

  return (
    <>
      <title>{`${t('title')} · ${t('common:appName')}`}</title>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
        <Typography variant="h5" component="h1">
          {t('common:home.title', { name: user?.name })}
        </Typography>
        <MonthPicker />
      </Stack>

      <QuickAdd />

      {drafts && drafts.total > 0 && (
        <Alert
          severity="info"
          role="status" // news, not an error: announced politely
          action={
            <Button component={RouterLink} to="/bot" color="inherit" size="small">
              {t('openInbox')}
            </Button>
          }
          sx={{ mb: 2 }}
        >
          {t('drafts', { count: drafts.total })}
        </Alert>
      )}
      {failed && (
        <Alert severity="error" action={<Button onClick={() => stats.forEach((query) => void query.refetch())}>{t('retry')}</Button>} sx={{ mb: 2 }}>
          {t('loadError')}
        </Alert>
      )}
      {!summary.currentData && summary.isFetching && <CircularProgress aria-label={t('common:loading')} sx={{ display: 'block', mx: 'auto', my: 4 }} />}

      <Stack spacing={2}>
        {summary.currentData && <SummaryStrip summary={summary.currentData} />}
        <Grid container spacing={2}>
          {daily.currentData && (
            <Grid size={{ xs: 12, md: 8 }}>
              <DailyBars days={daily.currentData} />
            </Grid>
          )}
          {byCategory.currentData && (
            <Grid size={{ xs: 12, md: 4 }}>
              <CategoryBreakdown rows={byCategory.currentData} />
            </Grid>
          )}
        </Grid>
        <LatestTransactions />
      </Stack>
    </>
  );
}

// Income, expense, net and what is left of the month's overall budget: four cells of one panel, split by hairlines.
function SummaryStrip({ summary }: { summary: MonthSummary }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { budget } = summary;
  const left = budget && budget.limit - budget.spent;
  const used = budget ? Math.round((budget.spent / budget.limit) * 100) : 0;
  return (
    <Paper
      variant="outlined"
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: '1px', bgcolor: 'divider', overflow: 'hidden' }}
    >
      <Figure label={t('cards.income')} amount={summary.income} color="success.main" />
      <Figure label={t('cards.expense')} amount={summary.expense} />
      <Figure label={t('cards.net')} amount={summary.net} color={summary.net < 0 ? 'error.main' : undefined} />
      <Figure label={t('cards.budgetLeft')} amount={left} color={left !== null && left < 0 ? 'error.main' : undefined}>
        {budget ? (
          <>
            <LinearProgress
              variant="determinate"
              value={Math.min(used, 100)}
              color={used > 100 ? 'error' : used >= 85 ? 'warning' : 'primary'}
              aria-label={t('cards.budgetLeft')}
              sx={{ my: 1 }}
            />
            <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
              {left !== null && left < 0 && `${t('cards.budgetOver')} · `}
              {t('cards.budgetOf', { limit: formatMoney(budget.limit, language) })}
            </Typography>
          </>
        ) : (
          <>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
              {t('cards.noBudget')}
            </Typography>
            <Link component={RouterLink} to="/budgets" variant="body2">
              {t('cards.setBudget')}
            </Link>
          </>
        )}
      </Figure>
    </Paper>
  );
}

type FigureProps = { label: string; amount: number | null; color?: string; children?: ReactNode };

function Figure({ label, amount, color, children }: FigureProps) {
  const id = useId();
  return (
    <Box component="article" aria-labelledby={id} sx={{ bgcolor: 'background.paper', px: 2, py: 1.75, minWidth: 0 }}>
      <Typography id={id} variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      {amount !== null && (
        <Typography component="p" sx={{ fontSize: { xs: '1.125rem', sm: '1.375rem' }, fontWeight: 500, lineHeight: 1.35, mt: 0.5, color, overflowWrap: 'anywhere' }}>
          <MoneyText amount={amount} />
        </Typography>
      )}
      {children}
    </Box>
  );
}

// The 5 newest confirmed transactions (any month) as ledger rows: date, description with its category, wallet,
// amount. Drafts wait in the bot inbox, see the banner.
function LatestTransactions() {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { data } = useGetTransactionsQuery({ status: 'confirmed' }); // newest first; the first page is enough
  const { data: categories = [] } = useGetCategoriesQuery();
  const { data: wallets = [] } = useGetWalletsQuery();
  const titleId = useId();
  const items = data?.items.slice(0, 5) ?? [];

  return (
    <Paper component="section" variant="outlined" aria-labelledby={titleId}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography id={titleId} variant="h6" component="h2">
          {t('latest.title')}
        </Typography>
        <Link component={RouterLink} to="/transactions" variant="body2">
          {t('latest.all')}
        </Link>
      </Stack>
      {data && items.length === 0 && <Typography sx={{ color: 'text.secondary', p: 2 }}>{t('latest.empty')}</Typography>}
      {items.length > 0 && (
        <Box component="ul" role="list" aria-labelledby={titleId} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {items.map((transaction) => {
            const category = categories.find((c) => c.id === transaction.categoryId);
            const categoryLabel = category ? categoryName(category, language) : '';
            const wallet = wallets.find((w) => w.id === transaction.walletId)?.name ?? '';
            return (
              <Box
                component="li"
                key={transaction.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '52px 1fr auto', md: '72px minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto' },
                  alignItems: 'center',
                  columnGap: 2,
                  px: 2,
                  py: 1.25,
                  fontSize: '0.8125rem',
                  borderBottom: 1,
                  borderColor: 'divider',
                  '&:last-of-type': { borderBottom: 0 },
                  '&:hover': { bgcolor: 'panel2' },
                }}
              >
                <Box component="span" sx={{ ...moneySx, color: 'text.secondary' }}>
                  {formatDate(transaction.occurredAt, language, { day: '2-digit', month: '2-digit' })}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
                    {transaction.note || categoryLabel}
                  </Typography>
                  <Stack direction="row" sx={{ display: { md: 'none' }, alignItems: 'center', gap: 0.75, color: 'text.secondary', fontSize: '0.75rem' }}>
                    <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: category?.color || DEFAULT_COLOR }} />
                    {[categoryLabel, wallet].filter(Boolean).join(' · ')}
                  </Stack>
                </Box>
                <Stack direction="row" sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1, color: 'text.secondary', minWidth: 0 }}>
                  <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '2px', flexShrink: 0, bgcolor: category?.color || DEFAULT_COLOR }} />
                  <Typography noWrap sx={{ fontSize: 'inherit' }}>
                    {categoryLabel}
                  </Typography>
                </Stack>
                <Typography noWrap sx={{ display: { xs: 'none', md: 'block' }, fontSize: 'inherit', color: 'text.secondary' }}>
                  {wallet}
                </Typography>
                <Box
                  component="span"
                  sx={{ ...moneySx, fontWeight: 500, fontSize: '0.875rem', whiteSpace: 'nowrap', textAlign: 'right', color: transaction.type === 'income' ? 'success.main' : 'text.primary' }}
                >
                  {signedMoney(transaction.type, transaction.amount, language)}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Paper>
  );
}
