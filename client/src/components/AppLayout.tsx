import { AppBar, Box, Container, Link, Stack, Toolbar, useMediaQuery, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import AppSnackbar from './AppSnackbar';
import BottomNav from './BottomNav';
import Brand from './BrandMark';
import LanguageSwitch from './LanguageSwitch';
import NavDrawer, { DRAWER_WIDTH } from './NavDrawer';
import ThemeToggle from './ThemeToggle';
import UserMenu from './UserMenu';

// The frame around every logged-in page (docs/05 §5.4):
// desktop (≥ md) = permanent side drawer + top app bar; phone (< md) = top app bar + bottom navigation.
export default function AppLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      <Link href="#main" sx={skipLinkSx}>
        {t('skipToContent')}
      </Link>
      <AppBar
        component="header"
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', width: { md: `calc(100% - ${DRAWER_WIDTH}px)` }, ml: { md: `${DRAWER_WIDTH}px` } }}
      >
        <Toolbar sx={{ px: { xs: 2, md: 3 } }}>
          {!isDesktop && <Brand size={22} />}
          <Stack direction="row" spacing={1} sx={{ ml: 'auto', alignItems: 'center' }}>
            <LanguageSwitch />
            <ThemeToggle />
            <UserMenu />
          </Stack>
        </Toolbar>
      </AppBar>
      {isDesktop && <NavDrawer />}
      <Box component="main" id="main" tabIndex={-1} sx={{ flexGrow: 1, minWidth: 0, pb: { xs: 13, md: 4 }, outline: 'none' }}>
        <Toolbar />
        <Container maxWidth="xl" disableGutters sx={{ py: { xs: 2.5, md: 3 }, px: { xs: 2, sm: 3 } }}>
          <Outlet />
        </Container>
      </Box>
      {!isDesktop && <BottomNav />}
      <AppSnackbar />
    </Box>
  );
}

// Hidden until it receives keyboard focus (accessibility: skip repeated navigation).
const skipLinkSx = {
  position: 'absolute',
  left: 8,
  top: -48,
  zIndex: 'tooltip',
  p: 1,
  bgcolor: 'background.paper',
  '&:focus': { top: 8 },
} as const;
