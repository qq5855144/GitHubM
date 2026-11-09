// 启动自动更新检查
//
// 仅在 Android WebView 中启用：
// 1. 写入当前版本号，供原生 checkUpdate 读取
// 2. 监听原生 appUpdateAvailable 事件
// 3. 发现新版本时弹出更新对话框
// 4. 用户可忽略本次版本，忽略记录保存在 localStorage
import { useEffect, useState } from 'react';
import { ArrowUpCircle, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { downloadGithubFile, isDownloadProxyEnabled } from '@/lib/githubDownload';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import i18n from '@/i18n';

const IGNORED_VERSION_KEY = 'githubm_ignored_update_version';

interface UpdateInfo {
  version: string;
  downloadUrl: string;
  releaseNotes: string;
}

interface AndroidUpdateBridge {
  checkUpdate?: () => void;
  downloadFile?: (url: string, filename: string, token: string) => void;
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

/** 返回 <0 表示 a < b；0 表示相同；>0 表示 a > b */
function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split(/[.+-]/).slice(0, 3).map((v) => Number.parseInt(v, 10) || 0);
  const pb = normalizeVersion(b).split(/[.+-]/).slice(0, 3).map((v) => Number.parseInt(v, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export default function LaunchUpdateChecker() {
  const { token } = useAuth();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const currentVersion = import.meta.env.VITE_APP_VERSION || '';
    if (currentVersion) {
      try {
        localStorage.setItem('app_version', currentVersion);
      } catch {
        // ignore storage failures
      }
    }

    const bridge = (window as unknown as { AndroidBridge?: AndroidUpdateBridge }).AndroidBridge;
    if (!bridge?.checkUpdate) return;

    let active = true;
    let checkTimer = 0;
    let staleTimer = 0;

    const cleanup = () => {
      if (!active) return;
      active = false;
      window.removeEventListener('appUpdateAvailable', onAvailable as EventListener);
      window.removeEventListener('appUpdateLatest', onLatest);
      window.removeEventListener('appUpdateError', onError);
      window.clearTimeout(staleTimer);
    };

    const onAvailable = (event: Event) => {
      if (!active) return;
      const detail = (event as CustomEvent<Partial<UpdateInfo>>).detail;
      const latest = normalizeVersion(String(detail?.version || ''));
      if (!latest) {
        cleanup();
        return;
      }
      const ignored = localStorage.getItem(IGNORED_VERSION_KEY) || '';
      const current = normalizeVersion(currentVersion);
      // 已忽略该版本，或当前版本已经不低于线上版本时不打扰用户。
      if (ignored === latest || (current && compareVersions(latest, current) <= 0)) {
        cleanup();
        return;
      }
      cleanup();
      setUpdateInfo({
        version: latest,
        downloadUrl: String(detail?.downloadUrl || ''),
        releaseNotes: String(detail?.releaseNotes || ''),
      });
      setOpen(true);
    };

    const onLatest = () => cleanup();
    const onError = () => {
      // 自动检查失败保持静默，不打扰用户。
      cleanup();
    };

    window.addEventListener('appUpdateAvailable', onAvailable as EventListener);
    window.addEventListener('appUpdateLatest', onLatest);
    window.addEventListener('appUpdateError', onError);

    // 等待首屏稳定后再发起请求
    checkTimer = window.setTimeout(() => {
      try {
        bridge.checkUpdate?.();
      } catch {
        cleanup();
      }
    }, 600);

    // 兜底：20 秒没有收到原生结果则停止监听
    staleTimer = window.setTimeout(cleanup, 20_000);

    return () => {
      window.clearTimeout(checkTimer);
      cleanup();
    };
    // 只在 App 启动时检查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleIgnore = () => {
    if (updateInfo) {
      try {
        localStorage.setItem(IGNORED_VERSION_KEY, updateInfo.version);
      } catch {
        // ignore storage failures
      }
      toast.info(`${i18n.t('已忽略')} v${updateInfo.version} ${i18n.t('本次更新')}`);
    }
    setOpen(false);
  };

  const handleDownload = async () => {
    if (!updateInfo?.downloadUrl) return;
    setDownloading(true);
    const filename = updateInfo.downloadUrl.split('/').pop() || `github-manager-v${updateInfo.version}.apk`;
    const authToken = token || localStorage.getItem('github_manager_token') || '';
    const bridge = (window as unknown as { AndroidBridge?: AndroidUpdateBridge }).AndroidBridge;

    try {
      if (isDownloadProxyEnabled()) {
        try {
          await downloadGithubFile(updateInfo.downloadUrl, filename, authToken);
          toast.success(i18n.t('已开始下载更新'));
          setOpen(false);
          return;
        } catch {
          // 代理失败时回退原生下载
        }
      }

      if (bridge?.downloadFile) {
        bridge.downloadFile(updateInfo.downloadUrl, filename, authToken);
        toast.success(i18n.t('已开始下载更新'));
        setOpen(false);
      } else {
        window.open(updateInfo.downloadUrl, '_blank', 'noopener,noreferrer');
        setOpen(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n.t('更新下载失败'));
    } finally {
      setDownloading(false);
    }
  };

  if (!updateInfo) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!downloading) setOpen(next); }}>
      <DialogContent className="max-w-md p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ArrowUpCircle className="w-5 h-5 text-primary" />
            {i18n.t('发现新版本')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {i18n.t('当前版本')} {normalizeVersion(import.meta.env.VITE_APP_VERSION || '') || '—'}
            <span className="mx-1.5">→</span>
            <span className="text-primary font-semibold">v{updateInfo.version}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-secondary/35 p-3">
          <p className="text-xs font-medium text-foreground mb-1.5">{i18n.t('更新内容')}</p>
          {updateInfo.releaseNotes ? (
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
              {updateInfo.releaseNotes}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{i18n.t('包含功能改进与问题修复')}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs border-border"
            disabled={downloading}
            onClick={handleIgnore}
          >
            {i18n.t('忽略本次更新')}
          </Button>
          <Button
            size="sm"
            className="h-9 px-3 text-xs gap-1.5"
            disabled={downloading || !updateInfo.downloadUrl}
            onClick={() => void handleDownload()}
          >
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {downloading ? i18n.t('准备下载...') : i18n.t('下载更新')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}