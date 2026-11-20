import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import EmptyState from '@/components/EmptyState';
import { useAuth } from './useAuth';

// Layout route for /admin/*: a non-admin sees a 403 message instead of the page.
// The API checks the role too (requireRole), so this only keeps the UI honest.
export default function AdminRoute() {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return (
      <>
        <title>{`${t('forbidden.title')} · ${t('appName')}`}</title>
        <EmptyState heading={t('forbidden.title')} description={t('forbidden.body')} />
      </>
    );
  }
  return <Outlet />;
}
