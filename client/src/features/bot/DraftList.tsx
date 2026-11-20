import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useGetDraftsQuery } from './botApi';
import DraftCard from './DraftCard';

// Drafts from every source (Telegram, Zalo, receipts) waiting for review: GET /transactions?status=draft.
export default function DraftList() {
  const { t } = useTranslation('bot');
  const titleId = useId();
  const { data, isLoading, isError, refetch } = useGetDraftsQuery();
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <section aria-labelledby={titleId}>
      <Typography id={titleId} ref={heading} tabIndex={-1} variant="h6" component="h2" sx={{ mb: 1 }}>
        {t('drafts.title')}
        {data ? ` (${data.total})` : ''}
      </Typography>
      {isLoading && <CircularProgress aria-label={t('common:loading')} sx={{ display: 'block', mx: 'auto', my: 3 }} />}
      {isError && (
        <Alert severity="error" action={<Button onClick={() => void refetch()}>{t('retry')}</Button>}>
          {t('drafts.loadError')}
        </Alert>
      )}
      {data?.items.length === 0 && <Typography sx={{ color: 'text.secondary' }}>{t('drafts.empty')}</Typography>}
      <Stack spacing={2}>
        {data?.items.map((draft) => (
          // A confirmed or discarded card leaves with the button that had focus: focus goes to this heading, not <body>.
          <DraftCard key={draft.id} draft={draft} onGone={() => heading.current?.focus()} />
        ))}
      </Stack>
    </section>
  );
}
