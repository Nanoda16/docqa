import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { setTokenGetter } from '../services/api';

export interface AuthUser {
  id?: number;
  username?: string;
  nickname?: string | null;
  email?: string | null;
  avatar?: string | null;
  role?: string;
  status?: number;
  [key: string]: any;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: AuthUser) => void;
  updateUser: (patch: Partial<AuthUser>) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEYS = {
  token: 'token',
  user: 'user',
} as const;

function loadFromStorage() {
  const token = localStorage.getItem(STORAGE_KEYS.token);
  const userStr = localStorage.getItem(STORAGE_KEYS.user);
  let user: AuthUser | null = null;
  if (userStr) {
    try {
      user = JSON.parse(userStr) as AuthUser;
    } catch {
      user = null;
    }
  }
  return { token, user };
}

function saveToStorage(token: string, user: AuthUser) {
  localStorage.setItem(STORAGE_KEYS.token, token);
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
}

function clearStorage() {
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.user);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const stored = loadFromStorage();
    if (stored.token) {
      setToken(stored.token);
      setUser(stored.user);
    }
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (initialized) {
      setTokenGetter(() => token);
    }
  }, [token, initialized]);

  const login = useCallback((newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setUser(newUser);
    saveToStorage(newToken, newUser);
  }, []);

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((prev) => {
      const next = prev ? { ...prev, ...patch } : (patch as AuthUser);
      localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    clearStorage();
  }, []);

  const value: AuthContextValue = {
    user,
    token,
    isAuthenticated: !!token,
    login,
    updateUser,
    logout,
  };

  if (!initialized) {
    return null;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
