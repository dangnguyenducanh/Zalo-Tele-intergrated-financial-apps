import { Box } from '@mui/material';
import { useAppSelector } from '@/app/hooks';
import { formatMoney } from '@/i18n/format';
import { moneySx } from '@/theme/theme';

// Formats whole VND in the current language: "45.000 ₫" (vi) or "₫45,000" (en). An amount never wraps: a line
// break inside "-1.234.567.890 ₫" or after the minus sign would read as a different number (BUG-021).
export default function MoneyText({ amount }: { amount: number }) {
  const language = useAppSelector((s) => s.ui.language);
  return (
    <Box component="span" sx={{ ...moneySx, whiteSpace: 'nowrap' }}>
      {formatMoney(amount, language)}
    </Box>
  );
}
