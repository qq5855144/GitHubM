// 我的收藏 —— 用户 Star 过的仓库列表

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useNavigationType } from 'react-router-dom';
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
  getAllStarredRepos,
  unstarRepo,
  formatRelativeTime,
  formatNumber,
  getLanguageColor,
} from '@/services/github';
import { useAuth } from '@/contexts/AuthContext';
import type { GitHubRepo } from '@/types/types';
import { toast } from 'sonner';
import { pageCache } from '@/lib/page-cache';
import i18n from "@/i18n";

type SortKey = 'updated' | 'created' | 'stars' | 'name';

const PAGE_SIZE = 30;

interface StarredListView {
  visibleCount: number;
  search: string;
  sort: SortKey;
}

const DEFAULT_VIEW: StarredListView = { visibleCount: PAGE_SIZE, search: '', sort: 'updated' };

function toTime(value?: string): number {
  return value ? new Date(value).getTime() : 0;
}

function sortRepos(repos: GitHubRepo[], sort: SortKey): GitHubRepo[] {
  return [...repos].sort((a, b) => {
    let diff = 0;
    switch (sort) {
      case 'stars': diff = b.stargazers_count - a.stargazers_count; break;
      case 'name': diff = a.name.localeCompare(b.name); break;
      // 收藏时间：优先 starred_at（与 GitHub 网页一致），缺失时回退仓库创建时间
      case 'created': diff = toTime(b.starred_at || b.created_at) - toTime(a.starred_at || a.created_at); break;
      // 最近活跃 = 最后一次推送；GitHub 官方 /user/starred?sort=updated 就是按 pushed_at 排的
      case 'updated':
      default: diff = toTime(b.pushed_at || b.updated_at) - toTime(a.pushed_at || a.updated_at); break;
    }
    if (diff !== 0) return diff;
    // 时间戳相同（批量推送）时用 star 数、全名兜底，避免顺序抖动
    const byStars = b.stargazers_count - a.stargazers_count;
    if (byStars !== 0) return byStars;
    return a.full_name.localeCompare(b.full_name);
  });
}

export default function StarredPage() {
  const { user } = useAuth();
  return <StarredList key={user?.id} accountId={user?.id} />;
}

function StarredList({ accountId }: { accountId?: number }) {
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const cacheKey = `starred:${accountId}:all`;
  const viewKey = `starred-view:${accountId}`;
  const [allowExpired] = useState(() => navigationType === 'POP');
  const [cached] = useState(() => pageCache.get<GitHubRepo[]>(cacheKey, { allowExpired }));
  const [repos, setRepos] = useState(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState(() => pageCache.get<StarredListView>(viewKey) ?? DEFAULT_VIEW);
  const { visibleCount, search, sort } = view;
  const [unstarring, setUnstarring] = useState<number | null>(null);
  const requestRef = useRef<symbol>();

  useEffect(() => {
    pageCache.set(viewKey, view, Number.POSITIVE_INFINITY);
  }, [viewKey, view]);

  // 排序在本地做，必须拿到全量收藏；首页先回填，剩余页并发补齐。
  const loadStarred = useCallback(async (force = false) => {
    if (!force) {
      const snapshot = pageCache.get<GitHubRepo[]>(cacheKey, { allowExpired });
      if (snapshot) {
        setRepos(snapshot);
        setLoading(false);
        return;
      }
    }
    const request = Symbol();
    requestRef.current = request;
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await getAllStarredRepos('created', 'desc', (firstPage) => {
        if (requestRef.current !== request) return;
        setRepos(firstPage);
        setLoading(false);
      });
      if (requestRef.current !== request) return;
      setRepos(data);
      pageCache.set(cacheKey, data);
    } catch {
      if (requestRef.current === request) toast.error(i18n.t('加载收藏列表失败'));
    } finally {
      if (requestRef.current === request) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [allowExpired, cacheKey]);

  useEffect(() => {
    void loadStarred();
    return () => { requestRef.current = undefined; };
  }, [loadStarred]);

  const handleUnstar = async (repo: GitHubRepo) => {
    const [owner, name] = repo.full_name.split('/');
    setUnstarring(repo.id);
    try {
      await unstarRepo(owner, name);
      setRepos((prev) => {
        const updated = prev.filter((r) => r.id !== repo.id);
        pageCache.set(cacheKey, updated);
        return updated;
      });
      toast.success(`已取消收藏 ${repo.full_name}`);
    } catch {
      toast.error(i18n.t('取消收藏失败'));
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
  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 页头 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate('/')}>
          {i18n.t('首页')}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">{i18n.t('我的收藏')}</span>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Star className="w-5 h-5 text-primary fill-primary/30" />
          {i18n.t('我的收藏')}{!loading && (
            <Badge variant="outline" className="text-xs border-border text-muted-foreground font-normal">
              {repos.length} {i18n.t('个')}</Badge>
          )}
        </h1>
        <Button
          variant="ghost"
          size="sm"
          className="border border-border text-muted-foreground hover:bg-secondary h-8"
          onClick={() => loadStarred(true)}
          disabled={loading || refreshing}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
          {i18n.t('刷新')}</Button>
      </div>

      {/* 搜索 + 排序 */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setView({ ...view, search: e.target.value, visibleCount: PAGE_SIZE })}
            placeholder={i18n.t('搜索收藏的仓库…')}
            className="search-input pl-9 h-9 text-foreground placeholder:text-muted-foreground text-sm"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setView({ ...view, sort: v as SortKey, visibleCount: PAGE_SIZE })}>
          <SelectTrigger className="w-36 h-9 bg-secondary border-border text-foreground text-sm">
            <SortAsc className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            <SelectItem value="updated">{i18n.t('最近更新')}</SelectItem>
            <SelectItem value="created">{i18n.t('收藏时间')}</SelectItem>
            <SelectItem value="stars">{i18n.t('Star 数')}</SelectItem>
            <SelectItem value="name">{i18n.t('名称')}</SelectItem>
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
              {search.trim() ? i18n.t('没有匹配的收藏仓库') : i18n.t('还没有收藏任何仓库')}
            </p>
            <p className="text-sm text-muted-foreground mt-1 text-pretty max-w-xs mx-auto">
              {search.trim()
                ? i18n.t('换个关键词试试')
                : i18n.t('去搜索或浏览仓库，点击 Star 按钮即可收藏')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((repo) => (
              <div
                key={repo.id}
                role="button"
                tabIndex={0}
                className="px-4 py-3 hover:bg-secondary/30 transition-colors group cursor-pointer"
                onClick={() => navigate(`/repos/${repo.full_name}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/repos/${repo.full_name}`);
                  }
                }}
              >
                {/* 第一行：仓库名 + 取消收藏（右固定，尺寸随行） */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {repo.private
                      ? <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      : <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    }
                    <span className="text-sm font-semibold text-accent group-hover:underline truncate">
                      {repo.name}
                    </span>
                    {repo.fork && (
                      <Badge variant="outline" className="text-[10px] border-border text-muted-foreground h-4 px-1 shrink-0">Fork</Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-7 px-2 text-[11px] text-warning border border-warning/40 hover:bg-warning/10 hover:text-warning gap-1"
                    disabled={unstarring === repo.id}
                    onClick={(event) => { event.stopPropagation(); void handleUnstar(repo); }}
                    title={i18n.t('取消收藏')}
                  >
                    <Star className="w-3 h-3 fill-warning" />
                    {unstarring === repo.id ? i18n.t('处理中…') : i18n.t('已收藏')}
                  </Button>
                </div>

                {repo.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2 text-pretty">
                    {repo.description}
                  </p>
                )}

                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
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
                    {formatRelativeTime(repo.pushed_at || repo.updated_at)}
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
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 加载更多 */}
      {hasMore && !loading && (
        <Button
          variant="ghost"
          className="w-full border border-border text-muted-foreground hover:bg-secondary"
          onClick={() => setView(prev => ({ ...prev, visibleCount: prev.visibleCount + PAGE_SIZE }))}
        >
          {i18n.t('加载更多')}
        </Button>
      )}
    </div>
  );
}
