// 仓库 Fork 列表 —— 查看谁 Fork 了这个仓库

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  GitFork,
  Star,
  Clock,
  ChevronRight,
  Globe,
  Lock,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getRepoForks,
  formatRelativeTime,
  formatNumber,
  getLanguageColor,
} from '@/services/github';
import type { GitHubRepo } from '@/types/types';
import { toast } from 'sonner';

type ForkSort = 'newest' | 'oldest' | 'stargazers' | 'watchers';

export default function RepoForksPage() {
  const { owner, repo: repoName } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [forks, setForks] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<ForkSort>('newest');

  const loadForks = useCallback(async (p = 1, sortBy: ForkSort = 'newest', append = false) => {
    if (!owner || !repoName) return;
    if (p === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const data = await getRepoForks(owner, repoName, { per_page: 30, page: p, sort: sortBy });
      if (append) setForks((prev) => [...prev, ...data]);
      else setForks(data);
      setHasMore(data.length === 30);
      setPage(p);
    } catch {
      toast.error('加载 Fork 列表失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [owner, repoName]);

  useEffect(() => { loadForks(1, sort); }, [loadForks, sort]);

  const handleSortChange = (val: string) => {
    const newSort = val as ForkSort;
    setSort(newSort);
    loadForks(1, newSort);
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate('/repos')}>
          仓库
        </button>
        <ChevronRight className="w-3 h-3" />
        <button
          type="button"
          className="hover:text-accent transition-colors"
          onClick={() => navigate(`/repos/${owner}/${repoName}`)}
        >
          {owner}/{repoName}
        </button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Forks</span>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <GitFork className="w-5 h-5 text-primary" />
          Fork 列表
          {!loading && (
            <Badge variant="outline" className="text-xs border-border text-muted-foreground font-normal">
              {forks.length}{hasMore ? '+' : ''} 个
            </Badge>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={handleSortChange}>
            <SelectTrigger className="w-32 h-8 bg-secondary border-border text-foreground text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="newest">最新</SelectItem>
              <SelectItem value="oldest">最早</SelectItem>
              <SelectItem value="stargazers">Star 数</SelectItem>
              <SelectItem value="watchers">Watch 数</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="border border-border text-muted-foreground hover:bg-secondary h-8"
            onClick={() => loadForks(1, sort)}
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="p-4 flex gap-3 items-start">
                <Skeleton className="w-9 h-9 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3 bg-muted" />
                  <Skeleton className="h-3 w-2/3 bg-muted" />
                  <Skeleton className="h-3 w-1/4 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : forks.length === 0 ? (
          <div className="py-16 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">暂无 Fork</p>
            <p className="text-sm text-muted-foreground mt-1">
              还没有人 Fork 这个仓库
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {forks.map((fork) => {
              const forkOwner = fork.owner;
              return (
                <div
                  key={fork.id}
                  className="p-4 hover:bg-secondary/30 transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    {/* 头像 */}
                    <button
                      type="button"
                      onClick={() => navigate(`/repos/${fork.full_name}`)}
                      className="shrink-0"
                    >
                      <Avatar className="w-9 h-9 ring-1 ring-border">
                        <AvatarImage src={forkOwner?.avatar_url} alt={forkOwner?.login} />
                        <AvatarFallback className="bg-secondary text-xs">
                          {(forkOwner?.login || '?').substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </button>

                    {/* 仓库信息 */}
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left"
                      onClick={() => navigate(`/repos/${fork.full_name}`)}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        {fork.private
                          ? <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          : <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        }
                        <span className="text-sm font-semibold text-accent group-hover:underline truncate">
                          {fork.full_name}
                        </span>
                      </div>

                      {fork.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 text-pretty">
                          {fork.description}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {fork.language && (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: getLanguageColor(fork.language) }}
                            />
                            {fork.language}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Star className="w-3 h-3" />
                          {formatNumber(fork.stargazers_count)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <GitFork className="w-3 h-3" />
                          {formatNumber(fork.forks_count)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatRelativeTime(fork.updated_at)}
                        </span>
                      </div>
                    </button>
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
          onClick={() => loadForks(page + 1, sort, true)}
        >
          {loadingMore
            ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />加载中…</>
            : '加载更多'}
        </Button>
      )}
    </div>
  );
}
