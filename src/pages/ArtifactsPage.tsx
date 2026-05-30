// 仓库产物查看与下载（Releases + Actions Artifacts）

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Package,
  Download,
  Trash2,
  Tag,
  Clock,
  FileArchive,
  AlertCircle,
  ChevronDown,
  ExternalLink,
  RefreshCw,
  Zap,
  Archive,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  getReleases,
  getRepoArtifacts,
  deleteArtifact,
  deleteRelease,
  getToken,
  formatRelativeTime,
  type GitHubRelease,
  type GitHubArtifact,
  type GitHubReleaseAsset,
} from '@/services/github';
import { supabase } from '@/db/supabase';
import { toast } from 'sonner';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 下载 GitHub 文件。
 *
 * Android WebView：
 *   通过 AndroidBridge.downloadFile 交给原生 DownloadManager，携带 Token 认证，
 *   支持私有仓库，同时绕过 blob URL 限制。
 *
 * 浏览器环境：
 *   直接用 window.open(browser_download_url) 进行浏览器原生导航下载。
 *   ──────────────────────────────────────────────────────────────────
 *   ❌ 为什么不用 fetch + Authorization？
 *      api.github.com 的 Asset 下载接口会 302 重定向到 objects.githubusercontent.com。
 *      CORS 规范规定：若请求携带凭证头（Authorization），而重定向目标以通配符
 *      Access-Control-Allow-Origin: * 响应，浏览器会直接拦截 → "Failed to fetch"。
 *      无论使用 browser_download_url 还是 api.github.com 接口 URL，均受此限制。
 *   ✅ window.open 是浏览器原生导航，不走 CORS 检查，由浏览器自身处理跳转与下载。
 *      公开仓库无需登录即可下载；私有仓库需在浏览器中登录 GitHub.com。
 */
async function downloadWithAuth(url: string, filename: string): Promise<void> {
  const token = getToken();
  if (!token) {
    toast.error('请先登录后再下载');
    return;
  }

  // Android WebView 原生下载（携带 Token，支持私有仓库）
  const bridge = (window as unknown as { AndroidBridge?: { downloadFile?: (u: string, f: string, t: string) => void } }).AndroidBridge;
  if (bridge?.downloadFile) {
    bridge.downloadFile(url, filename, token);
    toast.success(`开始下载 ${filename}`);
    return;
  }

  // 浏览器：原生导航下载，绕过 CORS 重定向限制
  window.open(url, '_blank', 'noopener,noreferrer');
  toast.success(`已在新标签页中打开 ${filename} 的下载链接`);
}

function AssetItem({ asset }: { asset: GitHubReleaseAsset }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadWithAuth(asset.browser_download_url, asset.name);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 group hover:bg-secondary/30 transition-colors">
      <FileArchive className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground font-mono truncate">{asset.name}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span>{formatBytes(asset.size)}</span>
          <span>·</span>
          <span>{asset.content_type}</span>
          <span>·</span>
          <span className="flex items-center gap-0.5"><Download className="w-3 h-3" />{asset.download_count}</span>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs shrink-0"
        onClick={handleDownload}
        disabled={downloading}
      >
        {downloading
          ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />下载中</>
          : <><Download className="w-3.5 h-3.5 mr-1.5" />下载</>
        }
      </Button>
    </div>
  );
}

function ReleaseItem({
  release,
  onDelete,
}: {
  release: GitHubRelease;
  onDelete: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dlZip, setDlZip] = useState(false);
  const [dlTar, setDlTar] = useState(false);
  const totalSize = release.assets.reduce((sum, a) => sum + a.size, 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors text-left group">
        <Tag className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground font-mono">{release.tag_name}</span>
            {release.name && release.name !== release.tag_name && (
              <span className="text-sm text-muted-foreground truncate">{release.name}</span>
            )}
            {release.draft && <Badge variant="outline" className="text-xs text-muted-foreground border-border">草稿</Badge>}
            {release.prerelease && <Badge className="bg-warning/10 text-warning border-warning/30 text-xs">预发布</Badge>}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatRelativeTime(release.published_at || release.created_at)}</span>
            <span>{release.assets.length} 个产物 · {formatBytes(totalSize)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <a href={release.html_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-accent hover:bg-accent/10">
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          </a>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={(e) => { e.stopPropagation(); onDelete(release.id); }}
            title="删除 Release"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border bg-secondary/10">
          {/* 源码下载按钮（zipball / tarball 均为 api.github.com 接口，需携带 token） */}
          <div className="flex gap-2 px-4 py-2.5 border-b border-border/50 flex-wrap">
            {release.zipball_url && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={dlZip}
                onClick={async () => {
                  setDlZip(true);
                  await downloadWithAuth(release.zipball_url!, `${release.tag_name}-source.zip`);
                  setDlZip(false);
                }}
              >
                {dlZip
                  ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />下载中</>
                  : <><Archive className="w-3 h-3 mr-1.5" />Source code (.zip)</>
                }
              </Button>
            )}
            {release.tarball_url && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={dlTar}
                onClick={async () => {
                  setDlTar(true);
                  await downloadWithAuth(release.tarball_url!, `${release.tag_name}-source.tar.gz`);
                  setDlTar(false);
                }}
              >
                {dlTar
                  ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />下载中</>
                  : <><Archive className="w-3 h-3 mr-1.5" />Source code (.tar.gz)</>
                }
              </Button>
            )}
          </div>
          {release.assets.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">此版本没有产物文件</div>
          ) : (
            <div className="divide-y divide-border/50">
              {release.assets.map((asset) => <AssetItem key={asset.id} asset={asset} />)}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Actions Artifact 下载按钮
 *
 * archive_download_url 必须携带 Authorization 才能拿到 GitHub 302 重定向的临时预签名 URL。
 * 浏览器无法在 window.open 中携带 Authorization，直接打开会得到 401。
 *
 * 方案：通过 Edge Function（服务端）携带 token 获取 302 Location（预签名 URL），
 *       返回给前端后再用 window.open 打开——预签名 URL 不需要 Authorization。
 */
function ArtifactDownloadButton({ art, owner, repo }: { art: GitHubArtifact; owner: string; repo: string }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    const token = getToken();
    if (!token) {
      toast.error('请先登录后再下载');
      return;
    }

    setDownloading(true);
    try {
      // Android WebView：原生层直接携带 token 下载
      const bridge = (window as unknown as {
        AndroidBridge?: { downloadFile?: (u: string, f: string, t: string) => void }
      }).AndroidBridge;
      if (bridge?.downloadFile) {
        bridge.downloadFile(art.archive_download_url, `${art.name}.zip`, token);
        toast.success(`开始下载 ${art.name}.zip`);
        return;
      }

      // 浏览器：通过 Edge Function 服务端获取预签名 URL，再 window.open 打开
      const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>(
        'get-artifact-url',
        { body: { owner, repo, artifact_id: art.id, token } },
      );

      if (error) {
        const msg = await (error as { context?: { text?: () => Promise<string> } }).context?.text?.() ?? error.message;
        toast.error(`下载失败：${msg}`);
        return;
      }
      if (data?.error) {
        toast.error(`下载失败：${data.error}`);
        return;
      }
      if (!data?.url) {
        toast.error('获取下载链接失败，请稍后重试');
        return;
      }

      window.open(data.url, '_blank', 'noopener,noreferrer');
      toast.success(`已打开 ${art.name}.zip 的下载链接`);
    } catch (err) {
      toast.error(`下载失败：${err instanceof Error ? err.message : '未知错误'}`);
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
        ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />获取中</>
        : <><Download className="w-3.5 h-3.5 mr-1.5" />下载</>
      }
    </Button>
  );
}

export default function ArtifactsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [artifacts, setArtifacts] = useState<GitHubArtifact[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(true);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  const [hasMoreReleases, setHasMoreReleases] = useState(false);
  const [releasePage, setReleasePage] = useState(1);
  const [deleteRelTarget, setDeleteRelTarget] = useState<number | null>(null);
  const [deleteArtTarget, setDeleteArtTarget] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadReleases = useCallback(async (page = 1, append = false) => {
    if (!owner || !repo) return;
    if (page === 1) setLoadingReleases(true);
    try {
      const data = await getReleases(owner, repo, { per_page: 20, page });
      if (append) setReleases((prev) => [...prev, ...data]);
      else setReleases(data);
      setHasMoreReleases(data.length === 20);
      setReleasePage(page);
    } catch (err) {
      toast.error('加载 Release 列表失败');
      console.error(err);
    } finally {
      setLoadingReleases(false);
    }
  }, [owner, repo]);

  const loadArtifacts = useCallback(async () => {
    if (!owner || !repo) return;
    setLoadingArtifacts(true);
    try {
      const data = await getRepoArtifacts(owner, repo, { per_page: 30 });
      setArtifacts(Array.isArray(data.artifacts) ? data.artifacts : []);
    } catch (err) {
      toast.error('加载 Artifacts 失败');
      console.error(err);
    } finally {
      setLoadingArtifacts(false);
    }
  }, [owner, repo]);

  useEffect(() => { loadReleases(1); }, [loadReleases]);

  const handleDeleteRelease = async () => {
    if (!deleteRelTarget || !owner || !repo) return;
    setDeleting(true);
    try {
      await deleteRelease(owner, repo, deleteRelTarget);
      setReleases((prev) => prev.filter((r) => r.id !== deleteRelTarget));
      toast.success('Release 已删除');
      setDeleteRelTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteArtifact = async () => {
    if (!deleteArtTarget || !owner || !repo) return;
    setDeleting(true);
    try {
      await deleteArtifact(owner, repo, deleteArtTarget);
      setArtifacts((prev) => prev.filter((a) => a.id !== deleteArtTarget));
      toast.success('Artifact 已删除');
      setDeleteArtTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>仓库</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">产物</span>
      </div>

      <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
        <Package className="w-5 h-5 text-primary" />
        仓库产物
      </h1>

      <Tabs defaultValue="releases">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="releases" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground gap-1.5">
            <Tag className="w-3.5 h-3.5" />Releases
          </TabsTrigger>
          <TabsTrigger value="artifacts" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground gap-1.5"
            onClick={() => { if (artifacts.length === 0) loadArtifacts(); }}>
            <Zap className="w-3.5 h-3.5" />Artifacts
          </TabsTrigger>
        </TabsList>

        {/* Releases */}
        <TabsContent value="releases" className="mt-4">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {loadingReleases ? (
              <div className="divide-y divide-border">
                {[1,2,3].map(i => (
                  <div key={i} className="p-4 flex gap-3">
                    <Skeleton className="w-8 h-8 rounded bg-muted shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/3 bg-muted" />
                      <Skeleton className="h-3 w-1/4 bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            ) : releases.length === 0 ? (
              <div className="py-16 text-center">
                <Tag className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-foreground font-medium">暂无 Release</p>
                <p className="text-sm text-muted-foreground mt-1">创建 Release 后可在此查看和下载产物</p>
                <a href={`https://github.com/${owner}/${repo}/releases/new`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block">
                  <Button className="bg-primary text-primary-foreground hover:bg-primary/90 mt-3">
                    <ExternalLink className="w-4 h-4 mr-2" />在 GitHub 创建 Release
                  </Button>
                </a>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {releases.map((rel) => (
                  <ReleaseItem key={rel.id} release={rel} onDelete={setDeleteRelTarget} />
                ))}
              </div>
            )}
          </div>
          {hasMoreReleases && !loadingReleases && (
            <Button variant="ghost" className="w-full mt-3 border border-border text-muted-foreground hover:bg-secondary" onClick={() => loadReleases(releasePage + 1, true)}>
              加载更多
            </Button>
          )}
        </TabsContent>

        {/* Actions Artifacts */}
        <TabsContent value="artifacts" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button variant="ghost" size="sm" className="border border-border text-muted-foreground hover:bg-secondary h-8" onClick={loadArtifacts} disabled={loadingArtifacts}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingArtifacts ? 'animate-spin' : ''}`} />刷新
            </Button>
          </div>
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {loadingArtifacts ? (
              <div className="divide-y divide-border">
                {[1,2,3,4].map(i => (
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
              <div className="py-16 text-center">
                <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-foreground font-medium">暂无 Artifacts</p>
                <p className="text-sm text-muted-foreground mt-1 text-pretty max-w-xs mx-auto">
                  Actions Artifacts 是工作流运行后上传的产物文件，会在一段时间后自动过期。
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
                        {art.expired && <Badge variant="outline" className="text-xs text-muted-foreground border-border">已过期</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                        <span>{formatBytes(art.size_in_bytes)}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatRelativeTime(art.created_at)}</span>
                        {art.expires_at && !art.expired && (
                          <span>过期：{formatRelativeTime(art.expires_at)}</span>
                        )}
                        {art.workflow_run && (
                          <span>分支：<code className="font-mono">{art.workflow_run.head_branch}</code></span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!art.expired && (
                        <ArtifactDownloadButton art={art} owner={owner ?? ''} repo={repo ?? ''} />
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteArtTarget(art.id)}
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* 删除 Release 确认 */}
      <AlertDialog open={!!deleteRelTarget} onOpenChange={() => setDeleteRelTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">确认删除 Release</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">此操作不可撤销，该 Release 及所有关联产物文件将被永久删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteRelease} disabled={deleting}>
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除 Artifact 确认 */}
      <AlertDialog open={!!deleteArtTarget} onOpenChange={() => setDeleteArtTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">确认删除 Artifact</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">此操作不可撤销，该 Artifact 文件将被永久删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteArtifact} disabled={deleting}>
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
