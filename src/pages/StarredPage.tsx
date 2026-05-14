// 我的收藏 —— 用户 Star 过的仓库列表

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Star,
  GitFork,
  Clock,
  Search,
  RefreshCw,
  Globe,
  Lock,
  ChevronRight,
  Bookmark,
  SortAsc,
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
  getStarredRepos,
  unstarRepo,
  formatRelativeTime,
  formatNumber,
  getLanguageColor,
} from '@/services/github';
import type { GitHubRepo } from '@/types/types';
import { toast } from 'sonner';
import { pageCache } from '@/lib/page-cache';

type SortKey = 'updated' | 'created' | 'stars' | 'name';

function sortRepos(repos: GitHubRepo[], sort: SortKey): GitHubRepo[] {
  return [...repos].sort((a, b) => {
    switch (sort) {
      case 'stars': return b.stargazers_count - a.stargazers_count;
      case 'name': return a.name.localeCompare(b.name);
      case 'created': return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'updated':
      default: return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    }
  });
}

export default function StarredPage() {
  const navigate = useNavigate();
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [unstarring, setUnstarring] = useState<number | null>(null);

  const CACHE_KEY = 'starred:p1';

  const loadStarred = useCallback(async (p = 1, append = false, force = false) => {
    if (p === 1) setLoading(true);
    else setLoadingMore(true);

    // 第一页且非追加时走缓存（强制刷新跳过）
    if (p === 1 && !append && !force) {
      const cached = pageCache.get<{ repos: GitHubRepo[]; hasMore: boolean }>(CACHE_KEY);
      if (cached) {
        setRepos(cached.repos);
        setHasMore(cached.hasMore);
        setPage(1);
        setLoading(false);
        return;
      }
    }

    try {
      const data = await getStarredRepos({ per_page: 30, page: p });
      if (append) setRepos((prev) => [...prev, ...data]);
      else {
        setRepos(data);
        pageCache.set(CACHE_KEY, { repos: data, hasMore: data.length === 30 });
      }
      setHasMore(data.length === 30);
      setPage(p);
    } catch {
      toast.error('加载收藏列表失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { loadStarred(1); }, [loadStarred]);

  const handleUnstar = async (repo: GitHubRepo) => {
    const [owner, name] = repo.full_name.split('/');
    setUnstarring(repo.id);
    try {
      await unstarRepo(owner, name);
      setRepos((prev) => {
        const updated = prev.filter((r) => r.id !== repo.id);
        pageCache.set(CACHE_KEY, { repos: updated, hasMore: hasMore });
        return updated;
      });
      toast.success(`已取消收藏 ${repo.full_name}`);
    } catch {
      toast.error('取消收藏失败');
    } finally {
      setUnstarring(null);
    }
  };

  const filtered = sortRepos(
    repos.filter((r) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        r.full_name.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.language || '').toLowerCase().includes(q)
      );
    }),
    sort
  );

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 页头 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate('/')}>
          首页
        </button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">我的收藏</span>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Star className="w-5 h-5 text-primary fill-primary/30" />
          我的收藏
          {!loading && (
            <Badge variant="outline" className="text-xs border-border text-muted-foreground font-normal">
              {repos.length}{hasMore ? '+' : ''} 个
            </Badge>
          )}
        </h1>
        <Button
          variant="ghost"
          size="sm"
          className="border border-border text-muted-foreground hover:bg-secondary h-8"
          onClick={() => loadStarred(1, false, true)}
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* 搜索 + 排序 */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索收藏的仓库…"
            className="pl-9 h-9 bg-secondary border-border text-foreground placeholder:text-muted-foreground text-sm"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-36 h-9 bg-secondary border-border text-foreground text-sm">
            <SortAsc className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            <SelectItem value="updated">最近更新</SelectItem>
            <SelectItem value="created">收藏时间</SelectItem>
            <SelectItem value="stars">Star 数</SelectItem>
            <SelectItem value="name">名称</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4 flex gap-3">
                <Skeleton className="w-8 h-8 rounded bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3 bg-muted" />
                  <Skeleton className="h-3 w-2/3 bg-muted" />
                  <Skeleton className="h-3 w-1/4 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Bookmark className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">
              {search.trim() ? '没有匹配的收藏仓库' : '还没有收藏任何仓库'}
            </p>
            <p className="text-sm text-muted-foreground mt-1 text-pretty max-w-xs mx-auto">
              {search.trim()
                ? '换个关键词试试'
                : '去搜索或浏览仓库，点击 Star 按钮即可收藏'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((repo) => {
              const [repoOwner] = repo.full_name.split('/');
              return (
                <div
                  key={repo.id}
                  className="p-4 hover:bg-secondary/30 transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    {/* 仓库信息 */}
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left"
                      onClick={() => navigate(`/repos/${repo.full_name}`)}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        {repo.private
                          ? <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          : <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        }
                        <span className="text-sm font-semibold text-accent group-hover:underline truncate">
                          {repoOwner !== '' && <span className="text-muted-foreground font-normal">{repoOwner}/</span>}
                          {repo.name}
                        </span>
                        {repo.fork && (
                          <Badge variant="outline" className="text-xs border-border text-muted-foreground h-4 px-1">Fork</Badge>
                        )}
                      </div>

                      {repo.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 text-pretty">
                          {repo.description}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {repo.language && (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: getLanguageColor(repo.language) }}
                            />
                            {repo.language}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Star className="w-3 h-3" />
                          {formatNumber(repo.stargazers_count)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <GitFork className="w-3 h-3" />
                          {formatNumber(repo.forks_count)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatRelativeTime(repo.updated_at)}
                        </span>
                        {repo.topics && repo.topics.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {repo.topics.slice(0, 3).map((topic) => (
                              <span
                                key={topic}
                                className="text-xs bg-accent/10 text-accent border border-accent/20 px-1.5 py-0.5 rounded"
                              >
                                {topic}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>

                    {/* 取消收藏按钮 */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-8 text-xs text-warning border border-warning/40 hover:bg-warning/10 hover:text-warning"
                      disabled={unstarring === repo.id}
                      onClick={() => handleUnstar(repo)}
                      title="取消收藏"
                    >
                      <Star className="w-3.5 h-3.5 mr-1 fill-warning" />
                      {unstarring === repo.id ? '处理中…' : '已收藏'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 加载更多 */}
      {hasMore && !loading && (
        <Button
          variant="ghost"
          className="w-full border border-border text-muted-foreground hover:bg-secondary"
          disabled={loadingMore}
          onClick={() => loadStarred(page + 1, true)}
        >
          {loadingMore ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />加载中…</> : '加载更多'}
        </Button>
      )}
    </div>
  );
}
