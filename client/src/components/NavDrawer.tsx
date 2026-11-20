import { Drawer, Toolbar, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/useAuth';
import NavList from './NavList';
import { navItemsFor } from './navItems';

export const DRAWER_WIDTH = 248;

// Desktop (≥ md): a permanent side navigation. It is always visible, so it is a plain <nav>, not a dialog.
export default function NavDrawer() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <Drawer variant="permanent" sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}>
      <Toolbar>
        <Typography variant="h6" component="div" noWrap sx={{ fontWeight: 700, color: 'primary.main' }}>
          {t('appName')}
        </Typography>
      </Toolbar>
      <nav aria-label={t('nav.label')}>
        <NavList items={navItemsFor(user)} />
      </nav>
    </Drawer>
  );
}
