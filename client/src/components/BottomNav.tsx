import { BottomNavigation, BottomNavigationAction, Box, Drawer, IconButton, Paper, Toolbar, Typography, type Theme } from '@mui/material';
import { Menu, X } from '@/components/icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, matchPath, useLocation } from 'react-router';
import { useAuth } from '@/auth/useAuth';
import NavList from './NavList';
import { ICON, navItemsFor } from './navItems';

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
        square
        sx={(theme) => ({
          position: 'fixed',
          insetInline: 0,
          bottom: 0,
          zIndex: 'appBar',
          pb: 'env(safe-area-inset-bottom)',
          borderTop: `1px solid ${theme.palette.divider}`,
          bgcolor: theme.palette.background.default,
        })}
      >
        <BottomNavigation showLabels value={current}>
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

// Five tabs fit a 320 px phone: labels stay on one line and shrink instead of wrapping.
// The current tab (.Mui-selected, also on "More" for its pages) gets bold text and a top bar in
// primary.main, not colour alone (modern-web-guidance `navbar`, WCAG 1.4.1).
const actionSx = {
  minWidth: 0,
  px: 0.5,
  '&.Mui-selected': { boxShadow: (theme: Theme) => `inset 0 2px 0 ${theme.palette.primary.main}` },
  '& svg': { mb: 0.5 },
  '& .MuiBottomNavigationAction-label': {
    fontSize: '0.6875rem',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    '&.Mui-selected': { fontSize: '0.6875rem', fontWeight: 600 },
  },
} as const;
