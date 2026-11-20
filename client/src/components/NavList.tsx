import { List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import type { NavItem } from './navItems';

// A list of page links. NavLink marks the current page with aria-current="page"; it is shown by a
// raised ground, full-strength text and a 2px accent bar, not by colour alone (modern-web-guidance `navbar`).
export default function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <List sx={{ px: 1.5, py: 0.5 }}>
      {items.map((item) => (
        <li key={item.to}>
          <ListItemButton
            component={NavLink}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            sx={(theme) => ({
              mb: '1px',
              minHeight: 34,
              py: 0.5,
              px: 1.25,
              color: 'text.secondary',
              '& .MuiListItemIcon-root': { color: 'inherit', minWidth: 28 },
              '& .MuiListItemText-primary': { fontSize: '0.875rem', fontWeight: 500 },
              '&:hover': { bgcolor: 'panel2', color: 'text.primary' },
              '&[aria-current="page"]': {
                bgcolor: 'panel2',
                color: 'text.primary',
                boxShadow: `inset 2px 0 0 ${theme.palette.primary.main}`,
                '& .MuiListItemText-primary': { fontWeight: 600 },
              },
            })}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={t(item.labelKey)} />
          </ListItemButton>
        </li>
      ))}
    </List>
  );
}
