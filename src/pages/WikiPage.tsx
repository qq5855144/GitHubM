// GitHub Wiki 文档管理

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  BookOpen,
  ExternalLink,
  AlertCircle,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function WikiPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [iframeError, setIframeError] = useState(false);

  const wikiUrl = `https://github.com/${owner}/${repo}/wiki`;

  return (
    <div className="p-4 md:p-6 space-y-4 h-full flex flex-col">
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap shrink-0">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>仓库</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Wiki</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3 shrink-0">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          Wiki 文档
        </h1>
        <a href={wikiUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="sm" className="border border-border text-muted-foreground hover:bg-secondary h-9">
            <ExternalLink className="w-4 h-4 mr-2" />
            在 GitHub 中编辑
          </Button>
        </a>
      </div>

      <div className="flex-1 min-h-0 bg-card border border-border rounded-lg overflow-hidden flex flex-col">
        {iframeError ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 px-6 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-foreground font-semibold text-lg mb-2">无法嵌入 Wiki 页面</p>
            <p className="text-sm text-muted-foreground text-pretty max-w-md mx-auto mb-6">
              GitHub Wiki 不允许在 iframe 中嵌入显示。请点击下方按钮前往 GitHub 网页端查看和编辑文档。
            </p>
            <div className="flex flex-col md:flex-row gap-3">
              <a href={wikiUrl} target="_blank" rel="noopener noreferrer">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  前往 GitHub Wiki
                </Button>
              </a>
              <a href={`${wikiUrl}/_edit/Home`} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" className="border border-border text-muted-foreground hover:bg-secondary">
                  <Globe className="w-4 h-4 mr-2" />
                  创建/编辑首页
                </Button>
              </a>
            </div>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-border bg-secondary/30 shrink-0 flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" />
              <a href={wikiUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-accent font-mono truncate">
                {wikiUrl}
              </a>
            </div>
            <iframe
              src={wikiUrl}
              className="w-full flex-1 min-h-0 border-0"
              title="GitHub Wiki"
              onError={() => setIframeError(true)}
              onLoad={(e) => {
                try {
                  const iframe = e.currentTarget;
                  if (!iframe.contentDocument) setIframeError(true);
                } catch {
                  setIframeError(true);
                }
              }}
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            />
          </>
        )}
      </div>

      {/* 快捷操作面板（始终可见） */}
      <div className="bg-card border border-border rounded-lg p-4 shrink-0">
        <p className="text-sm font-semibold text-foreground mb-3">Wiki 快捷操作</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: '查看 Wiki 首页', path: '' },
            { label: '创建新页面', path: '/_new' },
            { label: '页面列表', path: '/_pages' },
            { label: '历史记录', path: '/Home/_history' },
          ].map(({ label, path }) => (
            <a key={path} href={`${wikiUrl}${path}`} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" className="w-full border border-border text-muted-foreground hover:bg-secondary h-9 text-xs">
                <ExternalLink className="w-3 h-3 mr-1.5" />
                {label}
              </Button>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
