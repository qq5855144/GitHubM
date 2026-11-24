// PR 列表页

import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react';
import { Link, useLocation, useNavigationType, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  GitPullRequest,
  GitMerge,
  XCircle,
  MessageSquare,
  ChevronRight,
  GitBranch,
  Plus,
  ArrowRight,
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserLink } from '@/components/common/UserLink';
import { getPullRequests, formatRelativeTime } from '@/services/github';
import type { GitHubPullRequest, PrState } from '@/types/types';
import { pageCache } from '@/lib/page-cache';
import { useAuth } from '@/contexts/AuthContext';
import i18n from '@/i18n';

type PullSort = 'created' | 'updated' | 'popularity' | 'long-running';

interface PullListSnapshot {
  pulls: GitHubPullRequest[];
  hasNextPage: boolean;
  page: number;
}

export default function PullsPage() {
  const { owner = '', repo = '' } = useParams<{ owner: string; repo: string }>();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const state = params.get('state');
  const sort = params.get('sort');
  const stateFilter = state === 'closed' || state === 'all' ? state : 'open';
  const sortField = sort === 'updated' || sort === 'popularity' || sort === 'long-running' ? sort : 'created';
  const cacheKey = `pulls:${owner}/${repo}:${stateFilter}:${sortField}:${user?.id ?? user?.login ?? "guest"}`;
  return <PullList key={cacheKey} owner={owner} repo={repo} stateFilter={stateFilter} sortField={sortField} cacheKey={cacheKey} />;
}

function PullList({ owner, repo, stateFilter, sortField, cacheKey }: {
  owner: string;
  repo: string;
  stateFilter: PrState;
  sortField: PullSort;
  cacheKey: string;
}) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const fromList = pathname + search;
  const pullsPath = `/repos/${owner}/${repo}/pulls`;
  const navigationType = useNavigationType();
  const [params, setParams] = useSearchParams();
  const [snapshot, setSnapshot] = useState(() => pageCache.get<PullListSnapshot>(cacheKey, { allowExpired: navigationType === 'POP' }));
  const [loading, setLoading] = useState(!snapshot);
  const [error, setError] = useState('');
  const [numberQuery, setNumberQuery] = useState('');
  const requestId = useRef(0);
  const inFlight = useRef(false);
  const pulls = snapshot?.pulls ?? [];

  const loadPulls = useCallback(async (previous: PullListSnapshot | null) => {
    if (inFlight.current) return;
    const id = ++requestId.current;
    inFlight.current = true;
    const page = (previous?.page ?? 0) + 1;
    setLoading(true);
    setError('');
    try {
      const result = await getPullRequests(owner, repo, { state: stateFilter, sort: sortField, page });
      if (id !== requestId.current) return;
      const byId = new Map((previous?.pulls ?? []).map((pull) => [pull.id, pull]));
      for (const pull of result.data) byId.set(pull.id, pull);
      const next = { pulls: [...byId.values()], hasNextPage: result.hasNextPage, page };
      setSnapshot(next);
      pageCache.set(cacheKey, next);
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : i18n.t('加载 PR 列表失败'));
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        inFlight.current = false;
      }
    }
  }, [owner, repo, stateFilter, sortField, cacheKey]);

  useEffect(() => {
    if (!pageCache.get<PullListSnapshot>(cacheKey, { allowExpired: navigationType === 'POP' })) {
      void loadPulls(null);
    }
    return () => { requestId.current++; inFlight.current = false; };
  }, [cacheKey, loadPulls, navigationType]);

  const changeFilter = (key: 'state' | 'sort', value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next);
  };

  const pullNumber = numberQuery.trim().replace(/^#/, '');
  const canJump = /^[1-9]\d*$/.test(pullNumber) && Number.isSafeInteger(Number(pullNumber));
  const jumpToPull = (event: FormEvent) => {
    event.preventDefault();
    if (canJump) navigate(`${pullsPath}/${pullNumber}`, { state: { fromList } });
  };

  const getPrIcon = (pr: GitHubPullRequest) => {
    if (pr.merged_at || pr.merged) return <GitMerge className="w-4 h-4 text-chart-4 shrink-0" />;
    if (pr.state === 'closed') return <XCircle className="w-4 h-4 text-destructive shrink-0" />;
    if (pr.draft) return <GitPullRequest className="w-4 h-4 text-muted-foreground shrink-0" />;
    return <GitPullRequest className="w-4 h-4 text-primary shrink-0" />;
  };

  const getPrStateBadge = (pr: GitHubPullRequest) => {
    if (pr.merged_at || pr.merged) {
      return <Badge variant="outline" className="text-xs border-chart-4/50 text-chart-4 bg-chart-4/10">{i18n.t('已合并')}</Badge>;
    }
    if (pr.state === 'closed') {
      return <Badge variant="outline" className="text-xs border-destructive/50 text-destructive bg-destructive/10">{i18n.t('已关闭')}</Badge>;
    }
    if (pr.draft) {
      return <Badge variant="outline" className="text-xs border-muted-foreground text-muted-foreground">{i18n.t('草稿')}</Badge>;
    }
    return <Badge variant="outline" className="text-xs border-primary/50 text-primary bg-primary/10">{i18n.t('开放')}</Badge>;
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Pull Requests</span>
      </div>

      {/* 页头 */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-foreground">Pull Requests</h1>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0" onClick={() => navigate(`${pullsPath}/new`, { state: { fromList } })}>
          <Plus className="w-4 h-4 mr-1.5" />{i18n.t('新建 PR')}
        </Button>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2.5">
        <div className="flex shrink-0 items-center gap-1">
          {(['open', 'closed', 'all'] as PrState[]).map((state) => {
            const labels: Record<PrState, string> = { open: i18n.t('开放'), closed: i18n.t('已结束'), all: i18n.t('全部') };
            return (
              <button
                key={state}
                type="button"
                className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition-colors sm:text-sm ${stateFilter === state ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                aria-pressed={stateFilter === state}
                onClick={() => { if (stateFilter !== state) changeFilter('state', state); }}
              >
                {labels[state]}
              </button>
            );
          })}
        </div>
        <div className="ml-auto shrink-0">
          <Select value={sortField} onValueChange={(v) => changeFilter('sort', v)}>
            <SelectTrigger aria-label={i18n.t('排序')} className="h-8 w-[108px] whitespace-nowrap bg-secondary border-border text-xs text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="created" className="text-foreground">{i18n.t('创建时间')}</SelectItem>
              <SelectItem value="updated" className="text-foreground">{i18n.t('更新时间')}</SelectItem>
              <SelectItem value="popularity" className="text-foreground">{i18n.t('热度')}</SelectItem>
              <SelectItem value="long-running" className="text-foreground">{i18n.t('持续时间')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <form onSubmit={jumpToPull} className="flex items-center gap-2">
        <Input value={numberQuery} onChange={(event) => setNumberQuery(event.target.value)} inputMode="numeric" placeholder={i18n.t('输入 PR 编号，例如 #123')} aria-label={i18n.t('PR 编号')} className="min-w-0" />
        <Button type="submit" variant="outline" disabled={!canJump} className="shrink-0 gap-1.5"><ArrowRight className="h-4 w-4" />{i18n.t('打开 PR')}</Button>
      </form>

      {/* PR 列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading && !snapshot ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4">
                <Skeleton className="h-5 w-2/3 bg-muted mb-2" />
                <Skeleton className="h-4 w-1/2 bg-muted" />
              </div>
            ))}
          </div>
        ) : !snapshot && error ? (
          <div className="space-y-3 p-4 text-center" role="alert">
            <p className="break-words text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => loadPulls(null)}>{i18n.t('重试')}</Button>
          </div>
        ) : pulls.length === 0 ? (
          <div className="py-16 text-center">
            <GitPullRequest className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">{i18n.t('暂无 Pull Request')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {pulls.map((pr) => (
              <article key={pr.id} className="group relative p-4 transition-colors hover:bg-secondary/50">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{getPrIcon(pr)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <Link to={`${pullsPath}/${pr.number}`} state={{ fromList }} className="break-words text-sm font-medium text-foreground before:absolute before:inset-0 group-hover:text-accent">
                        {pr.title}
                      </Link>
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
                        #{pr.number} · {formatRelativeTime(pr.created_at)} · <UserLink login={pr.user.login} className="relative hover:text-accent hover:underline">{pr.user.login}</UserLink>
                      </span>
                      <div className="flex min-w-0 flex-wrap items-center gap-1 break-all text-xs text-muted-foreground">
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
              </article>
            ))}
          </div>
        )}
      </div>

      {snapshot?.hasNextPage && (
        <div className="space-y-2 text-center">
          {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
          <Button
            variant="outline"
            className="border-border hover:bg-secondary"
            onClick={() => loadPulls(snapshot)}
            disabled={loading}
          >
            {loading ? i18n.t('加载中...') : error ? i18n.t('重试') : i18n.t('加载更多')}</Button>
        </div>
      )}
    </div>
  );
}
