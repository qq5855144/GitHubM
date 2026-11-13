import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const SCROLL_KEY_PREFIX = 'githubm_scroll_position:';

function readScrollPosition(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(`${SCROLL_KEY_PREFIX}${key}`);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function saveScrollPosition(key: string, value: number): void {
  try {
    sessionStorage.setItem(`${SCROLL_KEY_PREFIX}${key}`, String(Math.max(0, Math.round(value))));
  } catch { /* ignore quota errors */ }
}

/**
 * 全局页面滚动管理：
 * - 新进入页面时回到顶部
 * - 浏览器前进/后退时恢复该历史记录对应的滚动位置
 * - 不同底部 Tab / 路由之间不再共享滚动位置
 */
export default function RouteScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const lastKeyRef = useRef(location.key);
  const currentKeyRef = useRef(location.key);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const previousKey = lastKeyRef.current;
    if (previousKey && previousKey !== location.key) {
      saveScrollPosition(previousKey, window.scrollY);
    }

    currentKeyRef.current = location.key;
    const saved = readScrollPosition(location.key);
    const target = navigationType === 'POP' && saved !== null ? saved : 0;

    const apply = () => window.scrollTo({ top: target, left: 0, behavior: 'auto' });
    apply();
    const raf = window.requestAnimationFrame(apply);
    // 异步页面内容可能稍后才撑开高度，POP 恢复时短暂重试。
    const retries = target > 0
      ? [window.setTimeout(apply, 80), window.setTimeout(apply, 240)]
      : [];

    lastKeyRef.current = location.key;
    return () => {
      window.cancelAnimationFrame(raf);
      retries.forEach((timer) => window.clearTimeout(timer));
    };
  }, [location.key, navigationType]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raf = 0;
    const handleScroll = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        saveScrollPosition(currentKeyRef.current, window.scrollY);
      });
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [location.key]);

  return null;
}