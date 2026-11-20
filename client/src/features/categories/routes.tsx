import type { RouteObject } from 'react-router';

export const categoriesRoutes: RouteObject[] = [
  { path: '/categories', lazy: async () => ({ Component: (await import('./CategoriesPage')).default }) },
];
