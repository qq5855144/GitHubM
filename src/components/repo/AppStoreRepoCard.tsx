import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, GitFork, Star } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { formatNumber, formatRelativeTime, getLanguageColor } from '@/services/github';
import type { GitHubRepo } from '@/types/types';
import i18n from '@/i18n';

interface AppStoreRepoCardProps {
  repo: GitHubRepo;
  /** 覆盖默认跳转（默认进入本项目仓库详情页） */
  onClick?: () => void;
  /** 右上角自定义操作区（如右键菜单触发） */
  actions?: React.ReactNode;
  className?: string;
}

/** GitHub 头像 CDN 直链：省掉 github.com/xxx.png 的一次跳转 */
function avatarUrl(login: string): string {
  return `https://avatars.githubusercontent.com/${login}?size=120`;
}

/**
 * 应用商店风格仓库卡片（搜索页专用）
 * 结构参考「开源应用商店」：左侧大图标 + 右侧标题/描述/元信息 + 「查看」胶囊按钮
 */
export default function AppStoreRepoCard({
  repo,
  onClick,
  actions,
  className,
}: AppStoreRepoCardProps) {
  const navigate = useNavigate();
  const open = onClick ?? (() => navigate(`/repos/${repo.full_name}`));
  const displayName = repo.name || repo.full_name.split('/')[1] || repo.full_name;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      className={cn(
        'w-full bg-card border border-border rounded-2xl text-left cursor-pointer',
        'p-4 hover:border-primary/40 hover:bg-secondary/20 active:scale-[0.995] transition-all',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {/* 应用图标 */}
        <Avatar className="h-16 w-16 rounded-2xl shrink-0 border border-border bg-secondary">
          <AvatarImage
            src={repo.owner?.avatar_url || avatarUrl(repo.owner?.login ?? '')}
            alt={repo.owner?.login ?? displayName}
            className="rounded-2xl object-cover"
            loading="lazy"
          />
          <AvatarFallback className="rounded-2xl bg-secondary text-base font-semibold text-muted-foreground">
            {displayName.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        {/* 主体信息 */}
        <div className="flex-1 min-w-0">
          {/* 标题行：名称 + 查看胶囊 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-semibold text-foreground truncate">{displayName}</span>
                {repo.archived && (
                  <span className="shrink-0 text-[10px] leading-4 px-1.5 rounded border border-border text-muted-foreground">
                    {i18n.t('已归档')}
                  </span>
                )}
                {repo.fork && (
                  <span className="shrink-0 text-[10px] leading-4 px-1.5 rounded border border-border text-muted-foreground">
                    Fork
                  </span>
                )}
              </div>
              <span className="block text-xs text-muted-foreground truncate mt-0.5">
                {repo.full_name}
              </span>
            </div>

            {actions ? (
              <div className="shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
                {actions}
              </div>
            ) : (
              <span
                className="shrink-0 inline-flex items-center gap-0.5 pl-3 pr-2 py-1 rounded-full border-[1.5px] border-primary text-primary text-[13px] font-semibold leading-none"
                aria-hidden
              >
                {i18n.t('查看')}
                <ChevronRight className="w-3.5 h-3.5" />
              </span>
            )}
          </div>

          {/* 简介 */}
          {repo.description && (
            <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 text-pretty">
              {repo.description}
            </p>
          )}

          {/* 元信息行 */}
          <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground flex-wrap">
            {repo.language && (
              <span className="flex items-center gap-1 shrink-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: getLanguageColor(repo.language) }}
                />
                {repo.language}
              </span>
            )}
            <span className="flex items-center gap-0.5 shrink-0">
              <Star className="w-3 h-3" />
              {formatNumber(repo.stargazers_count)}
            </span>
            <span className="flex items-center gap-0.5 shrink-0">
              <GitFork className="w-3 h-3" />
              {formatNumber(repo.forks_count)}
            </span>
            {repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' && (
              <span className="shrink-0 truncate max-w-[7rem]">{repo.license.spdx_id}</span>
            )}
            <span className="ml-auto shrink-0">
              {formatRelativeTime(repo.pushed_at || repo.updated_at)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
