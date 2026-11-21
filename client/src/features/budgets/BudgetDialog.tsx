import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { apiErrorMessage } from '@/features/categories/helpers';
import { formatNumber, isOverMax, MAX_MONEY, parseAmount } from '@/features/transactions/helpers';
import { formatDate, formatMoney } from '@/i18n/format';
import { useCreateBudgetMutation, useUpdateBudgetMutation, type Budget } from './budgetsApi';

const OVERALL = 'overall'; // the <option> value for the overall budget (categoryId null)

type Props = {
  month: string; // "YYYY-MM"
  budget?: { value: Budget; name: string }; // the budget to edit; none = add a new one
  taken: (string | null)[]; // categoryIds that already have a budget this month (null = overall)
  onClose: () => void;
};

// Add/edit one budget (docs/05 §5.7). Adding picks the overall budget or an expense category that has no
// budget yet this month; editing only changes the limit, because month and category are what the budget is.
export default function BudgetDialog({ month, budget, taken, onClose }: Props) {
  const { t } = useTranslation('budgets');
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.ui.language);
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'));
  const { data: categories = [] } = useGetCategoriesQuery();
  const [createBudget] = useCreateBudgetMutation();
  const [updateBudget] = useUpdateBudgetMutation();

  const options = [
    ...(taken.includes(null) ? [] : [{ value: OVERALL, label: t('fields.overallOption') }]),
    ...categories
      .filter((c) => c.type === 'expense' && !taken.includes(c.id))
      .map((c) => ({ value: c.id, label: categoryName(c, language) })),
  ];
  const [choice, setChoice] = useState('');
  const selected = options.some((o) => o.value === choice) ? choice : (options[0]?.value ?? ''); // first one until the user picks
  const [limitText, setLimitText] = useState(budget ? formatNumber(budget.value.limit, language) : '');
  const [submitted, setSubmitted] = useState(false); // errors show after the first Save, and go away once fixed
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const limit = parseAmount(limitText); // the bot's shortcuts work here too: "2tr", "500k"
  const wrong = { categoryId: !budget && !selected, limit: limit === null };
  const errors: Partial<typeof wrong> = submitted ? wrong : {};
  const monthLabel = formatDate(`${month}-15T00:00:00+07:00`, language, { month: 'long', year: 'numeric' });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (wrong.categoryId || limit === null) {
      // Focus the first wrong field so keyboard and screen reader users land on the problem.
      (event.currentTarget.elements.namedItem(wrong.categoryId ? 'categoryId' : 'limit') as HTMLElement | null)?.focus();
      return;
    }
    setSaving(true);
    try {
      if (budget) await updateBudget({ id: budget.value.id, limit }).unwrap();
      else await createBudget({ month, categoryId: selected === OVERALL ? null : selected, limit }).unwrap();
      dispatch(showSnackbar({ message: t('saved'), severity: 'success' }));
      onClose();
    } catch (error) {
      setServerError(apiErrorMessage(error)); // e.g. BUDGET_EXISTS, translated
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="xs">
      {/* display: contents keeps the dialog's flex layout (scrolling content, fixed actions) */}
      <form noValidate onSubmit={submit} style={{ display: 'contents' }}>
        <DialogTitle>{budget ? t('dialog.editTitle') : t('dialog.addTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{budget ? `${budget.name} · ${monthLabel}` : monthLabel}</DialogContentText>
          {serverError && <Alert severity="error">{serverError}</Alert>}
          {!budget && (
            <TextField
              name="categoryId"
              select
              label={t('fields.category')}
              value={selected}
              onChange={(event) => setChoice(event.target.value)}
              error={errors.categoryId}
              helperText={errors.categoryId ? t('validation.category') : undefined}
              required
              autoFocus
              fullWidth
              margin="normal"
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} // native: the phone's own picker
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </TextField>
          )}
          <TextField
            name="limit"
            label={t('fields.limit')}
            value={limitText}
            onChange={(event) => setLimitText(event.target.value)}
            onBlur={() => limit !== null && setLimitText(formatNumber(limit, language))}
            error={errors.limit}
            helperText={
              errors.limit
                ? isOverMax(limitText)
                  ? t('validation.limitMax', { max: formatMoney(MAX_MONEY, language) })
                  : t('validation.limit')
                : limit !== null ? `= ${formatMoney(limit, language)}` : t('fields.limitHelp')}
            required
            autoFocus={Boolean(budget)}
            fullWidth
            margin="normal"
            slotProps={{ htmlInput: { autoComplete: 'off', enterKeyHint: 'done' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" variant="contained" loading={saving}>
            {t('save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
