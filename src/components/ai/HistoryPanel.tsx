// 历史会话面板：memo 优化 + @tanstack/react-virtual 虚拟滚动
// 扁平化分组项（section 标题 + 会话行）统一放入 virtualizer，解决分组标题随数据增长仍重渲染问题
import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Trash2, MessageSquare, X, CheckSquare, Square, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetClose } from '@/components/ui/sheet';
import type { ChatSession, ChatSessionMessage } from './aiTypes';
import { fetchSessions, fetchSessionMessages, deleteSession } from './aiSupabase';
import i18n from "@/i18n";

// 虚拟行类型：区分 section 标题行 和 会话数据行
type VirtualRow =
  | { kind: 'header'; repo: string }
  | { kind: 'session'; session: ChatSession };

const SESSION_HEIGHT = 60;  // px — 会话行估算高度
const HEADER_HEIGHT  = 32;  // px — 分组标题行估算高度
const OVERSCAN       = 5;

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  login: string;
  onLoad: (session: ChatSession, messages: ChatSessionMessage[]) => void;
}

const HistoryPanel = memo(function HistoryPanel({
  open,
  onClose,
  login,
  onLoad,
}: HistoryPanelProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // 批量删除状态
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // 虚拟滚动容器 ref
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!login) return;
    setLoading(true);
    const data = await fetchSessions(login);
    setSessions(data);
    setLoading(false);
  }, [login]);

  useEffect(() => {
    if (open) { load(); }
    else { setSelectMode(false); setSelected(new Set()); }
  }, [open, load]);

  const handleLoad = async (session: ChatSession) => {
    if (selectMode) return; // 选择模式下点击行为切换选中，不加载
    const msgs = await fetchSessionMessages(session.id);
    onLoad(session, msgs);
    onClose();
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(id);
    await deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    setDeleting(null);
    toast.success(i18n.t('对话已删除'));
  };

  // ── 批量删除 ──────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === sessions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sessions.map(s => s.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    const ids = Array.from(selected);
    await Promise.all(ids.map(id => deleteSession(id)));
    setSessions(prev => prev.filter(s => !selected.has(s.id)));
    setSelected(new Set());
    setSelectMode(false);
    setBulkDeleting(false);
    toast.success(`已删除 ${ids.length} 条对话`);
  };

  const allSelected = sessions.length > 0 && selected.size === sessions.length;
  const someSelected = selected.size > 0;

  // ── 构建扁平化虚拟行列表（分组标题 + 会话行交叉排列）──────────────
  const rows = (() => {
    const grouped: Record<string, ChatSession[]> = {};
    for (const s of sessions) {
      if (!grouped[s.repo_full_name]) grouped[s.repo_full_name] = [];
      grouped[s.repo_full_name].push(s);
    }
    const result: VirtualRow[] = [];
    for (const [repo, items] of Object.entries(grouped)) {
      result.push({ kind: 'header', repo });
      for (const s of items) result.push({ kind: 'session', session: s });
    }
    return result;
  })();

  // ── 虚拟滚动 ────────────────────────────────────────────────────────
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (i) => rows[i].kind === 'header' ? HEADER_HEIGHT : SESSION_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight  = virtualizer.getTotalSize();

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      {/* 隐藏默认关闭按钮，使用自定义标题栏中的关闭按钮 */}
      <SheetContent side="right" className="w-80 p-0 flex flex-col bg-sidebar [&>button:first-of-type]:hidden">
        {/* ── 标题栏：图标+标题 | 条数 | 选择 | 关闭 ── */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
          <MessageSquare className="w-4 h-4 text-primary shrink-0" />
          <span className="font-semibold text-sm text-sidebar-foreground flex-1 min-w-0">{i18n.t('历史对话')}</span>
          {/* 条数 */}
          <span className="text-xs text-muted-foreground shrink-0">{sessions.length} {i18n.t('条')}</span>
          {/* 批量选择模式切换 */}
          {sessions.length > 0 && (
            <button
              onClick={() => { setSelectMode(v => !v); setSelected(new Set()); }}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded"
              title={selectMode ? i18n.t('退出选择') : i18n.t('批量选择')}
            >
              {selectMode ? i18n.t('取消') : i18n.t('选择')}
            </button>
          )}
          {/* 关闭按钮 */}
          <SheetClose asChild>
            <button
              className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title={i18n.t('关闭')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </SheetClose>
        </div>

        {/* 批量操作栏（选择模式时展示） */}
        {selectMode && (
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20 shrink-0">
            {/* 全选复选框 */}
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {allSelected
                ? <CheckSquare className="w-3.5 h-3.5 text-primary" />
                : <Square className="w-3.5 h-3.5" />}
              <span>{allSelected ? i18n.t('取消全选') : i18n.t('全选')}</span>
            </button>
            <span className="flex-1" />
            {someSelected && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="h-7 px-2.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
              >
                <CheckCheck className="w-3 h-3" />
                {i18n.t('删除')}{selected.size} {i18n.t('条')}</Button>
            )}
          </div>
        )}

        {/* 虚拟滚动容器 */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            /* 骨架屏 */
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5 p-2">
                  <Skeleton className="h-3.5 w-3/4 bg-muted" />
                  <Skeleton className="h-3 w-1/2 bg-muted" />
                </div>
              ))}
            </div>
          ) : sessions.length === 0 ? (
            /* 空状态 */
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <MessageSquare className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{i18n.t('暂无历史对话')}</p>
            </div>
          ) : (
            /* 虚拟滚动内容区 */
            <div style={{ height: totalHeight, position: 'relative' }}>
              {virtualItems.map(vItem => {
                const row = rows[vItem.index];
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
                    {row.kind === 'header' ? (
                      /* 分组标题行 */
                      <div className="px-4 py-2 bg-muted/30 border-b border-border/50">
                        <span className="text-[10px] font-mono text-muted-foreground font-medium truncate block">
                          {row.repo}
                        </span>
                      </div>
                    ) : (
                      /* 会话行 */
                      <button
                        onClick={() => selectMode ? toggleSelect(row.session.id) : handleLoad(row.session)}
                        className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left group border-b border-border/30 last:border-b-0"
                      >
                        {/* 选择模式复选框 */}
                        {selectMode && (
                          <span className="shrink-0 mt-0.5 text-muted-foreground">
                            {selected.has(row.session.id)
                              ? <CheckSquare className="w-3.5 h-3.5 text-primary" />
                              : <Square className="w-3.5 h-3.5" />}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-sidebar-foreground truncate">{row.session.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[90px]">
                              {row.session.branch}
                            </span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {new Date(row.session.updated_at).toLocaleDateString('zh-CN')}
                            </span>
                          </div>
                        </div>
                        {/* 单条删除（非选择模式才显示） */}
                        {!selectMode && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={e => handleDelete(row.session.id, e)}
                            disabled={deleting === row.session.id}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
});

export default HistoryPanel;
