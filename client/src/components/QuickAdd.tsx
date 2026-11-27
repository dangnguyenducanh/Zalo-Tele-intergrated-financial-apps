import { Box, Button, Chip, Paper, Stack, TextField } from '@mui/material';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import { categoryName, useGetCategoriesQuery } from '@/features/categories/categoriesApi';
import { apiErrorMessage } from '@/features/categories/helpers';
import { signedMoney } from '@/features/transactions/helpers';
import TransactionDialog from '@/features/transactions/TransactionDialog';
import {
  useCreateTransactionMutation,
  useLazyParseTransactionsQuery,
  useParseTransactionsQuery,
  type ParsedDraft,
  type ParseResult,
  type TransactionInput,
} from '@/features/transactions/transactionsApi';
import { useDebounced } from '@/features/transactions/useDebounced';
import { useGetWalletsQuery } from '@/features/wallets/walletsApi';
import { formatDate } from '@/i18n/format';

const isComplete = (draft: ParsedDraft): draft is TransactionInput => Boolean(draft.walletId && draft.categoryId);

// Which dialog is open: "apply" edits one preview line, "save" is the full add form (Shift+Enter).
type OpenForm = { mode: 'apply'; index: number; draft: ParsedDraft } | { mode: 'save'; draft: Partial<ParsedDraft> };

// The quick-add box (docs/05 §5.7, F13): type "phở 45k" like in the bot. After a 300 ms pause the server parser
// (POST /transactions/parse, saves nothing) shows a preview; Enter saves every line, Shift+Enter opens the full form.
// A question ("tháng 10 thu bao nhiêu") is not money: the server answers question: true, the preview becomes a notice,
// and Enter, Save, Shift+Enter and "Open full form" do nothing (docs/05 §5.10.2).
export default function QuickAdd() {
  const { t } = useTranslation('transactions');
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.ui.language);
  const [text, setText] = useState('');
  const value = text.trim();
  const settled = useDebounced(value, 300);
  const preview = useParseTransactionsQuery(settled, { skip: !settled });
  const [parse] = useLazyParseTransactionsQuery();
  const [createTransaction, { isLoading: saving }] = useCreateTransactionMutation();
  const { data: categories = [] } = useGetCategoriesQuery();
  const { data: wallets = [] } = useGetWalletsQuery({ includeArchived: true });
  // Lines changed through a chip, by line number; they only count while the text is still the same.
  const [edits, setEdits] = useState<{ text: string; drafts: Record<number, ParsedDraft> }>({ text: '', drafts: {} });
  const [error, setError] = useState<string | null>(null); // from the last Enter; cleared when typing
  const [form, setForm] = useState<OpenForm | null>(null);
  // Set before the parse request, not when the save starts, so a second Enter or click during the parse
  // cannot save the same lines twice. A ref, because it must change at once, not on the next render.
  const busy = useRef(false);

  const withEdits = (drafts: ParsedDraft[], forText: string) =>
    drafts.map((draft, i) => (edits.text === forText && edits.drafts[i]) || draft);
  const shown = value ? withEdits(preview.currentData?.drafts ?? [], settled) : []; // an emptied box hides it at once
  // Lines the parser could not use. Saving only the others would silently lose them, so they are named and Enter waits.
  const skipped = ({ noAmountLines, truncated }: ParseResult) =>
    noAmountLines.length > 0 ? t('quickAdd.noAmountLines', { lines: noAmountLines.join(', ') }) : truncated ? t('quickAdd.tooManyLines') : null;
  const isQuestion = Boolean(preview.currentData?.question) && value === settled;
  const warning = preview.currentData && value === settled ? skipped(preview.currentData) : null;
  const hint = preview.error && value === settled ? apiErrorMessage(preview.error) : isQuestion ? t('quickAdd.questionHint') : (warning ?? t('quickAdd.hint'));

  function reset(count: number) {
    setText('');
    dispatch(showSnackbar({ message: t('quickAdd.saved', { count }), severity: 'success' }));
  }

  // Runs one Enter / Shift+Enter at a time; a press while one is still running is ignored.
  async function once(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await work();
    } finally {
      busy.current = false;
    }
  }

  // Enter: parse (from the cache when the preview already did) and save each line in order.
  async function saveAll() {
    if (!value) return;
    try {
      const result = await parse(value, true).unwrap();
      if (result.question) return; // a question has no drafts: saving "nothing" must not clear the box or say "saved"
      const problem = skipped(result);
      if (problem) return setError(problem);
      const drafts = withEdits(result.drafts, value);
      if (!drafts.every(isComplete)) return setError(t('quickAdd.incomplete'));
      // ponytail: one request per line; if one fails midway the earlier lines stay saved and the text stays.
      for (const draft of drafts) await createTransaction(draft).unwrap();
      reset(drafts.length);
    } catch (failure) {
      setError(apiErrorMessage(failure)); // e.g. NO_AMOUNT_FOUND, in the user's language
    }
  }

  // Shift+Enter or the button: the full form, pre-filled with the first line (or the text as a note).
  async function openFullForm() {
    let draft: Partial<ParsedDraft> = { note: value };
    if (value) {
      try {
        const result = await parse(value, true).unwrap();
        if (result.question) return; // no form with the question as its note
        draft = withEdits(result.drafts, value)[0] ?? draft;
      } catch {
        // no amount: the form starts from the text alone
      }
    }
    setForm({ mode: 'save', draft });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault(); // no new line; pasted text keeps its lines
    if (event.nativeEvent.isComposing || event.keyCode === 229) return; // an IME is confirming a word
    void once(event.shiftKey ? openFullForm : saveAll);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void once(saveAll);
  }

  async function onFormSubmit(fields: TransactionInput) {
    if (form?.mode === 'apply') {
      const index = form.index;
      setEdits((old) => ({ text: settled, drafts: { ...(old.text === settled ? old.drafts : {}), [index]: fields } }));
      return;
    }
    await createTransaction(fields).unwrap();
    reset(1); // the full form saves one line, so the box is cleared
  }

  const chip = (label: string, index: number, draft: ParsedDraft) => (
    <Chip
      label={label}
      aria-label={t('quickAdd.change', { value: label })}
      onClick={() => setForm({ mode: 'apply', index, draft })}
      variant="outlined"
    />
  );

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
      <Box component="form" noValidate onSubmit={onSubmit}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            label={t('quickAdd.label')}
            placeholder={t('quickAdd.placeholder')}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
            onKeyDown={onKeyDown}
            error={error !== null}
            helperText={error ?? hint}
            multiline
            maxRows={6}
            fullWidth
            slotProps={{ htmlInput: { enterKeyHint: 'done', autoComplete: 'off' } }}
          />
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0, pt: { sm: 1 } }}>
            <Button type="submit" variant="contained" loading={saving}>
              {t('quickAdd.save')}
            </Button>
            <Button type="button" onClick={() => void once(openFullForm)}>
              {t('quickAdd.fullForm')}
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Box role="status">{isQuestion && <Chip label={t('quickAdd.question')} variant="outlined" sx={{ mt: 1.5 }} />}</Box>

      {shown.length > 0 && (
        <Stack component="ul" aria-label={t('quickAdd.preview')} spacing={1} sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.5 }}>
          {shown.map((draft, i) => {
            const category = categories.find((c) => c.id === draft.categoryId);
            const wallet = wallets.find((w) => w.id === draft.walletId);
            return (
              <Stack component="li" key={i} direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap' }}>
                {chip(signedMoney(draft.type, draft.amount, language), i, draft)}
                {chip(category ? categoryName(category, language) : t('quickAdd.noCategory'), i, draft)}
                {chip(wallet?.name ?? t('quickAdd.noWallet'), i, draft)}
                {chip(formatDate(draft.occurredAt, language), i, draft)}
              </Stack>
            );
          })}
        </Stack>
      )}

      {form && (
        <TransactionDialog
          title={t(form.mode === 'apply' ? 'dialog.draftTitle' : 'dialog.addTitle')}
          submitLabel={t(form.mode === 'apply' ? 'dialog.apply' : 'dialog.save')}
          initial={form.draft}
          onSubmit={onFormSubmit}
          onClose={() => setForm(null)}
        />
      )}
    </Paper>
  );
}
