import type { RouteObject } from 'react-router';

export const walletsRoutes: RouteObject[] = [
  { path: '/wallets', lazy: async () => ({ Component: (await import('./WalletsPage')).default }) },
];
