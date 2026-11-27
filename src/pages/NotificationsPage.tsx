// 通知中心

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  BellOff,
  GitPullRequest,
  AlertCircle,
  CheckCircle2,
  Package,
  RefreshCw,
  Loader2,
  Check,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  formatRelativeTime,
  getToken,
} from '@/services/github';
import type { GitHubNotification } from '@/types/types';
import { toast } from 'sonner';
import { notificationDestination } from '@/lib/notificationLink';
import { publishNotificationUnread, subscribeNotificationUnread } from '@/lib/notificationBadge';
import i18n from '@/i18n';

type InboxFilter = 'unread' | 'all' | 'done';
type NotificationAction = { type: 'all' } | { type: 'read' | 'done'; id: string };

interface Inbox {
  filter: InboxFilter;
  page: number;
  notifications: GitHubNotification[];
  hasNextPage: boolean;
}

const FILTERS = [
  { value: 'unread', label: '未读通知' },
  { value: 'all', label: '显示全部' },
  { value: 'done', label: '已完成' },
] as const;

const formatGitHubDate = (time: number) => new Date(time).toISOString().replace(/\.\d+Z$/, 'Z');

async function confirmBatchRead(cutoff: string, signal: AbortSignal): Promise<boolean> {
  // GitHub's before filter excludes the timestamp itself.
  const before = formatGitHubDate(Date.parse(cutoff) + 1000);
  for (const delay of [0, 700, 1400]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (signal.aborted) return false;
    const { data } = await getNotifications({ before, per_page: 1 }, { fresh: true, signal });
    if (!data.some(notification => notification.unread)) return true;
  }
  return false;
}

export default function NotificationsPage() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [filter, setFilter] = useState<InboxFilter>('unread');
  const [loadingPage, setLoadingPage] = useState<number | null>(1);
  const [loadError, setLoadError] = useState<{ page: number; detail?: string } | null>(null);
  const [action, setAction] = useState<NotificationAction | null>(null);
  const activeAction = useRef<NotificationAction | null>(null);
  const request = useRef<AbortController | null>(null);
  const batchCheck = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const loadNotifications = useCallback(async (page = 1) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoadingPage(page);
    setLoadError(null);
    try {
      const { data, hasNextPage } = await getNotifications({
        all: filter !== 'unread', done: filter === 'done', page,
      }, { fresh: true, signal: controller.signal });
      if (controller.signal.aborted) return;
      setInbox(previous => {
        const items = new Map(
          page > 1 && previous?.filter === filter ? previous.notifications.map(item => [item.id, item]) : [],
        );
        for (const item of data) items.set(item.id, item);
        return { filter, page, notifications: [...items.values()], hasNextPage };
      });
      if (filter !== 'done') {
        const unread = data.some(item => item.unread);
        if (unread || (page === 1 && (filter === 'unread' || !hasNextPage))) publishNotificationUnread(unread);
      }
    } catch (error) {
      if (!controller.signal.aborted) setLoadError({ page, detail: error instanceof Error ? error.message : undefined });
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoadingPage(null);
      }
    }
  }, [filter]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      batchCheck.current?.abort();
    };
  }, []);

  useEffect(() => {
    void loadNotifications();
    const unsubscribe = subscribeNotificationUnread(hasUnread => {
      if (hasUnread === null && !activeAction.current) void loadNotifications();
    });
    return () => {
      unsubscribe();
      const pending = request.current;
      request.current = null;
      pending?.abort();
    };
  }, [loadNotifications]);

  const updateInbox = async (change: NotificationAction) => {
    if (activeAction.current) return;
    activeAction.current = change;
    setAction(change);
    const token = getToken();
    try {
      let done = true;
      const cutoff = formatGitHubDate(Date.now());
      if (change.type === 'read') {
        await markNotificationRead(change.id);
      } else if (change.type === 'done') {
        await deleteNotification(change.id);
      } else {
        if ((await markAllNotificationsRead(cutoff)) === 'pending') {
          const controller = new AbortController();
          batchCheck.current = controller;
          const timeout = setTimeout(() => controller.abort(), 4500);
          try {
            done = mounted.current && getToken() === token && await confirmBatchRead(cutoff, controller.signal);
          } catch {
            // The mutation was accepted even if the confirmation request failed.
            done = false;
          } finally {
            clearTimeout(timeout);
            batchCheck.current = null;
          }
        }
      }
      if (getToken() !== token) return;
      if (mounted.current && done) {
        setInbox(current => {
          if (!current) return current;
          const notifications = current.notifications.flatMap(item => {
            if (change.type === 'done') return item.id === change.id ? [] : [item];
            const affected = change.type === 'all'
              ? Date.parse(item.updated_at) <= Date.parse(cutoff)
              : item.id === change.id;
            if (!affected || !item.unread) return [item];
            return current.filter === 'unread' ? [] : [{ ...item, unread: false }];
          });
          return { ...current, notifications };
        });
      }
      if (change.type === 'all') {
        if (done) toast.success(i18n.t('全部已标记为已读'));
        else toast.info(i18n.t('GitHub 已受理，通知正在批量更新'));
      } else if (change.type === 'done') {
        toast.success(i18n.t('通知已标为完成'));
      }
      // Invalidate both the badge and any notification page re-opened while this action was in flight.
      publishNotificationUnread(null);
      if (mounted.current) await loadNotifications();
    } catch (error) {
      if (getToken() !== token) return;
      toast.error(i18n.t(change.type === 'done' ? '标为完成失败' : '标记失败'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      activeAction.current = null;
      if (mounted.current) setAction(null);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'PullRequest':
        return <GitPullRequest className="w-4 h-4 text-chart-4" />;
      case 'Issue':
        return <AlertCircle className="w-4 h-4 text-primary" />;
      case 'CheckSuite':
        return <CheckCircle2 className="w-4 h-4 text-success" />;
      case 'Release':
        return <Package className="w-4 h-4 text-accent" />;
      default:
        return <Bell className="w-4 h-4 text-muted-foreground" />;
    }
  };

  /** 通知类型→中文标签 */
  const getTypeLabel = (type: string): string => {
    const map: Record<string, string> = {
      PullRequest: 'PR',
      Issue: 'Issue',
      CheckSuite: 'Actions',
      Release: i18n.t('版本发布'),
      Commit: i18n.t('提交'),
      Discussion: i18n.t('讨论'),
      RepositoryVulnerabilityAlert: i18n.t('安全警报'),
      RepositoryAdvisory: i18n.t('安全公告'),
      RepositoryDependabotAlertsThread: 'Dependabot',
    };
    return map[type] || type;
  };

  const current = inbox?.filter === filter ? inbox : null;
  const notifications = current?.notifications ?? [];
  const unreadCount = filter === 'done' ? 0 : notifications.filter(item => item.unread).length;
  const busy = action !== null;
  const loading = loadingPage !== null;
  const showMarkAll = filter !== 'done' && (unreadCount > 0 || (filter === 'all' && current?.hasNextPage));

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">{i18n.t('通知')}</h1>
          {unreadCount > 0 && <Badge className="bg-primary text-primary-foreground text-xs">{unreadCount}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" disabled={busy || loading}
            className="text-muted-foreground" onClick={() => void loadNotifications()}>
            <RefreshCw aria-hidden="true" className={loadingPage === 1 ? 'animate-spin' : undefined} />
            {i18n.t('刷新')}
          </Button>
          {showMarkAll && (
            <Button variant="outline" size="sm" disabled={busy || loading}
              onClick={() => void updateInbox({ type: 'all' })}>
              {action?.type === 'all' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              {action?.type === 'all' ? i18n.t('处理中...') : i18n.t('全部已读')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map(({ value, label }) => (
          <Button key={value} variant={filter === value ? 'secondary' : 'ghost'} size="sm"
            aria-pressed={filter === value} disabled={busy} onClick={() => setFilter(value)}>
            {i18n.t(label)}
          </Button>
        ))}
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-destructive">{i18n.t('加载通知失败')}</p>
            {loadError.detail && <p className="break-words text-xs text-muted-foreground">{loadError.detail}</p>}
          </div>
          <Button size="sm" variant="outline" disabled={busy || loading}
            onClick={() => void loadNotifications(loadError.page)}>{i18n.t('重试')}</Button>
        </div>
      )}

      {!current && loading ? (
        <div className="space-y-2" aria-busy="true">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="bg-card border border-border rounded-xl p-4">
              <Skeleton className="h-5 w-3/4 bg-muted mb-2" />
              <Skeleton className="h-4 w-1/3 bg-muted" />
            </div>
          ))}
        </div>
      ) : !loadError && current && notifications.length === 0 ? (
        <div className="bg-card border border-border rounded-xl py-14 text-center">
          <BellOff className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">
            {i18n.t(filter === 'unread' ? '没有未读通知' : filter === 'done' ? '没有已完成的通知' : '暂无通知')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(notification => {
            const destination = notificationDestination(notification);
            const external = destination.startsWith('https://');
            const unread = filter !== 'done' && notification.unread;
            const updating = action?.type !== 'all' && action?.id === notification.id;
            return (
              <div key={notification.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <Link
                  to={destination}
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noopener noreferrer' : undefined}
                  className={`block px-4 py-3 transition-colors ${unread ? 'bg-primary/[0.03] hover:bg-primary/[0.06]' : 'hover:bg-secondary/50'}`}
                  onClick={() => { if (unread && !busy) void updateInbox({ type: 'read', id: notification.id }); }}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${unread ? 'bg-primary/10' : 'bg-secondary/60'}`}>
                      {getNotificationIcon(notification.subject.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        {unread && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />}
                        <p className="text-sm font-semibold text-foreground break-words">{notification.subject.title}</p>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs text-muted-foreground">
                        <span>{notification.repository.full_name}</span>
                        <span>·</span>
                        <span>{formatRelativeTime(notification.updated_at)}</span>
                      </div>
                    </div>
                    {external && <ExternalLink aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                  </div>
                </Link>
                <div className={`flex items-center justify-between gap-2 px-3 py-2 border-t border-border ${unread ? 'bg-primary/5' : 'bg-secondary/20'}`}>
                  <Badge variant="outline" className="text-xs h-5 px-1.5 border-border text-muted-foreground">
                    {getTypeLabel(notification.subject.type)}
                  </Badge>
                  {filter !== 'done' && (
                    <div className="flex items-center gap-1">
                      {unread && (
                        <Button variant="ghost" size="sm" className="text-muted-foreground h-7 text-xs"
                          disabled={busy || loading} onClick={() => void updateInbox({ type: 'read', id: notification.id })}>
                          {updating && action?.type === 'read' && <Loader2 className="animate-spin" />}
                          {i18n.t('标为已读')}
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="size-7 text-muted-foreground"
                        title={i18n.t('标为完成')} aria-label={i18n.t('标为完成')} disabled={busy || loading}
                        onClick={() => void updateInbox({ type: 'done', id: notification.id })}>
                        {updating && action?.type === 'done'
                          ? <Loader2 className="animate-spin" />
                          : <Check aria-hidden="true" />}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {current?.hasNextPage && loadError?.page !== 1 && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={busy || loading}
            onClick={() => void loadNotifications(current.page + 1)}>
            {loadingPage && loadingPage > 1 ? <Loader2 className="animate-spin" /> : null}
            {i18n.t('加载更多')}
          </Button>
        </div>
      )}
    </div>
  );
}
