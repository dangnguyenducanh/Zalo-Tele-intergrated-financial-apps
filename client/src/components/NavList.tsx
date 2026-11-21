import { List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import { GRADIENT } from '@/theme/theme';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import type { NavItem } from './navItems';

// A list of page links. NavLink marks the current page with aria-current="page"; it is shown by a
// gradient pill with white semibold text, not by colour alone (modern-web-guidance `navbar`).
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
            sx={{
              mb: 0.5,
              minHeight: 40,
              py: 0.5,
              px: 1.75,
              color: 'text.secondary',
              '& .MuiListItemIcon-root': { color: 'inherit', minWidth: 28 },
              '& .MuiListItemText-primary': { fontSize: '0.875rem', fontWeight: 500 },
              '&:hover': { bgcolor: 'panel2', color: 'text.primary' },
              '&[aria-current="page"], &[aria-current="page"]:hover': {
                backgroundImage: GRADIENT,
                color: '#ffffff',
                boxShadow: '0 8px 18px -10px rgba(190, 24, 93, 0.6)',
                '& .MuiListItemText-primary': { fontWeight: 600 },
              },
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={t(item.labelKey)} />
          </ListItemButton>
        </li>
      ))}
    </List>
  );
}
