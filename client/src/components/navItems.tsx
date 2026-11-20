import { Gauge, Inbox, LayoutDashboard, ReceiptText, Settings, ShieldUser, Tags, Wallet, ListTree } from '@/components/icons';
import type { ReactElement } from 'react';
import type { User } from '@/types/api';

// Line icons, one weight everywhere (draft 2: no filled glyphs).
export const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;

export type NavItem = {
  to: string;
  labelKey: string; // key in i18n common.json
  icon: ReactElement;
  inBottomNav?: boolean; // one of the four phone tabs (docs/05 §5.4); the rest go under "More"
  adminOnly?: boolean;
};

// Every page in the side drawer, in order (docs/05 §5.2).
const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: <LayoutDashboard {...ICON} />, inBottomNav: true },
  { to: '/transactions', labelKey: 'nav.transactions', icon: <ReceiptText {...ICON} />, inBottomNav: true },
  { to: '/bot', labelKey: 'nav.bot', icon: <Inbox {...ICON} />, inBottomNav: true },
  { to: '/budgets', labelKey: 'nav.budgets', icon: <Gauge {...ICON} />, inBottomNav: true },
  { to: '/wallets', labelKey: 'nav.wallets', icon: <Wallet {...ICON} /> },
  { to: '/categories', labelKey: 'nav.categories', icon: <Tags {...ICON} /> },
  { to: '/settings', labelKey: 'nav.settings', icon: <Settings {...ICON} /> },
  { to: '/admin/users', labelKey: 'nav.adminUsers', icon: <ShieldUser {...ICON} />, adminOnly: true },
  { to: '/admin/categories', labelKey: 'nav.adminCategories', icon: <ListTree {...ICON} />, adminOnly: true },
];

export function navItemsFor(user: User | null): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === 'admin');
}
