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
    // Every session change (login, register, refresh, logout, failed refresh) arrives here.
    const unsubscribe = onSessionChange((session) => {
      if (session) {
        setState({ status: 'authenticated', user: session.user, accessToken: session.accessToken });
        dispatch(applyThemeMode(session.user.theme)); // the saved profile follows the user across devices
        dispatch(applyLanguage(session.user.language));
      } else {
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
