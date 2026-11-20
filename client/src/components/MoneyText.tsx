import { useAppSelector } from '@/app/hooks';
import { formatMoney } from '@/i18n/format';

// Formats whole VND in the current language: "45.000 ₫" (vi) or "₫45,000" (en).
export default function MoneyText({ amount }: { amount: number }) {
  const language = useAppSelector((s) => s.ui.language);
  return <span>{formatMoney(amount, language)}</span>;
}
