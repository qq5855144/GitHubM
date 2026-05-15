// 粉丝 / 关注列表页

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Users, ExternalLink, ChevronLeft, Loader2, UserPlus, UserMinus, UserCheck, Search, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { getFollowers, getFollowing, followUser, unfollowUser, searchUsers } from '@/services/github';
import type { GitHubUser } from '@/types/types';
import { toast } from 'sonner';

type ListType = 'followers' | 'following';

export default function FollowListPage() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const listType = (type === 'following' ? 'following' : 'followers') as ListType;
  const title = listType === 'followers' ? '我的粉丝' : '正在关注';
  const emptyText = listType === 'followers' ? '暂无粉丝' : '尚未关注任何人';

  const [list, setList] = useState<GitHubUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // 每行关注状态 & 操作中状态
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());
  const [actioningSet, setActioningSet] = useState<Set<string>>(new Set());

  // 搜索并添加关注弹窗
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GitHubUser[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PER_PAGE = 30;

  const loadPage = useCallback(
    async (p: number) => {
      if (!user) return;
      const isFirst = p === 1;
      isFirst ? setLoading(true) : setLoadingMore(true);
      try {
        const data =
          listType === 'followers'
            ? await getFollowers(user.login, p, PER_PAGE)
            : await getFollowing(user.login, p, PER_PAGE);
        setList((prev) => (isFirst ? data : [...prev, ...data]));
        setHasMore(data.length === PER_PAGE);
        // following 列表：所有人都在关注中
        if (listType === 'following') {
          setFollowingSet((prev) => {
            const next = new Set(prev);
            data.forEach((u) => next.add(u.login));
            return next;
          });
        }
      } catch {
        toast.error(`加载${title}失败`);
      } finally {
        isFirst ? setLoading(false) : setLoadingMore(false);
      }
    },
    [user, listType, title]
  );

  useEffect(() => {
    setList([]);
    setPage(1);
    setHasMore(true);
    setFollowingSet(new Set());
    loadPage(1);
  }, [loadPage]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    loadPage(next);
  };

  // 关注 / 取消关注
  const handleToggleFollow = async (targetLogin: string) => {
    setActioningSet((prev) => new Set(prev).add(targetLogin));
    const isFollowing = followingSet.has(targetLogin);
    try {
      if (isFollowing) {
        await unfollowUser(targetLogin);
        setFollowingSet((prev) => { const next = new Set(prev); next.delete(targetLogin); return next; });
        // following 列表直接移除该行，粉丝列表仅更新图标
        if (listType === 'following') {
          setList((prev) => prev.filter((u) => u.login !== targetLogin));
        }
        toast.success(`已取消关注 @${targetLogin}`);
      } else {
        await followUser(targetLogin);
        setFollowingSet((prev) => new Set(prev).add(targetLogin));
        toast.success(`已关注 @${targetLogin}`);
      }
    } catch {
      toast.error('操作失败，请重试');
    } finally {
      setActioningSet((prev) => { const next = new Set(prev); next.delete(targetLogin); return next; });
    }
  };

  // 搜索用户（防抖）
  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await searchUsers(value.trim(), { per_page: 8 });
        setSearchResults(result.items);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);
  };

  // 从搜索结果关注
  const handleFollowFromSearch = async (targetLogin: string) => {
    setActioningSet((prev) => new Set(prev).add(targetLogin));
    try {
      await followUser(targetLogin);
      setFollowingSet((prev) => new Set(prev).add(targetLogin));
      toast.success(`已关注 @${targetLogin}`);
    } catch {
      toast.error('关注失败，请重试');
    } finally {
      setActioningSet((prev) => { const next = new Set(prev); next.delete(targetLogin); return next; });
    }
  };

  const isCurrentUser = (login: string) => user?.login === login;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-foreground h-9 w-9"
          onClick={() => navigate(-1)}
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Users className="w-5 h-5 text-primary shrink-0" />
          <h1 className="text-lg font-bold text-foreground text-balance">{title}</h1>
          {!loading && (
            <span className="text-sm text-muted-foreground shrink-0">
              ({list.length}{hasMore ? '+' : ''})
            </span>
          )}
        </div>
        {/* 添加关注按钮（仅 following 页面显示） */}
        {listType === 'following' && (
          <Button
            size="sm"
            className="shrink-0 h-8 gap-1.5 text-xs"
            onClick={() => { setSearchOpen(true); setSearchQuery(''); setSearchResults([]); }}
          >
            <UserPlus className="w-3.5 h-3.5" />
            添加关注
          </Button>
        )}
      </div>

      {/* 列表 */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="w-10 h-10 rounded-full bg-muted shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-3.5 w-28 bg-muted" />
                  <Skeleton className="h-3 w-20 bg-muted" />
                </div>
                <Skeleton className="h-7 w-20 bg-muted rounded-md shrink-0" />
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">{emptyText}</div>
        ) : (
          <div className="divide-y divide-border">
            {list.map((u) => {
              const actioning = actioningSet.has(u.login);
              const isFollowing = followingSet.has(u.login);
              const isSelf = isCurrentUser(u.login);
              return (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors">
                  <Avatar className="w-10 h-10 shrink-0">
                    <AvatarImage src={u.avatar_url} alt={u.login} />
                    <AvatarFallback className="bg-secondary text-secondary-foreground text-sm font-semibold">
                      {u.login.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {u.name || u.login}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">@{u.login}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* 查看主页 */}
                    <a href={u.html_url} target="_blank" rel="noopener noreferrer">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        主页
                      </Button>
                    </a>
                    {/* 关注 / 取消关注（不显示自己） */}
                    {!isSelf && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={actioning}
                        onClick={() => handleToggleFollow(u.login)}
                        className={`h-7 px-2 text-xs gap-1 ${
                          isFollowing
                            ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                            : 'text-primary hover:bg-primary/10'
                        }`}
                      >
                        {actioning ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : isFollowing ? (
                          <><UserMinus className="w-3 h-3" />取消关注</>
                        ) : (
                          <><UserPlus className="w-3 h-3" />关注</>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 加载更多 */}
        {!loading && hasMore && (
          <div className="px-4 py-3 border-t border-border">
            <Button
              variant="ghost"
              className="w-full text-sm text-muted-foreground hover:text-foreground hover:bg-secondary h-9"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />加载中...</>
              ) : (
                '加载更多'
              )}
            </Button>
          </div>
        )}
      </div>

      {/* 搜索并添加关注弹窗 */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-primary" />
              搜索并关注用户
            </DialogTitle>
            <DialogDescription>输入用户名搜索 GitHub 用户</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            {/* 搜索框 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9 pr-8"
                placeholder="输入用户名…"
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                  onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 搜索结果 */}
            <div className="min-h-[120px] max-h-72 overflow-y-auto rounded-lg border border-border">
              {searching ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />搜索中…
                </div>
              ) : searchResults.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                  {searchQuery ? '未找到相关用户' : '请输入用户名进行搜索'}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {searchResults.map((u) => {
                    const actioning = actioningSet.has(u.login);
                    const isFollowing = followingSet.has(u.login);
                    const isSelf = isCurrentUser(u.login);
                    return (
                      <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/40 transition-colors">
                        <Avatar className="w-8 h-8 shrink-0">
                          <AvatarImage src={u.avatar_url} alt={u.login} />
                          <AvatarFallback className="bg-secondary text-xs font-semibold">
                            {u.login.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{u.name || u.login}</p>
                          <p className="text-xs text-muted-foreground">@{u.login}</p>
                        </div>
                        {!isSelf && (
                          <Button
                            size="sm"
                            variant={isFollowing ? 'ghost' : 'default'}
                            disabled={actioning}
                            onClick={() => {
                              if (isFollowing) {
                                handleToggleFollow(u.login);
                              } else {
                                handleFollowFromSearch(u.login);
                              }
                            }}
                            className={`h-7 px-2.5 text-xs gap-1 shrink-0 ${
                              isFollowing
                                ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                                : ''
                            }`}
                          >
                            {actioning ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : isFollowing ? (
                              <><UserCheck className="w-3 h-3" />已关注</>
                            ) : (
                              <><UserPlus className="w-3 h-3" />关注</>
                            )}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
