import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import CategoryIcon from '@mui/icons-material/Category';
import DashboardIcon from '@mui/icons-material/Dashboard';
import LabelIcon from '@mui/icons-material/Label';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import SavingsIcon from '@mui/icons-material/Savings';
import SettingsIcon from '@mui/icons-material/Settings';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import type { ReactElement } from 'react';
import type { User } from '@/types/api';

export type NavItem = {
  to: string;
  labelKey: string; // key in i18n common.json
  icon: ReactElement;
  inBottomNav?: boolean; // one of the four phone tabs (docs/05 §5.4); the rest go under "More"
  adminOnly?: boolean;
};

// Every page in the side drawer, in order (docs/05 §5.2).
const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: <DashboardIcon />, inBottomNav: true },
  { to: '/transactions', labelKey: 'nav.transactions', icon: <ReceiptLongIcon />, inBottomNav: true },
  { to: '/bot', labelKey: 'nav.bot', icon: <SmartToyIcon />, inBottomNav: true },
  { to: '/budgets', labelKey: 'nav.budgets', icon: <SavingsIcon />, inBottomNav: true },
  { to: '/wallets', labelKey: 'nav.wallets', icon: <AccountBalanceWalletIcon /> },
  { to: '/categories', labelKey: 'nav.categories', icon: <CategoryIcon /> },
  { to: '/settings', labelKey: 'nav.settings', icon: <SettingsIcon /> },
  { to: '/admin/users', labelKey: 'nav.adminUsers', icon: <AdminPanelSettingsIcon />, adminOnly: true },
  { to: '/admin/categories', labelKey: 'nav.adminCategories', icon: <LabelIcon />, adminOnly: true },
];

export function navItemsFor(user: User | null): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === 'admin');
}
