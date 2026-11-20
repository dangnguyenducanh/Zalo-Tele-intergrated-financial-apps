import { Alert, Button, Paper, TextField, Typography } from '@mui/material';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import { useAuth } from '@/auth/useAuth';
import { apiErrorMessage } from '@/features/categories/helpers';
import { useGetWalletsQuery } from '@/features/wallets/walletsApi';
import { useSaveProfile } from './useSaveProfile';

// Name and default wallet (the wallet the bots and quick add use when no wallet is named).
export default function ProfileForm() {
  const { t } = useTranslation('settings');
  const titleId = useId();
  const dispatch = useAppDispatch();
  const { user } = useAuth();
  const { data: wallets } = useGetWalletsQuery();
  const [save, busy] = useSaveProfile();
  const [name, setName] = useState(user?.name ?? '');
  const [walletId, setWalletId] = useState(user?.defaultWalletId ?? '');
  const [nameInvalid, setNameInvalid] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 60) {
      setNameInvalid(true);
      nameInput.current?.focus();
      return;
    }
    setServerError(null);
    try {
      await save({ name: trimmed, defaultWalletId: walletId || null });
      dispatch(showSnackbar({ message: t('profile.saved'), severity: 'success' }));
    } catch (error) {
      setServerError(apiErrorMessage(error));
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography id={titleId} variant="h6" component="h2">
        {t('profile.title')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t('profile.email', { email: user?.email })}
      </Typography>
      <form noValidate aria-labelledby={titleId} onSubmit={(event) => void submit(event)}>
        {serverError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {serverError}
          </Alert>
        )}
        <TextField
          name="name"
          label={t('profile.name')}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameInvalid(false); // clear the error as soon as the user fixes it, never while typing
          }}
          error={nameInvalid}
          helperText={nameInvalid ? t('profile.nameError') : undefined}
          inputRef={nameInput}
          autoComplete="name"
          required
          fullWidth
          margin="normal"
        />
        <TextField
          select
          name="defaultWalletId"
          label={t('profile.defaultWallet')}
          helperText={t('profile.defaultWalletHelp')}
          value={walletId}
          onChange={(event) => setWalletId(event.target.value)}
          fullWidth
          margin="normal"
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        >
          <option value="">{t('profile.noWallet')}</option>
          {wallets?.map((wallet) => (
            <option key={wallet.id} value={wallet.id}>
              {wallet.name}
            </option>
          ))}
        </TextField>
        <Button type="submit" variant="contained" loading={busy} sx={{ mt: 1 }}>
          {t('profile.save')}
        </Button>
      </form>
    </Paper>
  );
}
