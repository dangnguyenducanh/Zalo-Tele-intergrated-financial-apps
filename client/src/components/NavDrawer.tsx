import { Box, Drawer, Toolbar, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/auth/useAuth';
import { useDraftCount } from '@/features/transactions/useDraftCount';
import Brand from './BrandMark';
import NavList from './NavList';
import { navItemsFor } from './navItems';

export const DRAWER_WIDTH = 232;

// Desktop (≥ md): a permanent side navigation. It is always visible, so it is a plain <nav>, not a dialog.
// The bot inbox shows how many drafts wait; the signed-in account sits at the foot.
export default function NavDrawer() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const drafts = useDraftCount();
  return (
    <Drawer variant="permanent" sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}>
      <Toolbar sx={{ px: 2.5 }}>
        <Brand size={22} />
      </Toolbar>
      <nav aria-label={t('nav.label')}>
        <NavList items={navItemsFor(user)} badges={drafts ? { '/bot': drafts } : {}} />
      </nav>
      {user && (
        <Box sx={{ mt: 'auto', mx: 1.5, mb: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1.25, alignItems: 'center', minWidth: 0 }}>
          <Box
            aria-hidden
            sx={{ width: 30, height: 30, flexShrink: 0, borderRadius: '4px', border: 1, borderColor: 'divider', bgcolor: 'panel2', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 600 }}
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

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
