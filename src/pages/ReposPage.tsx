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
import {
  getUserRepos,
  formatRelativeTime,
  formatNumber,
  getLanguageColor,
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
import { copyToClipboard } from '@/lib/utils';
import i18n from "@/i18n";
import { useAuth } from '@/contexts/AuthContext';
import { isRepoOwner } from '@/lib/repoPermissions';

// 仓库右键上下文菜单
// ContextMenu 菜单内容（不含任何弹窗，只触发回调）
function RepoContextMenu({ repo, onDeleteRequest, onDeleteSuccess, canDelete }: {
  repo: GitHubRepo;
  onDeleteRequest: () => void;
  onDeleteSuccess: (name: string) => void;
  canDelete: boolean;
}) {
  const navigate = useNavigate();

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
      toast.error(i18n.t('操作失败'));
    }
  };

  const handleFork = async () => {
    try {
      toast.info(i18n.t('正在 Fork 仓库...'));
      await forkRepo(repo.owner.login, repo.name);
      toast.success(i18n.t('Fork 成功！'));
    } catch {
      toast.error(i18n.t('Fork 失败'));
    }
  };

  const handleCopyUrl = () => {
    copyToClipboard(repo.clone_url || repo.html_url);
    toast.success(i18n.t('仓库地址已复制'));
  };

  // 仅渲染菜单内容，AlertDialog 由外部（ContextMenu 树之外）负责渲染
  // 这样弹窗里的 pointer 事件不会通过 React fiber 冒泡回到 ContextMenuTrigger
  return (
    <ContextMenuContent className="bg-popover border-border w-52">
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={(e) => { e.stopPropagation(); navigate(`/repos/${repo.full_name}`); }}>
        <BookOpen className="w-3.5 h-3.5 mr-2" />{i18n.t('查看仓库详情')}</ContextMenuItem>
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={(e) => { e.stopPropagation(); navigate(`/repos/${repo.full_name}/code`); }}>
        <Code2 className="w-3.5 h-3.5 mr-2" />{i18n.t('浏览代码')}</ContextMenuItem>
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={(e) => { e.stopPropagation(); navigate(`/repos/${repo.full_name}/commits?branch=${encodeURIComponent(repo.default_branch)}`); }}>
        <GitBranch className="w-3.5 h-3.5 mr-2" />{i18n.t('查看提交记录')}</ContextMenuItem>
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={(e) => { e.stopPropagation(); navigate(`/repos/${repo.full_name}/issues`); }}>
        <AlertCircle className="w-3.5 h-3.5 mr-2" />{i18n.t('查看 Issues')}</ContextMenuItem>
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={(e) => { e.stopPropagation(); navigate(`/repos/${repo.full_name}/pulls`); }}>
        <GitPullRequest className="w-3.5 h-3.5 mr-2" />{i18n.t('查看 Pull Requests')}</ContextMenuItem>
      <ContextMenuSeparator className="bg-border" />
      <ContextMenuItem className="text-foreground cursor-pointer text-sm" onClick={(e) => { e.stopPropagation(); handleToggleStar(); }}>
        <Star className="w-3.5 h-3.5 mr-2" />{i18n.t('Star / 取消 Star')}</ContextMenuItem>
      <ContextMenuItem className="text-foreground cursor-pointer text-sm" onClick={(e) => { e.stopPropagation(); handleFork(); }}>
        <GitFork className="w-3.5 h-3.5 mr-2" />{i18n.t('Fork 仓库')}</ContextMenuItem>
      <ContextMenuSeparator className="bg-border" />
      <ContextMenuItem className="text-foreground cursor-pointer text-sm" onClick={(e) => { e.stopPropagation(); handleCopyUrl(); }}>
        <Copy className="w-3.5 h-3.5 mr-2" />{i18n.t('复制仓库地址')}</ContextMenuItem>
      {canDelete && (
        <>
          <ContextMenuSeparator className="bg-border" />
          <ContextMenuItem className="text-destructive cursor-pointer text-sm focus:text-destructive" onClick={onDeleteRequest}>
            <Trash2 className="w-3.5 h-3.5 mr-2" />{i18n.t('删除仓库')}</ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  );
}

// 删除确认弹窗：独立组件，在 ContextMenu 树之外渲染，彻底断开 React fiber 冒泡链路
function RepoDeleteDialog({ repo, open, onOpenChange, onDeleteSuccess }: {
  repo: GitHubRepo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleteSuccess: (name: string) => void;
}) {
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  // 弹窗关闭时重置输入
  const handleOpenChange = (v: boolean) => {
    if (!v) setConfirmName('');
    onOpenChange(v);
  };

  const handleDelete = async () => {
    if (!repo) return;
    if (confirmName !== repo.name) { toast.error(i18n.t('仓库名称不一致')); return; }
    setDeleting(true);
    try {
      await deleteRepo(repo.owner.login, repo.name);
      toast.success(`已删除仓库 ${repo.name}`);
      handleOpenChange(false);
      onDeleteSuccess(repo.name);
    } catch {
      toast.error(i18n.t('删除失败，请确认你有足够权限'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />{i18n.t('删除仓库')}</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground text-sm space-y-2">
            <span>{i18n.t('此操作将永久删除')}</span>
            <code className="font-mono text-foreground bg-secondary px-1.5 py-0.5 rounded text-xs">{repo?.full_name}</code>
            <span>{i18n.t('，包括所有代码、Issues、PR 等，且不可恢复。')}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="px-1 py-2 space-y-1.5">
          <Label className="text-sm font-normal text-foreground">
            {i18n.t('请输入仓库名称')}<code className="font-mono bg-secondary px-1 rounded text-xs">{repo?.name}</code> {i18n.t('确认删除')}</Label>
          <Input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={repo?.name ?? ''}
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-border hover:bg-secondary">{i18n.t('取消')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleDelete}
            disabled={deleting || confirmName !== (repo?.name ?? '')}
          >
            {deleting ? i18n.t('删除中...') : i18n.t('确认删除')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// 移动端仓库卡片下拉菜单（补全移动端的右键菜单功能）
function RepoCardDropdown({ repo, onDeleteRequest, onDeleteSuccess, canDelete }: { repo: GitHubRepo; onDeleteRequest: () => void; onDeleteSuccess: (name: string) => void; canDelete: boolean }) {
  const navigate = useNavigate();

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
    } catch { toast.error(i18n.t('操作失败')); }
  };

  const handleFork = async () => {
    try {
      toast.info(i18n.t('正在 Fork...'));
      await forkRepo(repo.owner.login, repo.name);
      toast.success(i18n.t('Fork 成功！'));
    } catch { toast.error(i18n.t('Fork 失败')); }
  };

  const handleCopyUrl = () => {
    copyToClipboard(repo.clone_url || repo.html_url);
    toast.success(i18n.t('仓库地址已复制'));
  };

  return (
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
          onClick={(e) => { e.stopPropagation(); navigate(`/repos/${repo.full_name}`); }}>
          <BookOpen className="w-3.5 h-3.5 mr-2" />{i18n.t('查看仓库详情')}</DropdownMenuItem>
        <DropdownMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={(e) => { e.stopPropagation(); navigate(`/repos/${repo.full_name}/code`); }}>
          <Code2 className="w-3.5 h-3.5 mr-2" />{i18n.t('浏览代码')}</DropdownMenuItem>
        <DropdownMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={(e) => { e.stopPropagation(); navigate(`/repos/${repo.full_name}/issues`); }}>
          <AlertCircle className="w-3.5 h-3.5 mr-2" />{i18n.t('查看 Issues')}</DropdownMenuItem>
        <DropdownMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={(e) => { e.stopPropagation(); navigate(`/repos/${repo.full_name}/pulls`); }}>
          <GitPullRequest className="w-3.5 h-3.5 mr-2" />{i18n.t('查看 Pull Requests')}</DropdownMenuItem>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem className="text-foreground cursor-pointer text-sm" onClick={(e) => { e.stopPropagation(); handleToggleStar(); }}>
          <Star className="w-3.5 h-3.5 mr-2" />{i18n.t('Star / 取消 Star')}</DropdownMenuItem>
        <DropdownMenuItem className="text-foreground cursor-pointer text-sm" onClick={(e) => { e.stopPropagation(); handleFork(); }}>
          <GitFork className="w-3.5 h-3.5 mr-2" />{i18n.t('Fork 仓库')}</DropdownMenuItem>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem className="text-foreground cursor-pointer text-sm" onClick={(e) => { e.stopPropagation(); handleCopyUrl(); }}>
          <Copy className="w-3.5 h-3.5 mr-2" />{i18n.t('复制仓库地址')}</DropdownMenuItem>
        {canDelete && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem className="text-destructive cursor-pointer text-sm focus:text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteRequest(); }}>
              <Trash2 className="w-3.5 h-3.5 mr-2" />{i18n.t('删除仓库')}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function ReposPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
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

  // 删除弹窗状态：在 ContextMenu 树之外统一管理，避免 React Portal 事件冒泡触发 ContextMenu
  const [deleteTarget, setDeleteTarget] = useState<GitHubRepo | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

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
      toast.error(i18n.t('加载仓库列表失败'));
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sortField, sortDirection, typeFilter]);

  useEffect(() => {
    loadRepos(1, false);
  }, [loadRepos]);

  const filteredRepos = repos.filter((repo) =>
    debouncedSearch
      ? repo.name.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (repo.description || '').toLowerCase().includes(debouncedSearch.toLowerCase())
      : true
  );

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 页头 */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">{i18n.t('仓库')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{i18n.t('管理您的 GitHub 仓库')}</p>
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
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => navigate('/repos/new')}>
              <Plus className="w-4 h-4 mr-2" />
              <span className="hidden md:inline">{i18n.t('新建仓库')}</span>
              <span className="md:hidden">{i18n.t('新建')}</span>
            </Button>
        </div>
      </div>

      {/* 筛选和搜索 */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={i18n.t('搜索仓库...')}
            className="search-input pl-9 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
            <SelectTrigger className="bg-secondary border-border text-foreground w-28 h-10">
              <Filter className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="all" className="text-foreground">{i18n.t('全部')}</SelectItem>
              <SelectItem value="owner" className="text-foreground">{i18n.t('我的')}</SelectItem>
              <SelectItem value="public" className="text-foreground">{i18n.t('公开')}</SelectItem>
              <SelectItem value="private" className="text-foreground">{i18n.t('私有')}</SelectItem>
              <SelectItem value="member" className="text-foreground">{i18n.t('参与的')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortField} onValueChange={(v) => setSortField(v as RepoSortField)}>
            <SelectTrigger className="bg-secondary border-border text-foreground w-28 h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="pushed" className="text-foreground">{i18n.t('最近推送')}</SelectItem>
              <SelectItem value="updated" className="text-foreground">{i18n.t('最近更新')}</SelectItem>
              <SelectItem value="created" className="text-foreground">{i18n.t('创建时间')}</SelectItem>
              <SelectItem value="full_name" className="text-foreground">{i18n.t('名称')}</SelectItem>
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

      {/* 仓库列表：卡片式布局（对齐用户主页仓库列表） */}
      <div className="space-y-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4">
                <Skeleton className="h-5 w-48 bg-muted mb-2" />
                <Skeleton className="h-4 w-full bg-muted mb-2" />
                <Skeleton className="h-4 w-32 bg-muted" />
              </div>
            ))}
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="bg-card border border-border rounded-xl py-16 text-center">
            <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">{i18n.t('暂无仓库')}</p>
            <p className="text-muted-foreground text-sm mt-1">
              {searchQuery ? i18n.t('没有找到匹配的仓库') : i18n.t('创建您的第一个仓库')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRepos.map((repo) => (
              <ContextMenu key={repo.id}>
                <ContextMenuTrigger asChild>
                  <div
                    role="button"
                    tabIndex={0}
                    className="w-full bg-card border border-border rounded-xl p-4 hover:bg-secondary/30 active:scale-[0.99] transition-all text-left group cursor-pointer"
                    onClick={() => navigate(`/repos/${repo.full_name}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/repos/${repo.full_name}`); }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm font-semibold text-accent group-hover:underline">
                            {repo.name}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-xs h-4 px-1.5 border-border text-muted-foreground"
                          >
                            {repo.private ? (
                              <><Lock className="w-2.5 h-2.5 mr-0.5" />{i18n.t('私有')}</>
                            ) : (
                              <><Globe className="w-2.5 h-2.5 mr-0.5" />{i18n.t('公开')}</>
                            )}
                          </Badge>
                          {repo.fork && (
                            <Badge variant="outline" className="text-xs h-4 px-1.5 border-border text-muted-foreground">
                              Fork
                            </Badge>
                          )}
                          {repo.archived && (
                            <Badge variant="outline" className="text-xs h-4 px-1.5 border-border text-muted-foreground">
                              {i18n.t('已归档')}</Badge>
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-sm text-muted-foreground mt-1 text-pretty line-clamp-2">
                            {repo.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-3 flex-wrap">
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
                        <RepoCardDropdown
                          repo={repo}
                          canDelete={isRepoOwner(repo.owner.login, user?.login)}
                          onDeleteRequest={() => {
                            // 移动端删除弹窗也统一在 ContextMenu 树之外渲染，避免 React Portal 事件冒泡
                            setDeleteTarget(repo);
                            setDeleteDialogOpen(true);
                          }}
                          onDeleteSuccess={(name) => {
                            // 立即从列表中移除（乐观更新），无需等待 API 响应
                            setRepos(prev => prev.filter(r => r.name !== name));
                            pageCache.invalidate('repos:');
                            // 异步静默刷新，同步最终数据（时间戳绕过 GitHub CDN 60s 缓存）
                            loadRepos(1, false, true);
                          }}
                        />
                        <ChevronRight className="w-4 h-4 text-muted-foreground hidden md:block group-hover:text-foreground transition-colors" />
                      </div>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <RepoContextMenu
                  repo={repo}
                          canDelete={isRepoOwner(repo.owner.login, user?.login)}
                  onDeleteRequest={() => {
                    // 只设置目标，弹窗在 ContextMenu 树之外渲染
                    setDeleteTarget(repo);
                    setDeleteDialogOpen(true);
                  }}
                  onDeleteSuccess={(name) => {
                    setRepos(prev => prev.filter(r => r.name !== name));
                    pageCache.invalidate('repos:');
                    loadRepos(1, false, true);
                  }}
                />
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
            {loadingMore ? i18n.t('加载中...') : i18n.t('加载更多')}
          </Button>
        </div>
      )}

      {/* 删除确认弹窗：渲染在 ContextMenu 组件树之外，切断 React Portal 事件冒泡路径
          避免弹窗内长按事件通过 fiber 树冒泡回到 ContextMenuTrigger，重新触发右键菜单 */}
      <RepoDeleteDialog
        repo={deleteTarget}
        open={deleteDialogOpen}
        onOpenChange={(v) => {
          setDeleteDialogOpen(v);
          if (!v) setDeleteTarget(null);
        }}
        onDeleteSuccess={(name) => {
          setRepos(prev => prev.filter(r => r.name !== name));
          pageCache.invalidate('repos:');
          loadRepos(1, false, true);
        }}
      />
    </div>
  );
}
