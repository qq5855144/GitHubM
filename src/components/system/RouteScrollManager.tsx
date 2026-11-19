import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const SCROLL_KEY_PREFIX = 'githubm_scroll_position:';
const RESTORE_TIMEOUT_MS = 2000;
const RESTORE_INTERVAL_MS = 50;

/** 每个页面（pathname + search）独立记忆滚动位置，不同列表互不覆盖 */
function scrollKey(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

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
 * - 按 pathname + search 分别记忆滚动位置，不同页面互不覆盖
 * - 新进入页面回到顶部；浏览器前进/后退恢复进入前的位置
 * - 列表内容是异步渲染的，恢复时轮询重试，直到内容撑开高度或超时
 */
export default function RouteScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const keyRef = useRef(scrollKey(location.pathname, location.search));
  const firstMountRef = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const nextKey = scrollKey(location.pathname, location.search);
    // 先切 key：新页面渲染时浏览器会把越界的 scrollY 夹到 0 并触发 scroll 事件，
    // 那时写入的 0 只会落到新页面的 key 上，不会覆盖上一页记住的位置。
    keyRef.current = nextKey;

    const isFirstMount = firstMountRef.current;
    firstMountRef.current = false;
    const saved = readScrollPosition(nextKey);
    const shouldRestore = !isFirstMount && navigationType === 'POP' && saved !== null && saved > 0;

    if (!shouldRestore) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return;
    }

    const target = saved;
    const startedAt = Date.now();
    let timer = 0;
    let cancelled = false;
    const stop = () => {
      cancelled = true;
      window.clearTimeout(timer);
    };

    const apply = () => {
      if (cancelled) return;
      const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({ top: Math.min(target, maxTop), left: 0, behavior: 'auto' });
      const reached = Math.abs(window.scrollY - target) <= 2;
      if (reached || Date.now() - startedAt >= RESTORE_TIMEOUT_MS) return;
      timer = window.setTimeout(apply, RESTORE_INTERVAL_MS);
    };
    apply();

    // 用户主动滚动时立即停止抢位置
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      stop();
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
    };
  }, [location.pathname, location.search, navigationType]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raf = 0;
    const handleScroll = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        saveScrollPosition(keyRef.current, window.scrollY);
      });
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [location.pathname, location.search]);

  return null;
}
