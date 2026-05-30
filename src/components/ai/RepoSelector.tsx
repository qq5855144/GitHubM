// 仓库选择器：memo 优化 + @tanstack/react-virtual 虚拟滚动
// 虚拟化后无论仓库数量多少（几百~几千），DOM 节点始终保持在可视区行数附近
import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Star, Lock, Globe, ChevronRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { getUserRepos } from '@/services/github';
import type { GitHubRepo } from '@/types/types';
import i18n from "@/i18n";

// 虚拟行高：仓库卡片固定行高，virtualizer 估算用
const ITEM_HEIGHT = 72; // px  (与下方卡片 py-3 + 两行内容实际高度一致)
const OVERSCAN   = 5;  // 可视区外额外渲染的行数（上下各 5 行，平滑滚动更顺畅）

interface RepoSelectorProps {
  onSelect: (repo: GitHubRepo) => void;
}

const RepoSelector = memo(function RepoSelector({ onSelect }: RepoSelectorProps) {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // 虚拟滚动容器 ref（直接是 overflow-y-auto 的 div）
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await getUserRepos({ sort: 'updated', per_page: 30, page: p, type: 'all' });
      if (p === 1) setRepos(res.data);
      else setRepos(prev => [...prev, ...res.data]);
      setHasMore(res.hasNextPage);
      setPage(p);
    } catch {
      toast.error(i18n.t('获取仓库列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);

  const filtered = repos.filter(r =>
    r.full_name.toLowerCase().includes(query.toLowerCase()) ||
    (r.description || '').toLowerCase().includes(query.toLowerCase())
  );

  // ── 虚拟滚动 ──────────────────────────────────────────────────────
  // "加载更多"行追加为最后一个虚拟项，避免在 DOM 之外渲染真实按钮
  const hasLoadMore = hasMore && !loading;
  const virtualCount = filtered.length + (hasLoadMore ? 1 : 0);

  const virtualizer = useVirtualizer({
    count: virtualCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight  = virtualizer.getTotalSize();

  return (
    <div className="flex flex-col gap-4 w-full max-w-lg">
      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9 px-9"
          placeholder={i18n.t('搜索仓库名称或描述…')}
          value={query}
          onChange={e => { setQuery(e.target.value); }}
        />
      </div>

      {/* 虚拟列表容器 */}
      <div
        ref={scrollContainerRef}
        className="h-[360px] rounded-lg border border-border overflow-y-auto"
      >
        {/* 骨架屏（首次加载） */}
        {loading && repos.length === 0 ? (
          <div className="flex flex-col divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-3 flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3 bg-muted" />
                <Skeleton className="h-3 w-full bg-muted" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {query ? `未找到匹配 "${query}" 的仓库` : i18n.t('暂无仓库')}
          </div>
        ) : (
          /* 虚拟滚动：固定总高度容器 + 绝对定位偏移每行 */
          <div style={{ height: totalHeight, position: 'relative' }}>
            {virtualItems.map(vItem => {
              const isLoadMore = vItem.index === filtered.length;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  {isLoadMore ? (
                    /* 加载更多行 */
                    <button
                      onClick={() => load(page + 1)}
                      className="w-full p-3 text-center text-sm text-primary hover:bg-muted/60 transition-colors border-t border-border"
                    >
                      {i18n.t('加载更多仓库…')}</button>
                  ) : (
                    /* 仓库行 */
                    <button
                      onClick={() => onSelect(filtered[vItem.index])}
                      className="flex items-start gap-3 p-3 text-left hover:bg-muted/60 transition-colors group w-full border-b border-border last:border-b-0"
                    >
                      {(() => {
                        const repo = filtered[vItem.index];
                        return (
                          <>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-medium text-foreground truncate">
                                  {repo.full_name}
                                </span>
                                {repo.private
                                  ? <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
                                  : <Globe className="w-3 h-3 text-muted-foreground shrink-0" />}
                              </div>
                              {repo.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 text-pretty">
                                  {repo.description}
                                </p>
                              )}
                              <div className="flex items-center gap-3 mt-1">
                                {repo.language && (
                                  <span className="text-[10px] text-muted-foreground">{repo.language}</span>
                                )}
                                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                  <Star className="w-3 h-3" />{repo.stargazers_count}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {repo.default_branch}
                                </span>
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </>
                        );
                      })()}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 分页加载中提示 */}
        {loading && repos.length > 0 && (
          <div className="p-3 text-center text-xs text-muted-foreground sticky bottom-0 bg-background/80 backdrop-blur-sm border-t border-border">
            {i18n.t('加载中…')}</div>
        )}
      </div>

      {/* 刷新按钮 */}
      <button
        onClick={() => load(1)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors self-end"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        {i18n.t('刷新列表')}</button>
    </div>
  );
});

export default RepoSelector;
