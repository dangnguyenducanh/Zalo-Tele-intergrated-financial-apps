import { Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import EmptyState from '@/components/EmptyState';

export default function NotFoundPage() {
  const { t } = useTranslation('notFound');
  return (
    <main id="main">
      <title>{`${t('title')} · ${t('common:appName')}`}</title>
      <EmptyState
        heading={t('title')}
        description={t('body')}
        action={
          <Button component={Link} to="/" variant="contained">
            {t('home')}
          </Button>
        }
      />
    </main>
  );
}
