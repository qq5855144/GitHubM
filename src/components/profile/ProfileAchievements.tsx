// GitHub 官方个人成就徽章
//
// 首页个人卡片和用户主页共用同一套展示规则：
// - 不超过 4 枚时全部展示
// - 超过 4 枚时展示前 4 枚，并在右上角显示 +N
// - 点击整行打开全部成就弹窗
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProfileAchievement } from '@/services/github-achievements';
import i18n from '@/i18n';

const ACHIEVEMENT_TIER_LABELS: Record<string, string> = {
  bronze: i18n.t('青铜'),
  silver: i18n.t('白银'),
  gold: i18n.t('黄金'),
};

function achievementMetaParts(achievement: ProfileAchievement): string[] {
  return [
    achievement.tier ? (ACHIEVEMENT_TIER_LABELS[achievement.tier] || achievement.tier) : null,
    achievement.count && achievement.count > 1 ? `x${achievement.count}` : null,
  ].filter((value): value is string => Boolean(value));
}

function AchievementBadge({ achievement }: { achievement: ProfileAchievement }) {
  const titleParts = [achievement.name, ...achievementMetaParts(achievement)];
  return (
    <div className="relative shrink-0" title={titleParts.join(' · ')}>
      <img
        src={achievement.iconUrl}
        alt={`GitHub ${i18n.t('成就')}: ${achievement.name}`}
        className="w-8 h-8 object-contain"
        loading="lazy"
        decoding="async"
      />
      {achievement.count && achievement.count > 1 && (
        <span className="absolute -right-1 -bottom-1 min-w-4 h-4 px-1 inline-flex items-center justify-center rounded-full border border-border bg-popover text-[9px] font-semibold leading-none text-foreground">
          x{achievement.count}
        </span>
      )}
    </div>
  );
}

interface ProfileAchievementsProps {
  achievements: ProfileAchievement[];
  loading?: boolean;
  className?: string;
}

export function ProfileAchievements({
  achievements,
  loading = false,
  className = '',
}: ProfileAchievementsProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const rootClass = `flex items-center gap-1.5 shrink-0 ${className}`.trim();

  if (loading && achievements.length === 0) {
    return (
      <div className={rootClass} aria-label={i18n.t('GitHub 个人成就')}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="w-8 h-8 rounded-full bg-muted" />
        ))}
      </div>
    );
  }

  if (achievements.length === 0) return null;

  return (
    <>
      <div className={rootClass} aria-label={i18n.t('GitHub 个人成就')}>
        {achievements.length > 4 ? (
          <button
            type="button"
            className="relative flex items-center gap-1.5 shrink-0 rounded-lg cursor-pointer active:opacity-75 transition-opacity"
            aria-haspopup="dialog"
            aria-label={`${i18n.t('GitHub 个人成就')}，${i18n.t('共')} ${achievements.length} ${i18n.t('枚')}，${i18n.t('查看全部')}`}
            title={i18n.t('查看全部成就')}
            onClick={() => setDialogOpen(true)}
          >
            {achievements.slice(0, 4).map((achievement) => (
              <AchievementBadge key={achievement.slug} achievement={achievement} />
            ))}
            <span className="absolute -right-2 -top-2 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full border border-border bg-popover text-[9px] font-semibold leading-none text-foreground shadow-sm">
              +{achievements.length - 4}
            </span>
          </button>
        ) : (
          achievements.map((achievement) => (
            <AchievementBadge key={achievement.slug} achievement={achievement} />
          ))
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {i18n.t('GitHub 个人成就')}
              <Badge variant="outline" className="border-border text-muted-foreground text-xs">
                {achievements.length}
              </Badge>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {i18n.t('共获得')} {achievements.length} {i18n.t('枚官方成就徽章')}
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1 pb-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {achievements.map((achievement) => {
                const meta = achievementMetaParts(achievement);
                return (
                  <div
                    key={achievement.slug}
                    className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-2.5"
                  >
                    <img
                      src={achievement.iconUrl}
                      alt={achievement.name}
                      className="w-10 h-10 shrink-0 object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{achievement.name}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {meta.length > 0 ? meta.join(' · ') : i18n.t('已获得')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
