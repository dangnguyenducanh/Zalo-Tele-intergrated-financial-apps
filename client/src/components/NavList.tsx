import { List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import type { NavItem } from './navItems';

// A list of page links. NavLink marks the current page with aria-current="page" and the "active" class.
export default function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <List>
      {items.map((item) => (
        <li key={item.to}>
          <ListItemButton
            component={NavLink}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            sx={{ mx: 1, borderRadius: 2, '&.active': { bgcolor: 'action.selected', fontWeight: 600 } }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={t(item.labelKey)} />
          </ListItemButton>
        </li>
      ))}
    </List>
  );
}
