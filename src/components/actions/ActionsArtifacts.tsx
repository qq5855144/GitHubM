import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Clock,
  Download,
  FileArchive,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  deleteArtifact,
  formatRelativeTime,
  getRepoArtifacts,
  getToken,
  type GitHubArtifact,
} from '@/services/github';
import { toast } from 'sonner';
import i18n from '@/i18n';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function ArtifactDownloadButton({ art }: { art: GitHubArtifact }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    const token = getToken();
    if (!token) {
      toast.error(i18n.t('请先登录后再下载'));
      return;
    }

    setDownloading(true);
    try {
      const bridge = (window as unknown as {
        AndroidBridge?: { downloadFile?: (u: string, f: string, t: string) => void }
      }).AndroidBridge;
      if (bridge?.downloadFile) {
        bridge.downloadFile(art.archive_download_url, `${art.name}.zip`, token);
        toast.success(`开始下载 ${art.name}.zip`);
        return;
      }

      const res = await fetch(art.archive_download_url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      });

      if (!res.ok) {
        let msg = '';
        try { msg = (await res.text()).slice(0, 200); } catch { /* ignore */ }
        toast.error(`下载失败：HTTP ${res.status}${msg ? ` ${msg}` : ''}`);
        return;
      }

      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `${art.name}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
      toast.success(`开始下载 ${art.name}.zip`);
    } catch (err) {
      const msg = err instanceof Error && err.message.includes('CORS')
        ? i18n.t('跨域下载被拦截，请检查网络后重试')
        : err instanceof Error ? err.message : i18n.t('未知错误');
      toast.error(`下载失败：${msg}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 text-xs"
      disabled={downloading}
      onClick={handleDownload}
    >
      {downloading
        ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{i18n.t('获取中')}</>
        : <><Download className="w-3.5 h-3.5 mr-1.5" />{i18n.t('下载')}</>
      }
    </Button>
  );
}

export default function ActionsArtifacts({ owner, repo }: { owner: string; repo: string }) {
  const [artifacts, setArtifacts] = useState<GitHubArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadArtifacts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRepoArtifacts(owner, repo, { per_page: 30 });
      setArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []);
    } catch (err) {
      toast.error(i18n.t('加载 Artifacts 失败'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [owner, repo]);

  useEffect(() => { void loadArtifacts(); }, [loadArtifacts]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteArtifact(owner, repo, deleteTarget);
      setArtifacts((prev) => prev.filter((a) => a.id !== deleteTarget));
      toast.success(i18n.t('Artifact 已删除'));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('删除失败'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground flex items-center gap-2">
              <FileArchive className="w-4 h-4 text-primary" />Actions Artifacts
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {i18n.t('工作流运行后上传的产物文件，会在到期后自动清理。')}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="border border-border text-muted-foreground hover:bg-secondary h-8 shrink-0"
            onClick={loadArtifacts}
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />{i18n.t('刷新')}
          </Button>
        </div>

        {loading && artifacts.length === 0 ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map(i => (
              <div key={i} className="p-4 flex gap-3">
                <Skeleton className="w-8 h-8 rounded bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3 bg-muted" />
                  <Skeleton className="h-3 w-1/4 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : artifacts.length === 0 ? (
          <div className="py-12 text-center">
            <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">{i18n.t('暂无 Artifacts')}</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto text-pretty">
              {i18n.t('运行工作流并上传产物后，会显示在这里。')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {artifacts.map((art) => (
              <div key={art.id} className="flex items-center gap-3 px-4 py-3 group hover:bg-secondary/30 transition-colors">
                <FileArchive className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono text-foreground">{art.name}</span>
                    {art.expired && <Badge variant="outline" className="text-xs text-muted-foreground border-border">{i18n.t('已过期')}</Badge>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                    <span>{formatBytes(art.size_in_bytes)}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatRelativeTime(art.created_at)}</span>
                    {art.expires_at && !art.expired && (
                      <span>{i18n.t('过期：')}{formatRelativeTime(art.expires_at)}</span>
                    )}
                    {art.workflow_run && (
                      <span>{i18n.t('分支：')}<code className="font-mono">{art.workflow_run.head_branch}</code></span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {!art.expired && <ArtifactDownloadButton art={art} />}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteTarget(art.id)}
                    title={i18n.t('删除')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{i18n.t('确认删除 Artifact')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {i18n.t('此操作不可撤销，该 Artifact 文件将被永久删除。')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">{i18n.t('取消')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? i18n.t('删除中...') : i18n.t('确认删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
