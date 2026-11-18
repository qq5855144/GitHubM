import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import i18n from '@/i18n';
import {
  cancelRateLimitWait,
  getRateLimitStatus,
  subscribeRateLimitStatus,
} from '@/lib/githubRateLimitStatus';

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 全局展示 GitHub 配额等待，避免用户误以为任务卡死。 */
export function GitHubRateLimitBanner() {
  const status = useSyncExternalStore(subscribeRateLimitStatus, getRateLimitStatus, getRateLimitStatus);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!status.active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [status.active]);

  if (!status.active) return null;
  const remaining = status.until - now;
  const text = remaining > 0
    ? i18n.t('GitHub 配额恢复中，约 {{time}} 后自动继续', { time: formatRemaining(remaining) })
    : i18n.t('GitHub 配额已恢复，正在重试…');

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-1/2 z-[9998] flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-500/30 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-800 shadow-lg dark:bg-amber-950/90 dark:text-amber-200 md:bottom-6"
    >
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      <span className="whitespace-nowrap">{text}</span>
      {status.attempt > 1 && (
        <span className="rounded-full bg-amber-500/15 px-1.5 text-[9px]">
          {i18n.t('第 {{count}} 次等待', { count: status.attempt })}
        </span>
      )}
      <button
        type="button"
        onClick={cancelRateLimitWait}
        className="rounded-full border border-amber-600/30 px-2 py-0.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-500/15 dark:text-amber-100"
      >
        {i18n.t('取消等待')}
      </button>
    </div>
  );
}
