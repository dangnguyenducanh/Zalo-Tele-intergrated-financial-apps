import type { RouteObject } from 'react-router';
import AdminRoute from './auth/AdminRoute';
import ProtectedRoute from './auth/ProtectedRoute';
import AppLayout from './components/AppLayout';
import RouteError from './components/RouteError';
import Splash from './components/Splash';
import { adminRoutes } from './features/admin/routes';
import { authRoutes } from './features/auth/routes';
import { botRoutes } from './features/bot/routes';
import { budgetsRoutes } from './features/budgets/routes';
import { categoriesRoutes } from './features/categories/routes';
import { dashboardRoutes } from './features/dashboard/routes';
import { notFoundRoutes } from './features/notFound/routes';
import { settingsRoutes } from './features/settings/routes';
import { transactionsRoutes } from './features/transactions/routes';
import { walletsRoutes } from './features/wallets/routes';

// Route table (docs/05 §5.2). Each feature exports its routes from features/<x>/routes.tsx and adds
// ONE line here (docs/08 §8.5). Pages use the route `lazy` option, so each page's code is downloaded
// only when it is first opened and the first load stays small.
export const routes: RouteObject[] = [
  {
    hydrateFallbackElement: <Splash />, // shown while the first page's code downloads
    errorElement: <RouteError />, // a page failed to load or crashed
    children: [
      ...authRoutes, // /login, /register
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppLayout />,
            children: [
              ...dashboardRoutes, // /
              ...transactionsRoutes, // /transactions
              ...walletsRoutes, // /wallets
              ...categoriesRoutes, // /categories
              ...budgetsRoutes, // /budgets
              ...botRoutes, // /bot
              ...settingsRoutes, // /settings
              {
                element: <AdminRoute />,
                children: [...adminRoutes], // /admin/users, /admin/categories
              },
            ],
          },
        ],
      },
      ...notFoundRoutes, // *
    ],
  },
];
