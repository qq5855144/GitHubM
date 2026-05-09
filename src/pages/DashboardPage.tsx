// 首页仪表盘

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Star,
  GitFork,
  Users,
  Eye,
  Clock,
  TrendingUp,
  Activity,
  ExternalLink,
  Pin,
  Lock,
  Globe,
  Flame,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { getUserRepos, getUserEvents, formatRelativeTime, formatNumber, getLanguageColor } from '@/services/github';
import { gqlGetContributions, gqlGetPinnedRepos } from '@/services/github-graphql';
import type { GitHubRepo, GitHubEvent, ContributionCalendar, GQL_PinnedRepo } from '@/types/types';
import { toast } from 'sonner';

// 贡献等级 → 样式映射
function getContributionClass(level: string, count: number): string {
  if (count === 0) return 'bg-secondary';
  switch (level) {
    case 'FIRST_QUARTILE': return 'bg-primary/25';
    case 'SECOND_QUARTILE': return 'bg-primary/50';
    case 'THIRD_QUARTILE': return 'bg-primary/75';
    case 'FOURTH_QUARTILE': return 'bg-primary';
    default: return 'bg-secondary';
  }
}

/** 贡献热力图组件 */
function ContributionHeatmap({
  calendar,
  loading,
}: {
  calendar: ContributionCalendar | null;
  loading: boolean;
}) {
  const weekdayLabels = ['日', '', '二', '', '四', '', '六'];

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32 bg-muted" />
          <Skeleton className="h-4 w-20 bg-muted" />
        </div>
        <Skeleton className="h-28 w-full bg-muted rounded" />
      </div>
    );
  }

  if (!calendar) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm font-medium text-foreground flex items-center gap-2">
          <Flame className="w-4 h-4 text-primary" />
          贡献热力图
        </span>
        <Badge variant="outline" className="text-xs border-border text-muted-foreground">
          今年共 <span className="text-foreground font-semibold mx-1">{calendar.totalContributions.toLocaleString()}</span> 次贡献
        </Badge>
      </div>

      <TooltipProvider>
        <div className="w-full min-w-0 overflow-x-auto">
          <div className="inline-flex gap-1 min-w-max">
            {/* 周几标签列 */}
            <div className="flex flex-col gap-px pt-5">
              {weekdayLabels.map((label, i) => (
                <div key={i} className="h-3 flex items-center">
                  <span className="text-[9px] text-muted-foreground w-3 leading-none">{label}</span>
                </div>
              ))}
            </div>
            {/* 周数据列 */}
            {calendar.weeks.map((week, wi) => {
              // 月份标签：仅在该周为某月第一周时显示
              const firstDayDate = new Date(week.firstDay);
              const showMonth = wi === 0 || firstDayDate.getDate() <= 7;
              const monthName = showMonth
                ? firstDayDate.toLocaleDateString('zh-CN', { month: 'short' })
                : '';

              return (
                <div key={wi} className="flex flex-col gap-px">
                  {/* 月份标签 */}
                  <div className="h-4 flex items-end">
                    {showMonth && (
                      <span className="text-[9px] text-muted-foreground leading-none whitespace-nowrap">
                        {monthName}
                      </span>
                    )}
                  </div>
                  {/* 7天方块 */}
                  {Array.from({ length: 7 }).map((_, di) => {
                    const day = week.contributionDays.find((d) => d.weekday === di);
                    if (!day) return <div key={di} className="w-3 h-3 rounded-sm bg-transparent" />;
                    return (
                      <Tooltip key={di}>
                        <TooltipTrigger asChild>
                          <div
                            className={`w-3 h-3 rounded-sm cursor-default transition-opacity hover:opacity-80 ${getContributionClass(day.contributionLevel, day.contributionCount)}`}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="bg-popover border-border text-xs text-foreground">
                          {day.date}：{day.contributionCount > 0 ? `${day.contributionCount} 次贡献` : '无贡献'}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </TooltipProvider>

      {/* 图例 */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>少</span>
        {['bg-secondary', 'bg-primary/25', 'bg-primary/50', 'bg-primary/75', 'bg-primary'].map((cls, i) => (
          <div key={i} className={`w-3 h-3 rounded-sm ${cls}`} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}

/** Pinned 仓库卡片 */
function PinnedRepoCard({ repo }: { repo: GQL_PinnedRepo }) {
  const navigate = useNavigate();
  const [owner, name] = repo.nameWithOwner.split('/');
  return (
    <button
      type="button"
      className="w-full text-left bg-secondary/30 border border-border rounded-lg p-3 hover:bg-secondary/60 transition-colors group"
      onClick={() => navigate(`/repos/${repo.nameWithOwner}`)}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {repo.isPrivate
            ? <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
            : <Globe className="w-3 h-3 text-muted-foreground shrink-0" />}
          <span className="text-sm font-semibold text-accent group-hover:underline truncate">{name}</span>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{owner}</span>
      </div>
      {repo.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 text-pretty mb-2">{repo.description}</p>
      )}
      <div className="flex items-center gap-3">
        {repo.primaryLanguage && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: repo.primaryLanguage.color || '#8b949e' }}
            />
            {repo.primaryLanguage.name}
          </span>
        )}
        {repo.stargazerCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Star className="w-3 h-3" />{formatNumber(repo.stargazerCount)}
          </span>
        )}
        {repo.forkCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <GitFork className="w-3 h-3" />{formatNumber(repo.forkCount)}
          </span>
        )}
      </div>
    </button>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [events, setEvents] = useState<GitHubEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // GraphQL 数据
  const [calendar, setCalendar] = useState<ContributionCalendar | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [pinnedRepos, setPinnedRepos] = useState<GQL_PinnedRepo[]>([]);
  const [pinnedLoading, setPinnedLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const [reposResult, eventsResult] = await Promise.all([
          getUserRepos({ sort: 'pushed', per_page: 6, type: 'owner' }),
          getUserEvents(user.login, 1),
        ]);
        setRepos(reposResult.data);
        setEvents(eventsResult.slice(0, 15));
      } catch (err) {
        toast.error('加载仪表盘数据失败');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    // GraphQL：贡献热力图
    const loadCalendar = async () => {
      setCalendarLoading(true);
      try {
        const cal = await gqlGetContributions(user.login);
        setCalendar(cal);
      } catch {
        // 贡献图加载失败不影响其他功能
      } finally {
        setCalendarLoading(false);
      }
    };

    // GraphQL：Pinned 仓库
    const loadPinned = async () => {
      setPinnedLoading(true);
      try {
        const pinned = await gqlGetPinnedRepos(user.login);
        setPinnedRepos(pinned);
      } catch {
        // 静默失败
      } finally {
        setPinnedLoading(false);
      }
    };

    loadData();
    loadCalendar();
    loadPinned();
  }, [user]);

  const getEventDescription = (event: GitHubEvent): string => {
    const repoName = event.repo.name;
    switch (event.type) {
      case 'PushEvent': {
        const payload = event.payload as { commits?: unknown[] };
        const count = payload.commits?.length || 0;
        return `推送了 ${count} 个提交到 ${repoName}`;
      }
      case 'CreateEvent': {
        const payload = event.payload as { ref_type?: string; ref?: string };
        return `在 ${repoName} 创建了 ${payload.ref_type} ${payload.ref || ''}`;
      }
      case 'IssuesEvent': {
        const payload = event.payload as { action?: string; issue?: { title?: string } };
        return `${payload.action === 'opened' ? '创建了' : payload.action === 'closed' ? '关闭了' : '更新了'} Issue: ${payload.issue?.title || ''} (${repoName})`;
      }
      case 'PullRequestEvent': {
        const payload = event.payload as { action?: string; pull_request?: { title?: string } };
        return `${payload.action === 'opened' ? '创建了' : payload.action === 'closed' ? '关闭了' : '更新了'} PR: ${payload.pull_request?.title || ''} (${repoName})`;
      }
      case 'WatchEvent':
        return `标星了 ${repoName}`;
      case 'ForkEvent':
        return `Fork 了 ${repoName}`;
      case 'IssueCommentEvent':
        return `评论了 ${repoName} 的 Issue`;
      case 'PullRequestReviewEvent':
        return `审查了 ${repoName} 的 Pull Request`;
      default:
        return `在 ${repoName} 有新活动`;
    }
  };

  if (!user) return null;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      {/* 用户信息卡片 */}
      <div className="bg-card border border-border rounded-xl p-5">
        {/* 顶部：头像 + 核心信息 */}
        <div className="flex items-center gap-4">
          <Avatar className="w-16 h-16 shrink-0 ring-2 ring-border">
            <AvatarImage src={user.avatar_url} alt={user.login} />
            <AvatarFallback className="bg-secondary text-secondary-foreground text-xl font-bold">
              {user.login.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h1 className="text-lg font-bold text-foreground text-balance leading-tight">
                {user.name || user.login}
              </h1>
              <span className="text-sm text-muted-foreground truncate">@{user.login}</span>
            </div>
            {user.bio && (
              <p className="text-sm text-muted-foreground mt-1.5 text-pretty line-clamp-2">{user.bio}</p>
            )}
            {/* 位置 / 公司 / 博客 */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
              {user.company && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 shrink-0" />
                  {user.company}
                </span>
              )}
              {user.location && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 shrink-0" />
                  {user.location}
                </span>
              )}
              {user.blog && (
                <a
                  href={user.blog.startsWith('http') ? user.blog : `https://${user.blog}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[140px]">{user.blog}</span>
                </a>
              )}
            </div>
          </div>
        </div>
        {/* 底部：GitHub 主页按钮 */}
        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {user.twitter_username && (
              <span className="flex items-center gap-1">
                <span className="text-[10px] font-bold text-muted-foreground/80">𝕏</span>
                @{user.twitter_username}
              </span>
            )}
            <span>
              加入于 {new Date(user.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}
            </span>
          </div>
          <a
            href={user.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium
                       border border-border rounded-lg px-3 h-8
                       bg-background hover:bg-secondary transition-colors text-foreground"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            GitHub 主页
          </a>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: '公开仓库', value: user.public_repos, icon: BookOpen, color: 'text-primary', to: '/repos' },
          { label: '关注者', value: user.followers, icon: Users, color: 'text-accent', to: '/follow-list/followers' },
          { label: '正在关注', value: user.following, icon: Eye, color: 'text-chart-3', to: '/follow-list/following' },
          { label: '公开 Gist', value: user.public_gists, icon: TrendingUp, color: 'text-chart-4', to: '/gists' },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <button
              key={stat.label}
              type="button"
              className="text-left bg-card border border-border rounded-xl p-4 hover:border-primary/50 hover:bg-secondary/40 active:scale-[0.98] transition-all group"
              onClick={() => navigate(stat.to)}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${stat.color}`} />
                <span className="text-xs text-muted-foreground">{stat.label}</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{formatNumber(stat.value)}</p>
              <p className="text-xs text-muted-foreground mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                点击查看 →
              </p>
            </button>
          );
        })}
      </div>

      {/* 最近仓库 + 活动时间线 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 最近仓库 */}
        <Card className="bg-card border-border h-full flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold text-foreground">最近仓库</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="text-accent hover:bg-secondary text-xs h-7"
              onClick={() => navigate('/repos')}
            >
              查看全部
            </Button>
          </CardHeader>
          <CardContent className="flex-1 p-0">
            {loading ? (
              <div className="px-4 pb-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 bg-muted rounded-md" />
                ))}
              </div>
            ) : repos.length === 0 ? (
              <div className="px-4 pb-4 text-center text-muted-foreground text-sm py-8">
                暂无仓库
              </div>
            ) : (
              <div className="divide-y divide-border">
                {repos.map((repo) => (
                  <button
                    key={repo.id}
                    type="button"
                    className="w-full px-4 py-3 hover:bg-secondary/50 transition-colors text-left"
                    onClick={() => navigate(`/repos/${repo.full_name}`)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-accent truncate">{repo.name}</span>
                          {repo.private && (
                            <Badge variant="outline" className="text-xs border-border text-muted-foreground h-4 px-1">私有</Badge>
                          )}
                          {repo.fork && (
                            <GitFork className="w-3 h-3 text-muted-foreground shrink-0" />
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate text-pretty">{repo.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1">
                          {repo.language && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: getLanguageColor(repo.language) }}
                              />
                              {repo.language}
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Star className="w-3 h-3" />
                            {formatNumber(repo.stargazers_count)}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(repo.pushed_at)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 活动时间线 */}
        <Card className="bg-card border-border h-full flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              最近活动
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-y-auto max-h-[400px]">
            {loading ? (
              <div className="px-4 pb-4 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-10 bg-muted rounded-md" />
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="px-4 pb-4 text-center text-muted-foreground text-sm py-8">
                暂无活动记录
              </div>
            ) : (
              <div className="px-4 pb-4 space-y-0">
                {events.map((event, index) => (
                  <div key={event.id} className="flex gap-3 py-3 border-b border-border last:border-0">
                    <div className="w-1 shrink-0 relative">
                      <div className={`w-2 h-2 rounded-full bg-primary mt-1 -ml-0.5 ${index === 0 ? 'ring-2 ring-primary/20' : ''}`} />
                      {index < events.length - 1 && (
                        <div className="absolute top-3 left-0.5 w-px h-full bg-border" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground text-pretty">{getEventDescription(event)}</p>
                      <span className="text-xs text-muted-foreground mt-0.5 block">
                        {formatRelativeTime(event.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* GraphQL：贡献热力图 */}
      {(calendarLoading || calendar) && (
        <Card className="bg-card border-border">
          <CardContent className="p-4 md:p-6">
            <ContributionHeatmap calendar={calendar} loading={calendarLoading} />
          </CardContent>
        </Card>
      )}

      {/* GraphQL：Pinned 仓库 */}
      {(pinnedLoading || pinnedRepos.length > 0) && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Pin className="w-4 h-4 text-primary" />
              置顶仓库
              <Badge variant="outline" className="text-xs border-border text-muted-foreground font-normal">GraphQL</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pinnedLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-24 bg-muted rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {pinnedRepos.map((repo) => (
                  <PinnedRepoCard key={repo.id} repo={repo} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
