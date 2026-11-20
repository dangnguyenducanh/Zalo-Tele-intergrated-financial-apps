import type { RouteObject } from 'react-router';

export const notFoundRoutes: RouteObject[] = [
  { path: '*', lazy: async () => ({ Component: (await import('./NotFoundPage')).default }) },
];
