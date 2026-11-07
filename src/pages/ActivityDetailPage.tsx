import { useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  Clock,
  ExternalLink,
  GitBranch,
  GitCommit,
  Tag,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserLink } from '@/components/common/UserLink';
import { formatRelativeTime } from '@/services/github';
import type { GitHubEvent } from '@/types/types';
import i18n from '@/i18n';

const EVENT_STORAGE_PREFIX = 'github_activity_event_';

export function cacheActivityEvent(event: GitHubEvent) {
  try {
    sessionStorage.setItem(`${EVENT_STORAGE_PREFIX}${event.id}`, JSON.stringify(event));
  } catch { /* ignore */ }
}

function getTypeLabel(type: string): string {
  return type.replace(/Event$/, '');
}

function describeEvent(event: GitHubEvent): string {
  const repo = event.repo.name;
  const payload = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'PushEvent':
      return `推送了 ${(payload.commits as unknown[] | undefined)?.length || 0} 个提交到 ${repo}`;
    case 'CreateEvent':
      return `在 ${repo} 创建了 ${String(payload.ref_type || '')} ${String(payload.ref || '')}`;
    case 'DeleteEvent':
      return `在 ${repo} 删除了 ${String(payload.ref_type || '')} ${String(payload.ref || '')}`;
    case 'IssuesEvent':
      return `在 ${repo} ${String(payload.action || '更新')} Issue #${(payload.issue as { number?: number } | undefined)?.number ?? ''}`;
    case 'PullRequestEvent':
      return `在 ${repo} ${String(payload.action || '更新')} Pull Request #${(payload.pull_request as { number?: number } | undefined)?.number ?? ''}`;
    case 'IssueCommentEvent':
      return `评论了 ${repo} 的 Issue #${(payload.issue as { number?: number } | undefined)?.number ?? ''}`;
    case 'PullRequestReviewEvent':
      return `审查了 ${repo} 的 Pull Request #${(payload.pull_request as { number?: number } | undefined)?.number ?? ''}`;
    case 'ReleaseEvent':
      return `在 ${repo} 发布了 ${(payload.release as { name?: string; tag_name?: string } | undefined)?.name || (payload.release as { tag_name?: string } | undefined)?.tag_name || ''}`;
    case 'ForkEvent':
      return `Fork 了 ${repo}`;
    case 'WatchEvent':
      return `标星了 ${repo}`;
    default:
      return `在 ${repo} 有新的 ${getTypeLabel(event.type)} 活动`;
  }
}

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0 min-w-0">
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <span className="text-sm text-foreground break-all min-w-0">{value}</span>
    </div>
  );
}

export default function ActivityDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const event = useMemo<GitHubEvent | null>(() => {
    const stateEvent = (location.state as { event?: GitHubEvent } | null)?.event;
    if (stateEvent && stateEvent.id === eventId) return stateEvent;
    try {
      const raw = sessionStorage.getItem(`${EVENT_STORAGE_PREFIX}${eventId}`);
      return raw ? JSON.parse(raw) as GitHubEvent : null;
    } catch {
      return null;
    }
  }, [eventId, location.state]);

  if (!event) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          <button type="button" className="hover:text-accent" onClick={() => navigate('/')}>{i18n.t('首页')}</button>
          <span>/</span>
          <button type="button" className="hover:text-accent" onClick={() => navigate('/activity')}>{i18n.t('最近活动')}</button>
          <span>/</span>
          <span className="text-foreground">{i18n.t('活动详情')}</span>
        </div>
        <div className="bg-card border border-border rounded-xl py-16 text-center">
          <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">{i18n.t('活动详情已过期')}</p>
          <p className="text-sm text-muted-foreground mt-1">{i18n.t('该活动数据只在本次会话中保留，请返回最近活动重新打开。')}</p>
          <Button className="mt-4" variant="outline" onClick={() => navigate('/activity')}>{i18n.t('返回最近活动')}</Button>
        </div>
      </div>
    );
  }

  const payload = event.payload as Record<string, unknown>;
  const repoName = event.repo.name;
  const typeLabel = getTypeLabel(event.type);
  const commits = Array.isArray(payload.commits)
    ? payload.commits as Array<{ sha?: string; message?: string; url?: string }>
    : [];
  const issue = payload.issue as { number?: number; title?: string; html_url?: string; state?: string } | undefined;
  const pull = payload.pull_request as { number?: number; title?: string; html_url?: string; merged?: boolean } | undefined;
  const release = payload.release as { name?: string; tag_name?: string; html_url?: string } | undefined;
  const forkee = payload.forkee as { full_name?: string; html_url?: string } | undefined;
  const targetUrl = (issue?.html_url || pull?.html_url || release?.html_url || forkee?.html_url) as string | undefined;
  const rawPayload = JSON.stringify(payload, null, 2);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/')}>{i18n.t('首页')}</button>
        <span>/</span>
        <button type="button" className="hover:text-accent" onClick={() => navigate('/activity')}>{i18n.t('最近活动')}</button>
        <span>/</span>
        <span className="text-foreground">{i18n.t('活动详情')}</span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2 min-w-0">
          <Activity className="w-5 h-5 text-primary shrink-0" />
          <span className="truncate">{i18n.t('活动详情')}</span>
        </h1>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground shrink-0" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />{i18n.t('返回')}
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 md:p-5 space-y-5">
        <div className="flex items-start gap-3">
          <UserLink login={event.actor.login} className="shrink-0">
            <Avatar className="w-10 h-10">
              <AvatarImage src={event.actor.avatar_url} />
              <AvatarFallback className="bg-secondary text-xs">{event.actor.login.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </UserLink>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <UserLink login={event.actor.login} className="text-sm font-medium text-foreground">{event.actor.login}</UserLink>
              <Badge variant="outline" className="text-xs border-border text-muted-foreground">{typeLabel}</Badge>
            </div>
            <p className="text-sm text-foreground mt-1 break-words">{describeEvent(event)}</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatRelativeTime(event.created_at)}</span>
              <span className="flex items-center gap-1"><GitBranch className="w-3 h-3" />{repoName}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="h-8 gap-1.5" onClick={() => navigate(`/repos/${repoName}`)}>
            <GitCommit className="w-3.5 h-3.5" />{i18n.t('进入仓库')}
          </Button>
          {targetUrl && (
            <a href={targetUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="h-8 gap-1.5">
                <ExternalLink className="w-3.5 h-3.5" />{i18n.t('在 GitHub 查看')}
              </Button>
            </a>
          )}
        </div>

        <div className="border-t border-border pt-2">
          <InfoRow label={i18n.t('活动类型')} value={event.type} />
          <InfoRow label={i18n.t('仓库')} value={repoName} />
          <InfoRow label={i18n.t('操作')} value={String(payload.action || '')} />
          <InfoRow label={i18n.t('引用')} value={String(payload.ref || '')} />
          <InfoRow label={i18n.t('说明')} value={String(payload.description || '')} />
          <InfoRow label="Issue" value={issue?.number ? `#${issue.number} ${issue.title || ''}` : ''} />
          <InfoRow label="Pull Request" value={pull?.number ? `#${pull.number} ${pull.title || ''}` : ''} />
          <InfoRow label="Release" value={release ? (release.name || release.tag_name || '') : ''} />
          <InfoRow label="Fork" value={forkee?.full_name || ''} />
        </div>

        {commits.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <GitCommit className="w-3.5 h-3.5" />{i18n.t('提交')} ({commits.length})
            </p>
            <div className="space-y-2">
              {commits.map((commit, index) => (
                <div key={commit.sha || index} className="rounded-lg border border-border bg-secondary/30 px-3 py-2 min-w-0">
                  <p className="text-sm text-foreground break-words">{commit.message || ''}</p>
                  {commit.sha && <code className="text-xs font-mono text-accent break-all">{commit.sha.substring(0, 12)}</code>}
                </div>
              ))}
            </div>
          </div>
        )}

        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" />{i18n.t('原始 Payload')}
          </summary>
          <pre className="mt-2 text-xs p-3 rounded-lg bg-secondary/40 border border-border font-mono whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
            {rawPayload}
          </pre>
        </details>
      </div>
    </div>
  );
}
