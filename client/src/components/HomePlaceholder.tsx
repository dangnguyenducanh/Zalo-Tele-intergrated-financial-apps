import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/useAuth';
import EmptyState from './EmptyState';

// Temporary content for "/" until the dashboard (T10) replaces this route.
export default function HomePlaceholder() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <>
      <title>{`${t('nav.dashboard')} · ${t('appName')}`}</title>
      <EmptyState heading={t('home.title', { name: user?.name })} description={t('home.body')} />
    </>
  );
}
