import { Box, Paper, Typography, useTheme } from '@mui/material';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts';
import { useAppSelector } from '@/app/hooks';
import { formatDate, formatMoney } from '@/i18n/format';
import type { CategoryTotal, DayTotal } from './statsApi';

const CHART_STYLE = { width: '100%', height: 240 }; // `responsive`: the chart follows its box's CSS size

// A chart in a <figure> named by its heading, with a text summary in <figcaption>, so the numbers do not
// depend on seeing the picture (modern-web-guidance `accessibility`: complex images and charts).
function ChartFigure({ title, chart, summary }: { title: string; chart: ReactNode; summary: ReactNode }) {
  const titleId = useId();
  return (
    <Paper component="figure" variant="outlined" aria-labelledby={titleId} sx={{ m: 0, p: 2, height: '100%' }}>
      <Typography id={titleId} variant="h6" component="h2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {chart}
      <Box component="figcaption" sx={{ color: 'text.secondary', typography: 'body2' }}>
        {summary}
      </Box>
    </Paper>
  );
}

// Recharts draws SVG, so its colours are read from the MUI theme and follow light/dark mode.
function useChartTheme() {
  const { palette } = useTheme();
  return {
    palette,
    tooltip: {
      contentStyle: { backgroundColor: palette.background.paper, borderColor: palette.divider, color: palette.text.primary },
    },
    axis: { stroke: palette.divider, tick: { fill: palette.text.secondary, fontSize: 12 } },
  };
}

// Pie of the month's spending by category; the legend list doubles as the text summary.
export function CategoryPie({ rows }: { rows: CategoryTotal[] }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { palette, tooltip } = useChartTheme();
  const colors = [palette.primary.main, palette.error.main, palette.warning.main, palette.info.main, palette.secondary.main, palette.text.secondary];
  const data = rows.map((row, i) => ({ ...row, fill: colors[i % colors.length] })); // each slice's colour, by rank

  if (rows.length === 0) return <ChartFigure title={t('byCategory.title')} chart={null} summary={t('byCategory.empty')} />;
  return (
    <ChartFigure
      title={t('byCategory.title')}
      chart={
        <PieChart responsive style={CHART_STYLE}>
          <Pie data={data} dataKey="total" nameKey="name" innerRadius="55%" outerRadius="90%" stroke={palette.background.paper} />
          <Tooltip {...tooltip} formatter={(value) => formatMoney(Number(value), language)} />
        </PieChart>
      }
      summary={
        <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {data.map((row) => (
            <Box component="li" key={row.categoryId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: row.fill, flexShrink: 0 }} />
              {t('byCategory.item', { name: row.name, amount: formatMoney(row.total, language), percent: row.percent })}
            </Box>
          ))}
        </Box>
      }
    />
  );
}

// Bars of income and spending for each day of the month, summed up in one sentence underneath.
export function DailyBars({ days }: { days: DayTotal[] }) {
  const { t } = useTranslation('dashboard');
  const language = useAppSelector((s) => s.ui.language);
  const { palette, tooltip, axis } = useChartTheme();
  const income = days.reduce((sum, day) => sum + day.income, 0);
  const expense = days.reduce((sum, day) => sum + day.expense, 0);
  const peak = days.reduce((best, day) => (day.expense > best.expense ? day : best), days[0] ?? { date: '', income: 0, expense: 0 });
  const dayLabel = (date: string) => formatDate(`${date}T12:00:00+07:00`, language, { day: 'numeric', month: 'long' });
  const compact = new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'en-US', { notation: 'compact' }); // 1.500.000 → "1,5 Tr"

  if (income === 0 && expense === 0) return <ChartFigure title={t('daily.title')} chart={null} summary={t('daily.empty')} />;
  const money = (amount: number) => formatMoney(amount, language);
  const summary = [
    t('daily.totals', { income: money(income), expense: money(expense) }),
    peak.expense > 0 ? t('daily.peak', { day: dayLabel(peak.date), amount: money(peak.expense) }) : '',
  ];
  return (
    <ChartFigure
      title={t('daily.title')}
      chart={
        <BarChart responsive style={CHART_STYLE} data={days} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
          <CartesianGrid vertical={false} stroke={palette.divider} />
          <XAxis dataKey="date" {...axis} tickFormatter={(date: string) => String(Number(date.slice(8)))} />
          <YAxis {...axis} width={44} tickFormatter={(value: number) => compact.format(value)} />
          <Tooltip
            {...tooltip}
            cursor={{ fill: palette.action.hover }}
            labelFormatter={(date) => dayLabel(String(date))}
            formatter={(value) => money(Number(value))}
          />
          <Legend />
          <Bar dataKey="income" name={t('daily.income')} fill={palette.success.main} />
          <Bar dataKey="expense" name={t('daily.expense')} fill={palette.error.main} />
        </BarChart>
      }
      summary={summary.filter(Boolean).join(' ')}
    />
  );
}
