// PR 列表页

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  GitPullRequest,
  GitMerge,
  XCircle,
  MessageSquare,
  ChevronRight,
  GitBranch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getPullRequests, formatRelativeTime } from '@/services/github';
import type { GitHubPullRequest, PrState } from '@/types/types';
import { toast } from 'sonner';
import { pageCache } from '@/lib/page-cache';

export default function PullsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [pulls, setPulls] = useState<GitHubPullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState<PrState>('open');
  const [sortField, setSortField] = useState<'created' | 'updated' | 'popularity' | 'long-running'>('created');

  const loadPulls = useCallback(async (pageNum = 1, append = false, force = false) => {
    if (!owner || !repo) return;
    if (pageNum === 1) setLoading(true);

    const cacheKey = `pulls:${owner}/${repo}:${stateFilter}:${sortField}:p1`;
    if (pageNum === 1 && !append && !force) {
      const cached = pageCache.get<{ pulls: GitHubPullRequest[]; hasNextPage: boolean }>(cacheKey);
      if (cached) {
        setPulls(cached.pulls);
        setHasNextPage(cached.hasNextPage);
        setPage(1);
        setLoading(false);
        return;
      }
    }

    try {
      const result = await getPullRequests(owner, repo, {
        state: stateFilter,
        sort: sortField,
        per_page: 30,
        page: pageNum,
      });
      if (append) {
        setPulls((prev) => [...prev, ...result.data]);
      } else {
        setPulls(result.data);
        pageCache.set(cacheKey, { pulls: result.data, hasNextPage: result.hasNextPage });
      }
      setHasNextPage(result.hasNextPage);
      setPage(pageNum);
    } catch (err) {
      toast.error('加载 PR 列表失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [owner, repo, stateFilter, sortField]);

  useEffect(() => {
    loadPulls(1);
  }, [loadPulls]);

  const getPrIcon = (pr: GitHubPullRequest) => {
    if (pr.merged_at || pr.merged) return <GitMerge className="w-4 h-4 text-chart-4 shrink-0" />;
    if (pr.state === 'closed') return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
    if (pr.draft) return <GitPullRequest className="w-4 h-4 text-muted-foreground shrink-0" />;
    return <GitPullRequest className="w-4 h-4 text-primary shrink-0" />;
  };

  const getPrStateBadge = (pr: GitHubPullRequest) => {
    if (pr.merged_at || pr.merged) {
      return <Badge variant="outline" className="text-xs border-chart-4/50 text-chart-4 bg-chart-4/10">已合并</Badge>;
    }
    if (pr.state === 'closed') {
      return <Badge variant="outline" className="text-xs border-destructive/50 text-destructive bg-destructive/10">已关闭</Badge>;
    }
    if (pr.draft) {
      return <Badge variant="outline" className="text-xs border-muted-foreground text-muted-foreground">草稿</Badge>;
    }
    return <Badge variant="outline" className="text-xs border-primary/50 text-primary bg-primary/10">开放</Badge>;
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate('/repos')}>仓库</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Pull Requests</span>
      </div>

      {/* 页头 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Pull Requests</h1>
      </div>

      {/* 筛选栏 */}
      <div className="flex gap-3 bg-card border border-border rounded-lg p-3">
        <div className="flex gap-2">
          {(['open', 'closed', 'all'] as PrState[]).map((state) => {
            const labels: Record<PrState, string> = { open: '开放', closed: '已关闭', all: '全部' };
            return (
              <button
                key={state}
                type="button"
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${stateFilter === state ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setStateFilter(state)}
              >
                {labels[state]}
              </button>
            );
          })}
        </div>
        <div className="ml-auto">
          <Select value={sortField} onValueChange={(v) => setSortField(v as typeof sortField)}>
            <SelectTrigger className="bg-secondary border-border text-foreground w-28 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="created" className="text-foreground">创建时间</SelectItem>
              <SelectItem value="updated" className="text-foreground">更新时间</SelectItem>
              <SelectItem value="popularity" className="text-foreground">热度</SelectItem>
              <SelectItem value="long-running" className="text-foreground">持续时间</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* PR 列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4">
                <Skeleton className="h-5 w-2/3 bg-muted mb-2" />
                <Skeleton className="h-4 w-1/2 bg-muted" />
              </div>
            ))}
          </div>
        ) : pulls.length === 0 ? (
          <div className="py-16 text-center">
            <GitPullRequest className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">暂无 Pull Request</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {pulls.map((pr) => (
              <button
                key={pr.id}
                type="button"
                className="w-full p-4 hover:bg-secondary/50 transition-colors text-left group"
                onClick={() => navigate(`/repos/${owner}/${repo}/pulls/${pr.number}`)}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{getPrIcon(pr)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground group-hover:text-accent transition-colors text-balance">
                        {pr.title}
                      </span>
                      {getPrStateBadge(pr)}
                      {pr.labels.map((label) => (
                        <Badge
                          key={label.id}
                          variant="outline"
                          className="text-xs h-4 px-1.5"
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
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        #{pr.number} · {formatRelativeTime(pr.created_at)} · {pr.user.login}
                      </span>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <GitBranch className="w-3 h-3" />
                        <code className="text-xs font-mono">{pr.head.ref}</code>
                        <span>→</span>
                        <code className="text-xs font-mono">{pr.base.ref}</code>
                      </div>
                      {pr.assignees.length > 0 && (
                        <div className="flex items-center gap-1">
                          {pr.assignees.slice(0, 3).map((a) => (
                            <Avatar key={a.id} className="w-4 h-4">
                              <AvatarImage src={a.avatar_url} />
                              <AvatarFallback className="text-xs">{a.login[0]}</AvatarFallback>
                            </Avatar>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {pr.comments > 0 && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <MessageSquare className="w-3.5 h-3.5" />
                      {pr.comments}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {hasNextPage && !loading && (
        <div className="text-center">
          <Button
            variant="outline"
            className="border-border hover:bg-secondary"
            onClick={() => loadPulls(page + 1, true)}
          >
            加载更多
          </Button>
        </div>
      )}
    </div>
  );
}
