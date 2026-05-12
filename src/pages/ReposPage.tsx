// 仓库列表页

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  Star,
  GitFork,
  Lock,
  Globe,
  Filter,
  SortAsc,
  SortDesc,
  ChevronRight,
  BookOpen,
  RefreshCw,
  ExternalLink,
  Copy,
  GitBranch,
  GitPullRequest,
  Code2,
  Trash2,
  AlertTriangle,
  AlertCircle,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  getUserRepos,
  createRepo,
  formatRelativeTime,
  formatNumber,
  getLanguageColor,
  getGitignoreTemplates,
  getLicenses,
  starRepo,
  unstarRepo,
  checkStarred,
  forkRepo,
  deleteRepo,
} from '@/services/github';
import type { GitHubRepo, RepoSortField, SortDirection } from '@/types/types';
import { toast } from 'sonner';
import { useDebounce } from '@/hooks/use-debounce';
import { pageCache } from '@/lib/page-cache';

// 仓库右键上下文菜单
function RepoContextMenu({ repo, onDeleteSuccess }: { repo: GitHubRepo; onDeleteSuccess: () => void }) {
  const navigate = useNavigate();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleToggleStar = async () => {
    try {
      const starred = await checkStarred(repo.owner.login, repo.name);
      if (starred) {
        await unstarRepo(repo.owner.login, repo.name);
        toast.success(`已取消 ${repo.name} 的 Star`);
      } else {
        await starRepo(repo.owner.login, repo.name);
        toast.success(`已为 ${repo.name} 加 Star ⭐`);
      }
    } catch {
      toast.error('操作失败');
    }
  };

  const handleFork = async () => {
    try {
      toast.info('正在 Fork 仓库...');
      await forkRepo(repo.owner.login, repo.name);
      toast.success(`Fork 成功！`);
    } catch {
      toast.error('Fork 失败');
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(repo.clone_url || repo.html_url);
    toast.success('仓库地址已复制');
  };

  const handleDelete = async () => {
    if (confirmName !== repo.name) { toast.error('仓库名称不一致'); return; }
    setDeleting(true);
    try {
      await deleteRepo(repo.owner.login, repo.name);
      toast.success(`已删除仓库 ${repo.name}`);
      setDeleteDialogOpen(false);
      // 通知父组件刷新列表，避免 window.location.reload() 导致 GitHub Pages 空白页
      onDeleteSuccess();
    } catch {
      toast.error('删除失败，请确认你有足够权限');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ContextMenuContent className="bg-popover border-border w-52">
        <ContextMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={() => navigate(`/repos/${repo.full_name}`)}>
          <BookOpen className="w-3.5 h-3.5 mr-2" />查看仓库详情
        </ContextMenuItem>
        <ContextMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={() => navigate(`/repos/${repo.full_name}/code`)}>
          <Code2 className="w-3.5 h-3.5 mr-2" />浏览代码
        </ContextMenuItem>
        <ContextMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={() => navigate(`/repos/${repo.full_name}/commits/${repo.default_branch}`)}>
          <GitBranch className="w-3.5 h-3.5 mr-2" />查看提交记录
        </ContextMenuItem>
        <ContextMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={() => navigate(`/repos/${repo.full_name}/issues`)}>
          <AlertCircle className="w-3.5 h-3.5 mr-2" />查看 Issues
        </ContextMenuItem>
        <ContextMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={() => navigate(`/repos/${repo.full_name}/pulls`)}>
          <GitPullRequest className="w-3.5 h-3.5 mr-2" />查看 Pull Requests
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-border" />
        <ContextMenuItem className="text-foreground cursor-pointer text-sm" onClick={handleToggleStar}>
          <Star className="w-3.5 h-3.5 mr-2" />Star / 取消 Star
        </ContextMenuItem>
        <ContextMenuItem className="text-foreground cursor-pointer text-sm" onClick={handleFork}>
          <GitFork className="w-3.5 h-3.5 mr-2" />Fork 仓库
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-border" />
        <ContextMenuItem className="text-foreground cursor-pointer text-sm" onClick={handleCopyUrl}>
          <Copy className="w-3.5 h-3.5 mr-2" />复制仓库地址
        </ContextMenuItem>
        <ContextMenuItem className="text-foreground cursor-pointer text-sm" asChild>
          <a href={repo.html_url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3.5 h-3.5 mr-2" />在 GitHub 中打开
          </a>
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-border" />
        <ContextMenuItem
          className="text-destructive cursor-pointer text-sm focus:text-destructive"
          onClick={() => { setConfirmName(''); setDeleteDialogOpen(true); }}
        >
          <Trash2 className="w-3.5 h-3.5 mr-2" />删除仓库
        </ContextMenuItem>
      </ContextMenuContent>

      {/* 删除确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />删除仓库
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-sm space-y-2">
              <span>此操作将永久删除 </span>
              <code className="font-mono text-foreground bg-secondary px-1.5 py-0.5 rounded text-xs">{repo.full_name}</code>
              <span>，包括所有代码、Issues、PR 等，且不可恢复。</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2 space-y-1.5">
            <Label className="text-sm font-normal text-foreground">
              请输入仓库名称 <code className="font-mono bg-secondary px-1 rounded text-xs">{repo.name}</code> 确认删除
            </Label>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={repo.name}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting || confirmName !== repo.name}
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// 移动端仓库卡片下拉菜单（补全移动端的右键菜单功能）
function RepoCardDropdown({ repo, onDeleteSuccess }: { repo: GitHubRepo; onDeleteSuccess: () => void }) {
  const navigate = useNavigate();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleToggleStar = async () => {
    try {
      const isStarred = await checkStarred(repo.owner.login, repo.name);
      if (isStarred) {
        await unstarRepo(repo.owner.login, repo.name);
        toast.success(`已取消 ${repo.name} 的 Star`);
      } else {
        await starRepo(repo.owner.login, repo.name);
        toast.success(`已为 ${repo.name} 加 Star ⭐`);
      }
    } catch { toast.error('操作失败'); }
  };

  const handleFork = async () => {
    try {
      toast.info('正在 Fork...');
      await forkRepo(repo.owner.login, repo.name);
      toast.success('Fork 成功！');
    } catch { toast.error('Fork 失败'); }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(repo.clone_url || repo.html_url);
    toast.success('仓库地址已复制');
  };

  const handleDelete = async () => {
    if (confirmName !== repo.name) { toast.error('仓库名称不一致'); return; }
    setDeleting(true);
    try {
      await deleteRepo(repo.owner.login, repo.name);
      toast.success(`已删除仓库 ${repo.name}`);
      setDeleteDialogOpen(false);
      onDeleteSuccess();
    } catch { toast.error('删除失败，请确认你有足够权限'); } finally { setDeleting(false); }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden w-8 h-8 text-muted-foreground hover:bg-secondary shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-popover border-border w-52">
          <DropdownMenuItem className="text-foreground cursor-pointer text-sm"
            onClick={() => navigate(`/repos/${repo.full_name}`)}>
            <BookOpen className="w-3.5 h-3.5 mr-2" />查看仓库详情
          </DropdownMenuItem>
          <DropdownMenuItem className="text-foreground cursor-pointer text-sm"
            onClick={() => navigate(`/repos/${repo.full_name}/code`)}>
            <Code2 className="w-3.5 h-3.5 mr-2" />浏览代码
          </DropdownMenuItem>
          <DropdownMenuItem className="text-foreground cursor-pointer text-sm"
            onClick={() => navigate(`/repos/${repo.full_name}/issues`)}>
            <AlertCircle className="w-3.5 h-3.5 mr-2" />查看 Issues
          </DropdownMenuItem>
          <DropdownMenuItem className="text-foreground cursor-pointer text-sm"
            onClick={() => navigate(`/repos/${repo.full_name}/pulls`)}>
            <GitPullRequest className="w-3.5 h-3.5 mr-2" />查看 Pull Requests
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem className="text-foreground cursor-pointer text-sm" onClick={handleToggleStar}>
            <Star className="w-3.5 h-3.5 mr-2" />Star / 取消 Star
          </DropdownMenuItem>
          <DropdownMenuItem className="text-foreground cursor-pointer text-sm" onClick={handleFork}>
            <GitFork className="w-3.5 h-3.5 mr-2" />Fork 仓库
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem className="text-foreground cursor-pointer text-sm" onClick={handleCopyUrl}>
            <Copy className="w-3.5 h-3.5 mr-2" />复制仓库地址
          </DropdownMenuItem>
          <DropdownMenuItem className="text-foreground cursor-pointer text-sm" asChild>
            <a href={repo.html_url} target="_blank" rel="noopener noreferrer"
               onClick={(e) => e.stopPropagation()}>
              <ExternalLink className="w-3.5 h-3.5 mr-2" />在 GitHub 中打开
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border" />
          <DropdownMenuItem
            className="text-destructive cursor-pointer text-sm focus:text-destructive"
            onClick={(e) => { e.stopPropagation(); setConfirmName(''); setDeleteDialogOpen(true); }}
          >
            <Trash2 className="w-3.5 h-3.5 mr-2" />删除仓库
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 删除确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />删除仓库
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-sm space-y-2">
              <span>此操作将永久删除 </span>
              <code className="font-mono text-foreground bg-secondary px-1.5 py-0.5 rounded text-xs">{repo.full_name}</code>
              <span>，包括所有代码、Issues、PR 等，且不可恢复。</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2 space-y-1.5">
            <Label className="text-sm font-normal text-foreground">
              请输入仓库名称 <code className="font-mono bg-secondary px-1 rounded text-xs">{repo.name}</code> 确认删除
            </Label>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={repo.name}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting || confirmName !== repo.name}
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function ReposPage() {
  const navigate = useNavigate();
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [sortField, setSortField] = useState<RepoSortField>('pushed');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [typeFilter, setTypeFilter] = useState<'all' | 'owner' | 'member' | 'public' | 'private'>('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // 创建仓库表单
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoDesc, setNewRepoDesc] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [newRepoAutoInit, setNewRepoAutoInit] = useState(true);
  const [newRepoGitignore, setNewRepoGitignore] = useState('');
  const [newRepoLicense, setNewRepoLicense] = useState('');
  const [gitignoreTemplates, setGitignoreTemplates] = useState<string[]>([]);
  const [licenses, setLicenses] = useState<Array<{ key: string; name: string }>>([]);
  const [creating, setCreating] = useState(false);

  const loadRepos = useCallback(async (pageNum = 1, append = false, force = false) => {
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);

    // 只对第一页默认加载走缓存（append=false 时），强制刷新跳过缓存
    const cacheKey = `repos:${sortField}:${sortDirection}:${typeFilter}:p1`;
    if (pageNum === 1 && !append && !force) {
      const cached = pageCache.get<{ repos: GitHubRepo[]; hasNextPage: boolean }>(cacheKey);
      if (cached) {
        setRepos(cached.repos);
        setHasNextPage(cached.hasNextPage);
        setPage(1);
        setLoading(false);
        return;
      }
    }

    try {
      const result = await getUserRepos({
        sort: sortField,
        direction: sortDirection,
        per_page: 30,
        page: pageNum,
        type: typeFilter,
      });
      if (append) {
        setRepos((prev) => [...prev, ...result.data]);
      } else {
        setRepos(result.data);
        // 第一页加载成功后写入缓存
        pageCache.set(cacheKey, { repos: result.data, hasNextPage: result.hasNextPage });
      }
      setHasNextPage(result.hasNextPage);
      setPage(pageNum);
    } catch (err) {
      toast.error('加载仓库列表失败');
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sortField, sortDirection, typeFilter]);

  useEffect(() => {
    loadRepos(1, false);
  }, [loadRepos]);

  // 加载创建仓库所需数据
  useEffect(() => {
    if (!createDialogOpen) return;
    Promise.all([getGitignoreTemplates(), getLicenses()])
      .then(([templates, licenseList]) => {
        setGitignoreTemplates(templates);
        setLicenses(licenseList);
      })
      .catch(console.error);
  }, [createDialogOpen]);

  const filteredRepos = repos.filter((repo) =>
    debouncedSearch
      ? repo.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (repo.description || '').toLowerCase().includes(debouncedSearch.toLowerCase())
      : true
  );

  const handleCreateRepo = async () => {
    if (!newRepoName.trim()) {
      toast.error('请输入仓库名称');
      return;
    }
    setCreating(true);
    try {
      const newRepo = await createRepo({
        name: newRepoName.trim(),
        description: newRepoDesc.trim() || undefined,
        private: newRepoPrivate,
        auto_init: newRepoAutoInit,
        gitignore_template: newRepoGitignore || undefined,
        license_template: newRepoLicense || undefined,
      });
      toast.success(`仓库 ${newRepo.name} 创建成功！`);
      setCreateDialogOpen(false);
      setNewRepoName('');
      setNewRepoDesc('');
      setNewRepoPrivate(false);
      setNewRepoAutoInit(true);
      setNewRepoGitignore('');
      setNewRepoLicense('');
      pageCache.invalidate('repos:'); // 创建后使仓库列表缓存失效
      loadRepos(1, false, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建仓库失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 页头 */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">仓库</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理您的 GitHub 仓库</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-secondary"
            onClick={() => loadRepos(1, false, true)}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                <span className="hidden md:inline">新建仓库</span>
                <span className="md:hidden">新建</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-foreground">创建新仓库</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1">
                  <Label className="text-sm font-normal text-foreground">仓库名称 *</Label>
                  <Input
                    value={newRepoName}
                    onChange={(e) => setNewRepoName(e.target.value)}
                    placeholder="my-awesome-project"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-normal text-foreground">描述（可选）</Label>
                  <Textarea
                    value={newRepoDesc}
                    onChange={(e) => setNewRepoDesc(e.target.value)}
                    placeholder="项目简介..."
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none"
                    rows={2}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-normal text-foreground">私有仓库</Label>
                    <p className="text-xs text-muted-foreground">只有您有权访问此仓库</p>
                  </div>
                  <Switch checked={newRepoPrivate} onCheckedChange={setNewRepoPrivate} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-normal text-foreground">初始化 README</Label>
                    <p className="text-xs text-muted-foreground">自动创建 README 文件</p>
                  </div>
                  <Switch checked={newRepoAutoInit} onCheckedChange={setNewRepoAutoInit} />
                </div>
                {newRepoAutoInit && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-sm font-normal text-foreground">.gitignore 模板</Label>
                      <Select value={newRepoGitignore} onValueChange={setNewRepoGitignore}>
                        <SelectTrigger className="bg-secondary border-border text-foreground h-9">
                          <SelectValue placeholder="选择模板" />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border max-h-48">
                          <SelectItem value="none" className="text-foreground">无</SelectItem>
                          {gitignoreTemplates.map((t) => (
                            <SelectItem key={t} value={t} className="text-foreground">{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-sm font-normal text-foreground">许可证</Label>
                      <Select value={newRepoLicense} onValueChange={setNewRepoLicense}>
                        <SelectTrigger className="bg-secondary border-border text-foreground h-9">
                          <SelectValue placeholder="选择许可证" />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border max-h-48">
                          <SelectItem value="none" className="text-foreground">无</SelectItem>
                          {licenses.map((l) => (
                            <SelectItem key={l.key} value={l.key} className="text-foreground">{l.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1 border-border hover:bg-secondary"
                    onClick={() => setCreateDialogOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={handleCreateRepo}
                    disabled={creating || !newRepoName.trim()}
                  >
                    {creating ? '创建中...' : '创建仓库'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 筛选和搜索 */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索仓库..."
            className="pl-9 bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
            <SelectTrigger className="bg-secondary border-border text-foreground w-28 h-10">
              <Filter className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all" className="text-foreground">全部</SelectItem>
              <SelectItem value="owner" className="text-foreground">我的</SelectItem>
              <SelectItem value="public" className="text-foreground">公开</SelectItem>
              <SelectItem value="private" className="text-foreground">私有</SelectItem>
              <SelectItem value="member" className="text-foreground">参与的</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortField} onValueChange={(v) => setSortField(v as RepoSortField)}>
            <SelectTrigger className="bg-secondary border-border text-foreground w-28 h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="pushed" className="text-foreground">最近推送</SelectItem>
              <SelectItem value="updated" className="text-foreground">最近更新</SelectItem>
              <SelectItem value="created" className="text-foreground">创建时间</SelectItem>
              <SelectItem value="full_name" className="text-foreground">名称</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="border-border hover:bg-secondary h-10 w-10"
            onClick={() => setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc')}
          >
            {sortDirection === 'desc' ? <SortDesc className="w-4 h-4" /> : <SortAsc className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* 仓库列表 */}
      <div className="space-y-0 bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4">
                <Skeleton className="h-5 w-48 bg-muted mb-2" />
                <Skeleton className="h-4 w-full bg-muted mb-2" />
                <Skeleton className="h-4 w-32 bg-muted" />
              </div>
            ))}
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="py-16 text-center">
            <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">暂无仓库</p>
            <p className="text-muted-foreground text-sm mt-1">
              {searchQuery ? '没有找到匹配的仓库' : '创建您的第一个仓库'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredRepos.map((repo) => (
              <ContextMenu key={repo.id}>
                <ContextMenuTrigger asChild>
                  <div
                    role="button"
                    tabIndex={0}
                    className="w-full p-4 hover:bg-secondary/50 transition-colors text-left group cursor-pointer"
                    onClick={() => navigate(`/repos/${repo.full_name}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/repos/${repo.full_name}`); }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-accent group-hover:underline">
                            {repo.full_name}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-xs h-4 px-1.5 border-border text-muted-foreground"
                          >
                            {repo.private ? (
                              <><Lock className="w-2.5 h-2.5 mr-0.5" />私有</>
                            ) : (
                              <><Globe className="w-2.5 h-2.5 mr-0.5" />公开</>
                            )}
                          </Badge>
                          {repo.fork && (
                            <Badge variant="outline" className="text-xs h-4 px-1.5 border-border text-muted-foreground">
                              Fork
                            </Badge>
                          )}
                          {repo.archived && (
                            <Badge variant="outline" className="text-xs h-4 px-1.5 border-border text-muted-foreground">
                              已归档
                            </Badge>
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-sm text-muted-foreground mt-1 text-pretty line-clamp-2">
                            {repo.description}
                          </p>
                        )}
                        <div className="flex items-center gap-4 mt-2 flex-wrap">
                          {repo.language && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: getLanguageColor(repo.language) }}
                              />
                              {repo.language}
                            </span>
                          )}
                          {repo.stargazers_count > 0 && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Star className="w-3 h-3" />
                              {formatNumber(repo.stargazers_count)}
                            </span>
                          )}
                          {repo.forks_count > 0 && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <GitFork className="w-3 h-3" />
                              {formatNumber(repo.forks_count)}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(repo.pushed_at)}
                          </span>
                        </div>
                      </div>
                      {/* 右侧操作区：移动端三点菜单 + 桌面端右箭头 */}
                      <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                        <RepoCardDropdown repo={repo} onDeleteSuccess={() => { pageCache.invalidate('repos:'); loadRepos(1, false, true); }} />
                        <ChevronRight className="w-4 h-4 text-muted-foreground hidden md:block group-hover:text-foreground transition-colors" />
                      </div>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <RepoContextMenu repo={repo} onDeleteSuccess={() => { pageCache.invalidate('repos:'); loadRepos(1, false, true); }} />
              </ContextMenu>
            ))}
          </div>
        )}
      </div>

      {/* 加载更多 */}
      {hasNextPage && !loading && !searchQuery && (
        <div className="text-center">
          <Button
            variant="outline"
            className="border-border hover:bg-secondary"
            onClick={() => loadRepos(page + 1, true)}
            disabled={loadingMore}
          >
            {loadingMore ? '加载中...' : '加载更多'}
          </Button>
        </div>
      )}
    </div>
  );
}
