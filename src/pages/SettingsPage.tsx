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
  Pencil,
  ExternalLink,
  Loader2,
  User,
  Palette,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme, type ThemeMode, ACCENT_SCHEMES } from '@/contexts/ThemeContext';
import { updateUserProfile } from '@/services/github';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

const themeOptions: { value: ThemeMode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: Monitor },
];

// ── 编辑资料 Dialog ──────────────────────────────────────────────────
interface EditProfileDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

function EditProfileDialog({ open, onOpenChange }: EditProfileDialogProps) {
  const { user, updateUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: user?.name || '',
    bio: user?.bio || '',
    company: user?.company || '',
    location: user?.location || '',
    blog: user?.blog || '',
    twitter_username: user?.twitter_username || '',
    email: user?.email || '',
  });

  const handleChange = (field: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      // 只传非空字段，避免意外清空
      const payload: Record<string, string> = {};
      (Object.keys(form) as (keyof typeof form)[]).forEach((k) => {
        if (form[k].trim() !== '') payload[k] = form[k].trim();
        else payload[k] = ''; // 允许清空字段
      });
      const updated = await updateUserProfile(payload);
      updateUser(updated);
      toast.success('个人资料已更新');
      onOpenChange(false);
    } catch {
      toast.error('更新失败，请检查 Token 是否具有 user 权限');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            编辑个人资料
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* 头像区 */}
          <div className="flex items-center gap-4 p-4 bg-secondary/40 rounded-xl border border-border">
            <Avatar className="w-16 h-16 shrink-0 ring-2 ring-border">
              <AvatarImage src={user?.avatar_url} alt={user?.login} />
              <AvatarFallback className="bg-secondary text-lg font-bold">
                {user?.login.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">个人头像</p>
              <p className="text-xs text-muted-foreground mt-0.5 text-pretty">
                头像需前往 GitHub.com 更改，API 不支持直接上传。
              </p>
              <a
                href="https://github.com/settings/profile"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-1.5"
              >
                <ExternalLink className="w-3 h-3" />
                前往 GitHub 更改头像
              </a>
            </div>
          </div>

          {/* 表单字段 */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-normal text-foreground">显示名称</Label>
                <Input
                  value={form.name}
                  onChange={handleChange('name')}
                  placeholder="你的名字"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-normal text-foreground">个人简介</Label>
                <Textarea
                  value={form.bio}
                  onChange={handleChange('bio')}
                  placeholder="简单介绍一下自己..."
                  rows={3}
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal text-foreground">公司 / 组织</Label>
                  <Input
                    value={form.company}
                    onChange={handleChange('company')}
                    placeholder="@YourCompany"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal text-foreground">所在地</Label>
                  <Input
                    value={form.location}
                    onChange={handleChange('location')}
                    placeholder="城市, 国家"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-normal text-foreground">个人网站</Label>
                <Input
                  value={form.blog}
                  onChange={handleChange('blog')}
                  placeholder="https://yourwebsite.com"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal text-foreground">X (Twitter) 用户名</Label>
                  <Input
                    value={form.twitter_username}
                    onChange={handleChange('twitter_username')}
                    placeholder="your_handle（不含 @）"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal text-foreground">公开邮箱</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={handleChange('email')}
                    placeholder="you@example.com"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="outline"
              className="border-border hover:bg-secondary"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />保存中...</>
              ) : '保存修改'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SettingsPage() {
  const { user, rateLimit, logout, login, token, refreshRateLimit } = useAuth();
  const { theme: currentTheme, setTheme, accentSchemeId, setAccentScheme } = useTheme();
  const navigate = useNavigate();
  const [showToken, setShowToken] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [showNewToken, setShowNewToken] = useState(false);
  const [updatingToken, setUpdatingToken] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

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
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">账号信息</h2>
            <Button
              variant="outline"
              size="sm"
              className="border-border hover:bg-secondary text-xs h-8 gap-1.5"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="w-3.5 h-3.5" />
              编辑资料
            </Button>
          </div>

          {/* 头像 + 基本信息 */}
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <Avatar className="w-16 h-16 ring-2 ring-border">
                <AvatarImage src={user.avatar_url} alt={user.login} />
                <AvatarFallback className="bg-secondary text-lg font-bold">
                  {user.login.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground truncate max-w-[180px] text-base">
                  {user.name || user.login}
                </span>
                <Badge variant="outline" className="border-primary/50 text-primary text-xs shrink-0">
                  已认证
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">@{user.login}</p>
              {user.bio && (
                <p className="text-xs text-muted-foreground mt-1 text-pretty line-clamp-2">{user.bio}</p>
              )}
            </div>
          </div>

          {/* 详细信息网格 */}
          <div className="mt-4 grid grid-cols-1 gap-2 text-xs text-muted-foreground border-t border-border pt-4">
            {user.email && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground/60 w-14 shrink-0">邮箱</span>
                <span className="truncate text-foreground/80">{user.email}</span>
              </div>
            )}
            {user.company && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground/60 w-14 shrink-0">公司</span>
                <span className="truncate text-foreground/80">{user.company}</span>
              </div>
            )}
            {user.location && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground/60 w-14 shrink-0">地区</span>
                <span className="truncate text-foreground/80">{user.location}</span>
              </div>
            )}
            {user.blog && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground/60 w-14 shrink-0">网站</span>
                <a
                  href={user.blog.startsWith('http') ? user.blog : `https://${user.blog}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline truncate flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  {user.blog}
                </a>
              </div>
            )}
            {user.twitter_username && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground/60 w-14 shrink-0">X</span>
                <span className="text-foreground/80">@{user.twitter_username}</span>
              </div>
            )}
            <div className="flex items-center gap-3 mt-1 pt-2 border-t border-border/60">
              <span>{user.public_repos} 个公开仓库</span>
              <span>·</span>
              <span>{user.followers} 粉丝</span>
              <span>·</span>
              <span>关注 {user.following} 人</span>
            </div>
          </div>

          {/* 查看 GitHub 主页 */}
          <div className="mt-3">
            <a href={user.html_url} target="_blank" rel="noopener noreferrer">
              <Button
                variant="ghost"
                size="sm"
                className="w-full border border-border text-muted-foreground hover:text-foreground hover:bg-secondary text-xs h-8 gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                查看 GitHub 主页
              </Button>
            </a>
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

      {/* 主题色方案 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Palette className="w-4 h-4 text-primary" />
          强调色方案
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {ACCENT_SCHEMES.map((scheme) => (
            <button
              key={scheme.id}
              type="button"
              onClick={() => setAccentScheme(scheme.id)}
              className={cn(
                'flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all',
                accentSchemeId === scheme.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-secondary/50 hover:border-border/70 hover:bg-secondary'
              )}
            >
              {/* 色圆 */}
              <span
                className="w-7 h-7 rounded-full shadow-sm ring-2 ring-border/40 shrink-0"
                style={{ backgroundColor: scheme.previewColor }}
              />
              <span className={cn(
                'text-xs font-medium',
                accentSchemeId === scheme.id ? 'text-primary' : 'text-muted-foreground'
              )}>
                {scheme.label}
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          当前方案：<span className="text-foreground font-medium">{ACCENT_SCHEMES.find(s => s.id === accentSchemeId)?.label ?? '紫罗兰'}</span>
          ，选择后立即生效并持久化保存
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

      {/* 作者 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">作者</h2>
        <div className="flex items-center gap-3">
          {/* 头像（预留 SVG 内联位置） */}
          <div className="w-10 h-10 rounded-full bg-muted border border-border flex items-center justify-center shrink-0 overflow-hidden">
            <span className="text-lg select-none">🦖</span>
          </div>
          <div className="flex-1 min-w-0 space-y-0.5">
            <p className="text-sm text-foreground truncate">作者：MT 论坛练习时长两年半的水怪</p>
            <p className="text-xs text-muted-foreground">
              反馈邮箱：
              <a
                href="mailto:3214931827@qq.com"
                className="hover:text-primary transition-colors underline underline-offset-2 decoration-border hover:decoration-primary"
              >
                3214931827@qq.com
              </a>
            </p>
          </div>
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

      {/* 编辑资料 Dialog */}
      {user && <EditProfileDialog open={editOpen} onOpenChange={setEditOpen} />}
    </div>
  );
}

