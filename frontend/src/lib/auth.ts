import { createContext, useContext } from 'react';
import type { AuthInfo } from '../../../src/types/domain';

export const AuthContext = createContext<AuthInfo>({ role: 'admin' });

export function useAuth() {
  const auth = useContext(AuthContext);
  return { auth, isAdmin: auth.role === 'admin', familyName: auth.role === 'family' ? auth.familyName : null };
}
