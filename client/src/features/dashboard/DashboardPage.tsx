import { alpha, Alert, AlertTitle, Box, Button, CircularProgress, Grid, LinearProgress, Link, Paper, Stack, Typography } from '@mui/material';
import { createElement, useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';
import { useAppSelector } from '@/app/hooks';
import { useAuth } from '@/auth/useAuth';
import MoneyText from '@/components/MoneyText';
import MonthPicker from '@/components/MonthPicker';
import QuickAdd from '@/components/QuickAdd';
import { budgetLevel, useGetBudgetsQuery, type Budget } from '@/features/budgets/budgetsApi';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { DEFAULT_COLOR, iconOf } from '@/features/categories/icons';
import { signedMoney } from '@/features/transactions/helpers';
import { useGetTransactionsQuery, type Transaction } from '@/features/transactions/transactionsApi';
import { useGetWalletsQuery, type Wallet } from '@/features/wallets/walletsApi';
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
  const budgets = useGetBudgetsQuery(month);
  const wallets = useGetWalletsQuery({ includeArchived: true }); // the same cached request as QuickAdd
  const latest = useGetTransactionsQuery({ status: 'confirmed' }); // newest first; the first page is enough
  const { data: drafts } = useGetTransactionsQuery({ status: 'draft' }); // only `total` is used
  // Every query whose numbers the page shows: one failure shows the error and Retry reloads them all, so a failed
  // request never reads as a real 0 ₫ or an empty list. Last month feeds the comparison, so it counts too.
  const stats = [summary, byCategory, daily, previousDaily, budgets, wallets, latest];
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
      {budgets.currentData && <BudgetWarnings budgets={budgets.currentData} />}
      {!summary.currentData && summary.isFetching && <CircularProgress aria-label={t('common:loading')} sx={{ display: 'block', mx: 'auto', my: 4 }} />}

      <Grid container spacing={2}>
        {summary.currentData && wallets.data && ( // no wallets, no total: never a made-up 0 ₫
          <Grid size={{ xs: 12, md: 5 }}>
            <BalanceCard summary={summary.currentData} wallets={wallets.data} />
          </Grid>
        )}
        {summary.currentData && (
          <Grid size={{ xs: 12, md: 7 }}>
            <SummaryCards summary={summary.currentData} />
          </Grid>
        )}
        {daily.currentData && previousDaily.currentData && ( // never compare against a month that has not loaded
          <Grid size={{ xs: 12, md: 7 }}>
            <MonthCompare days={daily.currentData} previousDays={previousDaily.currentData} />
          </Grid>
        )}
        {byCategory.currentData && (
          <Grid size={{ xs: 12, md: 5 }}>
            <CategoryBreakdown rows={byCategory.currentData} />
          </Grid>
        )}
        <Grid size={12}>
          <LatestTransactions transactions={latest.data?.items} wallets={wallets.data ?? []} />
        </Grid>
      </Grid>
    </>
  );
}

// The total of every active wallet on the brand gradient, with the month's money in and out underneath.
// Its text is white on a gradient that keeps 4.5:1 everywhere (theme GRADIENT).
function BalanceCard({ summary, wallets }: { summary: MonthSummary; wallets: Wallet[] }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const active = wallets.filter((wallet) => !wallet.archived);
  const total = formatMoney(active.reduce((sum, wallet) => sum + wallet.balance, 0), language);
  // A sum of capped amounts can be 14+ digits, so the total shrinks to fit the card on one line (BUG-018): a
  // character is at most ~0.6 em wide, so a font of 160 / length % of the width (cqi) fits, up to the usual 2rem / 2.375rem.
  const fit = `${(160 / total.length).toFixed(2)}cqi`;
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
        '&::before, &::after': { content: '""', position: 'absolute', borderRadius: '50%', bgcolor: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }, // faint enough that white text stays ≥ 4.5:1
        '&::before': { width: 260, height: 260, right: -90, top: -120 },
        '&::after': { width: 200, height: 200, right: 20, bottom: -140 },
      }}
    >
      <Stack direction="row" sx={{ justifyContent: 'space-between', fontSize: '0.8125rem', position: 'relative' }}>
        <span id={titleId}>{t('wallet.title')}</span>
        <span>{t('wallet.count', { count: active.length })}</span>
      </Stack>
      <Box sx={{ position: 'relative', containerType: 'inline-size' }}>
        <Typography
          component="p"
          sx={{ ...moneySx, whiteSpace: 'nowrap', fontSize: { xs: `min(2rem, ${fit})`, sm: `min(2.375rem, ${fit})` }, fontWeight: 400, lineHeight: 1.1 }}
        >
          {total}
        </Typography>
        <Typography noWrap sx={{ fontSize: '0.8125rem', mt: 0.5 }}>
          {active.map((wallet) => wallet.name).join(' · ')}
        </Typography>
      </Box>
      {/* Each half keeps its words together; on a narrow card "chi" moves down with its amount, never alone. */}
      <Stack direction="row" sx={{ justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 2, fontSize: '0.8125rem', position: 'relative', whiteSpace: 'nowrap', ...moneySx }}>
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
  const used = budget ? Math.round((budget.spent / budget.limit) * 100) : 0; // the bar's length only
  return (
    // One column on phones: in a 2×2 grid a card leaves about 100 px for a 10-digit amount (BUG-021).
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, height: '100%' }}>
      <Figure label={t('cards.income')} amount={summary.income} color="income" />
      <Figure label={t('cards.expense')} amount={summary.expense} color="spend" />
      <Figure label={t('cards.net')} amount={summary.net} color={summary.net < 0 ? 'error.main' : undefined} />
      <Figure label={t('cards.budgetLeft')} amount={left} color={left !== null && left < 0 ? 'error.main' : undefined}>
        {budget ? (
          <>
            <LinearProgress
              variant="determinate"
              value={Math.min(used, 100)}
              color={BAR_COLOR[budgetLevel(budget)]} // the Budgets page's rule: amber from 80 %, red above 100 %
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

const BAR_COLOR = { ok: 'primary', warn: 'warning', over: 'error' } as const;

// Category budgets of the month past 80 % (amber) or 100 % (red): the web side of the bot's budget warning
// (docs/02 §2.4). The overall budget has its own card. Reuses the Budgets page's strings.
function BudgetWarnings({ budgets }: { budgets: Budget[] }) {
  const { t } = useTranslation('budgets');
  const language = useAppSelector((s) => s.ui.language);
  const { data: categories = [] } = useGetCategoriesQuery();
  const titleId = useId();
  const flagged = budgets.filter((budget) => budget.categoryId && budgetLevel(budget) !== 'ok');
  if (flagged.length === 0) return null;
  const money = (amount: number) => formatMoney(amount, language);
  const nameOf = (budget: Budget) => {
    const category = categories.find((c) => c.id === budget.categoryId);
    return category ? categoryName(category, language) : '';
  };
  return (
    <Alert
      severity={flagged.some((budget) => budgetLevel(budget) === 'over') ? 'error' : 'warning'}
      role="status" // shown on load, not caused by the user: announced politely
      aria-labelledby={titleId}
      action={
        <Button component={RouterLink} to="/budgets" color="inherit" size="small">
          {t('dashboard:budgetAlert.open')}
        </Button>
      }
      sx={{ mb: 2 }}
    >
      <AlertTitle id={titleId}>{t('dashboard:budgetAlert.title')}</AlertTitle>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {flagged.map((budget) => {
          const level = budgetLevel(budget);
          const detail =
            level === 'over'
              ? t('over', { amount: money(budget.spent - budget.limit) })
              : t('usage', { spent: money(budget.spent), limit: money(budget.limit), percent: budget.percent });
          return <li key={budget.id}>{`${nameOf(budget)}: ${t(`level.${level}`)} · ${detail}`}</li>;
        })}
      </Box>
    </Alert>
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
        <Typography component="p" sx={{ fontSize: { xs: '1.125rem', sm: '1.375rem' }, fontWeight: 400, lineHeight: 1.35, mt: 0.5, color }}>
          <MoneyText amount={amount} />
        </Typography>
      )}
      {children}
    </Paper>
  );
}

// The 5 newest confirmed transactions (any month): a round tile with the category's icon in its colour, the note
// and its category · wallet, the signed amount and the date. Drafts wait in the bot inbox, see the banner.
// `transactions` is undefined until it loads (or when the request failed: the page shows the error and Retry).
// `wallets` includes archived ones: a past transaction may sit in an archived wallet.
function LatestTransactions({ transactions, wallets }: { transactions?: Transaction[]; wallets: Wallet[] }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { data: categories = [] } = useGetCategoriesQuery();
  const titleId = useId();
  const items = transactions?.slice(0, 5) ?? [];

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
      {transactions && items.length === 0 && <Typography sx={{ color: 'text.secondary' }}>{t('latest.empty')}</Typography>}
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
