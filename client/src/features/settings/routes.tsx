import type { RouteObject } from 'react-router';

export const settingsRoutes: RouteObject[] = [{ path: '/settings', lazy: async () => ({ Component: (await import('./SettingsPage')).default }) }];
