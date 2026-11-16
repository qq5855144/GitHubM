// 登录页 - GitHub 令牌认证

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronDown, Eye, EyeOff, ExternalLink, Globe, Key, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

// 应用 Logo（登录页用）——内联 SVG，无路径依赖，GitHub Pages / file:// 均可正常显示
function AppLogo({ size = 48 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-label="GitHub 管理器"
      className="text-primary"
      fill="currentColor"
      style={{ display: 'block' }}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59c.4.07.55-.17.55-.38c0-.19-.01-.82-.01-1.49c-2.01.37-2.53-.49-2.69-.94c-.09-.23-.48-.94-.82-1.13c-.28-.15-.68-.52-.01-.53c.63-.01 1.08.58 1.23.82c.72 1.21 1.87.87 2.33.66c.07-.52.28-.87.51-1.07c-1.78-.2-3.64-.89-3.64-3.95c0-.87.31-1.59.82-2.15c-.08-.2-.36-1.02.08-2.12c0 0 .67-.21 2.2.82c.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82c.44 1.1.16 1.92.08 2.12c.51.56.82 1.27.82 2.15c0 3.07-1.87 3.75-3.65 3.95c.29.25.54.73.54 1.48c0 1.07-.01 1.93-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
    </svg>
  );
}

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('app_language', lng);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError(t('login.errorEmpty'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      await login(token.trim());
      toast.success(t('login.success'));
      navigate('/');
    } catch (err) {
      const status = (err as Error & { status?: number })?.status;
      const message = err instanceof Error ? err.message : 'Login failed';

      if (status === 401 || message.includes('Bad credentials') || message.includes('Requires authentication')) {
        setError(t('login.errInvalid'));
      } else if (status === 403) {
        setError(t('login.errPerm'));
      } else if (status === 404) {
        setError(t('login.errFetch'));
      } else if (
        message.includes('Failed to fetch') ||
        message.includes('NetworkError') ||
        message.includes('Network request failed') ||
        !window.navigator.onLine
      ) {
        setError(t('login.errNetwork'));
      } else {
        setError(t('login.errFail', { message }));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg relative flex min-h-screen flex-col overflow-x-hidden">
      {/* 语言切换 */}
      <div className="absolute right-4 top-4 z-50">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-1.5 rounded-full px-3 text-muted-foreground hover:text-foreground">
              <Globe className="h-4 w-4" />
              <span className="text-xs font-medium">{i18n.language === 'en' ? 'EN' : '中文'}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={() => changeLanguage('zh-CN')} className={i18n.language === 'zh-CN' ? 'bg-secondary' : ''}>
              简体中文
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => changeLanguage('en')} className={i18n.language === 'en' ? 'bg-secondary' : ''}>
              English
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-1 items-center justify-center px-5 py-14">
        <div className="w-full max-w-[400px]">
          {/* Logo 与标题 */}
          <div className="mb-7 flex flex-col items-center text-center">
            <div className="login-logo-tile mb-5 flex h-[76px] w-[76px] items-center justify-center">
              <AppLogo size={42} />
            </div>
            <h1 className="text-[24px] font-semibold tracking-tight text-foreground">{t('login.title')}</h1>
            <p className="mt-1.5 text-pretty text-sm text-muted-foreground">{t('login.subtitle')}</p>
          </div>

          {/* 登录卡片 */}
          <div className="login-card p-5 sm:p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token" className="pl-1 text-[13px] font-medium text-muted-foreground">
                  {t('login.tokenLabel')}
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Key className="h-3.5 w-3.5" />
                  </span>
                  <Input
                    id="token"
                    type="text"
                    inputMode="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={t('login.placeholder')}
                    className="login-field h-12 rounded-2xl pl-12 pr-12 font-mono text-[15px] text-foreground placeholder:font-sans placeholder:text-muted-foreground"
                    style={showToken ? undefined : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/[0.08]"
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex gap-2.5 rounded-2xl bg-destructive/10 px-3.5 py-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="space-y-1 text-[13px] leading-relaxed text-destructive">
                    <p>{error}</p>
                    {(error.includes('无效') || error.includes('过期') || error.includes('invalid') || error.includes('expired')) && (
                      <p className="text-xs opacity-80">{t('login.hintInvalid')}</p>
                    )}
                    {(error.includes('权限') || error.includes('permission')) && (
                      <p className="text-xs opacity-80">
                        {t('login.hintPerm')}{' '}
                        <code className="rounded bg-destructive/20 px-1">repo</code>{' '}
                        <code className="rounded bg-destructive/20 px-1">user</code>{' '}
                        <code className="rounded bg-destructive/20 px-1">notifications</code>
                      </p>
                    )}
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !token.trim()}
                className="login-cta flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    {t('login.loading')}
                  </span>
                ) : (
                  t('login.button')
                )}
              </button>
            </form>
          </div>

          {/* 获取令牌指引 */}
          <div className="login-tip-card mt-4 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-foreground">{t('login.howToTitle')}</span>
              <a
                href="https://github.com/settings/tokens/new"
                target="_blank"
                rel="noopener noreferrer"
                className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
              >
                {t('login.link')}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <ol className="mt-3 space-y-2">
              {[1, 2, 3, 4, 5].map((step) => (
                <li key={step} className="flex gap-2.5 text-xs leading-relaxed text-muted-foreground">
                  <span className="mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground">
                    {step}
                  </span>
                  <span>{t(`login.howTo${step}`)}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* 安全说明 */}
          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            {t('login.security')}
          </p>
        </div>
      </div>
    </div>
  );
}
