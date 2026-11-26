import type { RouteObject } from 'react-router';
import { takeClaimTokenFromAddressBar } from '@/auth/claimToken';

// router.tsx imports this before the app renders, so a claim token leaves the address bar before anything else happens.
takeClaimTokenFromAddressBar();

// Public like /login: LinkPage sends a logged-out visitor to log in itself (docs/05 §5.9.2).
export const linkRoutes: RouteObject[] = [{ path: '/link', lazy: async () => ({ Component: (await import('./LinkPage')).default }) }];
