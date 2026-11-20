import type { RouteObject } from 'react-router';

// Admin pages. router.tsx puts them inside <AdminRoute>, so a non-admin sees the 403 page instead.
export const adminRoutes: RouteObject[] = [
  { path: '/admin/users', lazy: async () => ({ Component: (await import('./AdminUsersPage')).default }) },
  { path: '/admin/categories', lazy: async () => ({ Component: (await import('./AdminCategoriesPage')).default }) },
];
