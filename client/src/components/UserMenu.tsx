import { Avatar, Divider, IconButton, ListItemIcon, Menu, MenuItem, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { LogOut, Settings } from '@/components/icons';
import { useAuth } from '@/auth/useAuth';
import { GRADIENT } from '@/theme/theme';
import { initials } from './initials';

// Avatar button in the app bar → account menu with Settings and Log out.
export default function UserMenu() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const close = () => setAnchor(null);

  async function logOut() {
    close();
    await logout();
    // A plain /login, without the `from` that ProtectedRoute saved on the way out: the next person to
    // log in on this browser starts at /, not on this user's last page and filters (BUG-013).
    await navigate('/login', { replace: true });
  }

  return (
    <>
      <IconButton
        color="inherit"
        aria-label={t('account.menu')}
        aria-haspopup="menu"
        aria-controls={anchor ? 'account-menu' : undefined}
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <Avatar sx={{ width: 34, height: 34, fontSize: 13, color: '#ffffff', backgroundImage: GRADIENT }}>
          {user && initials(user.name)}
        </Avatar>
      </IconButton>
      <Menu id="account-menu" anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        <Typography component="div" sx={{ px: 2, py: 1 }}>
          <strong>{user?.name}</strong>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {user?.email}
          </Typography>
        </Typography>
        <Divider />
        <MenuItem component={Link} to="/settings" onClick={close}>
          <ListItemIcon>
            <Settings size={16} strokeWidth={1.75} aria-hidden />
          </ListItemIcon>
          {t('account.settings')}
        </MenuItem>
        <MenuItem onClick={() => void logOut()}>
          <ListItemIcon>
            <LogOut size={16} strokeWidth={1.75} aria-hidden />
          </ListItemIcon>
          {t('account.logout')}
        </MenuItem>
      </Menu>
    </>
  );
}
