// 全局错误边界 — 捕获任何渲染异常，防止整页空白
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import i18n from "@/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 生产环境记录错误，方便排查
    console.error(i18n.t('[ErrorBoundary] 捕获到渲染错误:'), error, info.componentStack);
  }

  handleReload = () => {
    // 重置错误状态后刷新到首页
    this.setState({ hasError: false, error: null });
    window.location.hash = '/';
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.hash = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
          <div className="flex flex-col items-center gap-6 max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-semibold text-foreground text-balance">{i18n.t('页面出现了一个错误')}</h1>
              <p className="text-sm text-muted-foreground text-pretty">
                {i18n.t('应用遇到了意外错误。你可以尝试刷新页面或返回首页。')}</p>
              {this.state.error && (
                <p className="text-xs font-mono text-muted-foreground/70 bg-muted rounded px-3 py-2 mt-2 text-left break-words">
                  {this.state.error.message}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="border-border hover:bg-secondary"
                onClick={this.handleGoHome}
              >
                <Home className="w-4 h-4 mr-2" />
                {i18n.t('返回首页')}</Button>
              <Button onClick={this.handleReload}>
                <RefreshCw className="w-4 h-4 mr-2" />
                {i18n.t('刷新页面')}</Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
