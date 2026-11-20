import LogoutIcon from '@mui/icons-material/Logout';
import { Alert, Button, Chip, IconButton, List, ListItem, ListItemText, Paper, Typography } from '@mui/material';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { showSnackbar } from '@/app/uiSlice';
import ConfirmDialog from '@/components/ConfirmDialog';
import { apiErrorMessage } from '@/features/categories/helpers';
import { formatDate } from '@/i18n/format';
import { describeDevice } from './device';
import { useGetSessionsQuery, useRevokeOtherSessionsMutation, useRevokeSessionMutation, type Session } from './settingsApi';

// The devices logged in to this account (GET /sessions), newest first. Any other device can be logged out on its
// own or all at once; this device logs out from the account menu instead.
export default function SessionsList() {
  const { t } = useTranslation('settings');
  const titleId = useId();
  const dispatch = useAppDispatch();
  const language = useAppSelector((s) => s.ui.language);
  const heading = useRef<HTMLHeadingElement>(null);
  const { data: sessions, isLoading, isError, refetch } = useGetSessionsQuery();
  const [revokeSession] = useRevokeSessionMutation();
  const [revokeOthers] = useRevokeOtherSessionsMutation();
  const [pending, setPending] = useState<Session | 'others' | null>(null); // what the confirm dialog is about

  const deviceName = (session: Session) => describeDevice(session.userAgent) || t('sessions.unknownDevice');
  const others = sessions?.filter((session) => !session.current) ?? [];

  async function confirm() {
    const target = pending;
    setPending(null);
    if (!target) return;
    try {
      if (target === 'others') await revokeOthers().unwrap();
      else await revokeSession(target.id).unwrap();
      heading.current?.focus(); // the button that was used leaves with its row: keep focus on the page, not <body>
      const message = target === 'others' ? t('sessions.loggedOutOthers') : t('sessions.revoked', { device: deviceName(target) });
      dispatch(showSnackbar({ message, severity: 'success' }));
    } catch (error) {
      dispatch(showSnackbar({ message: apiErrorMessage(error), severity: 'error' }));
    }
  }

  return (
    <Paper component="section" variant="outlined" aria-labelledby={titleId} sx={{ p: 2 }}>
      <Typography id={titleId} ref={heading} tabIndex={-1} variant="h6" component="h2">
        {t('sessions.title')}
      </Typography>
      {isLoading && <Typography sx={{ color: 'text.secondary', mt: 1 }}>{t('common:loading')}</Typography>}
      {isError && (
        <Alert severity="error" sx={{ mt: 1 }} action={<Button onClick={() => void refetch()}>{t('sessions.retry')}</Button>}>
          {t('sessions.loadError')}
        </Alert>
      )}
      {sessions && (
        <List aria-labelledby={titleId}>
          {sessions.map((session) => (
            <ListItem
              key={session.id}
              disableGutters
              secondaryAction={
                session.current ? (
                  <Chip size="small" color="primary" variant="outlined" label={t('sessions.thisDevice')} />
                ) : (
                  <IconButton edge="end" aria-label={t('sessions.revoke', { device: deviceName(session) })} onClick={() => setPending(session)}>
                    <LogoutIcon />
                  </IconButton>
                )
              }
              sx={{ pr: session.current ? 14 : 6 }}
            >
              <ListItemText
                primary={deviceName(session)}
                secondary={`${session.ip} · ${t('sessions.lastUsed', {
                  date: formatDate(session.lastUsedAt, language, { dateStyle: 'medium', timeStyle: 'short' }),
                })}`}
                slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
              />
            </ListItem>
          ))}
        </List>
      )}
      {sessions && others.length === 0 && <Typography sx={{ color: 'text.secondary' }}>{t('sessions.onlyThisDevice')}</Typography>}
      {others.length > 0 && (
        <Button variant="outlined" color="error" startIcon={<LogoutIcon />} onClick={() => setPending('others')}>
          {t('sessions.logoutOthers')}
        </Button>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={t(pending === 'others' ? 'sessions.logoutOthersTitle' : 'sessions.revokeTitle')}
        message={pending === 'others' ? t('sessions.logoutOthersMessage') : pending ? t('sessions.revokeMessage', { device: deviceName(pending) }) : ''}
        confirmLabel={t('sessions.confirm')}
        destructive
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
      />
    </Paper>
  );
}
