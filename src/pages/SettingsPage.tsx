// 设置页

import { useState, useEffect, useCallback, useRef } from 'react';
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
  ArrowUpCircle,
  Bot,
  CheckCircle2,
  BarChart3,
  ChevronDown,
  ChevronUp,
  DollarSign,
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
import { MODEL_DEFS, loadProviderKey, saveProviderKey } from '@/components/ai/aiUtils';
import { getProviderStats, getTotalRequestCount, clearAllUsage, type ProviderStats } from '@/components/ai/usageStats';
import { formatCostUsd, getModelPrice, SOURCES } from '@/components/ai/modelPricing';

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

  // ── AI API Key 配置状态（按平台独立存储）──────────────────────────────
  // 仅对需要用户提供 API Key 的平台展示
  const aiKeyProviders = MODEL_DEFS.filter(m => m.needKey && m.type !== 'custom');
  const [aiKeys, setAiKeys] = useState<Record<string, string>>(() =>
    Object.fromEntries(aiKeyProviders.map(m => [m.type, loadProviderKey(m.type as import('@/components/ai/aiUtils').ModelType)]))
  );
  const [savedAiKeys, setSavedAiKeys] = useState<Record<string, boolean>>({});

  const handleSaveAiKey = (type: string, key: string) => {
    saveProviderKey(type as import('@/components/ai/aiUtils').ModelType, key);
    setSavedAiKeys(prev => ({ ...prev, [type]: true }));
    setTimeout(() => setSavedAiKeys(prev => ({ ...prev, [type]: false })), 2000);
    if (key.trim()) {
      toast.success(`${MODEL_DEFS.find(m => m.type === type)?.label ?? type} API Key 已保存`);
    } else {
      toast.info(`${MODEL_DEFS.find(m => m.type === type)?.label ?? type} API Key 已清除`);
    }
  };

  // ── AI 用量统计 ─────────────────────────────────────────────────────
  const [usageStats, setUsageStats] = useState<ProviderStats[]>(() => getProviderStats());
  const [totalRequests, setTotalRequests] = useState(() => getTotalRequestCount());
  // 展开模型明细的 provider set
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  const toggleProviderExpand = (pt: string) =>
    setExpandedProviders(prev => {
      const next = new Set(prev);
      next.has(pt) ? next.delete(pt) : next.add(pt);
      return next;
    });

  const handleClearUsage = () => {
    clearAllUsage();
    setUsageStats([]);
    setTotalRequests(0);
    toast.success('AI 用量统计已清除');
  };

  // ── 版本更新检查（仅 Android 环境） ─────────────────────────────────
  // 检测是否在 AndroidBridge 环境中
  const isAndroid = typeof window !== 'undefined' &&
    !!(window as unknown as { AndroidBridge?: unknown }).AndroidBridge;

  const [updateInfo, setUpdateInfo] = useState<{
    version: string;
    downloadUrl: string;
    releaseNotes: string;
  } | null>(null);

  // checking: 正在检查中 | latest: 已是最新 | error: 检查失败
  type UpdateCheckState = 'idle' | 'checking' | 'latest' | 'error';
  const [checkState, setCheckState] = useState<UpdateCheckState>('idle');
  const [checkErrorMsg, setCheckErrorMsg] = useState('');
  const checkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 将当前版本号写入 localStorage，供 Android 原生读取对比
  useEffect(() => {
    const ver = import.meta.env.VITE_APP_VERSION;
    if (ver) {
      try { localStorage.setItem('app_version', ver); } catch { /* ignore */ }
    }
  }, []);

  // 监听 Android 原生推送的三种更新结果事件
  useEffect(() => {
    const onAvailable = (e: Event) => {
      const detail = (e as CustomEvent<{
        version: string; downloadUrl: string; releaseNotes: string;
      }>).detail;
      if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current);
      if (detail?.version) {
        setUpdateInfo(detail);
        setCheckState('idle');
      }
    };
    const onLatest = () => {
      if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current);
      setCheckState('latest');
      // 3 秒后恢复 idle，避免状态一直停留
      checkTimeoutRef.current = setTimeout(() => setCheckState('idle'), 3000);
    };
    const onError = (e: Event) => {
      const msg = (e as CustomEvent<{ message: string }>).detail?.message || '网络异常，请稍后重试';
      if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current);
      setCheckErrorMsg(msg);
      setCheckState('error');
      // 5 秒后恢复 idle
      checkTimeoutRef.current = setTimeout(() => setCheckState('idle'), 5000);
    };

    window.addEventListener('appUpdateAvailable', onAvailable);
    window.addEventListener('appUpdateLatest', onLatest);
    window.addEventListener('appUpdateError', onError);
    return () => {
      window.removeEventListener('appUpdateAvailable', onAvailable);
      window.removeEventListener('appUpdateLatest', onLatest);
      window.removeEventListener('appUpdateError', onError);
      if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current);
    };
  }, []);

  // 主动触发 Android 原生检查更新（仅 Android 可用）
  const handleCheckUpdate = useCallback(() => {
    const bridge = (window as unknown as { AndroidBridge?: { checkUpdate?: () => void } }).AndroidBridge;
    if (!bridge?.checkUpdate) return;
    setUpdateInfo(null);
    setCheckState('checking');
    setCheckErrorMsg('');
    bridge.checkUpdate();
    // 15 秒超时保底，防止 Android 无响应时 UI 卡在 checking 状态
    checkTimeoutRef.current = setTimeout(() => {
      setCheckState('error');
      setCheckErrorMsg('检查超时，请检查网络后重试');
    }, 15_000);
  }, []);

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

      {/* AI 模型 API Key 配置 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          AI 模型 API Key
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          配置各平台密钥后，在 AI 助手中切换模型时将自动预填。密钥仅存储在本地。
        </p>
        <div className="space-y-4">
          {aiKeyProviders.map(provider => {
            const key = aiKeys[provider.type] ?? '';
            const saved = savedAiKeys[provider.type] ?? false;
            return (
              <div key={provider.type} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-normal text-foreground flex items-center gap-1.5">
                    {provider.label}
                    {provider.badge && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                        {provider.badge}
                      </span>
                    )}
                  </Label>
                  {provider.docsUrl && (
                    <a
                      href={provider.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                    >
                      获取密钥
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      inputMode="text"
                      value={key}
                      onChange={e => setAiKeys(prev => ({ ...prev, [provider.type]: e.target.value }))}
                      placeholder={provider.keyPlaceholder ?? '请输入 API Key'}
                      className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono text-sm"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-border hover:bg-secondary gap-1.5"
                    onClick={() => handleSaveAiKey(provider.type, key)}
                  >
                    {saved
                      ? <><CheckCircle2 className="w-3.5 h-3.5 text-success" />已保存</>
                      : '保存'
                    }
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI 用量统计 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            AI 用量统计
          </h2>
          {usageStats.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs border-border text-muted-foreground hover:text-destructive hover:border-destructive/50"
              onClick={handleClearUsage}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              清除统计
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          近 30 天 AI 对话 Token 用量及费用估算，数据存储在本地，自动清理超期记录。
        </p>

        {usageStats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
            <BarChart3 className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">暂无用量记录</p>
            <p className="text-xs text-muted-foreground/70">使用 AI 助手后将自动统计 Token 用量</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 总览行 */}
            <div className="flex items-center justify-between gap-2 bg-secondary/50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>共 <span className="font-medium text-foreground">{totalRequests}</span> 次对话，覆盖 <span className="font-medium text-foreground">{usageStats.length}</span> 个平台</span>
              </div>
              <div className="flex items-center gap-1 text-xs font-medium text-foreground shrink-0">
                <DollarSign className="w-3.5 h-3.5 text-primary" />
                <span>{formatCostUsd(usageStats.reduce((s, p) => s + p.costUsd, 0))}</span>
                <span className="text-muted-foreground font-normal">合计</span>
              </div>
            </div>

            {/* 按平台分组 */}
            <div className="space-y-2">
              {usageStats.map(stat => {
                const providerLabel = MODEL_DEFS.find(m => m.type === stat.providerType)?.label ?? stat.providerType;
                const expanded = expandedProviders.has(stat.providerType);
                const hasMultipleModels = stat.modelBreakdown.length > 1;
                const singleModel = stat.modelBreakdown[0]?.model ?? '';
                // 定价源 URL（按 provider 兜底）
                const priceInfo = getModelPrice(stat.providerType, singleModel);
                const sourceUrl = priceInfo.sourceUrl ?? (SOURCES as Record<string, string>)[stat.providerType];

                return (
                  <div key={stat.providerType} className="border border-border rounded-lg overflow-hidden">
                    {/* Provider 头部行 */}
                    <div className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-foreground truncate">{providerLabel}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{stat.requestCount} 次</span>
                        </div>
                        {/* 费用主显示 */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-base font-semibold font-mono text-primary">
                            {formatCostUsd(stat.costUsd)}
                          </span>
                          {priceInfo.isFree && stat.costUsd === 0 && (
                            <span className="text-[10px] bg-green-500/10 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded font-medium">免费额度</span>
                          )}
                          {priceInfo.isEstimated && (
                            <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">估算</span>
                          )}
                        </div>
                      </div>

                      {/* Token 三列 */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-muted-foreground">输入 Tokens</span>
                          <span className="text-sm font-mono font-medium text-foreground">{stat.promptTokens.toLocaleString()}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-muted-foreground">输出 Tokens</span>
                          <span className="text-sm font-mono font-medium text-foreground">{stat.completionTokens.toLocaleString()}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-muted-foreground">合计 Tokens</span>
                          <span className="text-sm font-mono font-medium text-foreground">{stat.totalTokens.toLocaleString()}</span>
                        </div>
                      </div>

                      {/* 底部：定价来源 + 展开按钮 */}
                      <div className="flex items-center justify-between pt-1 border-t border-border/50">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Info className="w-3 h-3 shrink-0" />
                          {priceInfo.note ? (
                            <span className="truncate max-w-[180px]">{priceInfo.note}</span>
                          ) : (
                            <span>官方定价</span>
                          )}
                          {sourceUrl && (
                            <a
                              href={sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-0.5 text-primary hover:underline ml-1 shrink-0"
                            >
                              查看定价 <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                        {/* 仅多模型时显示展开按钮 */}
                        {hasMultipleModels && (
                          <button
                            type="button"
                            onClick={() => toggleProviderExpand(stat.providerType)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          >
                            {expanded ? (
                              <><ChevronUp className="w-3 h-3" />收起明细</>
                            ) : (
                              <><ChevronDown className="w-3 h-3" />{stat.modelBreakdown.length} 个模型</>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 模型级明细（展开时显示） */}
                    {expanded && hasMultipleModels && (
                      <div className="border-t border-border bg-secondary/30 divide-y divide-border/50">
                        {stat.modelBreakdown.map(ms => {
                          const mp = getModelPrice(stat.providerType, ms.model);
                          return (
                            <div key={ms.model} className="px-3 py-2 flex items-center justify-between gap-2">
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-xs font-mono text-foreground truncate">{ms.model || '(默认)'}</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {ms.requestCount} 次 · {ms.totalTokens.toLocaleString()} tokens
                                  {mp.inputPer1M > 0 && (
                                    <> · 输入 ${(mp.inputPer1M).toFixed(mp.inputPer1M < 0.1 ? 4 : 2)}/M · 输出 ${(mp.outputPer1M).toFixed(mp.outputPer1M < 0.1 ? 4 : 2)}/M</>
                                  )}
                                </span>
                              </div>
                              <span className="text-sm font-semibold font-mono text-foreground shrink-0">
                                {formatCostUsd(ms.costUsd)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 底部说明 */}
            <p className="text-[10px] text-muted-foreground text-center">
              费用按各平台官方定价估算，免费额度内实际费用为 $0，仅供参考。
              CNY 定价按 1 USD = 7.2 CNY 换算。
            </p>
          </div>
        )}
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
        <div className="space-y-3">
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>GitHub 管理器 v{import.meta.env.VITE_APP_VERSION || '1.0.local'}</p>
            <p>基于 GitHub REST API v2022-11-28</p>
            <p>使用 React + TypeScript + Tailwind CSS 构建</p>
          </div>
          {/* 有新版本时显示更新提示 */}
          {updateInfo && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
              <ArrowUpCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-xs font-medium text-primary">
                  新版本 {updateInfo.version} 可用
                </p>
                {updateInfo.releaseNotes && (
                  <p className="text-xs text-muted-foreground line-clamp-2 text-pretty">
                    {updateInfo.releaseNotes}
                  </p>
                )}
              </div>
              {updateInfo.downloadUrl && (
                <a
                  href={updateInfo.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0"
                >
                  <Button size="sm" className="h-7 text-xs px-2 bg-primary text-primary-foreground hover:bg-primary/90">
                    下载
                  </Button>
                </a>
              )}
            </div>
          )}

          {/* 已是最新版本提示 */}
          {checkState === 'latest' && !updateInfo && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-green-500/10 border border-green-500/20">
              <svg className="w-4 h-4 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <p className="text-xs text-green-700 dark:text-green-400 font-medium">已是最新版本</p>
            </div>
          )}

          {/* 检查失败提示 */}
          {checkState === 'error' && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
              <svg className="w-4 h-4 text-destructive shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-xs text-destructive text-pretty">{checkErrorMsg}</p>
            </div>
          )}

          {/* 检查更新按钮：仅 Android 环境显示 */}
          {isAndroid && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs border-border"
              onClick={handleCheckUpdate}
              disabled={checkState === 'checking'}
            >
              {checkState === 'checking' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  检查中…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  检查更新
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* 作者 */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">作者</h2>
        <div className="flex items-center gap-3">
          {/* 头像 */}
          <div className="w-10 h-10 rounded-full border border-border shrink-0 overflow-hidden">
            <img
              src="https://miaoda-conversation-file.cdn.bcebos.com/user-a7uyohzdep6o/app-bgc5z86utjwh/20260513/头像.png"
              alt="作者头像"
              className="w-full h-full object-cover"
            />
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

