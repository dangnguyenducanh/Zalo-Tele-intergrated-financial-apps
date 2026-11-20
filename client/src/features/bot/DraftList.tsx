import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useGetDraftsQuery } from './botApi';
import DraftCard from './DraftCard';

// Drafts from every source (Telegram, Zalo, receipts) waiting for review: GET /transactions?status=draft.
export default function DraftList() {
  const { t } = useTranslation('bot');
  const titleId = useId();
  const { data, isLoading, isError, refetch } = useGetDraftsQuery();

  return (
    <section aria-labelledby={titleId}>
      <Typography id={titleId} variant="h6" component="h2" sx={{ mb: 1 }}>
        {t('drafts.title')}
        {data ? ` (${data.total})` : ''}
      </Typography>
      {isLoading && <CircularProgress aria-label={t('common:loading')} sx={{ display: 'block', mx: 'auto', my: 3 }} />}
      {isError && (
        <Alert severity="error" action={<Button onClick={() => void refetch()}>{t('drafts.retry')}</Button>}>
          {t('drafts.loadError')}
        </Alert>
      )}
      {data?.items.length === 0 && <Typography sx={{ color: 'text.secondary' }}>{t('drafts.empty')}</Typography>}
      <Stack spacing={2}>
        {data?.items.map((draft) => (
          <DraftCard key={draft.id} draft={draft} />
        ))}
      </Stack>
    </section>
  );
}
