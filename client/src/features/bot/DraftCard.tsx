import { Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import ConfirmDialog from '@/components/ConfirmDialog';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { apiErrorMessage } from '@/features/categories/helpers';
import { formatNumber, fromDateTimeInput, isOverMax, MAX_MONEY, parseAmount, toDateTimeInput } from '@/features/transactions/helpers';
import { useDeleteTransactionMutation, type TransactionInput, type TransactionType } from '@/features/transactions/transactionsApi';
import { useGetWalletsQuery } from '@/features/wallets/walletsApi';
import { formatMoney } from '@/i18n/format';
import { useConfirmDraftMutation, type Draft } from './botApi';
import { sourceIcon } from './sourceIcon';

// One draft as a small inline form (docs/05 §5.7): the parsed fields can be corrected in place.
// Confirm = POST /transactions/:id/confirm with the changed fields (if any): one step, so a draft confirmed in
// the chat meanwhile is refused (409) without its saved amount being overwritten.
// Discard = DELETE /transactions/:id. Either way the list refetches and the card goes away, so onGone()
// moves focus out of it first.
export default function DraftCard({ draft, onGone }: { draft: Draft; onGone: () => void }) {
  const { t } = useTranslation('bot');
  const titleId = useId();
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.ui.language);
  const { data: categories = [] } = useGetCategoriesQuery();
  const { data: wallets = [] } = useGetWalletsQuery({ includeArchived: true });
  const [deleteTransaction] = useDeleteTransactionMutation();
  const [confirmDraft] = useConfirmDraftMutation();

  const startTime = toDateTimeInput(draft.occurredAt);
  const [type, setType] = useState<TransactionType>(draft.type);
  const [amountText, setAmountText] = useState(formatNumber(draft.amount, language));
  const [categoryId, setCategoryId] = useState(draft.categoryId);
  const [walletId, setWalletId] = useState(draft.walletId);
  const [dateTime, setDateTime] = useState(startTime);
  const [note, setNote] = useState(draft.note);
  const [submitted, setSubmitted] = useState(false); // errors show after the first Confirm
  const [busy, setBusy] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  const categoryOptions = categories.filter((c) => c.type === type);
  const walletOptions = wallets.filter((w) => !w.archived || w.id === draft.walletId);
  const amount = parseAmount(amountText);
  const wrong = {
    amount: amount === null,
    categoryId: !categoryOptions.some((c) => c.id === categoryId),
    walletId: !walletOptions.some((w) => w.id === walletId),
    occurredAt: !dateTime,
  };
  const errors: Partial<typeof wrong> = submitted ? wrong : {};
  const title = draft.note || t('transactions:noNote');

  const say = (message: string, severity: 'success' | 'warning' | 'error') => dispatch(showSnackbar({ message, severity }));

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const firstWrong = (Object.keys(wrong) as (keyof typeof wrong)[]).find((key) => wrong[key]);
    if (firstWrong || amount === null) {
      (event.currentTarget.elements.namedItem(firstWrong ?? 'amount') as HTMLElement | null)?.focus();
      return;
    }
    const fields: TransactionInput = {
      type,
      amount,
      categoryId,
      walletId,
      occurredAt: dateTime === startTime ? draft.occurredAt : fromDateTimeInput(dateTime), // unchanged: keep the seconds
      note: note.trim(),
    };
    const changed = (Object.keys(fields) as (keyof TransactionInput)[]).some((key) => fields[key] !== draft[key]);
    setBusy(true);
    try {
      const { budgetWarning } = await confirmDraft({ id: draft.id, changes: changed ? fields : undefined }).unwrap();
      if (budgetWarning) say(t('drafts.budgetWarning', { percent: budgetWarning.percent }), 'warning');
      else say(t('drafts.confirmed'), 'success');
      onGone();
    } catch (error) {
      say(apiErrorMessage(error), 'error');
      setBusy(false);
      // 409 ALREADY_CONFIRMED (confirmed in the chat meanwhile) or 404 (deleted): the card leaves the list too.
      const { status } = error as { status?: unknown };
      if (status === 404 || status === 409) onGone();
    }
  }

  async function discard() {
    setAskDiscard(false);
    try {
      await deleteTransaction(draft.id).unwrap();
      say(t('drafts.discarded'), 'success');
      onGone();
    } catch (error) {
      say(apiErrorMessage(error), 'error');
    }
  }

  const select = { select: { native: true }, inputLabel: { shrink: true } }; // the phone's own picker
  const items = draft.receipt?.items ?? [];

  return (
    <Paper component="form" variant="outlined" noValidate onSubmit={confirm} aria-labelledby={titleId} sx={{ p: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Chip size="small" icon={sourceIcon(draft.source)} label={t(`sources.${draft.source}`)} />
        <Typography id={titleId} variant="subtitle1" component="h3" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' } }}>
        <TextField
          name="type"
          select
          label={t('transactions:fields.type')}
          value={type}
          onChange={(event) => setType(event.target.value as TransactionType)}
          slotProps={select}
        >
          <option value="expense">{t('transactions:types.expense')}</option>
          <option value="income">{t('transactions:types.income')}</option>
        </TextField>
        <TextField
          name="amount"
          label={t('transactions:fields.amount')}
          value={amountText}
          onChange={(event) => setAmountText(event.target.value)}
          onBlur={() => amount !== null && setAmountText(formatNumber(amount, language))}
          error={errors.amount}
          helperText={
            errors.amount
              ? isOverMax(amountText)
                ? t('transactions:validation.amountMax', { max: formatMoney(MAX_MONEY, language) })
                : t('transactions:validation.amount')
              : amount !== null ? `= ${formatMoney(amount, language)}` : ' '}
          required
          slotProps={{ htmlInput: { autoComplete: 'off' } }}
        />
        <TextField
          name="categoryId"
          select
          label={t('transactions:fields.category')}
          value={categoryOptions.some((c) => c.id === categoryId) ? categoryId : ''}
          onChange={(event) => setCategoryId(event.target.value)}
          error={errors.categoryId}
          helperText={errors.categoryId ? t('transactions:validation.category') : undefined}
          required
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
          label={t('transactions:fields.wallet')}
          value={walletOptions.some((w) => w.id === walletId) ? walletId : ''}
          onChange={(event) => setWalletId(event.target.value)}
          error={errors.walletId}
          helperText={errors.walletId ? t('transactions:validation.wallet') : undefined}
          required
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
          label={t('transactions:fields.occurredAt')}
          value={dateTime}
          onChange={(event) => setDateTime(event.target.value)}
          error={errors.occurredAt}
          helperText={errors.occurredAt ? t('transactions:validation.occurredAt') : undefined}
          required
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          name="note"
          label={t('transactions:fields.note')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 200 } }}
        />
      </Box>

      {items.length > 0 && (
        // Native disclosure: keyboard and screen reader support without any script.
        <Box component="details" sx={{ mt: 2, typography: 'body2', '& summary': { cursor: 'pointer', py: 0.5 } }}>
          <summary>
            {t('drafts.items', { count: items.length })} · {t(draft.receipt?.reconciled ? 'drafts.reconciled' : 'drafts.notReconciled')}
          </summary>
          <Box component="ul" sx={{ m: 0, mt: 1, pl: 3 }}>
            {items.map((item, index) => (
              <li key={index}>
                {[
                  item.name,
                  item.quantity && item.unitPrice ? `${item.quantity} × ${formatMoney(item.unitPrice, language)}` : '',
                  item.amount !== undefined ? formatMoney(item.amount, language) : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </li>
            ))}
          </Box>
        </Box>
      )}

      <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1, mt: 2 }}>
        <Button type="button" color="error" disabled={busy} onClick={() => setAskDiscard(true)}>
          {t('drafts.discard')}
        </Button>
        <Button type="submit" variant="contained" loading={busy}>
          {t('drafts.confirm')}
        </Button>
      </Stack>
      <ConfirmDialog
        open={askDiscard}
        title={t('drafts.discardTitle')}
        message={t('drafts.discardMessage', { name: title })}
        confirmLabel={t('drafts.discard')}
        destructive
        onConfirm={() => void discard()}
        onCancel={() => setAskDiscard(false)}
      />
    </Paper>
  );
}
