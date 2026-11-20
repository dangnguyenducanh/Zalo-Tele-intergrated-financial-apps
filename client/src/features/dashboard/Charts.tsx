import { Box, Paper, Stack, Typography, useTheme } from '@mui/material';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { useAppSelector } from '@/app/hooks';
import { moneySx } from '@/theme/theme';
import { useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { formatDate, formatMoney } from '@/i18n/format';
import { sliceColors } from './sliceColors';
import type { CategoryTotal, DayTotal } from './statsApi';

const CHART_STYLE = { width: '100%', height: 260 }; // `responsive`: the chart follows its box's CSS size

// A panel in a <figure> named by its heading (a header row with an optional right-hand slot), with a text
// summary in <figcaption>, so the numbers do not depend on seeing the picture
// (modern-web-guidance `accessibility`: complex images and charts).
function ChartFigure({ title, aside, chart, summary }: { title: string; aside?: ReactNode; chart: ReactNode; summary: ReactNode }) {
  const titleId = useId();
  return (
    <Paper component="figure" variant="outlined" aria-labelledby={titleId} sx={{ m: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography id={titleId} variant="h6" component="h2">
          {title}
        </Typography>
        {aside && <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.75 }}>{aside}</Box>}
      </Stack>
      <Box sx={{ px: 2, py: 1.5, flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {chart}
        <Box component="figcaption" sx={{ color: 'text.secondary', typography: 'body2' }}>
          {summary}
        </Box>
      </Box>
    </Paper>
  );
}

// A square colour key: categories and series are marked by small squares, never by icons or dots.
const Swatch = ({ color }: { color: string }) => <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: color, flexShrink: 0 }} />;


// The month's spending by category as a ranked list: a colour square, the category, its amount and share,
// and a thin bar scaled to the biggest category. Each row reads as one sentence for screen readers.
export function CategoryBreakdown({ rows }: { rows: CategoryTotal[] }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { data: categories = [] } = useGetCategoriesQuery();
  const colors = sliceColors(rows, (id) => categories.find((c) => c.id === id)?.color || undefined);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const max = Math.max(...rows.map((row) => row.total), 1);

  if (rows.length === 0) return <ChartFigure title={t('byCategory.title')} chart={null} summary={t('byCategory.empty')} />;
  return (
    <ChartFigure
      title={t('byCategory.title')}
      aside={
        <Typography variant="body2" sx={{ ...moneySx, color: 'text.secondary' }}>
          {formatMoney(total, language)}
        </Typography>
      }
      chart={null}
      summary={
        <Box component="ul" role="list" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid' }}>
          {rows.map((row, i) => (
            <Box component="li" key={row.categoryId} sx={{ py: 0.875, color: 'text.primary', fontSize: '0.8125rem' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '8px 1fr auto 40px', alignItems: 'center', columnGap: 1.25 }}>
                <Swatch color={colors[i]!} />
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
              <Box aria-hidden sx={{ ml: '18px', mt: 0.75, height: 3, borderRadius: '2px', bgcolor: 'track', overflow: 'hidden' }}>
                <Box sx={{ width: `${(row.total / max) * 100}%`, height: '100%', bgcolor: colors[i], opacity: 0.85 }} />
              </Box>
            </Box>
          ))}
        </Box>
      }
    />
  );
}

// Pixel strings: in sx a bare 1 means 100%.
const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;

// Bars of income and spending for each day of the month, summed up in one sentence underneath.
// A salary day can be ten times any spending day; then the axis stops just above the biggest spending day,
// so the spending bars stay readable (the clipped bar still reaches the top, and the exact figure is in the tooltip).
export function DailyBars({ days }: { days: DayTotal[] }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { palette } = useTheme();
  const income = days.reduce((sum, day) => sum + day.income, 0);
  const expense = days.reduce((sum, day) => sum + day.expense, 0);
  const peak = days.reduce((best, day) => (day.expense > best.expense ? day : best), days[0] ?? { date: '', income: 0, expense: 0 });
  const maxIncome = Math.max(...days.map((day) => day.income), 0);
  const cap = peak.expense > 0 && maxIncome > peak.expense * 2 ? Math.ceil((peak.expense * 1.15) / 100_000) * 100_000 : undefined;
  const dayLabel = (date: string) => formatDate(`${date}T12:00:00+07:00`, language, { day: 'numeric', month: 'long' });
  const compact = new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', { notation: 'compact' }); // 1.500.000 → "1,5 Tr"
  const axis = { stroke: palette.divider, tick: { fill: palette.text.secondary, fontSize: 11 }, tickLine: false };

  if (income === 0 && expense === 0) return <ChartFigure title={t('daily.title')} chart={null} summary={t('daily.empty')} />;
  const money = (amount: number) => formatMoney(amount, language);
  const summary = [
    t('daily.totals', { income: money(income), expense: money(expense) }),
    peak.expense > 0 ? t('daily.peak', { day: dayLabel(peak.date), amount: money(peak.expense) }) : '',
  ];
  return (
    <ChartFigure
      title={t('daily.title')}
      aside={[
        [t('daily.expense'), palette.primary.main],
        [t('daily.income'), palette.success.main],
      ].map(([label, color]) => (
        <Stack key={label} direction="row" sx={{ alignItems: 'center', gap: 0.75, typography: 'body2', color: 'text.secondary' }}>
          <Swatch color={color!} />
          {label}
        </Stack>
      ))}
      chart={
        <BarChart responsive style={CHART_STYLE} data={days} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={1}>
          <CartesianGrid vertical={false} stroke={palette.divider} strokeDasharray="2 3" />
          <XAxis dataKey="date" {...axis} interval={4} tickFormatter={(date: string) => String(Number(date.slice(8)))} />
          <YAxis {...axis} axisLine={false} width={44} domain={cap ? [0, cap] : [0, 'auto']} allowDataOverflow tickFormatter={(value: number) => compact.format(value)} />
          <Tooltip
            cursor={{ fill: palette.panel2 }}
            contentStyle={{ backgroundColor: palette.background.paper, borderColor: palette.divider, borderRadius: 4, color: palette.text.primary, fontSize: 12 }}
            labelFormatter={(date) => dayLabel(String(date))}
            formatter={(value) => money(Number(value))}
          />
          <Bar dataKey="expense" name={t('daily.expense')} fill={palette.primary.main} radius={[2, 2, 0, 0]} maxBarSize={10} />
          <Bar dataKey="income" name={t('daily.income')} fill={palette.success.main} radius={[2, 2, 0, 0]} maxBarSize={10} />
        </BarChart>
      }
      summary={summary.filter(Boolean).join(' ')}
    />
  );
}
