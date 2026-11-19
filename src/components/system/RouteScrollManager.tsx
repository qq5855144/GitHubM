import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const SCROLL_KEY_PREFIX = 'githubm_scroll_position:';
const RESTORE_TIMEOUT_MS = 2000;
const RESTORE_INTERVAL_MS = 50;
/** 到达目标后继续守护的时长：APK 原生底部 Tab 切换会在导航后再次把页面归零 */
const RESTORE_GUARD_MS = 600;

/**
 * 一级导航路径（与 MainLayout 的 bottomTabs / navItems 保持一致）。
 * 这些页面之间跳转属于 push 导航，但用户预期「回到上次停留的位置」，
 * 因此同样恢复滚动位置；其余页面（详情页等）push 进入时仍从顶部开始。
 */
const TAB_PATHS = [
  '/',
  '/repos',
  '/notifications',
  '/search',
  '/activity',
  '/gists',
  '/packages',
  '/accounts',
  '/export',
  '/graphql-playground',
  '/ai-assistant',
  '/ai-settings',
  '/more',
  '/settings',
];

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
 * - 新进入的详情页回到顶部；返回（POP）与一级导航之间切换恢复上次位置
 * - 列表内容是异步渲染的，恢复时轮询重试，直到内容撑开高度或超时
 * - 恢复期间不写入记忆值，避免把归零/中间值当成用户最终位置
 */
export default function RouteScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const pageKey = scrollKey(location.pathname, location.search);
  const keyRef = useRef(pageKey);
  const firstMountRef = useRef(true);
  /** true 表示位置正由恢复逻辑接管，此时写回的 scrollY 不能当作记忆值 */
  const restoringRef = useRef(false);

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
    const isFirstMount = firstMountRef.current;
    firstMountRef.current = false;
    // 先切 key：新页面渲染时浏览器会把越界的 scrollY 夹到 0 并触发 scroll 事件，
    // 那时写入的 0 只会落到新页面的 key 上，不会覆盖上一页记住的位置。
    keyRef.current = pageKey;

    const saved = readScrollPosition(pageKey);
    const shouldRestore =
      !isFirstMount &&
      saved !== null &&
      saved > 0 &&
      (navigationType === 'POP' || TAB_PATHS.includes(location.pathname));

    if (!shouldRestore) {
      restoringRef.current = false;
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return;
    }

    const target = saved;
    const startedAt = Date.now();
    let timer = 0;
    let cancelled = false;
    restoringRef.current = true;
    const stop = () => {
      cancelled = true;
      restoringRef.current = false;
      window.clearTimeout(timer);
    };

    const apply = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({ top: Math.min(target, maxTop), left: 0, behavior: 'auto' });
      const reached = Math.abs(window.scrollY - target) <= 2;
      if (elapsed >= RESTORE_TIMEOUT_MS) {
        restoringRef.current = false;
        return;
      }
      // 已到达目标也再守护一小段时间，抵消导航后原生层/浏览器的二次归零
      if (reached && elapsed >= RESTORE_GUARD_MS) {
        restoringRef.current = false;
        return;
      }
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
  }, [pageKey, location.pathname, navigationType]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raf = 0;
    const handleScroll = () => {
      // 恢复过程中的位置由恢复逻辑决定，不写入记忆值
      if (restoringRef.current) return;
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        if (restoringRef.current) return;
        saveScrollPosition(keyRef.current, window.scrollY);
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return null;
}
