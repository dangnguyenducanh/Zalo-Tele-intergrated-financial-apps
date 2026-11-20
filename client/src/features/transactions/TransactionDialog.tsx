import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { useAuth } from '@/auth/useAuth';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { apiErrorMessage } from '@/features/categories/helpers';
import { useGetWalletsQuery } from '@/features/wallets/walletsApi';
import { formatMoney } from '@/i18n/format';
import { formatNumber, fromDateTimeInput, parseAmount, toDateTimeInput } from './helpers';
import type { ParsedDraft, TransactionInput, TransactionType } from './transactionsApi';

const TYPES: TransactionType[] = ['expense', 'income'];

type Props = {
  title: string;
  submitLabel: string;
  initial?: Partial<ParsedDraft>; // a transaction to edit, a quick-add line, or nothing for a new one
  onSubmit: (fields: TransactionInput) => Promise<unknown> | void; // a rejection is shown in the dialog
  onClose: () => void;
};

// The full add/edit form (docs/05 §5.7): type, amount with the bot's k/tr shortcuts, category, wallet,
// date-time in Vietnam time, and note. The caller decides what "submit" does (create, update, or change a preview line).
export default function TransactionDialog({ title, submitLabel, initial, onSubmit, onClose }: Props) {
  const { t } = useTranslation('transactions');
  const { user } = useAuth();
  const language = useAppSelector((s) => s.ui.language);
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'));
  const { data: categories = [] } = useGetCategoriesQuery();
  const { data: wallets = [] } = useGetWalletsQuery({ includeArchived: true });

  const startTime = initial?.occurredAt ? toDateTimeInput(initial.occurredAt) : toDateTimeInput(new Date());
  const [type, setType] = useState<TransactionType>(initial?.type ?? 'expense');
  const [amountText, setAmountText] = useState(initial?.amount ? formatNumber(initial.amount, language) : '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [walletId, setWalletId] = useState(initial?.walletId ?? user?.defaultWalletId ?? '');
  const [dateTime, setDateTime] = useState(startTime);
  const [note, setNote] = useState(initial?.note ?? '');
  const [submitted, setSubmitted] = useState(false); // errors show after the first Save, and go away once fixed
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const categoryOptions = categories.filter((c) => c.type === type);
  const category = categoryOptions.some((c) => c.id === categoryId) ? categoryId : '';
  // Archived wallets are not offered, except the one this transaction already uses. No choice yet → the first wallet.
  const walletOptions = wallets.filter((w) => !w.archived || w.id === walletId);
  const wallet = walletOptions.some((w) => w.id === walletId) ? walletId : (walletOptions.find((w) => !w.archived)?.id ?? '');
  const amount = parseAmount(amountText);
  const wrong = { amount: amount === null, categoryId: !category, walletId: !wallet, occurredAt: !dateTime };
  const errors: Partial<typeof wrong> = submitted ? wrong : {};

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const firstWrong = (Object.keys(wrong) as (keyof typeof wrong)[]).find((key) => wrong[key]);
    if (firstWrong || amount === null) {
      // Focus the first wrong field so keyboard and screen reader users land on the problem.
      (event.currentTarget.elements.namedItem(firstWrong ?? 'amount') as HTMLElement | null)?.focus();
      return;
    }
    const fields: TransactionInput = {
      type,
      amount,
      categoryId: category,
      walletId: wallet,
      // Unchanged time: send the original instant, so seconds are not lost.
      occurredAt: dateTime === startTime && initial?.occurredAt ? initial.occurredAt : fromDateTimeInput(dateTime),
      note: note.trim(),
    };
    setSubmitting(true);
    try {
      await onSubmit(fields);
      onClose();
    } catch (error) {
      setServerError(apiErrorMessage(error));
      setSubmitting(false);
    }
  }

  // Native <select>: accessible and the phone's own picker, with no extra code.
  const select = { select: { native: true }, inputLabel: { shrink: true } };

  return (
    <Dialog open onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm">
      {/* display: contents keeps the dialog's flex layout (scrolling content, fixed actions) */}
      <form noValidate onSubmit={submit} style={{ display: 'contents' }}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          {serverError && <Alert severity="error">{serverError}</Alert>}
          <FormControl margin="normal">
            <FormLabel id="transaction-type-label">{t('fields.type')}</FormLabel>
            <RadioGroup
              row
              name="type"
              aria-labelledby="transaction-type-label"
              value={type}
              onChange={(event) => {
                setType(event.target.value as TransactionType);
                setCategoryId(''); // a category belongs to one type
              }}
            >
              {TYPES.map((value) => (
                <FormControlLabel key={value} value={value} control={<Radio />} label={t(`types.${value}`)} />
              ))}
            </RadioGroup>
          </FormControl>
          <TextField
            name="amount"
            label={t('fields.amount')}
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            onBlur={() => amount !== null && setAmountText(formatNumber(amount, language))}
            error={errors.amount}
            helperText={errors.amount ? t('validation.amount') : amount !== null ? `= ${formatMoney(amount, language)}` : t('fields.amountHelp')}
            required
            autoFocus
            fullWidth
            margin="normal"
            slotProps={{ htmlInput: { autoComplete: 'off', enterKeyHint: 'next' } }}
          />
          <TextField
            name="categoryId"
            select
            label={t('fields.category')}
            value={category}
            onChange={(event) => setCategoryId(event.target.value)}
            error={errors.categoryId}
            helperText={errors.categoryId ? t('validation.category') : undefined}
            required
            fullWidth
            margin="normal"
            slotProps={select}
          >
            <option value="" disabled />
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryName(c, language)}
              </option>
            ))}
          </TextField>
          <TextField
            name="walletId"
            select
            label={t('fields.wallet')}
            value={wallet}
            onChange={(event) => setWalletId(event.target.value)}
            error={errors.walletId}
            helperText={errors.walletId ? t('validation.wallet') : undefined}
            required
            fullWidth
            margin="normal"
            slotProps={select}
          >
            <option value="" disabled />
            {walletOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </TextField>
          <TextField
            name="occurredAt"
            type="datetime-local"
            label={t('fields.occurredAt')}
            value={dateTime}
            onChange={(event) => setDateTime(event.target.value)}
            error={errors.occurredAt}
            helperText={errors.occurredAt ? t('validation.occurredAt') : undefined}
            required
            fullWidth
            margin="normal"
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            name="note"
            label={t('fields.note')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            fullWidth
            margin="normal"
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" variant="contained" loading={submitting}>
            {submitLabel}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
