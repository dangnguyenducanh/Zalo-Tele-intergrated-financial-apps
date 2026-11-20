import { createContext, useContext } from 'react';
import type { RegisterInput, User } from '@/types/api';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export type AuthContextValue = {
  user: User | null;
  accessToken: string | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
