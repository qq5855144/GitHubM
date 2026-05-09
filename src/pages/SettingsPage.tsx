// 设置页

import { useState } from 'react';
import {
  Settings,
  Key,
  Moon,
  Sun,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  Shield,
  Info,
  Monitor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme, type ThemeMode } from '@/contexts/ThemeContext';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

const themeOptions: { value: ThemeMode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: Monitor },
];

export default function SettingsPage() {
  const { user, rateLimit, logout, login, token, refreshRateLimit } = useAuth();
  const { theme: currentTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [showToken, setShowToken] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [showNewToken, setShowNewToken] = useState(false);
  const [updatingToken, setUpdatingToken] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

  const handleUpdateToken = async () => {
    if (!newToken.trim()) {
      toast.error('请输入新令牌');
      return;
    }
    setUpdatingToken(true);
    try {
      await login(newToken.trim());
      setNewToken('');
      toast.success('令牌已更新');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '令牌无效');
    } finally {
      setUpdatingToken(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const maskedToken = token
    ? `${token.substring(0, 6)}${'*'.repeat(20)}${token.substring(token.length - 4)}`
    : '';

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
        <Settings className="w-5 h-5 text-primary" />
        设置
      </h1>

      {/* 用户信息 */}
      {user && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">账号信息</h2>
          {/* 移动端：竖向堆叠；桌面端：横向一行 */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
            {/* 头像 + 用户名/邮箱行 */}
            <div className="flex items-center gap-3 min-w-0">
              <Avatar className="w-14 h-14 shrink-0">
                <AvatarImage src={user.avatar_url} alt={user.login} />
                <AvatarFallback className="bg-secondary text-lg font-bold">
                  {user.login.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground truncate max-w-[160px]">{user.name || user.login}</span>
                  <Badge variant="outline" className="border-primary/50 text-primary text-xs shrink-0">已认证</Badge>
                </div>
                <p className="text-sm text-muted-foreground truncate">@{user.login}</p>
                {user.email && <p className="text-xs text-muted-foreground truncate mt-0.5">{user.email}</p>}
              </div>
            </div>
            {/* 统计数字 + 查看主页按钮：移动端一行两端对齐；桌面端按钮推到右侧 */}
            <div className="flex items-center justify-between gap-3 md:contents">
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>{user.public_repos} 个仓库</span>
                <span>{user.followers} 关注者</span>
              </div>
              <a
                href={user.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 md:ml-auto"
              >
                <Button variant="outline" size="sm" className="border-border hover:bg-secondary text-xs">
                  查看主页
                </Button>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* 主题设置 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Sun className="w-4 h-4 text-primary" />
          外观主题
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {themeOptions.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={cn(
                'flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all',
                currentTheme === value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-secondary/50 text-muted-foreground hover:border-primary/40 hover:bg-secondary'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          {currentTheme === 'system' ? '当前跟随系统偏好自动切换主题' : `当前使用${currentTheme === 'dark' ? '深色' : '浅色'}主题`}
        </p>
      </div>

      {/* API 速率限制 */}
      {rateLimit && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              API 速率限制
            </h2>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:bg-secondary h-7 text-xs"
              onClick={refreshRateLimit}
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              刷新
            </Button>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">剩余请求</span>
              <span className={cn(
                'font-mono font-medium',
                rateLimit.remaining > 1000 ? 'text-success' :
                rateLimit.remaining > 100 ? 'text-warning' : 'text-destructive'
              )}>
                {rateLimit.remaining} / {rateLimit.limit}
              </span>
            </div>
            <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  rateLimit.remaining > 1000 ? 'bg-success' :
                  rateLimit.remaining > 100 ? 'bg-warning' : 'bg-destructive'
                )}
                style={{ width: `${(rateLimit.remaining / rateLimit.limit) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              重置时间：{new Date(rateLimit.reset * 1000).toLocaleTimeString('zh-CN')}
            </p>
          </div>
        </div>
      )}

      {/* 当前令牌 */}
      {token && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            当前 Token
          </h2>
          <div className="relative">
            <Input
              type={showToken ? 'text' : 'password'}
              value={showToken ? token : maskedToken}
              readOnly
              className="bg-secondary border-border text-foreground pr-10 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <Info className="w-3 h-3" />
            令牌仅保存在本地浏览器中
          </p>
        </div>
      )}

      {/* 更新令牌 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">更新 Token</h2>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-sm font-normal text-foreground">新 Personal Access Token</Label>
            <div className="relative">
              <Input
                type={showNewToken ? 'text' : 'password'}
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground pr-10 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowNewToken(!showNewToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNewToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleUpdateToken}
            disabled={updatingToken || !newToken.trim()}
          >
            {updatingToken ? '验证中...' : '更新令牌'}
          </Button>
        </div>
      </div>

      {/* 危险操作 */}
      <div className="bg-card border border-destructive/30 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-destructive mb-4">危险操作</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">退出登录</p>
              <p className="text-xs text-muted-foreground">清除本地保存的令牌并退出</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-destructive text-destructive hover:bg-destructive/10 shrink-0"
              onClick={() => setLogoutDialogOpen(true)}
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              退出登录
            </Button>
          </div>
        </div>
      </div>

      {/* 关于 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3">关于</h2>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p>GitHub 管理器 v{import.meta.env.VITE_APP_VERSION || '1.0.local'}</p>
          <p>基于 GitHub REST API v2022-11-28</p>
          <p>使用 React + TypeScript + Tailwind CSS 构建</p>
        </div>
      </div>

      {/* 退出确认 */}
      <AlertDialog open={logoutDialogOpen} onOpenChange={setLogoutDialogOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">确认退出登录</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              退出后将清除本地保存的令牌，需要重新输入才能使用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-secondary">取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleLogout}
            >
              退出登录
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

