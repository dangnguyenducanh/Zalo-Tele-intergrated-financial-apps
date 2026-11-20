import type { RouteObject } from 'react-router';

export const budgetsRoutes: RouteObject[] = [
  { path: '/budgets', lazy: async () => ({ Component: (await import('./BudgetsPage')).default }) },
];
