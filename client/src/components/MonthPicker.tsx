import { IconButton, Stack, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight } from '@/components/icons';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { monthChanged } from '@/app/uiSlice';
import { formatDate } from '@/i18n/format';
import { strongLine } from '@/theme/theme';

// The arrows are square segments of one bordered control (draft 2), not floating round buttons.
const segmentSx = { width: 32, borderRadius: 0, color: 'text.secondary', '&.Mui-focusVisible': { outlineOffset: -2 } } as const;

// "YYYY-MM" plus or minus some months.
function shiftMonth(month: string, delta: number): string {
  const [year = 0, mon = 1] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

// ‹ Tháng 11, 2026 › — the month shared by the dashboard and budgets (uiSlice.month).
export default function MonthPicker() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const month = useAppSelector((s) => s.ui.month);
  const language = useAppSelector((s) => s.ui.language);
  const label = formatDate(`${month}-15T00:00:00+07:00`, language, { month: 'long', year: 'numeric' });

  return (
    <Stack
      direction="row"
      sx={(theme) => ({ alignItems: 'stretch', height: 34, border: 1, borderColor: strongLine(theme), borderRadius: '4px', bgcolor: 'background.paper', overflow: 'hidden' })}
    >
      <IconButton aria-label={t('month.previous')} onClick={() => dispatch(monthChanged(shiftMonth(month, -1)))} sx={segmentSx}>
        <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
      </IconButton>
      <Typography
        component="output"
        aria-live="polite"
        sx={(theme) => ({ minWidth: 140, px: 1.5, display: 'grid', placeItems: 'center', fontWeight: 500, fontSize: '0.8125rem', borderInline: 1, borderColor: strongLine(theme) })}
      >
        {label}
      </Typography>
      <IconButton aria-label={t('month.next')} onClick={() => dispatch(monthChanged(shiftMonth(month, 1)))} sx={segmentSx}>
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
      </IconButton>
    </Stack>
  );
}
