import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/app/api';
import { useAppDispatch } from '@/app/hooks';
import { applyLanguage, applyThemeMode } from '@/app/uiSlice';
import type { AuthResponse, RegisterInput, User } from '@/types/api';
import { onSessionChange, postAuth, refreshSession, setSession } from './session';
import { AuthContext, type AuthContextValue, type AuthStatus } from './useAuth';

type State = { status: AuthStatus; user: User | null; accessToken: string | null };

// "Context for login" (docs/05 §5.3): who is logged in, their access token, and the auth actions.
export function AuthProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const [state, setState] = useState<State>({ status: 'loading', user: null, accessToken: null });

  useEffect(() => {
    let userId: string | null = null; // who the preferences were last applied for
    // Every session change (login, register, refresh, logout, failed refresh) arrives here.
    const unsubscribe = onSessionChange((session) => {
      if (session) {
        setState({ status: 'authenticated', user: session.user, accessToken: session.accessToken });
        // The saved profile follows the user across devices, but only when they log in (or the session
        // is restored at start-up). A token refresh while logged in must not re-apply it: the refresh
        // can carry the profile from before a theme/language change whose PATCH is still being retried.
        if (session.user.id !== userId) {
          dispatch(applyThemeMode(session.user.theme));
          dispatch(applyLanguage(session.user.language));
        }
        userId = session.user.id;
      } else {
        userId = null;
        setState({ status: 'anonymous', user: null, accessToken: null });
        dispatch(api.util.resetApiState()); // drop the previous user's cached data
      }
    });
    // Restore the session from the httpOnly refresh cookie; the app shows a splash until this settles.
    void refreshSession();
    return unsubscribe;
  }, [dispatch]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login: async (email, password) => setSession(await postAuth<AuthResponse>('login', { email, password })),
      register: async (input: RegisterInput) => setSession(await postAuth<AuthResponse>('register', input)),
      logout: async () => {
        await postAuth('logout').catch(() => undefined); // log out locally even if the server is unreachable
        setSession(null);
      },
      refresh: async () => (await refreshSession()) !== null,
    }),
    [state],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
