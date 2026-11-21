import { alpha, Alert, Box, Button, CircularProgress, Grid, LinearProgress, Link, Paper, Stack, Typography } from '@mui/material';
import { createElement, useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';
import { useAppSelector } from '@/app/hooks';
import { useAuth } from '@/auth/useAuth';
import MoneyText from '@/components/MoneyText';
import MonthPicker from '@/components/MonthPicker';
import QuickAdd from '@/components/QuickAdd';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { DEFAULT_COLOR, iconOf } from '@/features/categories/icons';
import { signedMoney } from '@/features/transactions/helpers';
import { useGetTransactionsQuery } from '@/features/transactions/transactionsApi';
import { useGetWalletsQuery } from '@/features/wallets/walletsApi';
import { formatDate, formatMoney } from '@/i18n/format';
import { GRADIENT, moneySx } from '@/theme/theme';
import { CategoryBreakdown, MonthCompare } from './Charts';
import { useGetByCategoryQuery, useGetDailyQuery, useGetSummaryQuery, type MonthSummary } from './statsApi';
import { previousMonth } from './weekly';

// "/" (docs/05 §5.7, draft 3): greeting and the shared MonthPicker, quick add, a "drafts waiting" banner, the total
// balance on a gradient card beside the month's four figures, this month against last month in weekly columns
// (spending or income) with a ranked category breakdown, and the latest 5 transactions. Every query is tagged, so a
// quick add, a budget change or a new month refreshes the numbers by itself.
export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { user } = useAuth();
  const month = useAppSelector((s) => s.ui.month);
  // currentData, not data: while another month loads, data still holds the previous month's numbers.
  const summary = useGetSummaryQuery(month);
  const byCategory = useGetByCategoryQuery(month);
  const daily = useGetDailyQuery(month);
  const previousDaily = useGetDailyQuery(previousMonth(month));
  const { data: drafts } = useGetTransactionsQuery({ status: 'draft' }); // only `total` is used
  const stats = [summary, byCategory, daily];
  const failed = stats.some((query) => query.isError);

  return (
    <>
      <title>{`${t('title')} · ${t('common:appName')}`}</title>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 2.5 }}>
        <Typography variant="h4" component="h1" sx={{ typography: { xs: 'h5', sm: 'h4' } }}>
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

      <Grid container spacing={2}>
        {summary.currentData && (
          <>
            <Grid size={{ xs: 12, md: 5 }}>
              <BalanceCard summary={summary.currentData} />
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <SummaryCards summary={summary.currentData} />
            </Grid>
          </>
        )}
        {daily.currentData && (
          <Grid size={{ xs: 12, md: 7 }}>
            <MonthCompare days={daily.currentData} previousDays={previousDaily.currentData ?? []} />
          </Grid>
        )}
        {byCategory.currentData && (
          <Grid size={{ xs: 12, md: 5 }}>
            <CategoryBreakdown rows={byCategory.currentData} />
          </Grid>
        )}
        <Grid size={12}>
          <LatestTransactions />
        </Grid>
      </Grid>
    </>
  );
}

// The total of every active wallet on the brand gradient, with the month's money in and out underneath.
// Its text is white on a gradient that keeps 4.5:1 everywhere (theme GRADIENT).
function BalanceCard({ summary }: { summary: MonthSummary }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { data: wallets = [] } = useGetWalletsQuery({ includeArchived: true }); // the same cached request as QuickAdd
  const active = wallets.filter((wallet) => !wallet.archived);
  const total = active.reduce((sum, wallet) => sum + wallet.balance, 0);
  const titleId = useId();
  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        minHeight: 196,
        borderRadius: '24px',
        p: { xs: 2.25, sm: 2.75 },
        color: '#ffffff',
        backgroundImage: GRADIENT,
        boxShadow: '0 18px 36px -20px rgba(190, 24, 93, 0.6)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 2,
        // two soft light discs, decoration only
        '&::before, &::after': { content: '""', position: 'absolute', borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.12)', pointerEvents: 'none' },
        '&::before': { width: 260, height: 260, right: -90, top: -120 },
        '&::after': { width: 200, height: 200, right: 20, bottom: -140 },
      }}
    >
      <Stack direction="row" sx={{ justifyContent: 'space-between', fontSize: '0.8125rem', position: 'relative' }}>
        <span id={titleId}>{t('wallet.title')}</span>
        <span>{t('wallet.count', { count: active.length })}</span>
      </Stack>
      <Box sx={{ position: 'relative' }}>
        <Typography component="p" sx={{ ...moneySx, fontSize: { xs: '2rem', sm: '2.375rem' }, fontWeight: 400, lineHeight: 1.1 }}>
          {formatMoney(total, language)}
        </Typography>
        <Typography noWrap sx={{ fontSize: '0.8125rem', mt: 0.5 }}>
          {active.map((wallet) => wallet.name).join(' · ')}
        </Typography>
      </Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', fontSize: '0.8125rem', position: 'relative', ...moneySx }}>
        <span>
          {t('wallet.month')} +{formatMoney(summary.income, language)} {t('wallet.in')}
        </span>
        <span>
          −{formatMoney(summary.expense, language)} {t('wallet.out')}
        </span>
      </Stack>
    </Box>
  );
}

// Income, expense, net and what is left of the month's overall budget, as four cards in a 2×2 grid.
function SummaryCards({ summary }: { summary: MonthSummary }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { budget } = summary;
  const left = budget && budget.limit - budget.spent;
  const used = budget ? Math.round((budget.spent / budget.limit) * 100) : 0;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, height: '100%' }}>
      <Figure label={t('cards.income')} amount={summary.income} color="income" />
      <Figure label={t('cards.expense')} amount={summary.expense} color="spend" />
      <Figure label={t('cards.net')} amount={summary.net} color={summary.net < 0 ? 'error.main' : undefined} />
      <Figure label={t('cards.budgetLeft')} amount={left} color={left !== null && left < 0 ? 'error.main' : undefined}>
        {budget ? (
          <>
            <LinearProgress
              variant="determinate"
              value={Math.min(used, 100)}
              color={used > 100 ? 'error' : used >= 85 ? 'warning' : 'primary'}
              aria-hidden // a picture of the line below; its label would say "left" while the value is the share used
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
    </Box>
  );
}

type FigureProps = { label: string; amount: number | null; color?: string; children?: ReactNode };

function Figure({ label, amount, color, children }: FigureProps) {
  const id = useId();
  return (
    <Paper component="article" variant="outlined" aria-labelledby={id} sx={{ px: 2, py: 1.75, minWidth: 0 }}>
      <Typography id={id} variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      {amount !== null && (
        <Typography component="p" sx={{ fontSize: { xs: '1.125rem', sm: '1.375rem' }, fontWeight: 400, lineHeight: 1.35, mt: 0.5, color, overflowWrap: 'anywhere' }}>
          <MoneyText amount={amount} />
        </Typography>
      )}
      {children}
    </Paper>
  );
}

// The 5 newest confirmed transactions (any month): a round tile with the category's icon in its colour, the note
// and its category · wallet, the signed amount and the date. Drafts wait in the bot inbox, see the banner.
function LatestTransactions() {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { data } = useGetTransactionsQuery({ status: 'confirmed' }); // newest first; the first page is enough
  const { data: categories = [] } = useGetCategoriesQuery();
  const { data: wallets = [] } = useGetWalletsQuery({ includeArchived: true }); // a past transaction may sit in an archived wallet
  const titleId = useId();
  const items = data?.items.slice(0, 5) ?? [];

  return (
    <Paper component="section" variant="outlined" aria-labelledby={titleId} sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1.5 }}>
        <Typography id={titleId} variant="overline" component="h2" sx={{ color: 'text.primary' }}>
          {t('latest.title')}
        </Typography>
        <Link component={RouterLink} to="/transactions" variant="body2">
          {t('latest.all')}
        </Link>
      </Stack>
      {data && items.length === 0 && <Typography sx={{ color: 'text.secondary' }}>{t('latest.empty')}</Typography>}
      {items.length > 0 && (
        <Box component="ul" role="list" aria-labelledby={titleId} sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
          {items.map((transaction) => {
            const category = categories.find((c) => c.id === transaction.categoryId);
            const categoryLabel = category ? categoryName(category, language) : '';
            const wallet = wallets.find((w) => w.id === transaction.walletId)?.name ?? '';
            const income = transaction.type === 'income';
            const tint = category?.color || DEFAULT_COLOR;
            return (
              <Box
                component="li"
                key={transaction.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr auto',
                  alignItems: 'center',
                  columnGap: 1.5,
                  px: 1.5,
                  py: 1.25,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: '16px',
                  transition: 'background-color 140ms',
                  '&:hover': { bgcolor: 'panel2' },
                }}
              >
                <Box aria-hidden sx={{ width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: alpha(tint, 0.14), color: tint }}>
                  {createElement(iconOf(category?.icon ?? ''), { fontSize: 'small' })}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 500 }}>
                    {transaction.note || categoryLabel}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {[categoryLabel, wallet].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Box component="span" sx={{ ...moneySx, display: 'block', fontWeight: 500, fontSize: '0.875rem', whiteSpace: 'nowrap', color: income ? 'income' : 'text.primary' }}>
                    {signedMoney(transaction.type, transaction.amount, language)}
                  </Box>
                  <Box component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {formatDate(transaction.occurredAt, language, { day: '2-digit', month: '2-digit' })}
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Paper>
  );
}
