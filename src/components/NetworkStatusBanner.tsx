import { Wifi } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/use-network-status';
import i18n from "@/i18n";

/**
 * 网络恢复后短暂显示提示。
 */
export function NetworkStatusBanner() {
  const { isOnline, justRecovered } = useNetworkStatus();

  if (!isOnline || !justRecovered) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-center gap-2 bg-green-600 px-4 py-2 text-xs font-medium text-white transition-all duration-300"
    >
      <Wifi className="w-3.5 h-3.5 shrink-0" />
      <span>{i18n.t('网络已恢复')}</span>
    </div>
  );
}
