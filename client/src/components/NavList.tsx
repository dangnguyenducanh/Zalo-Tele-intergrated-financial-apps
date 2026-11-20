import { Box, List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import type { NavItem } from './navItems';

// A list of page links. NavLink marks the current page with aria-current="page"; it is shown by a
// raised ground, full-strength text and a 2px accent bar, not by colour alone (modern-web-guidance `navbar`).
// `badges` puts a small count after a label (the bot inbox shows its waiting drafts).
export default function NavList({ items, onNavigate, badges = {} }: { items: NavItem[]; onNavigate?: () => void; badges?: Record<string, ReactNode> }) {
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
            {badges[item.to] != null && (
              <Box
                component="span"
                aria-hidden // the count is extra; the link keeps its plain page name
                sx={{ ml: 1, minWidth: 18, height: 18, px: 0.5, borderRadius: '3px', bgcolor: 'primary.main', color: 'primary.contrastText', fontSize: 11, fontWeight: 600, display: 'grid', placeItems: 'center' }}
              >
                {badges[item.to]}
              </Box>
            )}
          </ListItemButton>
        </li>
      ))}
    </List>
  );
}
