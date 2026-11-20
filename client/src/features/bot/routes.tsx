import type { RouteObject } from 'react-router';

export const botRoutes: RouteObject[] = [{ path: '/bot', lazy: async () => ({ Component: (await import('./BotInboxPage')).default }) }];
