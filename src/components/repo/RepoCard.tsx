import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Star, GitFork } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatNumber, formatRelativeTime, getLanguageColor } from '@/services/github';
import type { GitHubRepo } from '@/types/types';
import i18n from '@/i18n';

interface RepoCardProps {
  repo: GitHubRepo;
  onClick?: () => void;
  actions?: React.ReactNode;
  showOwner?: boolean;
  className?: string;
  compact?: boolean;
}

/** 全站统一仓库卡片：首页 / 仓库列表 / 搜索 / 用户主页 */
export default function RepoCard({
  repo,
  onClick,
  actions,
  showOwner = false,
  className,
  compact = false,
}: RepoCardProps) {
  const navigate = useNavigate();
  const open = onClick ?? (() => navigate(`/repos/${repo.full_name}`));

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      className={cn(
        'w-full bg-card border border-border rounded-xl text-left group cursor-pointer',
        'hover:bg-secondary/30 active:scale-[0.99] transition-all',
        compact ? 'p-3' : 'p-4',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <BookOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            {showOwner && (
              <span className="text-xs text-muted-foreground truncate">{repo.owner.login}/</span>
            )}
            <span className="text-sm font-semibold text-accent group-hover:underline truncate">
              {repo.name}
            </span>
            {repo.private && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border text-muted-foreground">
                {i18n.t('私有')}
              </Badge>
            )}
            {repo.fork && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border text-muted-foreground">
                Fork
              </Badge>
            )}
            {repo.archived && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border text-muted-foreground">
                {i18n.t('已归档')}
              </Badge>
            )}
          </div>

          {repo.description && (
            <p className={cn(
              'text-xs text-muted-foreground mt-1.5 text-pretty',
              compact ? 'line-clamp-1' : 'line-clamp-2',
            )}>
              {repo.description}
            </p>
          )}

          <div className="flex items-center gap-3 mt-2.5 text-xs text-muted-foreground flex-wrap">
            {repo.language && (
              <span className="flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: getLanguageColor(repo.language) }}
                />
                {repo.language}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Star className="w-3.5 h-3.5" />
              {formatNumber(repo.stargazers_count)}
            </span>
            <span className="flex items-center gap-1">
              <GitFork className="w-3.5 h-3.5" />
              {formatNumber(repo.forks_count)}
            </span>
            <span className="ml-auto shrink-0">
              {formatRelativeTime(repo.pushed_at || repo.updated_at)}
            </span>
          </div>
        </div>

        {actions && (
          <div className="flex items-center gap-0.5 shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
