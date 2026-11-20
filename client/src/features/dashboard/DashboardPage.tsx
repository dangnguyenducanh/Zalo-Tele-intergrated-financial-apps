import {
  Alert,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';
import { useAppSelector } from '@/app/hooks';
import { useAuth } from '@/auth/useAuth';
import MoneyText from '@/components/MoneyText';
import MonthPicker from '@/components/MonthPicker';
import QuickAdd from '@/components/QuickAdd';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { signedMoney } from '@/features/transactions/helpers';
import { useGetTransactionsQuery } from '@/features/transactions/transactionsApi';
import { formatDate, formatMoney } from '@/i18n/format';
import { CategoryPie, DailyBars } from './Charts';
import { useGetByCategoryQuery, useGetDailyQuery, useGetSummaryQuery, type MonthSummary } from './statsApi';

// "/" (docs/05 §5.7): quick add, the shared MonthPicker, 4 month cards, a pie by category and a daily bar chart
// (each with a text summary), a "drafts waiting" banner linking to the bot inbox, and the latest 5 transactions.
// Every query is tagged, so a quick add, a budget change or a new month refreshes the numbers by itself.
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
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 3 }}>
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
        {summary.currentData && <SummaryCards summary={summary.currentData} />}
        {byCategory.currentData && (
          <Grid size={{ xs: 12, md: 5 }}>
            <CategoryPie rows={byCategory.currentData} />
          </Grid>
        )}
        {daily.currentData && (
          <Grid size={{ xs: 12, md: 7 }}>
            <DailyBars days={daily.currentData} />
          </Grid>
        )}
        <Grid size={12}>
          <LatestTransactions />
        </Grid>
      </Grid>
    </>
  );
}

// Income, expense, net and what is left of the month's overall budget.
function SummaryCards({ summary }: { summary: MonthSummary }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { budget } = summary;
  const left = budget && budget.limit - budget.spent;
  return (
    <>
      <StatCard label={t('cards.income')} amount={summary.income} color="success.main" />
      <StatCard label={t('cards.expense')} amount={summary.expense} color="error.main" />
      <StatCard label={t('cards.net')} amount={summary.net} color={summary.net < 0 ? 'error.main' : undefined} />
      <StatCard label={t('cards.budgetLeft')} amount={left} color={left !== null && left < 0 ? 'error.main' : undefined}>
        {budget ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {left !== null && left < 0 && `${t('cards.budgetOver')} · `}
            {t('cards.budgetOf', { limit: formatMoney(budget.limit, language) })}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('cards.noBudget')}
            </Typography>
            <Link component={RouterLink} to="/budgets" variant="body2">
              {t('cards.setBudget')}
            </Link>
          </>
        )}
      </StatCard>
    </>
  );
}

type StatCardProps = { label: string; amount: number | null; color?: string; children?: ReactNode };

function StatCard({ label, amount, color, children }: StatCardProps) {
  const id = useId();
  return (
    <Grid size={{ xs: 6, md: 3 }}>
      <Card component="article" aria-labelledby={id} variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Typography id={id} variant="body2" sx={{ color: 'text.secondary' }}>
            {label}
          </Typography>
          {amount !== null && (
            <Typography component="p" sx={{ typography: { xs: 'h6', sm: 'h5' }, fontWeight: 600, color, overflowWrap: 'anywhere' }}>
              <MoneyText amount={amount} />
            </Typography>
          )}
          {children}
        </CardContent>
      </Card>
    </Grid>
  );
}

// The 5 newest confirmed transactions (any month); drafts wait in the bot inbox, see the banner.
function LatestTransactions() {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { data } = useGetTransactionsQuery({ status: 'confirmed' }); // newest first; the first page is enough
  const { data: categories = [] } = useGetCategoriesQuery();
  const titleId = useId();
  const items = data?.items.slice(0, 5) ?? [];

  return (
    <Paper component="section" variant="outlined" aria-labelledby={titleId} sx={{ p: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Typography id={titleId} variant="h6" component="h2">
          {t('latest.title')}
        </Typography>
        <Link component={RouterLink} to="/transactions">
          {t('latest.all')}
        </Link>
      </Stack>
      {data && items.length === 0 && <Typography sx={{ color: 'text.secondary', mt: 1 }}>{t('latest.empty')}</Typography>}
      {items.length > 0 && (
        <List aria-labelledby={titleId} dense>
          {items.map((transaction) => {
            const category = categories.find((c) => c.id === transaction.categoryId);
            const categoryLabel = category ? categoryName(category, language) : '';
            return (
              <ListItem key={transaction.id} disableGutters>
                <ListItemText
                  primary={transaction.note || categoryLabel}
                  secondary={[categoryLabel, formatDate(transaction.occurredAt, language)].filter(Boolean).join(' · ')}
                />
                <Typography
                  sx={{ fontWeight: 600, whiteSpace: 'nowrap', ml: 2, color: transaction.type === 'income' ? 'success.main' : 'text.primary' }}
                >
                  {signedMoney(transaction.type, transaction.amount, language)}
                </Typography>
              </ListItem>
            );
          })}
        </List>
      )}
    </Paper>
  );
}
