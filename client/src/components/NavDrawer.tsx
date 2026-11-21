import { Box, Drawer, Toolbar, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/useAuth';
import Brand from './BrandMark';
import { initials } from './initials';
import NavList from './NavList';
import { GRADIENT } from '@/theme/theme';
import { navItemsFor } from './navItems';

export const DRAWER_WIDTH = 232;

// Desktop (≥ md): a permanent side navigation. It is always visible, so it is a plain <nav>, not a dialog.
// The signed-in account sits at the foot.
export default function NavDrawer() {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <Drawer variant="permanent" sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}>
      <Toolbar sx={{ px: 2.5 }}>
        <Brand size={22} />
      </Toolbar>
      <nav aria-label={t('nav.label')}>
        <NavList items={navItemsFor(user)} />
      </nav>
      {user && (
        <Box sx={{ mt: 'auto', mx: 1.5, mb: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1.25, alignItems: 'center', minWidth: 0 }}>
          <Box
            aria-hidden
            sx={{ width: 34, height: 34, flexShrink: 0, borderRadius: '50%', color: '#ffffff', backgroundImage: GRADIENT, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600 }}
          >
            {initials(user.name)}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: 13, fontWeight: 600 }}>
              {user.name}
            </Typography>
            <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary' }}>
              {user.email}
            </Typography>
          </Box>
        </Box>
      )}
    </Drawer>
  );
}
