// 活动页 - 展示用户的 GitHub 活动

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getUserEvents, formatRelativeTime } from '@/services/github';
import type { GitHubEvent } from '@/types/types';
import { toast } from 'sonner';

function getEventTypeInfo(type: string): { label: string; color: string } {
  const types: Record<string, { label: string; color: string }> = {
    PushEvent: { label: '推送', color: 'bg-primary/10 text-primary border-primary/30' },
    CreateEvent: { label: '创建', color: 'bg-success/10 text-success border-success/30' },
    DeleteEvent: { label: '删除', color: 'bg-destructive/10 text-destructive border-destructive/30' },
    IssuesEvent: { label: 'Issue', color: 'bg-warning/10 text-warning border-warning/30' },
    PullRequestEvent: { label: 'Pull Request', color: 'bg-chart-4/10 text-chart-4 border-chart-4/30' },
    WatchEvent: { label: '收藏', color: 'bg-warning/10 text-warning border-warning/30' },
    ForkEvent: { label: 'Fork', color: 'bg-accent/10 text-accent border-accent/30' },
    IssueCommentEvent: { label: '评论', color: 'bg-secondary text-muted-foreground border-border' },
    PullRequestReviewEvent: { label: '审查', color: 'bg-chart-3/10 text-chart-3 border-chart-3/30' },
    ReleaseEvent: { label: '发布', color: 'bg-primary/10 text-primary border-primary/30' },
    PublicEvent: { label: '开源', color: 'bg-success/10 text-success border-success/30' },
    MemberEvent: { label: '成员', color: 'bg-accent/10 text-accent border-accent/30' },
  };
  return types[type] || { label: type.replace('Event', ''), color: 'bg-secondary text-muted-foreground border-border' };
}

function getEventDescription(event: GitHubEvent): string {
  const repo = event.repo.name;
  switch (event.type) {
    case 'PushEvent': {
      const payload = event.payload as { commits?: unknown[] };
      return `推送了 ${payload.commits?.length || 0} 个提交到 ${repo}`;
    }
    case 'CreateEvent': {
      const payload = event.payload as { ref_type?: string; ref?: string; description?: string };
      if (payload.ref_type === 'repository') return `创建了仓库 ${repo}`;
      return `在 ${repo} 创建了 ${payload.ref_type} "${payload.ref}"`;
    }
    case 'DeleteEvent': {
      const payload = event.payload as { ref_type?: string; ref?: string };
      return `在 ${repo} 删除了 ${payload.ref_type} "${payload.ref}"`;
    }
    case 'IssuesEvent': {
      const payload = event.payload as { action?: string; issue?: { title?: string; number?: number } };
      const actionMap: Record<string, string> = { opened: '创建了', closed: '关闭了', reopened: '重新打开了' };
      return `${actionMap[payload.action || ''] || payload.action} Issue #${payload.issue?.number}: ${payload.issue?.title} (${repo})`;
    }
    case 'PullRequestEvent': {
      const payload = event.payload as { action?: string; pull_request?: { title?: string; number?: number } };
      const actionMap: Record<string, string> = { opened: '创建了', closed: '关闭了', merged: '合并了', reopened: '重新打开了' };
      return `${actionMap[payload.action || ''] || payload.action} PR #${payload.pull_request?.number}: ${payload.pull_request?.title} (${repo})`;
    }
    case 'WatchEvent':
      return `给 ${repo} 点了 Star`;
    case 'ForkEvent': {
      const payload = event.payload as { forkee?: { full_name?: string } };
      return `Fork 了 ${repo}${payload.forkee ? ` → ${payload.forkee.full_name}` : ''}`;
    }
    case 'IssueCommentEvent': {
      const payload = event.payload as { action?: string; issue?: { number?: number } };
      return `在 ${repo} Issue #${payload.issue?.number} 发表了评论`;
    }
    case 'ReleaseEvent': {
      const payload = event.payload as { action?: string; release?: { name?: string; tag_name?: string } };
      return `在 ${repo} 发布了 ${payload.release?.name || payload.release?.tag_name}`;
    }
    case 'PublicEvent':
      return `将 ${repo} 设为了公开仓库`;
    default:
      return `在 ${repo} 执行了 ${event.type.replace('Event', '')} 操作`;
  }
}

export default function ActivityPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<GitHubEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  /** 根据事件类型计算应用内跳转路由 */
  const getEventRoute = (event: GitHubEvent): string => {
    const repoName = event.repo.name; // owner/repo 格式
    const payload = event.payload as Record<string, unknown>;
    switch (event.type) {
      case 'IssuesEvent': {
        const issue = payload.issue as { number?: number } | undefined;
        return issue?.number
          ? `/repos/${repoName}/issues/${issue.number}`
          : `/repos/${repoName}/issues`;
      }
      case 'PullRequestEvent': {
        const pr = payload.pull_request as { number?: number } | undefined;
        return pr?.number
          ? `/repos/${repoName}/pulls/${pr.number}`
          : `/repos/${repoName}/pulls`;
      }
      case 'IssueCommentEvent': {
        const issue = payload.issue as { number?: number } | undefined;
        return issue?.number
          ? `/repos/${repoName}/issues/${issue.number}`
          : `/repos/${repoName}/issues`;
      }
      case 'PullRequestReviewEvent': {
        const pr = payload.pull_request as { number?: number } | undefined;
        return pr?.number
          ? `/repos/${repoName}/pulls/${pr.number}`
          : `/repos/${repoName}/pulls`;
      }
      case 'PushEvent':
        return `/repos/${repoName}/commits/${repoName.split('/')[1]}`;
      case 'ReleaseEvent':
        return `/repos/${repoName}/artifacts`;
      case 'CreateEvent':
      case 'DeleteEvent':
      case 'WatchEvent':
      case 'ForkEvent':
      case 'PublicEvent':
      case 'MemberEvent':
      default:
        return `/repos/${repoName}`;
    }
  };

  const loadEvents = async (pageNum = 1, append = false) => {
    if (!user) return;
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const data = await getUserEvents(user.login, pageNum);
      if (append) {
        setEvents((prev) => [...prev, ...data]);
      } else {
        setEvents(data);
      }
      setPage(pageNum);
    } catch (err) {
      toast.error('加载活动记录失败');
      console.error(err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadEvents(1);
  }, [user]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
        <Activity className="w-5 h-5 text-primary" />
        最近活动
      </h1>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-start gap-3 p-4 bg-card border border-border rounded-lg">
              <Skeleton className="w-8 h-8 rounded-full bg-muted shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-4 w-2/3 bg-muted mb-2" />
                <Skeleton className="h-3 w-1/3 bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="py-16 text-center">
          <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">暂无活动记录</p>
        </div>
      ) : (
        <div className="relative">
          {/* 时间线竖线 */}
          <div className="absolute left-9 top-0 bottom-0 w-px bg-border" />
          <div className="space-y-3">
            {events.map((event) => {
              const typeInfo = getEventTypeInfo(event.type);
              return (
                <div key={event.id} className="flex items-start gap-4">
                  {/* 头像 */}
                  <div className="relative z-10 shrink-0">
                    <Avatar className="w-8 h-8 ring-2 ring-background">
                      <AvatarImage src={event.actor.avatar_url} />
                      <AvatarFallback className="bg-secondary text-xs">
                        {event.actor.login.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  {/* 内容 */}
                  <div
                    className="flex-1 bg-card border border-border rounded-lg p-3 min-w-0 cursor-pointer hover:border-primary/40 hover:bg-secondary/50 transition-colors"
                    onClick={() => navigate(getEventRoute(event))}
                  >
                    <div className="flex items-start gap-2 flex-wrap">
                      <p className="text-sm text-foreground flex-1 min-w-0 text-pretty">
                        {getEventDescription(event)}
                      </p>
                      <Badge
                        variant="outline"
                        className={`text-xs shrink-0 h-5 px-1.5 ${typeInfo.color}`}
                      >
                        {typeInfo.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {formatRelativeTime(event.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && events.length > 0 && (
        <div className="text-center pt-2">
          <Button
            variant="outline"
            className="border-border hover:bg-secondary"
            onClick={() => loadEvents(page + 1, true)}
            disabled={loadingMore}
          >
            {loadingMore ? '加载中...' : '加载更多'}
          </Button>
        </div>
      )}
    </div>
  );
}
