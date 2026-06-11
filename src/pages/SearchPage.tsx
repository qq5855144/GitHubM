// 全局搜索页

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  BookOpen,
  AlertCircle,
  Users,
  GitPullRequest,
  Star,
  GitFork,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Copy,
  Code2,
  Clock,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  searchRepositories,
  searchIssues,
  searchUsers,
  formatRelativeTime,
  formatNumber,
  getLanguageColor,
  starRepo,
  unstarRepo,
  checkStarred,
  forkRepo,
} from '@/services/github';
import type { GitHubRepo, GitHubIssue, GitHubUser } from '@/types/types';
import { toast } from 'sonner';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, copyToClipboard } from '@/lib/utils';
import i18n from "@/i18n";

// GitHub Search API 最多返回 1000 条结果
const PER_PAGE = 20;
const MAX_RESULTS = 1000;
const HISTORY_STORAGE_KEY = 'github_search_history';
const SORT_STORAGE_KEY    = 'github_search_sort';
const MAX_HISTORY = 12;

type SearchType = 'repositories' | 'issues' | 'users';
type SortOption  = 'best-match' | 'stars' | 'forks' | 'updated';

interface SortConfig { value: SortOption; label: string; apiSort?: string; apiOrder?: string }

const SORT_OPTIONS: SortConfig[] = [
  { value: 'best-match', label: i18n.t('最佳匹配') },
  { value: 'stars',      label: i18n.t('Stars 最多'),  apiSort: 'stars',   apiOrder: 'desc' },
  { value: 'forks',      label: i18n.t('Forks 最多'),  apiSort: 'forks',   apiOrder: 'desc' },
  { value: 'updated',    label: i18n.t('最近更新'),     apiSort: 'updated', apiOrder: 'desc' },
];

// 每种排序方式对应的图标
const SORT_ICONS: Record<SortOption, { icon: React.ElementType }> = {
  'best-match': { icon: Search  },
  'stars':      { icon: Star    },
  'forks':      { icon: GitFork },
  'updated':    { icon: Clock   },
};

// ── 搜索历史工具函数 ──────────────────────────────────────────────────────
function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
  } catch { return []; }
}

function saveHistory(query: string) {
  const prev = loadHistory().filter(q => q !== query);
  const next = [query, ...prev].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
}

function clearHistory() {
  localStorage.removeItem(HISTORY_STORAGE_KEY);
}

// 搜索结果仓库右键菜单
function SearchRepoContextMenu({ repo, children }: { repo: GitHubRepo; children: React.ReactNode }) {
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
    } catch { toast.error(i18n.t('操作失败')); }
  };

  const handleFork = async () => {
    try {
      toast.info(i18n.t('正在 Fork 仓库...'));
      await forkRepo(repo.owner.login, repo.name);
      toast.success(i18n.t('Fork 成功！'));
    } catch { toast.error(i18n.t('Fork 失败')); }
  };

  const handleCopyUrl = () => {
    copyToClipboard(repo.clone_url || repo.html_url);
    toast.success(i18n.t('仓库地址已复制'));
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="bg-popover border-border w-52">
        <ContextMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={(e) => { e.stopPropagation(); navigate(`/repos/${repo.full_name}`); }}>
          <BookOpen className="w-3.5 h-3.5 mr-2" />{i18n.t('查看仓库详情')}</ContextMenuItem>
        <ContextMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={(e) => { e.stopPropagation(); navigate(`/repos/${repo.full_name}/code`); }}>
          <Code2 className="w-3.5 h-3.5 mr-2" />{i18n.t('浏览代码')}</ContextMenuItem>
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
        <ContextMenuItem className="text-foreground cursor-pointer text-sm" asChild>
          <a href={repo.html_url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3.5 h-3.5 mr-2" />{i18n.t('在 GitHub 中打开')}</a>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // 从 URL 参数读取初始状态
  const initQuery = searchParams.get('q') || '';
  const initType  = (searchParams.get('type') as SearchType) || 'repositories';
  const initPage  = parseInt(searchParams.get('page') || '1', 10);

  const [query, setQuery]           = useState(initQuery);
  const [searchType, setSearchType] = useState<SearchType>(initType);
  const [loading, setLoading]       = useState(false);
  const [repos, setRepos]           = useState<GitHubRepo[]>([]);
  const [issues, setIssues]         = useState<GitHubIssue[]>([]);
  const [users, setUsers]           = useState<GitHubUser[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searched, setSearched]     = useState(false);
  const [currentPage, setCurrentPage] = useState(initPage);

  // 搜索历史
  const [history, setHistory]         = useState<string[]>(() => loadHistory());
  const [showHistory, setShowHistory] = useState(false);
  const inputRef                       = useRef<HTMLInputElement>(null);
  const historyRef                     = useRef<HTMLDivElement>(null);

  // 排序
  const [sortOption, setSortOption] = useState<SortOption>(() => {
    return (localStorage.getItem(SORT_STORAGE_KEY) as SortOption | null) || 'best-match';
  });

  const totalPages = Math.min(Math.ceil(totalCount / PER_PAGE), MAX_RESULTS / PER_PAGE);

  const handleSearch = useCallback(async (
    searchQuery: string,
    type: SearchType,
    page = 1,
    sort: SortOption = sortOption,
  ) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setSearched(true);
    setShowHistory(false);
    // 保存历史记录
    saveHistory(searchQuery.trim());
    setHistory(loadHistory());
    try {
      const sortCfg = SORT_OPTIONS.find(s => s.value === sort);
      const sortParam = sortCfg?.apiSort as 'stars' | 'forks' | 'updated' | undefined;
      const orderParam = sortCfg?.apiOrder as 'asc' | 'desc' | undefined;

      if (type === 'repositories') {
        const result = await searchRepositories(searchQuery, {
          per_page: PER_PAGE,
          page,
          ...(sortParam ? { sort: sortParam, order: orderParam } : {}),
        });
        setRepos(result.items);
        setTotalCount(result.total_count);
        setIssues([]);
        setUsers([]);
      } else if (type === 'issues') {
        const result = await searchIssues(searchQuery, { per_page: PER_PAGE, page });
        setIssues(result.items);
        setTotalCount(result.total_count);
        setRepos([]);
        setUsers([]);
      } else {
        const result = await searchUsers(searchQuery, { per_page: PER_PAGE, page });
        setUsers(result.items);
        setTotalCount(result.total_count);
        setRepos([]);
        setIssues([]);
      }
      setCurrentPage(page);
      // 同步 URL 参数，方便返回时恢复
      setSearchParams({ q: searchQuery, type, page: String(page) }, { replace: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast.error(i18n.t('搜索失败'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [setSearchParams, sortOption]);

  // 首次挂载：如果 URL 中已有搜索参数则自动恢复搜索结果
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (initQuery) {
      handleSearch(initQuery, initType, initPage);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 全局快捷键：/ 或 Ctrl+K 唤起搜索框 ──────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isInputActive =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setShowHistory(true);
        return;
      }
      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        inputRef.current?.focus();
        setShowHistory(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 点击历史面板外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        historyRef.current &&
        !historyRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch(query, searchType, 1);
    }
    if (e.key === 'Escape') {
      setShowHistory(false);
    }
  };

  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages || loading) return;
    handleSearch(query, searchType, page);
  };

  const handleSortChange = (newSort: SortOption) => {
    localStorage.setItem(SORT_STORAGE_KEY, newSort);
    setSortOption(newSort);
    if (searched && query.trim()) {
      handleSearch(query, searchType, 1, newSort);
    }
  };

  // 仅保留 handleSortChange，循环切换已由下拉菜单替代

  const handleClearHistory = () => {
    clearHistory();
    setHistory([]);
    toast.success(i18n.t('搜索历史已清除'));
  };

  const TABS: Array<{ type: SearchType; label: string; icon: typeof BookOpen }> = [
    { type: 'repositories', label: i18n.t('仓库'), icon: BookOpen },
    { type: 'issues', label: 'Issues & PRs', icon: AlertCircle },
    { type: 'users', label: i18n.t('用户'), icon: Users },
  ];

  // 生成页码按钮列表（最多显示 7 个）
  const getPageNumbers = (): (number | '...')[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | '...')[] = [];
    if (currentPage <= 4) {
      pages.push(1, 2, 3, 4, 5, '...', totalPages);
    } else if (currentPage >= totalPages - 3) {
      pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
    }
    return pages;
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-foreground">{i18n.t('全局搜索')}</h1>
        {/* 快捷键提示 */}
        <span className="text-xs text-muted-foreground hidden md:flex items-center gap-1.5">
          {i18n.t('按')}<kbd className="px-1.5 py-0.5 rounded border border-border bg-secondary text-xs font-mono">/</kbd>
          {i18n.t('或')}<kbd className="px-1.5 py-0.5 rounded border border-border bg-secondary text-xs font-mono">Ctrl K</kbd>
          {i18n.t('唤起搜索')}</span>
      </div>

      {/* 搜索框 */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          {/* 左侧图标：仓库搜索时为可点击的排序图标（下拉选择），其他类型为静态搜索图标 */}
          {searchType === 'repositories' ? (() => {
            const { icon: SortIcon } = SORT_ICONS[sortOption];
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={i18n.t('点击选择排序方式')}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-primary hover:bg-primary/10 transition-colors"
                  >
                    <SortIcon className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="bg-popover border-border w-36">
                  {SORT_OPTIONS.map(opt => {
                    const { icon: OptIcon } = SORT_ICONS[opt.value];
                    return (
                      <DropdownMenuItem
                        key={opt.value}
                        className={cn(
                          'cursor-pointer text-sm gap-2',
                          sortOption === opt.value
                            ? 'text-primary font-medium'
                            : 'text-foreground'
                        )}
                        onClick={() => handleSortChange(opt.value)}
                      >
                        <OptIcon className="w-3.5 h-3.5 shrink-0" />
                        {opt.label}
                        {sortOption === opt.value && (
                          <span className="ml-auto text-primary text-xs">✓</span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })() : (
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          )}
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setShowHistory(true)}
            placeholder={i18n.t('搜索 GitHub…')}
            className="pl-9 bg-secondary border-border text-foreground placeholder:text-muted-foreground text-base"
          />
          {/* 搜索历史下拉 */}
          {showHistory && history.length > 0 && (
            <div
              ref={historyRef}
              className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />{i18n.t('搜索历史')}</span>
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                >
                  {i18n.t('清除全部')}</button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {history.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-secondary/60 transition-colors text-left"
                    onMouseDown={(e) => {
                      // 防止 blur 先触发隐藏历史
                      e.preventDefault();
                      setQuery(item);
                      handleSearch(item, searchType, 1);
                    }}
                  >
                    <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{item}</span>
                    <X
                      className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = history.filter((_, i) => i !== idx);
                        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
                        setHistory(next);
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
          onClick={() => handleSearch(query, searchType, 1)}
          disabled={loading || !query.trim()}
        >
          {i18n.t('搜索')}</Button>
      </div>

      {/* 搜索类型选项卡 */}
      <div className="flex border-b border-border">
        {TABS.map(({ type, label, icon: Icon }) => (
          <button
            key={type}
            type="button"
            className={`flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-colors ${
              searchType === type
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => {
              setSearchType(type);
              setCurrentPage(1);
              if (query.trim()) handleSearch(query, type, 1);
            }}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* 结果数量 */}
      {searched && !loading && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-muted-foreground">
            {i18n.t('找到约')}<span className="text-foreground font-medium">{formatNumber(totalCount)}</span> {i18n.t('个结果')}{totalPages > 1 && (
              <span className="ml-2 text-muted-foreground">
                {i18n.t('· 第')}<span className="text-foreground font-medium">{currentPage}</span> / {totalPages} {i18n.t('页')}</span>
            )}
          </p>
        </div>
      )}

      {/* 搜索结果 */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-20 bg-muted rounded-lg" />
          ))}
        </div>
      ) : !searched ? (
        <div className="py-20 text-center">
          <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-foreground font-medium">{i18n.t('搜索 GitHub')}</p>
          <p className="text-muted-foreground text-sm mt-1">{i18n.t('输入关键词，按回车或点击搜索')}</p>
          <p className="text-muted-foreground text-xs mt-1">
            {i18n.t('快捷键：')}<kbd className="px-1 py-0.5 rounded border border-border bg-secondary font-mono">/</kbd>
            {' '}{i18n.t('或')}{' '}
            <kbd className="px-1 py-0.5 rounded border border-border bg-secondary font-mono">Ctrl K</kbd>
          </p>
        </div>
      ) : (
        <div className="space-y-0 bg-card border border-border rounded-lg overflow-hidden">
          {/* 仓库结果 */}
          {searchType === 'repositories' && (
            repos.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">{i18n.t('无搜索结果')}</div>
            ) : (
              repos.map((repo) => (
                <SearchRepoContextMenu key={repo.id} repo={repo}>
                  <button
                    type="button"
                    className="w-full p-4 hover:bg-secondary/50 transition-colors text-left border-b border-border last:border-0 group"
                    onClick={() => navigate(`/repos/${repo.full_name}`)}
                  >
                    <div className="flex items-start gap-3">
                      <BookOpen className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-accent group-hover:underline">
                          {repo.name}
                        </span>
                        {repo.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 text-pretty">{repo.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {repo.language && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getLanguageColor(repo.language) }} />
                              {repo.language}
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Star className="w-3 h-3" />{formatNumber(repo.stargazers_count)}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <GitFork className="w-3 h-3" />{formatNumber(repo.forks_count)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(repo.updated_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                </SearchRepoContextMenu>
              ))
            )
          )}

          {/* Issue 结果 */}
          {searchType === 'issues' && (
            issues.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">{i18n.t('无搜索结果')}</div>
            ) : (
              issues.map((issue) => (
                <div
                  key={issue.id}
                  className="p-4 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {issue.pull_request ? (
                      <GitPullRequest className="w-4 h-4 text-chart-4 mt-0.5 shrink-0" />
                    ) : issue.state === 'open' ? (
                      <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <a
                        href={issue.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-accent hover:underline text-balance"
                      >
                        {issue.title}
                      </a>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                        <span>{issue.user.login}</span>
                        <span>{formatRelativeTime(issue.created_at)}</span>
                        <span className="text-primary">{issue.state === 'open' ? i18n.t('开放') : i18n.t('已关闭')}</span>
                      </div>
                    </div>
                    {issue.labels.map((label) => (
                      <Badge
                        key={label.id}
                        variant="outline"
                        className="text-xs shrink-0 h-4 px-1.5"
                        style={{
                          borderColor: `#${label.color}50`,
                          backgroundColor: `#${label.color}15`,
                          color: `#${label.color}`,
                        }}
                      >
                        {label.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))
            )
          )}

          {/* 用户结果 */}
          {searchType === 'users' && (
            users.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">{i18n.t('无搜索结果')}</div>
            ) : (
              users.map((user) => (
                <a
                  key={user.id}
                  href={user.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-4 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors group"
                >
                  <Avatar className="w-10 h-10 shrink-0">
                    <AvatarImage src={user.avatar_url} />
                    <AvatarFallback className="bg-secondary text-sm">{user.login.substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-accent group-hover:underline">{user.login}</span>
                      {user.name && <span className="text-xs text-muted-foreground">{user.name}</span>}
                    </div>
                    {user.bio && <p className="text-xs text-muted-foreground mt-0.5 truncate">{user.bio}</p>}
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span>{formatNumber(user.followers)} {i18n.t('关注者')}</span>
                      <span>{user.public_repos} {i18n.t('个仓库')}</span>
                    </div>
                  </div>
                </a>
              ))
            )
          )}
        </div>
      )}

      {/* 分页控件 */}
      {searched && !loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 pt-2 pb-4 flex-wrap">
          {/* 上一页 */}
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 border border-border text-muted-foreground hover:bg-secondary disabled:opacity-40"
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1 || loading}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            {i18n.t('上一页')}</Button>

          {/* 页码 */}
          <div className="flex items-center gap-1">
            {getPageNumbers().map((p, idx) =>
              p === '...' ? (
                <span key={`ellipsis-${idx}`} className="w-9 h-9 flex items-center justify-center text-sm text-muted-foreground select-none">
                  ···
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  className={`w-9 h-9 rounded-md text-sm font-medium transition-colors ${
                    p === currentPage
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground border border-border'
                  }`}
                  onClick={() => goToPage(p as number)}
                  disabled={loading}
                >
                  {p}
                </button>
              )
            )}
          </div>

          {/* 下一页 */}
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-3 border border-border text-muted-foreground hover:bg-secondary disabled:opacity-40"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages || loading}
          >
            {i18n.t('下一页')}<ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
