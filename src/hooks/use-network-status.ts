import { useState, useEffect } from 'react';

interface NetworkStatus {
  /** 当前是否在线 */
  isOnline: boolean;
  /** 是否刚从离线恢复——true 持续 3 秒后自动变 false */
  justRecovered: boolean;
}

/**
 * 监听浏览器网络状态变化。
 *
 * - 断网时 isOnline = false，触发离线横幅
 * - 网络恢复时 justRecovered = true，触发「已恢复」横幅，3s 后自动清除
 * - WebView 内同样有效（依赖 navigator.onLine + online/offline 事件）
 */
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [justRecovered, setJustRecovered] = useState(false);

  useEffect(() => {
    let recoveryTimer: ReturnType<typeof setTimeout>;

    const handleOnline = () => {
      setIsOnline(true);
      setJustRecovered(true);
      recoveryTimer = setTimeout(() => setJustRecovered(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setJustRecovered(false);
      clearTimeout(recoveryTimer);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearTimeout(recoveryTimer);
    };
  }, []);

  return { isOnline, justRecovered };
}
