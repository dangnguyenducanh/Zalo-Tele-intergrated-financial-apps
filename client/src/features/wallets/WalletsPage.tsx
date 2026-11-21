import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import AddIcon from '@mui/icons-material/Add';
import ArchiveIcon from '@mui/icons-material/Archive';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import PaymentsIcon from '@mui/icons-material/Payments';
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import { getAccessToken, setSession } from '@/auth/session';
import { useAuth } from '@/auth/useAuth';
import ConfirmDialog from '@/components/ConfirmDialog';
import EmptyState from '@/components/EmptyState';
import MoneyText from '@/components/MoneyText';
import { apiErrorMessage } from '@/features/categories/helpers';
import WalletDialog from './WalletDialog';
import { useDeleteWalletMutation, useGetWalletsQuery, useUpdateWalletMutation, type Wallet, type WalletType } from './walletsApi';

const TYPE_ICONS: Record<WalletType, typeof PaymentsIcon> = {
  cash: PaymentsIcon,
  bank: AccountBalanceIcon,
  ewallet: PhoneIphoneIcon,
  credit: CreditCardIcon,
};

// /wallets: a card per wallet with the balance the server computed, add/edit dialog, archive toggle,
// and delete (the server refuses it with WALLET_IN_USE while transactions use the wallet) (docs/05 §5.7).
export default function WalletsPage() {
  const { t } = useTranslation('wallets');
  const dispatch = useAppDispatch();
  const { data: wallets = [], isLoading, isError, refetch } = useGetWalletsQuery({ includeArchived: true });
  const [updateWallet] = useUpdateWalletMutation();
  const [deleteWallet] = useDeleteWalletMutation();
  const [editing, setEditing] = useState<Wallet | 'new' | null>(null); // which dialog is open
  const [deleting, setDeleting] = useState<Wallet | null>(null);
  const { user } = useAuth();

  const active = wallets.filter((wallet) => !wallet.archived);
  const archived = wallets.filter((wallet) => wallet.archived);

  // Runs a mutation; a failure (e.g. WALLET_IN_USE) is explained in the snackbar in the user's language.
  async function run(action: () => Promise<unknown>, success?: string) {
    try {
      await action();
      if (success) dispatch(showSnackbar({ message: success, severity: 'success' }));
    } catch (error) {
      dispatch(showSnackbar({ message: apiErrorMessage(error), severity: 'error' }));
    }
  }

  // The server clears the default wallet when it is archived or deleted; the signed-in user is updated to match,
  // so the Add form and Settings stop offering it without a reload.
  function forgetIfDefault(walletId: string) {
    const accessToken = getAccessToken();
    if (user && accessToken && user.defaultWalletId === walletId) setSession({ accessToken, user: { ...user, defaultWalletId: null } });
  }

  async function toggleArchive(wallet: Wallet) {
    await updateWallet({ id: wallet.id, archived: !wallet.archived }).unwrap();
    if (!wallet.archived) forgetIfDefault(wallet.id);
  }

  async function remove(wallet: Wallet) {
    await deleteWallet(wallet.id).unwrap();
    forgetIfDefault(wallet.id);
  }

  const cardFor = (wallet: Wallet) => (
    <WalletCard
      key={wallet.id}
      wallet={wallet}
      onEdit={() => setEditing(wallet)}
      onToggleArchive={() => void run(() => toggleArchive(wallet))}
      onDelete={() => setDeleting(wallet)}
    />
  );

  return (
    <>
      <title>{`${t('title')} · ${t('common:appName')}`}</title>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ typography: { xs: 'h5', sm: 'h4' } }}>
          {t('title')}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
          {t('add')}
        </Button>
      </Stack>

      {isLoading && <CircularProgress aria-label={t('common:loading')} sx={{ display: 'block', mx: 'auto', my: 4 }} />}
      {isError && (
        <Alert severity="error" action={<Button onClick={() => void refetch()}>{t('retry')}</Button>}>
          {t('loadError')}
        </Alert>
      )}
      {!isLoading && !isError && wallets.length === 0 && <EmptyState headingLevel="h2" heading={t('empty')} />}

      <Grid container spacing={2}>
        {active.map(cardFor)}
      </Grid>

      {archived.length > 0 && (
        <Box component="section" aria-labelledby="archived-wallets" sx={{ mt: 4 }}>
          <Typography variant="h6" component="h2" id="archived-wallets" sx={{ mb: 2 }}>
            {t('archivedTitle')}
          </Typography>
          <Grid container spacing={2}>
            {archived.map(cardFor)}
          </Grid>
        </Box>
      )}

      {editing && <WalletDialog wallet={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteConfirm.title')}
        message={t('deleteConfirm.message', { name: deleting?.name ?? '' })}
        confirmLabel={t('deleteConfirm.confirm')}
        destructive
        onConfirm={() => {
          const wallet = deleting;
          setDeleting(null);
          if (wallet) void run(() => remove(wallet), t('deleted'));
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

type CardProps = { wallet: Wallet; onEdit: () => void; onToggleArchive: () => void; onDelete: () => void };

function WalletCard({ wallet, onEdit, onToggleArchive, onDelete }: CardProps) {
  const { t } = useTranslation('wallets');
  const Icon = TYPE_ICONS[wallet.type];
  const nameId = `wallet-${wallet.id}`;
  const { name } = wallet;
  return (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <Card component="article" aria-labelledby={nameId} variant="outlined" sx={{ height: '100%', opacity: wallet.archived ? 0.75 : 1 }}>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Icon color="primary" />
            <Typography variant="h6" component="h3" id={nameId} noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
              {name}
            </Typography>
            {wallet.archived && <Chip size="small" label={t('archived')} />}
          </Stack>
          <Typography sx={{ color: 'text.secondary' }}>{t(`types.${wallet.type}`)}</Typography>
          <Typography variant="h5" component="p" sx={{ mt: 1, color: wallet.balance < 0 ? 'error.main' : 'text.primary' }}>
            <MoneyText amount={wallet.balance} />
          </Typography>
          {wallet.aliases.length > 0 && (
            <Stack direction="row" useFlexGap spacing={0.5} sx={{ flexWrap: 'wrap', mt: 1 }}>
              {wallet.aliases.map((alias) => (
                <Chip key={alias} size="small" variant="outlined" label={alias} />
              ))}
            </Stack>
          )}
        </CardContent>
        <CardActions>
          <IconButton aria-label={t('actions.edit', { name })} onClick={onEdit}>
            <EditIcon />
          </IconButton>
          <IconButton aria-label={t(wallet.archived ? 'actions.unarchive' : 'actions.archive', { name })} onClick={onToggleArchive}>
            {wallet.archived ? <UnarchiveIcon /> : <ArchiveIcon />}
          </IconButton>
          <IconButton aria-label={t('actions.delete', { name })} onClick={onDelete}>
            <DeleteIcon />
          </IconButton>
        </CardActions>
      </Card>
    </Grid>
  );
}
