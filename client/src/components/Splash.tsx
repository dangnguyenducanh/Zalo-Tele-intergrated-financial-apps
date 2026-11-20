import { Box, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';

// Shown while the session is being restored and while a lazy page loads.
export default function Splash() {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60dvh' }}>
      <CircularProgress aria-label={t('loading')} />
    </Box>
  );
}
