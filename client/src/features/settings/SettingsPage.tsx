import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import PasswordForm from './PasswordForm';
import PreferencesForm from './PreferencesForm';
import ProfileForm from './ProfileForm';
import SessionsList from './SessionsList';

// /settings (docs/05 §5.7): profile, preferences, password and the logged-in devices.
// Two columns on a desktop, one on a phone. Each part saves on its own.
export default function SettingsPage() {
  const { t } = useTranslation('settings');
  return (
    <>
      <title>{`${t('title')} · ${t('common:appName')}`}</title>
      <Typography variant="h4" component="h1" sx={{ typography: { xs: 'h5', sm: 'h4' }, mb: 3 }}>
        {t('title')}
      </Typography>
      <Box sx={{ display: 'grid', gap: 3, alignItems: 'start', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' } }}>
        <Stack spacing={3}>
          <ProfileForm />
          <PreferencesForm />
        </Stack>
        <Stack spacing={3}>
          <PasswordForm />
          <SessionsList />
        </Stack>
      </Box>
    </>
  );
}
