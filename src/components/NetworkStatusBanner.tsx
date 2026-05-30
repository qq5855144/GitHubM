import { WifiOff, Wifi } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/use-network-status';
import i18n from "@/i18n";

/**
 * 全局网络状态横幅
 *
 * 行为：
 * - 断网时：顶部固定红色横幅持续展示
 * - 恢复时：绿色横幅展示 3 秒后自动淡出
 * - 在线且未刚恢复：不渲染任何内容（零开销）
 *
 * 使用：在 App.tsx 根层挂载一次即可。
 */
export function NetworkStatusBanner() {
  const { isOnline, justRecovered } = useNetworkStatus();

  if (isOnline && !justRecovered) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2',
        'px-4 py-2 text-xs font-medium transition-all duration-300',
        isOnline
          ? 'bg-green-600 text-white'
          : 'bg-destructive text-destructive-foreground',
      ].join(' ')}
    >
      {isOnline ? (
        <>
          <Wifi className="w-3.5 h-3.5 shrink-0" />
          <span>{i18n.t('网络已恢复')}</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>{i18n.t('网络已断开，请检查网络连接')}</span>
        </>
      )}
    </div>
  );
}
