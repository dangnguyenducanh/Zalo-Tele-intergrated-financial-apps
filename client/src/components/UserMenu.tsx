import LogoutIcon from '@mui/icons-material/Logout';
import SettingsIcon from '@mui/icons-material/Settings';
import { Avatar, Divider, IconButton, ListItemIcon, Menu, MenuItem, Typography } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '@/auth/useAuth';

// Avatar button in the app bar → account menu with Settings and Log out.
export default function UserMenu() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);

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
        <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
          {user?.name.charAt(0).toUpperCase()}
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
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          {t('account.settings')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            void logout();
          }}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          {t('account.logout')}
        </MenuItem>
      </Menu>
    </>
  );
}
