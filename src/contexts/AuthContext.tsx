import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { GitHubUser, GitHubRateLimit, SavedAccount } from '@/types/types';
import { getCurrentUser, getRateLimit, setToken } from '@/services/github';
import { pageCache } from '@/lib/page-cache';
import { getSecureItem, setSecureItem, removeSecureItem } from '@/lib/secureStorage';

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
  /** 修改本机保存的 Token 备注名 */
  renameAccount: (token: string, label: string) => void;
  /** 更新本机保存的 Token 元信息（作用域 / 过期时间 / 验证时间等） */
  updateAccountMeta: (token: string, patch: Partial<SavedAccount>) => void;
  refreshRateLimit: () => Promise<void>;
  /** 重新请求 /user 并刷新 user 状态 */
  refreshUser: () => Promise<void>;
  /** 用新的用户数据直接更新 state（避免额外网络请求） */
  updateUser: (newUser: GitHubUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'github_manager_token';
const ACCOUNTS_KEY = 'github_manager_accounts';

function loadAccounts(): SavedAccount[] {
  try {
    return JSON.parse(getSecureItem(ACCOUNTS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveAccounts(accounts: SavedAccount[]) {
  setSecureItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() =>
    getSecureItem(TOKEN_KEY)
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
    const previousToken = token;
    setToken(newToken);
    try {
      const userData = await getCurrentUser();
      setSecureItem(TOKEN_KEY, newToken);
      setTokenState(newToken);
      setUser(userData);
      setIsAuthenticated(true);
      persistAccount(newToken, userData);
      refreshRateLimit();
    } catch (error) {
      // 校验失败时回滚模块级 token，避免「界面还是旧用户、请求全 401」的半登出状态。
      setToken(previousToken);
      throw error;
    }
  }, [token, refreshRateLimit, persistAccount]);

  const switchAccount = useCallback(async (switchToken: string) => {
    const previousToken = token;
    setToken(switchToken);
    try {
      const userData = await getCurrentUser();
      setSecureItem(TOKEN_KEY, switchToken);
      setTokenState(switchToken);
      setUser(userData);
      setIsAuthenticated(true);
      persistAccount(switchToken, userData);
      refreshRateLimit();
    } catch (error) {
      setToken(previousToken);
      throw error;
    }
  }, [token, refreshRateLimit, persistAccount]);

  const removeAccount = useCallback((removeToken: string) => {
    setSavedAccounts((prev) => {
      const updated = prev.filter((a) => a.token !== removeToken);
      saveAccounts(updated);
      return updated;
    });
  }, []);
  const renameAccount = useCallback((targetToken: string, label: string) => {
    setSavedAccounts((prev) => {
      const updated = prev.map((a) => (a.token === targetToken ? { ...a, label: label.trim() || undefined } : a));
      saveAccounts(updated);
      return updated;
    });
  }, []);
  const updateAccountMeta = useCallback((targetToken: string, patch: Partial<SavedAccount>) => {
    setSavedAccounts((prev) => {
      const updated = prev.map((a) => (a.token === targetToken ? { ...a, ...patch } : a));
      saveAccounts(updated);
      return updated;
    });
  }, []);

  /** 重新请求 /user 刷新当前用户信息 */
  const refreshUser = useCallback(async () => {
    try {
      const userData = await getCurrentUser();
      setUser(userData);
      // 同步更新 savedAccounts 中对应的用户快照
      if (token) {
        setSavedAccounts((prev) => {
          const updated = prev.map((a) =>
            a.token === token ? { ...a, user: userData } : a
          );
          saveAccounts(updated);
          return updated;
        });
      }
    } catch {
      // 静默失败
    }
  }, [token]);

  /** 直接用新数据更新 user state（保存 PATCH 后立即刷新 UI） */
  const updateUser = useCallback((newUser: GitHubUser) => {
    setUser(newUser);
    if (token) {
      setSavedAccounts((prev) => {
        const updated = prev.map((a) =>
          a.token === token ? { ...a, user: newUser } : a
        );
        saveAccounts(updated);
        return updated;
      });
    }
  }, [token]);

  const logout = useCallback(() => {
    removeSecureItem(TOKEN_KEY);
    setToken(null);
    setTokenState(null);
    setUser(null);
    setIsAuthenticated(false);
    setRateLimit(null);
    pageCache.clear(); // 登出时清空所有页面缓存
  }, []);

  // 初始化时自动验证已保存的令牌
  useEffect(() => {
    const savedToken = getSecureItem(TOKEN_KEY);
    if (savedToken) {
      setToken(savedToken);
      getCurrentUser()
        .then((userData) => {
          setUser(userData);
          setIsAuthenticated(true);
          refreshRateLimit();
        })
        .catch(() => {
          removeSecureItem(TOKEN_KEY);
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
        savedAccounts, login, logout, switchAccount, removeAccount, renameAccount, updateAccountMeta,
        refreshRateLimit, refreshUser, updateUser,
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
