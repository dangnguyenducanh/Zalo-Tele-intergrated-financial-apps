import type { RouteObject } from 'react-router';

export const transactionsRoutes: RouteObject[] = [
  { path: '/transactions', lazy: async () => ({ Component: (await import('./TransactionsPage')).default }) },
];
