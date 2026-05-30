// 登录页 - GitHub 令牌认证

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ExternalLink, Key, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
      style={{ display: 'block' }}
    >
      <path
        fill="#7c3aed"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59c.4.07.55-.17.55-.38c0-.19-.01-.82-.01-1.49c-2.01.37-2.53-.49-2.69-.94c-.09-.23-.48-.94-.82-1.13c-.28-.15-.68-.52-.01-.53c.63-.01 1.08.58 1.23.82c.72 1.21 1.87.87 2.33.66c.07-.52.28-.87.51-1.07c-1.78-.2-3.64-.89-3.64-3.95c0-.87.31-1.59.82-2.15c-.08-.2-.36-1.02.08-2.12c0 0 .67-.21 2.2.82c.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82c.44 1.1.16 1.92.08 2.12c.51.56.82 1.27.82 2.15c0 3.07-1.87 3.75-3.65 3.95c.29.25.54.73.54 1.48c0 1.07-.01 1.93-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
      />
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
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      {/* 语言切换 */}
      <div className="absolute top-4 right-4 z-50">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <Globe className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => changeLanguage('zh-CN')} className={i18n.language === 'zh-CN' ? 'bg-secondary' : ''}>
              简体中文
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => changeLanguage('en')} className={i18n.language === 'en' ? 'bg-secondary' : ''}>
              English
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 背景装饰 */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-accent/8 blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mx-auto mb-4">
            <AppLogo size={56} />
          </div>
          <h1 className="text-2xl font-bold text-foreground text-balance">{t('login.title')}</h1>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            {t('login.subtitle')}
          </p>
        </div>

        {/* 登录卡片 */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token" className="text-sm font-normal text-foreground">
                {t('login.tokenLabel')}
              </Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="token"
                  type="text"
                  inputMode="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={t('login.placeholder')}
                  className="pl-10 pr-10 bg-secondary border-border text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary font-mono text-sm"
                  style={showToken ? undefined : { WebkitTextSecurity: 'disc' } as React.CSSProperties}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <Alert variant="destructive" className="border-destructive bg-destructive/10">
                <AlertDescription className="text-destructive text-sm space-y-1">
                  <p>{error}</p>
                  {(error.includes('无效') || error.includes('过期') || error.includes('invalid') || error.includes('expired')) && (
                    <p className="text-xs opacity-80">{t('login.hintInvalid')}</p>
                  )}
                  {(error.includes('权限') || error.includes('permission')) && (
                    <p className="text-xs opacity-80">{t('login.hintPerm')} <code className="bg-destructive/20 px-1 rounded">repo</code> <code className="bg-destructive/20 px-1 rounded">user</code> <code className="bg-destructive/20 px-1 rounded">notifications</code></p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={loading || !token.trim()}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  {t('login.loading')}
                </span>
              ) : (
                t('login.button')
              )}
            </Button>
          </form>
        </div>

        {/* 提示信息 */}
        <div className="mt-4 bg-card border border-border rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">{t('login.howToTitle')}</h3>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>{t('login.howTo1')}</li>
            <li>{t('login.howTo2')}</li>
            <li>{t('login.howTo3')}</li>
            <li>{t('login.howTo4')}</li>
            <li>{t('login.howTo5')}</li>
          </ol>
          <a
            href="https://github.com/settings/tokens/new"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            {t('login.link')}
          </a>
        </div>

        {/* 安全说明 */}
        <p className="text-xs text-muted-foreground text-center mt-4 text-pretty">
          {t('login.security')}
        </p>
      </div>
    </div>
  );
}

