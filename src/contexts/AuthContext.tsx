import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { GitHubUser, GitHubRateLimit, SavedAccount } from '@/types/types';
import { getCurrentUser, getRateLimit, setToken } from '@/services/github';

interface AuthContextValue {
  token: string | null;
  user: GitHubUser | null;
  isAuthenticated: boolean;
  rateLimit: GitHubRateLimit | null;
  loading: boolean;
  // 多账号
  savedAccounts: SavedAccount[];
  login: (token: string) => Promise<void>;
  logout: () => void;
  switchAccount: (token: string) => Promise<void>;
  removeAccount: (token: string) => void;
  refreshRateLimit: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'github_manager_token';
const ACCOUNTS_KEY = 'github_manager_accounts';

function loadAccounts(): SavedAccount[] {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveAccounts(accounts: SavedAccount[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY)
  );
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [rateLimit, setRateLimit] = useState<GitHubRateLimit | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>(() => loadAccounts());

  const refreshRateLimit = useCallback(async () => {
    try {
      const { rate } = await getRateLimit();
      setRateLimit(rate);
    } catch {
      // 忽略速率限制获取失败
    }
  }, []);

  const persistAccount = useCallback((newToken: string, userData: GitHubUser) => {
    setSavedAccounts((prev) => {
      const filtered = prev.filter((a) => a.token !== newToken);
      const updated = [{ token: newToken, user: userData, addedAt: new Date().toISOString() }, ...filtered];
      saveAccounts(updated);
      return updated;
    });
  }, []);

  const login = useCallback(async (newToken: string) => {
    setToken(newToken);
    const userData = await getCurrentUser();
    localStorage.setItem(TOKEN_KEY, newToken);
    setTokenState(newToken);
    setUser(userData);
    setIsAuthenticated(true);
    persistAccount(newToken, userData);
    refreshRateLimit();
  }, [refreshRateLimit, persistAccount]);

  const switchAccount = useCallback(async (switchToken: string) => {
    setToken(switchToken);
    const userData = await getCurrentUser();
    localStorage.setItem(TOKEN_KEY, switchToken);
    setTokenState(switchToken);
    setUser(userData);
    setIsAuthenticated(true);
    persistAccount(switchToken, userData);
    refreshRateLimit();
  }, [refreshRateLimit, persistAccount]);

  const removeAccount = useCallback((removeToken: string) => {
    setSavedAccounts((prev) => {
      const updated = prev.filter((a) => a.token !== removeToken);
      saveAccounts(updated);
      return updated;
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setTokenState(null);
    setUser(null);
    setIsAuthenticated(false);
    setRateLimit(null);
  }, []);

  // 初始化时自动验证已保存的令牌
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    if (savedToken) {
      setToken(savedToken);
      getCurrentUser()
        .then((userData) => {
          setUser(userData);
          setIsAuthenticated(true);
          refreshRateLimit();
        })
        .catch(() => {
          localStorage.removeItem(TOKEN_KEY);
          setTokenState(null);
          setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [refreshRateLimit]);

  // 定期刷新速率限制
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(refreshRateLimit, 60000);
    return () => clearInterval(interval);
  }, [isAuthenticated, refreshRateLimit]);

  return (
    <AuthContext.Provider
      value={{
        token, user, isAuthenticated, rateLimit, loading,
        savedAccounts, login, logout, switchAccount, removeAccount, refreshRateLimit,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
