// 登录页 - GitHub 令牌认证

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ExternalLink, Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

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
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError('请输入 GitHub 令牌');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await login(token.trim());
      toast.success('登录成功！欢迎使用 GitHub 管理器');
      navigate('/');
    } catch (err) {
      const status = (err as Error & { status?: number })?.status;
      const message = err instanceof Error ? err.message : '登录失败';

      if (status === 401 || message.includes('Bad credentials') || message.includes('Requires authentication')) {
        setError('令牌无效或已过期，请重新生成后重试');
      } else if (status === 403) {
        setError('令牌权限不足，请确保令牌包含 repo、user、notifications 权限');
      } else if (status === 404) {
        setError('无法获取用户信息，请确认令牌有效');
      } else if (
        message.includes('Failed to fetch') ||
        message.includes('NetworkError') ||
        message.includes('Network request failed') ||
        !window.navigator.onLine
      ) {
        setError('网络连接失败，请检查网络后重试');
      } else {
        setError(`登录失败：${message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
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
          <h1 className="text-2xl font-bold text-foreground text-balance">GitHub 管理器</h1>
          <p className="text-muted-foreground mt-2 text-sm text-pretty">
            通过 GitHub Personal Access Token 安全登录
          </p>
        </div>

        {/* 登录卡片 */}
        <div className="bg-card border border-border rounded-xl p-6 shadow-lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token" className="text-sm font-normal text-foreground">
                Personal Access Token
              </Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="token"
                  type="text"
                  inputMode="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
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
                  {(error.includes('无效') || error.includes('过期')) && (
                    <p className="text-xs opacity-80">请前往 GitHub → Settings → Developer settings → Personal access tokens 重新生成</p>
                  )}
                  {error.includes('权限') && (
                    <p className="text-xs opacity-80">生成 Token 时请勾选：<code className="bg-destructive/20 px-1 rounded">repo</code> <code className="bg-destructive/20 px-1 rounded">user</code> <code className="bg-destructive/20 px-1 rounded">notifications</code></p>
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
                  验证中...
                </span>
              ) : (
                '登录'
              )}
            </Button>
          </form>
        </div>

        {/* 提示信息 */}
        <div className="mt-4 bg-card border border-border rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">如何获取 Personal Access Token？</h3>
          <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
            <li>登录 GitHub，进入 Settings → Developer Settings</li>
            <li>选择 Personal access tokens → Tokens (classic)</li>
            <li>点击 Generate new token</li>
            <li>选择所需权限：<code className="bg-secondary px-1 rounded text-foreground">repo</code>、<code className="bg-secondary px-1 rounded text-foreground">notifications</code>、<code className="bg-secondary px-1 rounded text-foreground">user</code></li>
            <li>生成并复制令牌</li>
          </ol>
          <a
            href="https://github.com/settings/tokens/new"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            前往 GitHub 创建令牌
          </a>
        </div>

        {/* 安全说明 */}
        <p className="text-xs text-muted-foreground text-center mt-4 text-pretty">
          令牌仅保存在本地浏览器中，不会上传至任何服务器
        </p>
      </div>
    </div>
  );
}

