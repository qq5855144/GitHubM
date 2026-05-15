// GitHub Pages 网站部署管理

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Globe,
  ExternalLink,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Play,
  Clock,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getPages,
  enablePages,
  updatePages,
  disablePages,
  triggerPagesBuild,
  listPagesBuilds,
  getRepoBranches,
  type GitHubPages,
  type GitHubPagesBuild,
  formatRelativeTime,
} from '@/services/github';
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
import { toast } from 'sonner';

function BuildStatusBadge({ status }: { status: string }) {
  if (status === 'built') return <Badge className="bg-success/10 text-success border-success/30 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />构建成功</Badge>;
  if (status === 'building') return <Badge className="bg-warning/10 text-warning border-warning/30 text-xs flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />构建中</Badge>;
  if (status === 'errored') return <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs flex items-center gap-1"><XCircle className="w-3 h-3" />构建失败</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground border-border">{status}</Badge>;
}

export default function PagesDeployPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [pages, setPages] = useState<GitHubPages | null>(null);
  const [builds, setBuilds] = useState<GitHubPagesBuild[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingBuilds, setLoadingBuilds] = useState(false);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [notEnabled, setNotEnabled] = useState(false);
  // 配置表单
  const [selectedBranch, setSelectedBranch] = useState('main');
  const [selectedDir, setSelectedDir] = useState<'/' | '/docs'>('/');
  const [cname, setCname] = useState('');

  useEffect(() => {
    if (!owner || !repo) return;
    Promise.all([
      getPages(owner, repo).catch(() => null),
      getRepoBranches(owner, repo).catch(() => []),
    ]).then(([pagesData, branchData]) => {
      if (pagesData) {
        setPages(pagesData);
        if (pagesData.source) {
          setSelectedBranch(pagesData.source.branch);
          setSelectedDir(pagesData.source.directory === '/docs' ? '/docs' : '/');
        }
        setCname(pagesData.cname || '');
      } else {
        setNotEnabled(true);
      }
      setBranches(branchData.map((b) => b.name));
    }).finally(() => setLoading(false));
  }, [owner, repo]);

  const loadBuilds = async () => {
    if (!owner || !repo) return;
    setLoadingBuilds(true);
    try {
      const data = await listPagesBuilds(owner, repo, { per_page: 10 });
      setBuilds(Array.isArray(data) ? data : []);
    } catch {
      toast.error('加载构建历史失败');
    } finally {
      setLoadingBuilds(false);
    }
  };

  const handleEnable = async () => {
    if (!owner || !repo) return;
    setSaving(true);
    try {
      const result = await enablePages(owner, repo, { branch: selectedBranch, path: selectedDir });
      setPages(result);
      setNotEnabled(false);
      toast.success('GitHub Pages 已启用');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '启用失败，请检查仓库权限');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!owner || !repo || !pages) return;
    setSaving(true);
    try {
      await updatePages(owner, repo, {
        source: { branch: selectedBranch, path: selectedDir },
        cname: cname.trim() || null,
      });
      setPages({ ...pages, source: { branch: selectedBranch, directory: selectedDir }, cname: cname.trim() || null });
      toast.success('Pages 配置已更新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerBuild = async () => {
    if (!owner || !repo) return;
    setTriggering(true);
    try {
      await triggerPagesBuild(owner, repo);
      toast.success('构建已触发，稍后查看构建状态');
      setTimeout(loadBuilds, 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '触发构建失败');
    } finally {
      setTriggering(false);
    }
  };

  const handleDisable = async () => {
    if (!owner || !repo) return;
    setDisabling(true);
    try {
      await disablePages(owner, repo);
      setPages(null);
      setNotEnabled(true);
      toast.success('GitHub Pages 已禁用');
      setDisableOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '禁用失败');
    } finally {
      setDisabling(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
        <Skeleton className="h-6 w-1/3 bg-muted" />
        <Skeleton className="h-40 bg-muted rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>仓库</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Pages 部署</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Globe className="w-5 h-5 text-primary" />
          GitHub Pages 部署
        </h1>
        {pages && (
          <Button
            variant="ghost"
            size="sm"
            className="border border-border text-muted-foreground hover:bg-secondary h-9"
            onClick={handleTriggerBuild}
            disabled={triggering}
          >
            {triggering ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />触发中</> : <><Play className="w-4 h-4 mr-2" />触发构建</>}
          </Button>
        )}
      </div>

      {/* 当前状态 */}
      {pages ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center gap-3">
            <Globe className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">部署状态</span>
            {pages.status === 'built' && <Badge className="bg-success/10 text-success border-success/30 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />已部署</Badge>}
            {pages.status === 'building' && <Badge className="bg-warning/10 text-warning border-warning/30 text-xs flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />部署中</Badge>}
            {pages.status === 'errored' && <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs flex items-center gap-1"><XCircle className="w-3 h-3" />部署失败</Badge>}
            {(!pages.status || pages.status === 'null') && <Badge variant="outline" className="text-xs text-muted-foreground">尚未部署</Badge>}
          </div>
          <div className="p-4 space-y-2 text-sm">
            {pages.html_url && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-24 shrink-0">网站地址</span>
                <a href={pages.html_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline flex items-center gap-1 font-mono text-xs break-all">
                  {pages.html_url}
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </div>
            )}
            {pages.cname && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-24 shrink-0">自定义域名</span>
                <span className="text-foreground font-mono text-xs">{pages.cname}</span>
              </div>
            )}
            {pages.source && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-24 shrink-0">部署来源</span>
                <code className="text-foreground font-mono text-xs bg-secondary px-1.5 py-0.5 rounded">{pages.source.branch}{pages.source.directory}</code>
              </div>
            )}
          </div>
        </div>
      ) : notEnabled ? (
        <div className="bg-card border border-border rounded-lg py-8 text-center px-6">
          <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">此仓库尚未启用 GitHub Pages</p>
          <p className="text-sm text-muted-foreground mt-1">配置下方选项并点击"启用"开始部署</p>
        </div>
      ) : null}

      {/* 配置表单 */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Pages 配置</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-foreground">部署分支</Label>
            {branches.length > 0 ? (
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger className="bg-secondary border-border text-foreground h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {branches.map((b) => <SelectItem key={b} value={b} className="text-foreground text-sm">{b}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} className="bg-secondary border-border text-foreground h-9" placeholder="main" />
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-foreground">发布目录</Label>
            <Select value={selectedDir} onValueChange={(v) => setSelectedDir(v as '/' | '/docs')}>
              <SelectTrigger className="bg-secondary border-border text-foreground h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="/" className="text-foreground text-sm">/ （根目录）</SelectItem>
                <SelectItem value="/docs" className="text-foreground text-sm">/docs</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-foreground">自定义域名（可选）</Label>
          <Input
            value={cname}
            onChange={(e) => setCname(e.target.value)}
            placeholder="example.com"
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground h-9 font-mono"
          />
          <p className="text-xs text-muted-foreground">如需自定义域名，还需在 DNS 处配置 CNAME 记录指向 {owner}.github.io</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {notEnabled ? (
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleEnable} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />启用中</> : <><Globe className="w-4 h-4 mr-2" />启用 Pages</>}
            </Button>
          ) : (
            <>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleUpdate} disabled={saving}>
                {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />保存中</> : '保存配置'}
              </Button>
              <Button
                variant="ghost"
                className="border border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => setDisableOpen(true)}
              >
                禁用 Pages
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 构建历史 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">构建历史</span>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground border border-border hover:bg-secondary" onClick={loadBuilds} disabled={loadingBuilds}>
            {loadingBuilds ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
            刷新
          </Button>
        </div>
        {loadingBuilds ? (
          <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 bg-muted" />)}</div>
        ) : builds.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <p>暂无构建记录，点击"刷新"加载</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {builds.map((build, idx) => (
              <div key={idx} className="flex items-center gap-3 px-4 py-3">
                <BuildStatusBadge status={build.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-muted-foreground truncate">{build.commit.substring(0, 8)}</p>
                  {build.error?.message && <p className="text-xs text-destructive mt-0.5">{build.error.message}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground">{formatRelativeTime(build.updated_at)}</p>
                  <p className="text-xs text-muted-foreground">{(build.duration / 1000).toFixed(1)}s</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">确认禁用 GitHub Pages</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              禁用后网站将无法访问，配置信息会丢失。此操作不可撤销，如需重新启用需重新配置。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDisable} disabled={disabling}>
              {disabling ? '禁用中...' : '确认禁用'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
