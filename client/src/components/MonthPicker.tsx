import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { IconButton, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { monthChanged } from '@/app/uiSlice';
import { formatDate } from '@/i18n/format';

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
    <Stack direction="row" sx={{ alignItems: 'center' }}>
      <IconButton aria-label={t('month.previous')} onClick={() => dispatch(monthChanged(shiftMonth(month, -1)))}>
        <ChevronLeftIcon />
      </IconButton>
      <Typography component="output" aria-live="polite" sx={{ minWidth: 140, textAlign: 'center', fontWeight: 600 }}>
        {label}
      </Typography>
      <IconButton aria-label={t('month.next')} onClick={() => dispatch(monthChanged(shiftMonth(month, 1)))}>
        <ChevronRightIcon />
      </IconButton>
    </Stack>
  );
}
