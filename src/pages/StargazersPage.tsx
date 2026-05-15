// 仓库收藏者列表页

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Star, ChevronRight, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getRepoStargazers, formatNumber } from '@/services/github';
import type { GitHubUser } from '@/types/types';
import { toast } from 'sonner';

export default function StargazersPage() {
  const { owner, repo: repoName } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();

  const [stargazers, setStargazers] = useState<GitHubUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);

  const PER_PAGE = 30;

  const loadStargazers = useCallback(async (p = 1, append = false) => {
    if (!owner || !repoName) return;
    if (p === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const data = await getRepoStargazers(owner, repoName, { per_page: PER_PAGE, page: p });
      if (append) setStargazers((prev) => [...prev, ...data]);
      else setStargazers(data);
      setHasMore(data.length === PER_PAGE);
      setPage(p);
    } catch {
      toast.error('加载收藏者列表失败');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [owner, repoName]);

  useEffect(() => { loadStargazers(1); }, [loadStargazers]);

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
        <span className="text-foreground">Stargazers</span>
      </div>

      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Star className="w-5 h-5 text-warning" />
          收藏者列表
          {!loading && (
            <Badge variant="outline" className="text-xs border-border text-muted-foreground font-normal">
              {formatNumber(stargazers.length)}{hasMore ? '+' : ''} 人
            </Badge>
          )}
        </h1>
        <Button
          variant="ghost"
          size="sm"
          className="border border-border text-muted-foreground hover:bg-secondary h-8"
          onClick={() => loadStargazers(1)}
          disabled={loading}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* 列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="w-9 h-9 rounded-full bg-muted shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-3.5 w-28 bg-muted" />
                  <Skeleton className="h-3 w-20 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : stargazers.length === 0 ? (
          <div className="py-16 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">暂无收藏者</p>
            <p className="text-sm text-muted-foreground mt-1">还没有人收藏这个仓库</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {stargazers.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors group"
              >
                {/* 头像 */}
                <button
                  type="button"
                  className="shrink-0"
                  onClick={() => window.open(user.html_url, '_blank', 'noopener,noreferrer')}
                >
                  <Avatar className="w-9 h-9 ring-1 ring-border">
                    <AvatarImage src={user.avatar_url} alt={user.login} />
                    <AvatarFallback className="bg-secondary text-xs font-semibold">
                      {user.login.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>

                {/* 用户信息 */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {user.name || user.login}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">@{user.login}</p>
                </div>

                {/* 查看 GitHub 主页 */}
                <a
                  href={user.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ExternalLink className="w-3 h-3" />
                    主页
                  </Button>
                </a>
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
          disabled={loadingMore}
          onClick={() => loadStargazers(page + 1, true)}
        >
          {loadingMore
            ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />加载中…</>
            : '加载更多'}
        </Button>
      )}
    </div>
  );
}
