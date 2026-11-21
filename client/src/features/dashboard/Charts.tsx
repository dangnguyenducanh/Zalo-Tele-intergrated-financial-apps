import { alpha, Box, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography, useTheme } from '@mui/material';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { useAppSelector } from '@/app/hooks';
import { Sparkles } from '@/components/icons';
import { useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { formatMoney } from '@/i18n/format';
import { moneySx } from '@/theme/theme';
import { sliceColors } from './sliceColors';
import type { CategoryTotal, DayTotal } from './statsApi';
import { weekTotals, type Flow } from './weekly';

const CHART_STYLE = { width: '100%', height: 220 }; // `responsive`: the chart follows its box's CSS size

// A card in a <figure> named by its heading (an uppercase caption with an optional right-hand slot), with a text
// summary in <figcaption>, so the numbers do not depend on seeing the picture
// (modern-web-guidance `accessibility`: complex images and charts).
function ChartFigure({ title, aside, children, summary }: { title: string; aside?: ReactNode; children: ReactNode; summary: ReactNode }) {
  const titleId = useId();
  return (
    <Paper component="figure" variant="outlined" aria-labelledby={titleId} sx={{ m: 0, height: '100%', p: { xs: 2, sm: 2.5 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography id={titleId} variant="overline" component="h2" sx={{ color: 'text.primary' }}>
          {title}
        </Typography>
        {aside && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5 }}>{aside}</Box>}
      </Stack>
      {children}
      {summary && (
        <Box
          component="figcaption"
          sx={{ mt: 'auto', pt: 1.5, borderTop: 1, borderColor: 'divider', color: 'text.secondary', typography: 'body2', display: 'flex', gap: 1, alignItems: 'flex-start' }}
        >
          <Box component="span" aria-hidden sx={{ color: 'primary.light', display: 'flex', mt: '2px' }}>
            <Sparkles size={16} strokeWidth={1.75} />
          </Box>
          <span>{summary}</span>
        </Box>
      )}
    </Paper>
  );
}

const Dot = ({ color }: { color: string }) => <Box aria-hidden sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />;

// This month against last month, in four weekly columns each (the student asked for columns here, T18).
// The switch picks spending or income; the big figure and the sentence underneath follow it.
export function MonthCompare({ days, previousDays }: { days: DayTotal[]; previousDays: DayTotal[] }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { palette } = useTheme();
  const [flow, setFlow] = useState<Flow>('expense');
  const now = weekTotals(days, flow);
  const before = weekTotals(previousDays, flow);
  const total = now.reduce((a, b) => a + b, 0);
  const totalBefore = before.reduce((a, b) => a + b, 0);
  const color = flow === 'expense' ? palette.spend : palette.income;
  const money = (amount: number) => formatMoney(amount, language);
  const data = now.map((value, i) => ({ week: t('compare.week', { n: i + 1 }), now: value, before: before[i] }));
  const peak = now.indexOf(Math.max(...now));
  const what = t(flow === 'expense' ? 'compare.spent' : 'compare.earned');
  const diff = total - totalBefore;
  const summary =
    total === 0 && totalBefore === 0
      ? t('compare.empty')
      : [
          t(diff > 0 ? 'compare.more' : diff < 0 ? 'compare.less' : 'compare.same', { what, now: money(total), diff: money(Math.abs(diff)) }),
          total > 0 ? t('compare.peak', { n: peak + 1, amount: money(now[peak]!) }) : '',
        ]
          .filter(Boolean)
          .join(' ');

  return (
    <ChartFigure
      title={t(flow === 'expense' ? 'compare.expense' : 'compare.income')}
      aside={
        <ToggleButtonGroup exclusive size="small" value={flow} onChange={(_, next: Flow | null) => next && setFlow(next)} aria-label={t('compare.switch')}>
          <ToggleButton value="expense">{t('compare.toExpense')}</ToggleButton>
          <ToggleButton value="income">{t('compare.toIncome')}</ToggleButton>
        </ToggleButtonGroup>
      }
      summary={summary}
    >
      <Stack direction="row" sx={{ alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography component="p" sx={{ ...moneySx, fontSize: { xs: '1.75rem', sm: '2rem' }, fontWeight: 400, lineHeight: 1.15, color }}>
            {money(total)}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('compare.versus')}
          </Typography>
        </Box>
        <Stack sx={{ gap: 0.5, typography: 'body2', color: 'text.secondary' }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
            <Dot color={alpha(color, 0.35)} />
            {t('compare.lastMonth')}
          </Stack>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
            <Dot color={color} />
            {t('compare.thisMonth')}
          </Stack>
        </Stack>
      </Stack>
      <BarChart responsive style={CHART_STYLE} data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barGap={4} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={palette.divider} strokeDasharray="3 4" />
        <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fill: palette.text.secondary, fontSize: 12 }} />
        <YAxis
          width={46}
          tickLine={false}
          axisLine={false}
          tick={{ fill: palette.text.secondary, fontSize: 11 }}
          tickFormatter={(value: number) => new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', { notation: 'compact' }).format(value)}
        />
        <Tooltip
          cursor={{ fill: alpha(color, 0.08), radius: 10 }}
          contentStyle={{ backgroundColor: '#0f2a5f', border: 0, borderRadius: 12, color: '#fff', fontSize: 12 }}
          labelStyle={{ color: '#bae6fd' }}
          itemStyle={{ color: '#fff' }}
          formatter={(value) => money(Number(value))}
        />
        <Bar dataKey="before" name={t('compare.lastMonth')} fill={alpha(color, 0.35)} radius={[8, 8, 8, 8]} maxBarSize={22} />
        <Bar dataKey="now" name={t('compare.thisMonth')} fill={color} radius={[8, 8, 8, 8]} maxBarSize={22} />
      </BarChart>
    </ChartFigure>
  );
}

// The month's spending by category as a ranked list: a colour dot, the category, its amount and share,
// and a rounded bar scaled to the biggest category. Each row reads as one sentence for screen readers.
export function CategoryBreakdown({ rows }: { rows: CategoryTotal[] }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { data: categories = [] } = useGetCategoriesQuery();
  const colors = sliceColors(rows, (id) => categories.find((c) => c.id === id)?.color || undefined);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const max = Math.max(...rows.map((row) => row.total), 1);

  return (
    <ChartFigure
      title={t('byCategory.title')}
      aside={
        rows.length > 0 && (
          <Typography variant="body2" sx={{ ...moneySx, color: 'text.secondary' }}>
            {formatMoney(total, language)}
          </Typography>
        )
      }
      summary={rows.length === 0 ? t('byCategory.empty') : null}
    >
      {rows.length > 0 && (
        <Box component="ul" role="list" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 0.5 }}>
          {rows.map((row, i) => (
            <Box component="li" key={row.categoryId} sx={{ py: 0.75, color: 'text.primary', fontSize: '0.8125rem' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '9px 1fr auto 40px', alignItems: 'center', columnGap: 1.25 }}>
                <Dot color={colors[i]!} />
                <span>{row.name}</span>
                {/* ": " and " (…%)" stay in the text for the accessible sentence; the grid shows them as columns */}
                <Box component="span" sx={moneySx}>
                  <Box component="span" sx={visuallyHidden}>
                    {': '}
                  </Box>
                  {formatMoney(row.total, language)}
                </Box>
                <Box component="span" sx={{ ...moneySx, textAlign: 'right', color: 'text.secondary', fontSize: '0.75rem' }}>
                  <Box component="span" sx={visuallyHidden}>
                    {' ('}
                  </Box>
                  {row.percent}%
                  <Box component="span" sx={visuallyHidden}>
                    {')'}
                  </Box>
                </Box>
              </Box>
              <Box aria-hidden sx={{ ml: '19px', mt: 0.75, height: 6, borderRadius: 3, bgcolor: 'track', overflow: 'hidden' }}>
                <Box sx={{ width: `${(row.total / max) * 100}%`, height: '100%', borderRadius: 3, bgcolor: colors[i] }} />
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </ChartFigure>
  );
}

// Pixel strings: in sx a bare 1 means 100%.
const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;
