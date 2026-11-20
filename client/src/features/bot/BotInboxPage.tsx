import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import DraftList from './DraftList';
import LinkCard from './LinkCard';
import LinkedAccounts from './LinkedAccounts';
import ReceiptUpload from './ReceiptUpload';

// /bot (docs/05 §5.7): receipt upload and the drafts to review on the left; linking Telegram/Zalo and the
// linked accounts on the right. On a phone everything is one column, drafts first.
export default function BotInboxPage() {
  const { t } = useTranslation('bot');
  return (
    <>
      <title>{`${t('title')} · ${t('common:appName')}`}</title>
      <Typography variant="h4" component="h1" sx={{ typography: { xs: 'h5', sm: 'h4' }, mb: 1 }}>
        {t('title')}
      </Typography>
      <Typography sx={{ color: 'text.secondary', mb: 3 }}>{t('intro')}</Typography>
      <Box sx={{ display: 'grid', gap: 3, alignItems: 'start', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 2fr) minmax(0, 1fr)' } }}>
        <Stack spacing={3}>
          <ReceiptUpload />
          <DraftList />
        </Stack>
        <Stack spacing={3}>
          <LinkCard />
          <LinkedAccounts />
        </Stack>
      </Box>
    </>
  );
}
