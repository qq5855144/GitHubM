// 主布局组件 - 包含侧边栏导航 + 移动端底部 Tab 栏

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  BookOpen,
  Bell,
  Search,
  Settings,
  Menu,
  X,
  LogOut,
  ChevronDown,
  Activity,
  Code2,
  Package2,
  Users,
  Download,
  Sun,
  Moon,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  User,
  Braces,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme, type ThemeMode } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';
import i18n from "@/i18n";

// 应用 Logo（侧边栏用）——内联 SVG，无路径依赖，GitHub Pages / file:// 均可正常显示
function AppLogo({ size = 20 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-label={i18n.t('GitHub 管理器')}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path
        fill="#7c3aed"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59c.4.07.55-.17.55-.38c0-.19-.01-.82-.01-1.49c-2.01.37-2.53-.49-2.69-.94c-.09-.23-.48-.94-.82-1.13c-.28-.15-.68-.52-.01-.53c.63-.01 1.08.58 1.23.82c.72 1.21 1.87.87 2.33.66c.07-.52.28-.87.51-1.07c-1.78-.2-3.64-.89-3.64-3.95c0-.87.31-1.59.82-2.15c-.08-.2-.36-1.02.08-2.12c0 0 .67-.21 2.2.82c.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82c.44 1.1.16 1.92.08 2.12c.51.56.82 1.27.82 2.15c0 3.07-1.87 3.75-3.65 3.95c.29.25.54.73.54 1.48c0 1.07-.01 1.93-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
      />
    </svg>
  );
}

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { label: i18n.t('首页'), path: '/', icon: Home },
  { label: i18n.t('仓库'), path: '/repos', icon: BookOpen },
  { label: i18n.t('通知'), path: '/notifications', icon: Bell },
  { label: i18n.t('搜索'), path: '/search', icon: Search },
  { label: i18n.t('活动'), path: '/activity', icon: Activity },
  { label: 'Gists', path: '/gists', icon: Code2 },
  { label: 'Packages', path: '/packages', icon: Package2 },
  { label: i18n.t('账号管理'), path: '/accounts', icon: Users },
  { label: i18n.t('数据导出'), path: '/export', icon: Download },
  { label: 'GraphQL', path: '/graphql-playground', icon: Braces },
  { label: i18n.t('AI 助手'), path: '/ai-assistant', icon: Sparkles },
];

const themeIcons: Record<ThemeMode, React.ComponentType<{ className?: string }>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

// 移动端底部 Tab 导航（WebView APK 友好，5 个核心入口）
const bottomTabs = [
  { label: i18n.t('首页'),  path: '/',             icon: Home },
  { label: i18n.t('仓库'),  path: '/repos',        icon: BookOpen },
  { label: 'AI',   path: '/ai-assistant', icon: Sparkles },
  { label: i18n.t('通知'),  path: '/notifications', icon: Bell },
  { label: i18n.t('我的'),  path: '/settings',     icon: User },
];

function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  // APK 壳内由原生底部导航栏接管，隐藏 Web 端的重复导航条
  const isInAndroidApp = typeof window !== 'undefined' && !!(window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
  if (isInAndroidApp) return null;

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t border-border
                    flex items-center h-16 safe-area-inset-bottom"
         style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {bottomTabs.map((tab) => {
        const isActive =
          tab.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(tab.path);
        const Icon = tab.icon;
        return (
          <button
            key={tab.path}
            type="button"
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 h-full',
              'transition-colors duration-150',
              isActive
                ? 'text-primary'
                : 'text-sidebar-foreground/60 hover:text-sidebar-foreground active:text-primary'
            )}
            onClick={() => navigate(tab.path)}
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="text-[10px] leading-none font-medium">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function SidebarNav({
  collapsed = false,
  onClose,
}: {
  collapsed?: boolean;
  onClose?: () => void;
}) {
  const { user, rateLimit, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
    onClose?.();
  };

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      {/* Logo 区域 */}
      <div className={cn('flex items-center gap-3 px-4 py-4 border-b border-sidebar-border', collapsed && 'justify-center px-3')}>
        <div className="w-8 h-8 shrink-0 flex items-center justify-center">
          <AppLogo size={28} />
        </div>
        {!collapsed && (
          <span className="flex-1 min-w-0 font-semibold text-sidebar-foreground text-sm tracking-tight truncate">{i18n.t('GitHub 管理器')}</span>
        )}
        {/* 移动端 Sheet 模式的关闭按钮（collapsed 桌面端不显示） */}
        {onClose && !collapsed && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            aria-label={i18n.t('关闭菜单')}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 用户头像 */}
      {user && (
        <div className={cn('flex items-center gap-3 px-4 py-3 border-b border-sidebar-border', collapsed && 'justify-center px-3')}>
          <Avatar className="w-8 h-8 shrink-0 ring-2 ring-primary/20">
            <AvatarImage src={user.avatar_url} alt={user.login} />
            <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">
              {user.login.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-sidebar-foreground truncate">{user.name || user.login}</p>
              <p className="text-xs text-sidebar-foreground/50 truncate">@{user.login}</p>
            </div>
          )}
        </div>
      )}

      {/* 导航菜单 */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path));
          const Icon = item.icon;

          return collapsed ? (
            <Tooltip key={item.path}>
              <TooltipTrigger asChild>
                <Link
                  to={item.path}
                  onClick={onClose}
                  className={cn(
                    'flex items-center justify-center w-full h-9 rounded-lg transition-colors',
                    isActive
                      ? 'bg-primary/20 text-primary'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <Icon className="w-4 h-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-medium">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            <Link
              key={item.path}
              to={item.path}
              onClick={onClose}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* 底部区域 */}
      <div className="p-2 border-t border-sidebar-border space-y-0.5">
        {/* API 速率限制 */}
        {rateLimit && !collapsed && (
          <div className="px-3 py-2 mb-1">
            <div className="flex items-center justify-between text-xs text-sidebar-foreground/50 mb-1.5">
              <span>{i18n.t('API 请求')}</span>
              <span className={cn(
                rateLimit.remaining > 1000 ? 'text-success' :
                rateLimit.remaining > 100 ? 'text-warning' : 'text-destructive'
              )}>{rateLimit.remaining}/{rateLimit.limit}</span>
            </div>
            <div className="w-full h-1 bg-sidebar-accent rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  rateLimit.remaining > 1000 ? 'bg-success' :
                  rateLimit.remaining > 100 ? 'bg-warning' : 'bg-destructive'
                )}
                style={{ width: `${(rateLimit.remaining / rateLimit.limit) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* 设置 */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/settings"
                onClick={onClose}
                className={cn(
                  'flex items-center justify-center w-full h-9 rounded-lg transition-colors',
                  location.pathname === '/settings'
                    ? 'bg-primary/20 text-primary'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <Settings className="w-4 h-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{i18n.t('设置')}</TooltipContent>
          </Tooltip>
        ) : (
          <Link
            to="/settings"
            onClick={onClose}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
              location.pathname === '/settings'
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
            )}
          >
            <Settings className="w-4 h-4 shrink-0" />
            <span>{i18n.t('设置')}</span>
          </Link>
        )}

        {/* 退出登录 */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center justify-center w-full h-9 rounded-lg text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-destructive transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{i18n.t('退出登录')}</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-destructive w-full transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>{i18n.t('退出登录')}</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, rateLimit, logout } = useAuth();
  const { theme: currentTheme, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const ThemeIcon = themeIcons[currentTheme];

  const cycleTheme = () => {
    const order: ThemeMode[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(currentTheme) + 1) % order.length];
    setTheme(next);
  };

  const currentNavItem = navItems.find(
    (item) =>
      location.pathname === item.path ||
      (item.path !== '/' && location.pathname.startsWith(item.path))
  );

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* 桌面端侧边栏 */}
      <aside
        className={cn(
          'hidden lg:flex flex-col shrink-0 transition-all duration-200',
          collapsed ? 'w-14' : 'w-56'
        )}
      >
        <SidebarNav collapsed={collapsed} />
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* 顶部导航栏 */}
        <header className="sticky top-0 z-40 flex items-center h-14 px-4 gap-3 bg-card/95 backdrop-blur-sm border-b border-border">
          {/* 移动端菜单按钮 */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden text-foreground hover:bg-secondary">
                <Menu className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-56 bg-sidebar [&>button]:hidden">
              <SidebarNav onClose={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          {/* 桌面端折叠按钮 */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:flex text-muted-foreground hover:bg-secondary"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </Button>

          {/* 当前页面标题 */}
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-foreground truncate">
              {currentNavItem?.label || i18n.t('GitHub 管理器')}
            </span>
          </div>

          {/* 右侧操作区 */}
          <div className="flex items-center gap-1 shrink-0">
            {/* API 速率限制徽章 */}
            {rateLimit && (
              <Badge
                variant="outline"
                className={cn(
                  'text-xs hidden md:flex cursor-default',
                  rateLimit.remaining > 1000 ? 'border-success/40 text-success' :
                  rateLimit.remaining > 100 ? 'border-warning/40 text-warning' :
                  'border-destructive/40 text-destructive'
                )}
              >
                API: {rateLimit.remaining}
              </Badge>
            )}

            {/* 主题切换 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:bg-secondary"
                  onClick={cycleTheme}
                >
                  <ThemeIcon className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {currentTheme === 'light' ? i18n.t('当前：浅色') : currentTheme === 'dark' ? i18n.t('当前：深色') : i18n.t('当前：跟随系统')}
              </TooltipContent>
            </Tooltip>

            {/* 通知 */}
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:bg-secondary"
              onClick={() => navigate('/notifications')}
            >
              <Bell className="w-4 h-4" />
            </Button>

            {/* 用户下拉菜单 */}
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 px-2 h-9 text-foreground hover:bg-secondary">
                    <Avatar className="w-6 h-6">
                      <AvatarImage src={user.avatar_url} alt={user.login} />
                      <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">
                        {user.login.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm hidden md:block">{user.login}</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 bg-popover border-border">
                  <DropdownMenuItem onClick={() => navigate('/settings')} className="text-foreground hover:bg-secondary cursor-pointer">
                    <Settings className="w-4 h-4 mr-2" />
                    {i18n.t('个人设置')}</DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={handleLogout}
                    className="text-destructive hover:bg-secondary cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    {i18n.t('退出登录')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        {/* 页面内容 — Web 端底部留出导航栏高度，APK 内由原生导航栏占位 */}
        <main className={`flex-1 overflow-x-hidden ${typeof window !== 'undefined' && !!(window as unknown as { AndroidBridge?: unknown }).AndroidBridge ? '' : 'pb-16'} lg:pb-0`}>
          {children}
        </main>
      </div>
    </div>
  );
}
