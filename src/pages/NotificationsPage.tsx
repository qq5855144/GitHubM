// 通知中心

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BellOff,
  GitPullRequest,
  AlertCircle,
  CheckCircle2,
  Package,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  formatRelativeTime,
} from '@/services/github';
import type { GitHubNotification } from '@/types/types';
import { toast } from 'sonner';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<GitHubNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getNotifications({ all: showAll, per_page: 50 });
      setNotifications(result.data);
    } catch (err) {
      toast.error('加载通知失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleMarkRead = async (id: string) => {
    try {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, unread: false } : n))
      );
    } catch (err) {
      toast.error('标记失败');
      console.error(err);
    }
  };

  /** 解析 GitHub API URL 提取应用内路由，例如：
   *  https://api.github.com/repos/{owner}/{repo}/issues/{number}
   *  → /repos/{owner}/{repo}/issues/{number}
   */
  const resolveNotificationRoute = (notification: GitHubNotification): string | null => {
    const repoFullName = notification.repository.full_name; // owner/repo
    const url = notification.subject.url || '';
    const type = notification.subject.type;

    // 尝试从 API URL 末尾提取 issue/PR 编号
    const numberMatch = url.match(/\/(\d+)$/);
    const number = numberMatch ? numberMatch[1] : null;

    switch (type) {
      case 'Issue':
        return number ? `/repos/${repoFullName}/issues/${number}` : `/repos/${repoFullName}/issues`;
      case 'PullRequest':
        return number ? `/repos/${repoFullName}/pulls/${number}` : `/repos/${repoFullName}/pulls`;
      case 'Release':
        return `/repos/${repoFullName}/artifacts`;
      case 'CheckSuite':
        return `/repos/${repoFullName}/actions`;
      case 'Commit':
        return `/repos/${repoFullName}/commits/${repoFullName.split('/')[1]}`;
      default:
        return `/repos/${repoFullName}`;
    }
  };

  /** 点击通知：自动标为已读并跳转到对应页面 */
  const handleNotificationClick = async (notification: GitHubNotification) => {
    if (notification.unread) {
      // 乐观更新 UI，再执行 API 调用
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, unread: false } : n))
      );
      markNotificationRead(notification.id).catch(() => {
        // 回滚
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, unread: true } : n))
        );
      });
    }
    const route = resolveNotificationRoute(notification);
    if (route) navigate(route);
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
      toast.success('全部已标记为已读');
    } catch (err) {
      toast.error('操作失败');
      console.error(err);
    } finally {
      setMarkingAll(false);
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
      Release: '版本发布',
      Commit: '提交',
      Discussion: '讨论',
      RepositoryVulnerabilityAlert: '安全警报',
      RepositoryAdvisory: '安全公告',
      RepositoryDependabotAlertsThread: 'Dependabot',
    };
    return map[type] || type;
  };

  const unreadCount = notifications.filter((n) => n.unread).length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 页头 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">通知</h1>
          {unreadCount > 0 && (
            <Badge className="bg-primary text-primary-foreground text-xs">
              {unreadCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Switch
              id="show-all"
              checked={showAll}
              onCheckedChange={setShowAll}
            />
            <Label htmlFor="show-all" className="text-sm text-muted-foreground cursor-pointer">
              显示全部
            </Label>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:bg-secondary"
            onClick={loadNotifications}
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            刷新
          </Button>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="border-border hover:bg-secondary"
              onClick={handleMarkAllRead}
              disabled={markingAll}
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              {markingAll ? '处理中...' : '全部已读'}
            </Button>
          )}
        </div>
      </div>

      {/* 通知列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4">
                <Skeleton className="h-5 w-3/4 bg-muted mb-2" />
                <Skeleton className="h-4 w-1/3 bg-muted" />
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-16 text-center">
            <BellOff className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">暂无通知</p>
            <p className="text-muted-foreground text-sm mt-1">
              {showAll ? '没有任何通知' : '没有未读通知'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`p-4 transition-colors cursor-pointer ${notification.unread ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-secondary/50'}`}
                onClick={() => handleNotificationClick(notification)}
              >
                <div className="flex items-start gap-3">
                  {/* 未读指示点 */}
                  <div className="mt-1.5 shrink-0">
                    {notification.unread ? (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    ) : (
                      <div className="w-2 h-2 rounded-full bg-transparent border border-muted-foreground/30" />
                    )}
                  </div>
                  {/* 类型图标 */}
                  <div className="mt-0.5 shrink-0">
                    {getNotificationIcon(notification.subject.type)}
                  </div>
                  {/* 通知内容 */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm text-balance ${notification.unread ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {notification.subject.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {notification.repository.full_name}
                      </span>
                      <Badge variant="outline" className="text-xs h-4 px-1 border-border text-muted-foreground">
                        {getTypeLabel(notification.subject.type)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(notification.updated_at)}
                      </span>
                    </div>
                  </div>
                  {/* 操作 */}
                  {notification.unread && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground hover:bg-secondary h-7 text-xs"
                      onClick={(e) => { e.stopPropagation(); handleMarkRead(notification.id); }}
                    >
                      标为已读
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
