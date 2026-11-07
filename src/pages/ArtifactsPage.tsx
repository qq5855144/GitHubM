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
  Upload,
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getReleases,
  getRepoArtifacts,
  createRelease,
  deleteArtifact,
  deleteRelease,
  getToken,
  invalidateCache,
  formatRelativeTime,
  type GitHubRelease,
  type GitHubArtifact,
  type GitHubReleaseAsset,
} from '@/services/github';
import { toast } from 'sonner';
import { downloadGithubFile, isDownloadProxyEnabled } from '@/lib/githubDownload';
import i18n from "@/i18n";

interface ReleasePublishResultDetail {
  success: boolean;
  message: string;
  assetName: string;
  browserDownloadUrl?: string;
}

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
async function downloadWithAuth(asset: { url: string; browser_download_url: string; name: string }): Promise<void> {
  const token = getToken();
  if (!token) {
    toast.error(i18n.t('请先登录后再下载'));
    return;
  }

  // 全局下载代理：仅对 github.com 上的 Release 附件生效。
  // Source code zipball/tarball 是 api.github.com 接口，必须继续走 Token 直连。
  if (isDownloadProxyEnabled() && asset.browser_download_url.startsWith('https://github.com/')) {
    try {
      await downloadGithubFile(asset.browser_download_url, asset.name, token);
      toast.success(`开始下载 ${asset.name}`);
      return;
    } catch (err) {
      toast.error(err instanceof Error ? `代理下载失败，已切换直连：${err.message}` : '代理下载失败，已切换直连');
    }
  }

  // Android WebView 原生下载（携带 Token，支持私有仓库）
  const bridge = (window as unknown as { AndroidBridge?: { downloadFile?: (u: string, f: string, t: string) => void } }).AndroidBridge;
  if (bridge?.downloadFile) {
    // 对于原生端，使用 asset.url (api.github.com) 而非 browser_download_url，
    // 这样能够支持传入 token 鉴权，实现私有仓库产物下载。
    bridge.downloadFile(asset.url, asset.name, token);
    toast.success(`开始下载 ${asset.name}`);
    return;
  }

  // 浏览器：原生导航下载，绕过 CORS 重定向限制
  window.open(asset.browser_download_url, '_blank', 'noopener,noreferrer');
  toast.success(`已在新标签页中打开 ${asset.name} 的下载链接`);
}

function AssetItem({ asset }: { asset: GitHubReleaseAsset }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadWithAuth(asset);
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
          ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{i18n.t('下载中')}</>
          : <><Download className="w-3.5 h-3.5 mr-1.5" />{i18n.t('下载')}</>
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
  const [notesOpen, setNotesOpen] = useState(false);
  const [dlZip, setDlZip] = useState(false);
  const [dlTar, setDlTar] = useState(false);
  const totalSize = release.assets.reduce((sum, a) => sum + a.size, 0);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setNotesOpen(false);
  };
  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors text-left group">
        <Tag className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground font-mono">{release.tag_name}</span>
            {release.name && release.name !== release.tag_name && (
              <span className="text-sm text-muted-foreground truncate">{release.name}</span>
            )}
            {release.draft && <Badge variant="outline" className="text-xs text-muted-foreground border-border">{i18n.t('草稿')}</Badge>}
            {release.prerelease && <Badge className="bg-warning/10 text-warning border-warning/30 text-xs">{i18n.t('预发布')}</Badge>}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatRelativeTime(release.published_at || release.created_at)}</span>
            <span>{release.assets.length} {i18n.t('个产物 ·')}{formatBytes(totalSize)}</span>
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
            title={i18n.t('删除 Release')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border bg-secondary/10">
          {release.body && (
            <Collapsible open={notesOpen} onOpenChange={setNotesOpen}>
              <CollapsibleTrigger className="w-full flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/50 hover:bg-secondary/30 transition-colors text-left">
                <span className="text-xs font-medium text-muted-foreground">{i18n.t('发布说明')}</span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                  {notesOpen ? i18n.t('收起') : i18n.t('展开')}
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform ${notesOpen ? 'rotate-90' : ''}`} />
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-4 py-3 border-b border-border/50">
                  <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed max-h-72 overflow-y-auto rounded-md bg-background/60 border border-border/50 p-3">
                    {release.body}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
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
                  await downloadWithAuth({
                    url: release.zipball_url!,
                    browser_download_url: release.zipball_url!,
                    name: `${release.tag_name}-source.zip`
                  });
                  setDlZip(false);
                }}
              >
                {dlZip
                  ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />{i18n.t('下载中')}</>
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
                  await downloadWithAuth({
                    url: release.tarball_url!,
                    browser_download_url: release.tarball_url!,
                    name: `${release.tag_name}-source.tar.gz`
                  });
                  setDlTar(false);
                }}
              >
                {dlTar
                  ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />{i18n.t('下载中')}</>
                  : <><Archive className="w-3 h-3 mr-1.5" />Source code (.tar.gz)</>
                }
              </Button>
            )}
          </div>
          {release.assets.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">{i18n.t('此版本没有产物文件')}</div>
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
 * archive_download_url 必须携带 Authorization 才能访问，GitHub 会 302 重定向到
 * 带 SAS 签名的预签名 URL（签名内嵌，重定向后无需 Authorization）。
 *
 * Android WebView：原生层直接携带 token 下载。
 * 浏览器：fetch 携带 token 跟随 302 到预签名 URL，读取 blob 后触发下载
 *         （已脱离 Supabase Edge Function get-artifact-url）。
 */
function ArtifactDownloadButton({ art, owner, repo }: { art: GitHubArtifact; owner: string; repo: string }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    const token = getToken();
    if (!token) {
      toast.error(i18n.t('请先登录后再下载'));
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

      // 浏览器：前端直连 GitHub API（携带 token 跟随 302 到预签名 URL）
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

      // 读取 blob 并触发浏览器下载
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

export default function ArtifactsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [artifacts, setArtifacts] = useState<GitHubArtifact[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(true);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  const [activeTab, setActiveTab] = useState<'releases' | 'artifacts'>('releases');
  const [hasMoreReleases, setHasMoreReleases] = useState(false);
  const [releasePage, setReleasePage] = useState(1);
  const [deleteRelTarget, setDeleteRelTarget] = useState<number | null>(null);
  const [deleteArtTarget, setDeleteArtTarget] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [publishTarget, setPublishTarget] = useState<GitHubArtifact | null>(null);
  const [publishMode, setPublishMode] = useState<'existing' | 'new'>('existing');
  const [selectedReleaseId, setSelectedReleaseId] = useState('');
  const [newReleaseTag, setNewReleaseTag] = useState('');
  const [newReleaseName, setNewReleaseName] = useState('');
  const [newReleaseBody, setNewReleaseBody] = useState('');
  const [newReleaseDraft, setNewReleaseDraft] = useState(false);
  const [newReleasePrerelease, setNewReleasePrerelease] = useState(false);
  const [publishAssetName, setPublishAssetName] = useState('');
  const [publishing, setPublishing] = useState(false);

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
      toast.error(i18n.t('加载 Release 列表失败'));
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
      toast.error(i18n.t('加载 Artifacts 失败'));
      console.error(err);
    } finally {
      setLoadingArtifacts(false);
    }
  }, [owner, repo]);

  const nativePublishAvailable = typeof (window as unknown as {
    AndroidBridge?: { publishArtifactToRelease?: (...args: string[]) => void };
  }).AndroidBridge?.publishArtifactToRelease === 'function';
  const selectedRelease = releases.find((release) => String(release.id) === selectedReleaseId);
  const duplicateAsset = !!selectedRelease?.assets?.some((asset) => asset.name === publishAssetName.trim());

  const openPublishDialog = (artifact: GitHubArtifact) => {
    const latest = releases[0];
    setPublishTarget(artifact);
    setPublishAssetName(`${artifact.name}.zip`);
    setPublishMode(latest ? 'existing' : 'new');
    setSelectedReleaseId(latest ? String(latest.id) : '');
    setNewReleaseTag(`artifact-${artifact.id}`);
    setNewReleaseName(artifact.name);
    setNewReleaseBody(`由 Actions Artifact ${artifact.name} 发布`);
    setNewReleaseDraft(false);
    setNewReleasePrerelease(false);
    setPublishing(false);
  };

  const handlePublishArtifact = async () => {
    if (!owner || !repo || !publishTarget) return;
    const token = getToken();
    if (!token) {
      toast.error(i18n.t('请先登录后再发布'));
      return;
    }
    const bridge = (window as unknown as {
      AndroidBridge?: { publishArtifactToRelease?: (...args: string[]) => void };
    }).AndroidBridge?.publishArtifactToRelease;
    if (typeof bridge !== 'function') {
      toast.error(i18n.t('浏览器环境暂不支持一键发布，请在 Android App 内操作'));
      return;
    }
    const assetName = publishAssetName.trim();
    if (!assetName) {
      toast.error(i18n.t('请填写 Release Asset 名称'));
      return;
    }
    if (publishMode === 'existing' && !selectedReleaseId) {
      toast.error(i18n.t('请选择目标 Release'));
      return;
    }
    if (publishMode === 'new' && !newReleaseTag.trim()) {
      toast.error(i18n.t('请填写新 Release 的 Tag'));
      return;
    }
    setPublishing(true);
    try {
      let releaseId = Number(selectedReleaseId);
      if (publishMode === 'new') {
        const release = await createRelease(owner, repo, {
          tag_name: newReleaseTag.trim(),
          name: newReleaseName.trim() || newReleaseTag.trim(),
          body: newReleaseBody.trim(),
          draft: newReleaseDraft,
          prerelease: newReleasePrerelease,
        });
        releaseId = release.id;
      }
      if (!Number.isFinite(releaseId) || releaseId <= 0) {
        throw new Error(i18n.t('目标 Release 无效'));
      }
      const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
      bridge(uploadUrl, publishTarget.archive_download_url, assetName, token);
      toast.info(i18n.t('正在下载并发布 Artifact...'));
    } catch (err) {
      setPublishing(false);
      toast.error(err instanceof Error ? err.message : i18n.t('创建 Release 失败'));
    }
  };

  useEffect(() => {
    const handleResult = (event: Event) => {
      const detail = (event as CustomEvent<ReleasePublishResultDetail>).detail;
      if (!detail) return;
      setPublishing(false);
      if (detail.success) {
        toast.success(`${i18n.t('已发布到 Release：')}${detail.assetName}`);
        setPublishTarget(null);
        setActiveTab('releases');
        if (owner && repo) invalidateCache(`/repos/${owner}/${repo}/releases`);
        void loadReleases(1);
      } else {
        toast.error(`${i18n.t('发布失败：')}${detail.message}`);
      }
    };
    window.addEventListener('releaseAssetPublishResult', handleResult);
    return () => window.removeEventListener('releaseAssetPublishResult', handleResult);
  }, [loadReleases, owner, repo]);

  useEffect(() => { loadReleases(1); }, [loadReleases]);

  const handleDeleteRelease = async () => {
    if (!deleteRelTarget || !owner || !repo) return;
    setDeleting(true);
    try {
      await deleteRelease(owner, repo, deleteRelTarget);
      setReleases((prev) => prev.filter((r) => r.id !== deleteRelTarget));
      toast.success(i18n.t('Release 已删除'));
      setDeleteRelTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('删除失败'));
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
      toast.success(i18n.t('Artifact 已删除'));
      setDeleteArtTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('删除失败'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">{i18n.t('产物')}</span>
      </div>

      <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
        <Package className="w-5 h-5 text-primary" />
        {i18n.t('仓库产物')}</h1>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const next = value as 'releases' | 'artifacts';
          setActiveTab(next);
          if (next === 'artifacts' && artifacts.length === 0 && !loadingArtifacts) {
            void loadArtifacts();
          }
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <TabsList className="bg-secondary border border-border shrink-0">
            <TabsTrigger value="releases" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground gap-1.5">
              <Tag className="w-3.5 h-3.5" />Releases
            </TabsTrigger>
            <TabsTrigger value="artifacts" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground gap-1.5">
              <Zap className="w-3.5 h-3.5" />Artifacts
            </TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="sm"
            className="border border-border text-muted-foreground hover:bg-secondary h-8 shrink-0"
            onClick={() => {
              if (activeTab === 'releases') void loadReleases(1);
              else void loadArtifacts();
            }}
            disabled={activeTab === 'releases' ? loadingReleases : loadingArtifacts}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${(activeTab === 'releases' ? loadingReleases : loadingArtifacts) ? 'animate-spin' : ''}`} />
            {i18n.t('刷新')}
          </Button>
        </div>

        {/* Releases */}
        <TabsContent value="releases" className="mt-4">
          {loadingReleases && releases.length === 0 ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-card border border-border rounded-xl p-4 flex gap-3">
                  <Skeleton className="w-8 h-8 rounded bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3 bg-muted" />
                    <Skeleton className="h-3 w-1/4 bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : releases.length === 0 ? (
            <div className="bg-card border border-border rounded-xl py-16 text-center">
              <Tag className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-foreground font-medium">{i18n.t('暂无 Release')}</p>
              <p className="text-sm text-muted-foreground mt-1">{i18n.t('创建 Release 后可在此查看和下载产物')}</p>
              <a href={`https://github.com/${owner}/${repo}/releases/new`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90 mt-3">
                  <ExternalLink className="w-4 h-4 mr-2" />{i18n.t('在 GitHub 创建 Release')}</Button>
              </a>
            </div>
          ) : (
            <div className="space-y-2">
              {releases.map((rel) => (
                <div key={rel.id} className="bg-card border border-border rounded-xl overflow-hidden">
                  <ReleaseItem release={rel} onDelete={setDeleteRelTarget} />
                </div>
              ))}
            </div>
          )}
          {hasMoreReleases && !loadingReleases && (
            <Button variant="ghost" className="w-full mt-3 border border-border text-muted-foreground hover:bg-secondary" onClick={() => loadReleases(releasePage + 1, true)}>
              {i18n.t('加载更多')}</Button>
          )}
        </TabsContent>

        {/* Actions Artifacts */}
        <TabsContent value="artifacts" className="mt-4">
          {loadingArtifacts && artifacts.length === 0 ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-card border border-border rounded-xl p-4 flex gap-3">
                  <Skeleton className="w-8 h-8 rounded bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3 bg-muted" />
                    <Skeleton className="h-3 w-1/4 bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : artifacts.length === 0 ? (
            <div className="bg-card border border-border rounded-xl py-16 text-center">
              <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-foreground font-medium">{i18n.t('暂无 Artifacts')}</p>
              <p className="text-sm text-muted-foreground mt-1 text-pretty max-w-xs mx-auto">
                {i18n.t('Actions Artifacts 是工作流运行后上传的产物文件，会在一段时间后自动过期。')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {artifacts.map((art) => (
                <div key={art.id} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3">
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
                    {!art.expired && (
                      <ArtifactDownloadButton art={art} owner={owner ?? ''} repo={repo ?? ''} />
                    )}
                    {!art.expired && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs gap-1 shrink-0"
                        onClick={() => openPublishDialog(art)}
                        title={i18n.t('发布到 Release')}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {i18n.t('发布')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteArtTarget(art.id)}
                      title={i18n.t('删除')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!publishTarget}
        onOpenChange={(open) => { if (!open && !publishing) setPublishTarget(null); }}
      >
        <DialogContent className="max-w-[calc(100%-1.5rem)] md:max-w-lg bg-card border-border max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2 text-balance">
              <Upload className="w-4 h-4 text-primary shrink-0" />
              {i18n.t('发布 Artifact 到 Release')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {publishTarget?.name}{publishTarget ? ` · ${formatBytes(publishTarget.size_in_bytes)}` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPublishMode('existing')}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${publishMode === 'existing' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary/40 text-muted-foreground hover:bg-secondary'}`}
              >
                {i18n.t('现有 Release')}
              </button>
              <button
                type="button"
                onClick={() => setPublishMode('new')}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${publishMode === 'new' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary/40 text-muted-foreground hover:bg-secondary'}`}
              >
                {i18n.t('新建 Release')}
              </button>
            </div>

            {publishMode === 'existing' ? (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{i18n.t('目标 Release')}</Label>
                {releases.length > 0 ? (
                  <Select value={selectedReleaseId} onValueChange={setSelectedReleaseId}>
                    <SelectTrigger className="bg-secondary border-border text-foreground h-9 text-sm">
                      <SelectValue placeholder={i18n.t('选择 Release')} />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {releases.map((release) => (
                        <SelectItem key={release.id} value={String(release.id)} className="text-sm">
                          {release.tag_name}{release.name ? ` · ${release.name}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground py-1">{i18n.t('暂无可用 Release，请切换到「新建 Release」')}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{i18n.t('Tag')}</Label>
                  <Input
                    value={newReleaseTag}
                    onChange={(e) => setNewReleaseTag(e.target.value)}
                    placeholder="v1.0.0"
                    className="bg-secondary border-border h-9 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{i18n.t('Release 名称')}</Label>
                  <Input
                    value={newReleaseName}
                    onChange={(e) => setNewReleaseName(e.target.value)}
                    className="bg-secondary border-border h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{i18n.t('发布说明')}</Label>
                  <textarea
                    value={newReleaseBody}
                    onChange={(e) => setNewReleaseBody(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground resize-none outline-none"
                  />
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox checked={newReleaseDraft} onCheckedChange={(v) => setNewReleaseDraft(v === true)} />
                    {i18n.t('草稿')}
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox checked={newReleasePrerelease} onCheckedChange={(v) => setNewReleasePrerelease(v === true)} />
                    {i18n.t('预发布')}
                  </label>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{i18n.t('Release Asset 名称')}</Label>
              <Input
                value={publishAssetName}
                onChange={(e) => setPublishAssetName(e.target.value)}
                className="bg-secondary border-border h-9 text-sm font-mono"
              />
              {duplicateAsset && (
                <p className="text-[11px] text-warning">{i18n.t('目标 Release 已存在同名 Asset，请修改名称')}</p>
              )}
            </div>

            {!nativePublishAvailable && (
              <p className="text-[11px] text-warning">
                {i18n.t('浏览器环境暂不支持一键上传，请在 Android App 内操作')}
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sticky bottom-0 -mx-6 -mb-6 px-6 pb-4 pt-3 border-t border-border bg-card">
            <Button
              variant="ghost"
              className="border border-border text-muted-foreground hover:bg-secondary"
              onClick={() => setPublishTarget(null)}
              disabled={publishing}
            >
              {i18n.t('取消')}
            </Button>
            <Button
              className="gap-1.5"
              onClick={handlePublishArtifact}
              disabled={
                publishing
                || !nativePublishAvailable
                || !publishAssetName.trim()
                || duplicateAsset
                || (publishMode === 'existing' ? !selectedReleaseId : !newReleaseTag.trim())
              }
            >
              {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {publishing ? i18n.t('发布中...') : i18n.t('发布到 Release')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除 Release 确认 */}
      <AlertDialog open={!!deleteRelTarget} onOpenChange={() => setDeleteRelTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{i18n.t('确认删除 Release')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">{i18n.t('此操作不可撤销，该 Release 及所有关联产物文件将被永久删除。')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">{i18n.t('取消')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteRelease} disabled={deleting}>
              {deleting ? i18n.t('删除中...') : i18n.t('确认删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除 Artifact 确认 */}
      <AlertDialog open={!!deleteArtTarget} onOpenChange={() => setDeleteArtTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{i18n.t('确认删除 Artifact')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">{i18n.t('此操作不可撤销，该 Artifact 文件将被永久删除。')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">{i18n.t('取消')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteArtifact} disabled={deleting}>
              {deleting ? i18n.t('删除中...') : i18n.t('确认删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
