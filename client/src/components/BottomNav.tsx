import { alpha, BottomNavigation, BottomNavigationAction, Box, Drawer, IconButton, Paper, Toolbar, Typography } from '@mui/material';
import { Menu, X } from '@/components/icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, matchPath, useLocation } from 'react-router';
import { useAuth } from '@/auth/useAuth';
import NavList from './NavList';
import { ICON, navItemsFor } from './navItems';
import { GRADIENT } from '@/theme/theme';

// Phone (< md): four tabs at the bottom plus "More", which opens the other pages in a bottom sheet.
// The sheet is a modal (MUI Drawer): focus moves into it, Escape and the backdrop close it, and focus
// returns to the "More" button afterwards.
export default function BottomNav() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const items = navItemsFor(user);
  const tabs = items.filter((item) => item.inBottomNav);
  const others = items.filter((item) => !item.inBottomNav);
  const isCurrent = (to: string) => matchPath({ path: to, end: to === '/' }, pathname) !== null;
  const current = tabs.find((tab) => isCurrent(tab.to))?.to ?? (others.some((item) => isCurrent(item.to)) ? 'more' : false);

  return (
    <>
      <Paper
        component="nav"
        aria-label={t('nav.label')}
        elevation={0}
        sx={(theme) => ({
          position: 'fixed',
          insetInline: 12,
          bottom: 'calc(12px + env(safe-area-inset-bottom))',
          zIndex: 'appBar',
          borderRadius: '22px',
          border: `1px solid ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.background.paper, 0.94),
          backdropFilter: 'saturate(1.4) blur(12px)',
          boxShadow: theme.palette.mode === 'light' ? '0 12px 28px -14px rgba(15, 23, 42, 0.3)' : '0 12px 28px -10px rgba(0, 0, 0, 0.7)',
          px: 0.75,
        })}
      >
        {/* Without showLabels only the current tab shows its label; every tab keeps it as its accessible name. */}
        <BottomNavigation value={current}>
          {tabs.map((tab) => (
            <BottomNavigationAction
              key={tab.to}
              value={tab.to}
              label={t(tab.labelKey)}
              icon={tab.icon}
              component={Link}
              to={tab.to}
              aria-current={current === tab.to ? 'page' : undefined}
              sx={actionSx}
            />
          ))}
          <BottomNavigationAction
            value="more"
            label={t('nav.more')}
            icon={<Menu {...ICON} />}
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            sx={actionSx}
          />
        </BottomNavigation>
      </Paper>
      <Drawer
        anchor="bottom"
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        slotProps={{ paper: { role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'more-title', sx: { pb: 'env(safe-area-inset-bottom)' } } }}
      >
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Typography id="more-title" variant="h6" component="h2">
            {t('nav.moreTitle')}
          </Typography>
          <IconButton aria-label={t('close')} onClick={() => setMoreOpen(false)}>
            <X {...ICON} />
          </IconButton>
        </Toolbar>
        <Box component="nav" aria-label={t('nav.moreTitle')}>
          <NavList items={others} onNavigate={() => setMoreOpen(false)} />
        </Box>
      </Drawer>
    </>
  );
}

// The current tab (.Mui-selected, also on "More" for its pages) becomes a gradient pill with its label and white
// semibold text; the others show their icon only. Five tabs still fit a 320 px phone.
const actionSx = {
  minWidth: 0,
  flex: '1 1 0',
  height: 46,
  my: 'auto',
  px: 0.5,
  borderRadius: '16px',
  '& .MuiBottomNavigationAction-label': { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.03em', textTransform: 'uppercase', whiteSpace: 'nowrap' },
  '&.Mui-selected': {
    flex: '1.9 1 0',
    flexDirection: 'row',
    gap: 0.75,
    backgroundImage: GRADIENT,
    color: '#ffffff',
    boxShadow: '0 8px 18px -8px rgba(190, 24, 93, 0.55)',
    '& .MuiBottomNavigationAction-label': { fontSize: '0.6875rem' },
  },
} as const;
