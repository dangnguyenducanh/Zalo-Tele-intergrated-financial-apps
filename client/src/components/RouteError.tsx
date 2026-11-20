import { Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';

// Shown when a page fails to load or crashes, e.g. its code chunk is gone after a new deploy.
// Reloading fetches the current version of the app.
export default function RouteError() {
  const { t } = useTranslation();
  return (
    <main id="main">
      <EmptyState
        heading={t('GENERIC', { ns: 'errors' })}
        action={
          <Button variant="contained" onClick={() => window.location.reload()}>
            {t('reload')}
          </Button>
        }
      />
    </main>
  );
}
