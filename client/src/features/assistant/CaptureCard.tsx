import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '@/app/hooks';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { apiErrorMessage } from '@/features/categories/helpers';
import { signedMoney } from '@/features/transactions/helpers';
import { useCreateTransactionMutation, type DraftHint, type ParseResult } from '@/features/transactions/transactionsApi';
import { useGetWalletsQuery } from '@/features/wallets/walletsApi';
import { formatDate, formatMoney } from '@/i18n/format';
import { isComplete, toInput } from './drafts';

// What the drawer shows for a capture typed in it ("phở 45k", docs/05 §5.10.1): the quick-add preview and a save button.
// Nothing is saved until the button is pressed, and it saves the way QuickAdd's Enter does: one POST /transactions per line.
export default function CaptureCard({ result }: { result: ParseResult }) {
  const { t } = useTranslation(['assistant', 'transactions']);
  const language = useAppSelector((s) => s.ui.language);
  const { data: categories = [] } = useGetCategoriesQuery();
  const { data: wallets = [] } = useGetWalletsQuery({ includeArchived: true });
  const [createTransaction] = useCreateTransactionMutation();
  const [saved, setSaved] = useState(0); // lines saved so far, so a retry after a failure never saves a line twice
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false); // a second press while one save runs is ignored; a ref, because it must change at once
  const labelId = useId();

  const { drafts } = result;
  // Lines the parser could not use: saving only the others would lose them silently, so Save waits (as in QuickAdd).
  const warning = result.noAmountLines.length > 0 ? t('transactions:quickAdd.noAmountLines', { lines: result.noAmountLines.join(', ') }) : result.truncated ? t('transactions:quickAdd.tooManyLines') : null;
  const complete = drafts.every(isComplete);
  const done = drafts.length > 0 && saved === drafts.length;

  async function save() {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      let count = saved;
      for (const draft of drafts.slice(saved)) {
        if (!isComplete(draft)) break;
        await createTransaction(toInput(draft)).unwrap();
        count += 1;
        setSaved(count);
      }
    } catch (failure) {
      setError(apiErrorMessage(failure));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <Paper variant="outlined" role="group" aria-labelledby={labelId} sx={{ p: 1.5, alignSelf: 'stretch' }}>
      <Typography id={labelId} variant="overline" component="p" sx={{ color: 'text.secondary' }}>
        {t('capture.label')}
      </Typography>
      <Stack component="ul" spacing={1} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {drafts.map((draft, i) => {
          const category = categories.find((c) => c.id === draft.categoryId);
          const wallet = wallets.find((w) => w.id === draft.walletId);
          const name = category ? categoryName(category, language) : '';
          const hintText = (hint: DraftHint) =>
            hint.code === 'big'
              ? t('transactions:quickAdd.hintBig', { times: hint.times, category: name, median: formatMoney(hint.median, language) })
              : t('transactions:quickAdd.hintDuplicate', { category: name });
          return (
            <Stack component="li" key={i} direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Chip variant="outlined" label={signedMoney(draft.type, draft.amount, language)} />
              <Chip variant="outlined" label={name || t('transactions:quickAdd.noCategory')} />
              <Chip variant="outlined" label={wallet?.name ?? t('transactions:quickAdd.noWallet')} />
              <Chip variant="outlined" label={formatDate(draft.occurredAt, language)} />
              {draft.hints?.map((hint) => (
                <Typography key={hint.code} variant="caption" sx={{ flexBasis: '100%', color: 'warning.dark' }}>
                  {hintText(hint)}
                </Typography>
              ))}
            </Stack>
          );
        })}
      </Stack>
      {warning && (
        <Typography variant="caption" component="p" sx={{ mt: 1, color: 'text.secondary' }}>
          {warning}
        </Typography>
      )}
      {!complete && !warning && (
        <Typography variant="caption" component="p" sx={{ mt: 1, color: 'text.secondary' }}>
          {t('capture.noWallet')}
        </Typography>
      )}
      {error && (
        <Typography role="alert" variant="caption" component="p" sx={{ mt: 1, color: 'error.main' }}>
          {error}
        </Typography>
      )}
      <Box sx={{ mt: 1.5 }}>
        {done ? (
          <Typography role="status" variant="body2" sx={{ color: 'success.main' }}>
            {t('capture.saved', { count: saved })}
          </Typography>
        ) : (
          <Button variant="contained" size="small" loading={saving} disabled={!complete || warning !== null} onClick={() => void save()}>
            {t('capture.save')}
          </Button>
        )}
      </Box>
    </Paper>
  );
}
