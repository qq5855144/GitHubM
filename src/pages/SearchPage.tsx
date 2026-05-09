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

// GitHub Search API 最多返回 1000 条结果
const PER_PAGE = 20;
const MAX_RESULTS = 1000;

type SearchType = 'repositories' | 'issues' | 'users';

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
    } catch { toast.error('操作失败'); }
  };

  const handleFork = async () => {
    try {
      toast.info('正在 Fork 仓库...');
      await forkRepo(repo.owner.login, repo.name);
      toast.success('Fork 成功！');
    } catch { toast.error('Fork 失败'); }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(repo.clone_url || repo.html_url);
    toast.success('仓库地址已复制');
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
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
      </ContextMenuContent>
    </ContextMenu>
  );
}

export default function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // 从 URL 参数读取初始状态
  const initQuery = searchParams.get('q') || '';
  const initType = (searchParams.get('type') as SearchType) || 'repositories';
  const initPage = parseInt(searchParams.get('page') || '1', 10);

  const [query, setQuery] = useState(initQuery);
  const [searchType, setSearchType] = useState<SearchType>(initType);
  const [loading, setLoading] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [users, setUsers] = useState<GitHubUser[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searched, setSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(initPage);

  const totalPages = Math.min(Math.ceil(totalCount / PER_PAGE), MAX_RESULTS / PER_PAGE);

  const handleSearch = useCallback(async (searchQuery: string, type: SearchType, page = 1) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      if (type === 'repositories') {
        const result = await searchRepositories(searchQuery, { per_page: PER_PAGE, page });
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
      toast.error('搜索失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [setSearchParams]);

  // 首次挂载：如果 URL 中已有搜索参数则自动恢复搜索结果
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (initQuery) {
      handleSearch(initQuery, initType, initPage);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch(query, searchType, 1);
    }
  };

  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages || loading) return;
    handleSearch(query, searchType, page);
  };

  const TABS: Array<{ type: SearchType; label: string; icon: typeof BookOpen }> = [
    { type: 'repositories', label: '仓库', icon: BookOpen },
    { type: 'issues', label: 'Issues & PRs', icon: AlertCircle },
    { type: 'users', label: '用户', icon: Users },
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
      <h1 className="text-xl font-bold text-foreground">全局搜索</h1>

      {/* 搜索框 */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索 GitHub..."
            className="pl-9 bg-secondary border-border text-foreground placeholder:text-muted-foreground text-base"
            autoFocus={!initQuery}
          />
        </div>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
          onClick={() => handleSearch(query, searchType, 1)}
          disabled={loading || !query.trim()}
        >
          搜索
        </Button>
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

      {/* 结果数量与分页信息 */}
      {searched && !loading && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-muted-foreground">
            找到约 <span className="text-foreground font-medium">{formatNumber(totalCount)}</span> 个结果
            {totalPages > 1 && (
              <span className="ml-2 text-muted-foreground">
                · 第 <span className="text-foreground font-medium">{currentPage}</span> / {totalPages} 页
              </span>
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
          <p className="text-foreground font-medium">搜索 GitHub</p>
          <p className="text-muted-foreground text-sm mt-1">输入关键词，按回车或点击搜索</p>
        </div>
      ) : (
        <div className="space-y-0 bg-card border border-border rounded-lg overflow-hidden">
          {/* 仓库结果 */}
          {searchType === 'repositories' && (
            repos.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">无搜索结果</div>
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
                          {repo.full_name}
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
              <div className="py-12 text-center text-muted-foreground">无搜索结果</div>
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
                        <span className="text-primary">{issue.state === 'open' ? '开放' : '已关闭'}</span>
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
              <div className="py-12 text-center text-muted-foreground">无搜索结果</div>
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
                      <span>{formatNumber(user.followers)} 关注者</span>
                      <span>{user.public_repos} 个仓库</span>
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
            上一页
          </Button>

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
            下一页
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
