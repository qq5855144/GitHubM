// 用户主页：作者资料 + 该作者的全部仓库
//
// 背景：此前全应用没有 /users/:username 路由，点击头像/用户名只能跳转到
// github.com 或没有任何反应，用户无法在应用内查看作者主页与其仓库。
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Building2,
  Calendar,
  GitFork,
  Link2,
  Loader2,
  MapPin,
  Star,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import {
  checkFollowing,
  followUser,
  formatNumber,
  formatRelativeTime,
  getLanguageColor,
  getUserByLogin,
  getUserPublicRepos,
  getUserRepos,
  unfollowUser,
} from '@/services/github';
import type { GitHubRepo, GitHubUser } from '@/types/types';
import RepoCard from '@/components/repo/RepoCard';
import { ProfileAchievements } from '@/components/profile/ProfileAchievements';
import {
  getCachedProfileAchievements,
  loadProfileAchievements,
  type ProfileAchievement,
} from '@/services/github-achievements';
import { toast } from 'sonner';
import i18n from '@/i18n';

const PER_PAGE = 24;

function StatButton({
  icon: Icon,
  value,
  label,
  onClick,
}: {
  icon: typeof Users;
  value: number;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex items-center gap-1.5 text-sm text-muted-foreground enabled:hover:text-foreground transition-colors"
    >
      <Icon className="w-4 h-4" />
      <span className="font-semibold text-foreground">{formatNumber(value)}</span>
      <span>{label}</span>
    </button>
  );
}

export default function UserProfilePage() {
  const { username = '' } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { user: me, token } = useAuth();

  const [profile, setProfile] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [reposLoading, setReposLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [achievements, setAchievements] = useState<ProfileAchievement[]>([]);
  const [achievementsLoading, setAchievementsLoading] = useState(false);

  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followingChecked, setFollowingChecked] = useState(false);

  const isSelf = !!me && me.login.toLowerCase() === username.toLowerCase();

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setProfile(null);
    setRepos([]);
    setPage(1);
    setHasMore(true);
    setAchievements([]);
    setAchievementsLoading(false);

    getUserByLogin(username)
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        // 自己：包含私有仓库；他人：仅公开仓库
        return (isSelf
          ? getUserRepos({ type: 'owner', per_page: PER_PAGE, page: 1 })
          : getUserPublicRepos(username, { per_page: PER_PAGE, page: 1 })
        ).then((result) => {
          if (cancelled) return;
          setRepos(result.data);
          setHasMore(result.hasNextPage);
        });
      })
      .catch((err: Error & { status?: number }) => {
        if (cancelled) return;
        setNotFound(err.status === 404);
        if (err.status !== 404) toast.error(i18n.t('加载用户信息失败'));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setReposLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [username, isSelf]);

  // 加载该用户的 GitHub 官方个人成就
  useEffect(() => {
    const login = profile?.login;
    if (!login) return;
    let cancelled = false;
    const cached = getCachedProfileAchievements(login);
    if (cached.length > 0) {
      setAchievements(cached);
      setAchievementsLoading(false);
    } else {
      setAchievementsLoading(true);
    }
    loadProfileAchievements(login, token, true)
      .then((items) => {
        if (!cancelled) setAchievements(items);
      })
      .finally(() => {
        if (!cancelled) setAchievementsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.login, token]);

  // 关注状态只在「非本人」时需要
  useEffect(() => {
    if (!username || isSelf) {
      setFollowing(false);
      setFollowingChecked(true);
      return;
    }
    let cancelled = false;
    setFollowingChecked(false);
    checkFollowing(username)
      .then((value) => {
        if (!cancelled) setFollowing(value);
      })
      .finally(() => {
        if (!cancelled) setFollowingChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [username, isSelf]);

  const loadMore = useCallback(async () => {
    if (!profile || loadingMore || !hasMore) return;
    const next = page + 1;
    setLoadingMore(true);
    try {
      const result = isSelf
        ? await getUserRepos({ type: 'owner', per_page: PER_PAGE, page: next })
        : await getUserPublicRepos(profile.login, { per_page: PER_PAGE, page: next });
      setRepos((prev) => [...prev, ...result.data]);
      setHasMore(result.hasNextPage);
      setPage(next);
    } catch {
      toast.error(i18n.t('加载更多仓库失败'));
    } finally {
      setLoadingMore(false);
    }
  }, [profile, loadingMore, hasMore, page, isSelf]);

  const toggleFollow = async () => {
    if (!profile || isSelf) return;
    setFollowLoading(true);
    try {
      if (following) {
        await unfollowUser(profile.login);
        setFollowing(false);
        setProfile((prev) => (prev ? { ...prev, followers: Math.max(0, prev.followers - 1) } : prev));
        toast.success(`已取消关注 @${profile.login}`);
      } else {
        await followUser(profile.login);
        setFollowing(true);
        setProfile((prev) => (prev ? { ...prev, followers: prev.followers + 1 } : prev));
        toast.success(`已关注 @${profile.login}`);
      }
    } catch {
      toast.error(i18n.t('操作失败，请检查 Token 权限'));
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-8 w-24" />
        <div className="surface-card rounded-xl p-5 flex gap-4">
          <Skeleton className="w-20 h-20 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="p-8 text-center space-y-3">
        <Users className="w-12 h-12 mx-auto text-muted-foreground" />
        <p className="text-foreground font-medium">{i18n.t('用户不存在')}</p>
        <p className="text-sm text-muted-foreground">@{username}</p>
        <Button variant="outline" onClick={() => navigate(-1)} className="border-border">
          <ArrowLeft className="w-4 h-4 mr-2" />
          {i18n.t('返回')}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:bg-secondary -ml-2"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          {i18n.t('返回')}
        </Button>
        <span className="text-xs text-muted-foreground truncate">@{profile.login}</span>
      </div>

      {/* 资料卡 */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary/30 via-accent/20 to-transparent" />
        <div className="p-5 -mt-10">
          <div className="flex items-end gap-4 flex-wrap">
            <Avatar className="w-20 h-20 ring-4 ring-card shadow-sm">
              <AvatarImage src={profile.avatar_url} alt={profile.login} />
              <AvatarFallback className="bg-secondary text-xl font-semibold">
                {profile.login.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-foreground break-words whitespace-normal leading-snug">
                  {profile.name || profile.login}
                </h1>
                {isSelf && (
                  <Badge className="bg-primary/15 text-primary border border-primary/30 text-xs">
                    {i18n.t('这是你')}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">@{profile.login}</p>
            </div>
            <div className="flex items-center gap-2 pb-1">
              {!isSelf && followingChecked && (
                <Button
                  size="sm"
                  onClick={toggleFollow}
                  disabled={followLoading}
                  className={
                    following
                      ? 'border border-border bg-background text-foreground hover:bg-destructive/10 hover:text-destructive'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }
                  variant={following ? 'outline' : 'default'}
                >
                  {followLoading ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : following ? (
                    <UserMinus className="w-4 h-4 mr-1.5" />
                  ) : (
                    <UserPlus className="w-4 h-4 mr-1.5" />
                  )}
                  {following ? i18n.t('取消关注') : i18n.t('关注')}
                </Button>
              )}
              {/* GitHub 跳转入口已移除，统一在应用内浏览 */}
            </div>
          </div>

          {profile.bio && <p className="text-sm text-foreground mt-4 whitespace-pre-wrap">{profile.bio}</p>}

          <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3 text-xs text-muted-foreground">
            {profile.company && (
              <span className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                {profile.company}
              </span>
            )}
            {profile.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                {profile.location}
              </span>
            )}
            {profile.blog && (
              <a
                href={profile.blog.startsWith('http') ? profile.blog : `https://${profile.blog}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-accent hover:underline"
              >
                <Link2 className="w-3.5 h-3.5" />
                {profile.blog}
              </a>
            )}
            {profile.twitter_username && (
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold">𝕏</span>@{profile.twitter_username}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {i18n.t('加入于')}
              {new Date(profile.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}
            </span>
            <ProfileAchievements
              achievements={achievements}
              loading={achievementsLoading}
            />
          </div>

          <div className="flex items-center gap-5 mt-4 pt-4 border-t border-border flex-wrap">
            <StatButton
              icon={Users}
              value={profile.followers}
              label={i18n.t('关注者')}
              onClick={() => navigate(`/follow-list/followers?user=${encodeURIComponent(profile.login)}`)}
            />
            <StatButton
              icon={UserPlus}
              value={profile.following}
              label={i18n.t('正在关注')}
              onClick={() => navigate(`/follow-list/following?user=${encodeURIComponent(profile.login)}`)}
            />
            <StatButton icon={BookOpen} value={profile.public_repos} label={i18n.t('仓库')} />
            {typeof profile.public_gists === 'number' && (
              <StatButton icon={Star} value={profile.public_gists} label="Gists" />
            )}
          </div>
        </div>
      </div>

      {/* 仓库 / 关于 */}
      <Tabs defaultValue="repos" className="space-y-3">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger
            value="repos"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground"
          >
            {i18n.t('仓库')}
            {repos.length > 0 ? ` (${repos.length}${hasMore ? '+' : ''})` : ''}
          </TabsTrigger>
          <TabsTrigger
            value="about"
            className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground"
          >
            {i18n.t('资料')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="repos" className="space-y-3">
          {reposLoading ? (
            <div className="grid md:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : repos.length === 0 ? (
            <div className="bg-card border border-border rounded-xl py-12 text-center text-muted-foreground">
              <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{i18n.t('暂无公开仓库')}</p>
            </div>
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-3">
                {repos.map((repo) => (
                  <RepoCard key={repo.id} repo={repo} />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center pt-1">
                  <Button
                    variant="outline"
                    className="border-border"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    {i18n.t('加载更多')}
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="about">
          <div className="surface-card rounded-xl p-5 space-y-3 text-sm">
            <div className="grid grid-cols-[100px_1fr] gap-y-3">
              <span className="text-muted-foreground">{i18n.t('用户名')}</span>
              <span className="text-foreground font-mono">@{profile.login}</span>
              <span className="text-muted-foreground">{i18n.t('昵称')}</span>
              <span className="text-foreground">{profile.name || '—'}</span>
              <span className="text-muted-foreground">{i18n.t('简介')}</span>
              <span className="text-foreground whitespace-pre-wrap">{profile.bio || '—'}</span>
              <span className="text-muted-foreground">{i18n.t('公司')}</span>
              <span className="text-foreground">{profile.company || '—'}</span>
              <span className="text-muted-foreground">{i18n.t('所在地')}</span>
              <span className="text-foreground">{profile.location || '—'}</span>
              <span className="text-muted-foreground">{i18n.t('博客')}</span>
              <span className="text-foreground break-all">{profile.blog || '—'}</span>
              <span className="text-muted-foreground">Twitter / X</span>
              <span className="text-foreground">{profile.twitter_username ? `@${profile.twitter_username}` : '—'}</span>
              <span className="text-muted-foreground">{i18n.t('公开仓库')}</span>
              <span className="text-foreground">{profile.public_repos}</span>
              <span className="text-muted-foreground">{i18n.t('加入时间')}</span>
              <span className="text-foreground">
                {new Date(profile.created_at).toLocaleDateString('zh-CN')}
              </span>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}