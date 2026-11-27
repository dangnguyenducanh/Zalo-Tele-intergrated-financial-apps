import { createContext, useContext } from 'react';
import type { RegisterInput, SignupPending, User, VerifySignupInput } from '@/types/api';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export type AuthContextValue = {
  user: User | null;
  accessToken: string | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  // 201: logged in at once, resolves null. 202: a code was emailed, no session; resolves the pending sign-up.
  register: (input: RegisterInput) => Promise<SignupPending | null>;
  verifySignup: (input: VerifySignupInput) => Promise<void>; // the emailed code; logs in on success

  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
