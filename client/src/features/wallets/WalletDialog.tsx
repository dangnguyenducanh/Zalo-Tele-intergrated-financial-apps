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
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import { apiErrorMessage } from '@/features/categories/helpers';
import KeywordInput from '@/features/categories/KeywordInput';
import { MAX_MONEY } from '@/features/transactions/helpers';
import { formatMoney } from '@/i18n/format';
import { useCreateWalletMutation, useUpdateWalletMutation, type Wallet, type WalletType } from './walletsApi';

const WALLET_TYPES: WalletType[] = ['cash', 'bank', 'ewallet', 'credit'];

// "200.000", "200,000" or "-1 500 000" → whole VND; null when it is not a whole number.
function parseVnd(text: string): number | null {
  const digits = text.replace(/[\s.,]/g, '');
  if (digits === '') return 0;
  return /^-?\d+$/.test(digits) ? Number(digits) : null;
}

type BalanceError = 'initialBalance' | 'initialBalanceMax' | 'initialBalanceCreditOnly';

// The message key of what is wrong with the opening balance: not a whole number, beyond ±MAX_MONEY, or below
// zero on a wallet that is not a credit card (BUG-038, the server refuses it too). Like the server, a wallet
// saved below zero before that rule passes while its type and opening balance stay as they are.
function balanceError(amount: number | null, type: WalletType, wallet?: Wallet): BalanceError | undefined {
  if (amount === null) return 'initialBalance';
  if (Math.abs(amount) > MAX_MONEY) return 'initialBalanceMax';
  const unchanged = wallet?.type === type && wallet.initialBalance === amount;
  if (amount < 0 && type !== 'credit' && !unchanged) return 'initialBalanceCreditOnly';
  return undefined;
}

type Props = { wallet?: Wallet; onClose: () => void }; // no wallet = add a new one

// Add/edit dialog for one wallet: name, type, opening balance and the aliases the bot understands (docs/05 §5.7).
export default function WalletDialog({ wallet, onClose }: Props) {
  const { t } = useTranslation('wallets');
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.ui.language);
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [createWallet, created] = useCreateWalletMutation();
  const [updateWallet, updated] = useUpdateWalletMutation();

  const [name, setName] = useState(wallet?.name ?? '');
  const [type, setType] = useState<WalletType>(wallet?.type ?? 'cash');
  const [initialBalance, setInitialBalance] = useState(String(wallet?.initialBalance ?? ''));
  const [aliases, setAliases] = useState(wallet?.aliases ?? []);
  const [errors, setErrors] = useState<{ name?: boolean; initialBalance?: BalanceError }>({});
  const [serverError, setServerError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    const amount = parseVnd(initialBalance);
    const found = { name: trimmed.length < 1 || trimmed.length > 40, initialBalance: balanceError(amount, type, wallet) };
    setErrors(found);
    if (found.name || found.initialBalance || amount === null) {
      // Focus the first wrong field so keyboard and screen reader users land on the problem.
      (event.currentTarget.elements.namedItem(found.name ? 'name' : 'initialBalance') as HTMLElement | null)?.focus();
      return;
    }
    const fields = { name: trimmed, type, initialBalance: amount, aliases };
    try {
      if (wallet) await updateWallet({ id: wallet.id, ...fields }).unwrap();
      else await createWallet(fields).unwrap();
      dispatch(showSnackbar({ message: t('saved'), severity: 'success' }));
      onClose();
    } catch (error) {
      setServerError(apiErrorMessage(error));
    }
  }

  return (
    <Dialog open onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm">
      {/* display: contents keeps the dialog's flex layout (scrolling content, fixed actions) */}
      <form noValidate onSubmit={onSubmit} style={{ display: 'contents' }}>
        <DialogTitle>{wallet ? t('dialog.editTitle') : t('dialog.addTitle')}</DialogTitle>
        <DialogContent>
          {serverError && <Alert severity="error">{serverError}</Alert>}
          <TextField
            name="name"
            label={t('fields.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
            helperText={errors.name ? t('validation.name') : undefined}
            required
            autoFocus
            fullWidth
            margin="normal"
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
          <FormControl margin="normal">
            <FormLabel id="wallet-type-label">{t('fields.type')}</FormLabel>
            <RadioGroup
              row
              name="type"
              aria-labelledby="wallet-type-label"
              value={type}
              onChange={(event) => setType(event.target.value as WalletType)}
            >
              {WALLET_TYPES.map((value) => (
                <FormControlLabel key={value} value={value} control={<Radio />} label={t(`types.${value}`)} />
              ))}
            </RadioGroup>
          </FormControl>
          <TextField
            name="initialBalance"
            label={t('fields.initialBalance')}
            value={initialBalance}
            onChange={(event) => setInitialBalance(event.target.value)}
            error={!!errors.initialBalance}
            helperText={
              errors.initialBalance
                ? t(`validation.${errors.initialBalance}`, { min: formatMoney(-MAX_MONEY, language), max: formatMoney(MAX_MONEY, language) })
                : t('fields.initialBalanceHelp')
            }
            fullWidth
            margin="normal"
            slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'off' } }}
          />
          <KeywordInput label={t('fields.aliases')} helperText={t('fields.aliasesHelp')} value={aliases} onChange={setAliases} />
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button type="submit" variant="contained" loading={created.isLoading || updated.isLoading}>
            {t('save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
