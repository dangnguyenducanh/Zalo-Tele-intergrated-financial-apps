import { Alert, Box, Button, Chip, Pagination, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import { useAuth } from '@/auth/useAuth';
import ConfirmDialog from '@/components/ConfirmDialog';
import { errorMessage } from '@/i18n/errors';
import type { User } from '@/types/api';
import { errorCodeOf, useGetAdminStatsQuery, useGetAdminUsersQuery, useUpdateAdminUserMutation, type UserFilters } from './adminApi';
import { tableWrapperSx } from './tableSx';

const PAGE_SIZE = 20;

// The four things an admin can do to an account, and the PATCH /admin/users/:id body for each.
type Action = 'lock' | 'unlock' | 'makeAdmin' | 'removeAdmin';
const CHANGES: Record<Action, Partial<Pick<User, 'role' | 'status'>>> = {
  lock: { status: 'locked' },
  unlock: { status: 'active' },
  makeAdmin: { role: 'admin' },
  removeAdmin: { role: 'user' },
};
const DESTRUCTIVE: Action[] = ['lock', 'removeAdmin'];

// /admin/users (docs/05 §5.7): system stats, search and filters, role/status chips, and
// lock/unlock and promote/demote, each behind a confirm dialog.
export default function AdminUsersPage() {
  const { t } = useTranslation('admin');
  const dispatch = useAppDispatch();
  const { user: me } = useAuth();
  const captionId = useId();
  const [filters, setFilters] = useState<UserFilters>({});
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ user: User; action: Action } | null>(null);
  const { data, isError } = useGetAdminUsersQuery({ ...filters, page, limit: PAGE_SIZE });
  const [updateUser] = useUpdateAdminUserMutation();
  const pageCount = Math.ceil((data?.total ?? 0) / PAGE_SIZE);

  // Filters apply when the form is submitted (Enter or the Search button), not on every keystroke.
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim() || undefined; // "" = no filter
    setFilters({ q: value('q'), role: value('role') as UserFilters['role'], status: value('status') as UserFilters['status'] });
    setPage(1);
  }

  async function runPending() {
    if (!pending) return;
    const { user, action } = pending;
    setPending(null);
    try {
      await updateUser({ id: user.id, changes: CHANGES[action] }).unwrap();
      dispatch(showSnackbar({ message: t(`users.done.${action}`, { name: user.name }), severity: 'success' }));
    } catch (error) {
      dispatch(showSnackbar({ message: errorMessage(errorCodeOf(error)), severity: 'error' }));
    }
  }

  return (
    <>
      <title>{`${t('users.title')} · ${t('common:appName')}`}</title>
      <Typography variant="h4" component="h1" gutterBottom>
        {t('users.title')}
      </Typography>
      <StatsCards />

      <Box component="search" sx={{ my: 3 }}>
        <Stack component="form" onSubmit={search} direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <TextField
            name="q"
            type="search"
            label={t('users.search')}
            size="small"
            sx={{ flexGrow: 1 }}
            slotProps={{ htmlInput: { maxLength: 100, autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } }}
          />
          <TextField name="role" select label={t('users.role')} size="small" defaultValue="" slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
            <option value="">{t('users.all')}</option>
            <option value="user">{t('users.roles.user')}</option>
            <option value="admin">{t('users.roles.admin')}</option>
          </TextField>
          <TextField name="status" select label={t('users.status')} size="small" defaultValue="" slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
            <option value="">{t('users.all')}</option>
            <option value="active">{t('users.statuses.active')}</option>
            <option value="locked">{t('users.statuses.locked')}</option>
          </TextField>
          <Button type="submit" variant="contained">
            {t('users.apply')}
          </Button>
        </Stack>
      </Box>

      {isError && <Alert severity="error">{errorMessage('GENERIC')}</Alert>}
      <Box role="region" aria-labelledby={captionId} tabIndex={0} sx={tableWrapperSx}>
        <Table size="small">
          <caption id={captionId} style={{ captionSide: 'top', textAlign: 'start', padding: '8px 0' }}>
            {data ? t('users.caption', { count: data.total }) : t('common:loading')}
          </caption>
          <TableHead>
            <TableRow>
              <TableCell>{t('users.user')}</TableCell>
              <TableCell>{t('users.role')}</TableCell>
              <TableCell>{t('users.status')}</TableCell>
              <TableCell>{t('users.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data?.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>{t('users.empty')}</TableCell>
              </TableRow>
            )}
            {data?.items.map((user) => (
              <TableRow key={user.id}>
                <TableCell component="th" scope="row">
                  <strong>{user.name}</strong>
                  {user.id === me?.id && ` (${t('users.you')})`}
                  <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                    {user.email}
                  </Typography>
                </TableCell>
                <TableCell data-label={t('users.role')}>
                  <Chip size="small" label={t(`users.roles.${user.role}`)} color={user.role === 'admin' ? 'primary' : 'default'} />
                </TableCell>
                <TableCell data-label={t('users.status')}>
                  <Chip size="small" variant="outlined" label={t(`users.statuses.${user.status}`)} color={user.status === 'locked' ? 'error' : 'success'} />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                    {(['lock', 'unlock', 'makeAdmin', 'removeAdmin'] as const)
                      .filter((action) => allowed(user, action))
                      .map((action) => (
                        <Button
                          key={action}
                          size="small"
                          color={DESTRUCTIVE.includes(action) ? 'error' : 'primary'}
                          aria-label={`${t(`users.${action}`)} ${user.name}`}
                          onClick={() => setPending({ user, action })}
                        >
                          {t(`users.${action}`)}
                        </Button>
                      ))}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      {pageCount > 1 && (
        <Pagination
          sx={{ mt: 2 }}
          count={pageCount}
          page={page}
          onChange={(_event, next) => setPage(next)}
          getItemAriaLabel={(type, number) => t(`users.pagination.${type}`, { page: number })}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? t(`users.confirm.${pending.action}.title`) : ''}
        message={pending ? t(`users.confirm.${pending.action}.message`, { name: pending.user.name, email: pending.user.email }) : ''}
        confirmLabel={pending ? t(`users.${pending.action}`) : undefined}
        destructive={pending ? DESTRUCTIVE.includes(pending.action) : false}
        onConfirm={() => void runPending()}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

// Only the actions that change something are offered (no "Lock" on a locked account).
function allowed(user: User, action: Action): boolean {
  const change = CHANGES[action];
  return (change.role ?? user.role) !== user.role || (change.status ?? user.status) !== user.status;
}

// Counts for the whole system (GET /admin/stats). No one's transactions, only how many there are.
function StatsCards() {
  const { t, i18n } = useTranslation('admin');
  const { data } = useGetAdminStatsQuery();
  if (!data) return null;
  const n = (value: number) => value.toLocaleString(i18n.language);
  const cards = [
    { label: t('stats.users'), value: n(data.users) },
    { label: t('stats.activeUsers7d'), value: n(data.activeUsers7d) },
    { label: t('stats.chatLinks'), value: n(data.chatLinks.telegram + data.chatLinks.zalo), detail: t('stats.chatLinksDetail', mapValues(data.chatLinks, n)) },
    {
      label: t('stats.transactions'),
      value: n(Object.values(data.transactionsBySource).reduce((sum, count) => sum + count, 0)),
      detail: t('stats.transactionsDetail', mapValues(data.transactionsBySource, n)),
    },
  ];
  return (
    <Box component="dl" sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', m: 0 }}>
      {cards.map((card) => (
        <Paper key={card.label} variant="outlined" sx={{ p: 2 }}>
          <Typography component="dt" variant="body2" sx={{ color: 'text.secondary' }}>
            {card.label}
          </Typography>
          <Typography component="dd" variant="h5" sx={{ m: 0, fontWeight: 700 }}>
            {card.value}
          </Typography>
          {card.detail && (
            <Typography component="dd" variant="body2" sx={{ m: 0, color: 'text.secondary' }}>
              {card.detail}
            </Typography>
          )}
        </Paper>
      ))}
    </Box>
  );
}

const mapValues = <T extends Record<string, number>>(counts: T, format: (value: number) => string) =>
  Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, format(value)]));
