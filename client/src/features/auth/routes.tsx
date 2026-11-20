import type { RouteObject } from 'react-router';

// Public pages; each one redirects to "/" when the user is already logged in.
// `lazy` loads a page's code only when its route is first visited (code splitting).
export const authRoutes: RouteObject[] = [
  { path: '/login', lazy: async () => ({ Component: (await import('./LoginPage')).default }) },
  { path: '/register', lazy: async () => ({ Component: (await import('./RegisterPage')).default }) },
];
