// 历史执行日志面板：展示本 session 已持久化的工具调用记录，支持按轮次折叠 + 断点恢复
import { useEffect, useState, useCallback } from 'react';
import {
  Wrench, CheckCircle2, XCircle, Clock, History,
  ChevronRight, RefreshCw, RotateCcw, Terminal,
  FolderOpen, Play, Pencil, Trash2, Search,
  GitBranch, GitCommit, GitMerge, AlertCircle,
  MessageSquarePlus, ListChecks,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { fetchToolExecutionLogs, fetchLatestSnapshot } from '@/components/ai/aiSupabase';
import type { ToolHistoryItem } from './aiTypes';

// ── 类型 ─────────────────────────────────────────────────────────────────────

interface LogRow {
  id: string;
  session_id: string;
  turn_id: string;
  tool_name: string;
  label: string | null;
  hint: string | null;
  status: string;
  elapsed_ms: number | null;
  result_json: string | null;
  started_at: string;
}

interface TurnGroup {
  turnId: string;
  startedAt: string;
  items: LogRow[];
  successCount: number;
  errorCount: number;
}

interface RunHistoryPanelProps {
  sessionId: string | null;
  /** 断点恢复回调：将快照中的 toolHistory 写回父组件 */
  onRestore: (toolHistory: ToolHistoryItem[]) => void;
  /** 是否正在流式中（流式中时禁用恢复按钮） */
  isStreaming: boolean;
}

// ── 工具图标映射 ──────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ElementType> = {
  list_files: FolderOpen,
  read_file: Play,
  write_file: Pencil,
  patch_file: Pencil,
  delete_file: Trash2,
  search_code: Search,
  list_branches: GitBranch,
  list_commits: GitCommit,
  list_pull_requests: GitMerge,
  list_issues: AlertCircle,
  create_issue: MessageSquarePlus,
  get_workflow_runs: ListChecks,
};

function getToolIcon(toolName: string): React.ElementType {
  return TOOL_ICONS[toolName] ?? Terminal;
}

// ── 格式化时间 ────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `今天 ${formatTime(iso)}`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + formatTime(iso);
}

// ── TurnGroup 折叠行 ──────────────────────────────────────────────────────────

function TurnGroupRow({ group, defaultOpen }: { group: TurnGroup; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <div className="border border-border/60 rounded-lg overflow-hidden">
      {/* 折叠头 */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/60 transition-colors text-left"
      >
        <ChevronRight className={cn('w-3.5 h-3.5 shrink-0 transition-transform text-muted-foreground', open && 'rotate-90')} />
        <span className="flex-1 min-w-0 text-[11px] font-mono text-muted-foreground truncate">
          {formatDate(group.startedAt)}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {group.successCount > 0 && (
            <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-green-500/40 text-green-600 bg-green-500/5">
              <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />{group.successCount}
            </Badge>
          )}
          {group.errorCount > 0 && (
            <Badge variant="outline" className="h-4 px-1.5 text-[9px] border-red-500/40 text-red-600 bg-red-500/5">
              <XCircle className="w-2.5 h-2.5 mr-0.5" />{group.errorCount}
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground">{group.items.length} 步</span>
        </div>
      </button>

      {/* 展开内容 */}
      {open && (
        <div className="divide-y divide-border/40">
          {group.items.map((item, idx) => {
            const Icon = getToolIcon(item.tool_name);
            return (
              <div key={item.id} className="px-3 py-2 flex items-start gap-2.5 hover:bg-muted/20 transition-colors">
                {/* 序号 + 状态图标 */}
                <div className="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
                  <span className="text-[9px] font-mono text-muted-foreground/60 w-4 text-center">{idx + 1}</span>
                  <div className={cn(
                    'w-5 h-5 rounded-full border flex items-center justify-center',
                    item.status === 'success' && 'border-green-500/40 text-green-500 bg-green-500/5',
                    item.status === 'error' && 'border-red-500/40 text-red-500 bg-red-500/5',
                    item.status === 'running' && 'border-primary/40 text-primary bg-primary/5 animate-pulse',
                  )}>
                    {item.status === 'success' ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : item.status === 'error' ? (
                      <XCircle className="w-3 h-3" />
                    ) : (
                      <Clock className="w-3 h-3" />
                    )}
                  </div>
                </div>

                {/* 内容 */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Icon className="w-3 h-3 text-muted-foreground shrink-0" />
                    <span className="text-[11px] font-medium truncate">
                      {item.label ?? item.tool_name}
                    </span>
                    {item.elapsed_ms != null && (
                      <span className="text-[9px] font-mono text-muted-foreground ml-auto shrink-0">
                        {item.elapsed_ms}ms
                      </span>
                    )}
                  </div>
                  {item.hint && (
                    <p className="text-[10px] text-muted-foreground line-clamp-2 break-all leading-relaxed">
                      {item.hint}
                    </p>
                  )}
                  {item.result_json && (
                    <details className="mt-1 group/d">
                      <summary className="text-[10px] text-primary/70 hover:text-primary cursor-pointer list-none flex items-center gap-1 select-none">
                        <ChevronRight className="w-3 h-3 group-open/d:rotate-90 transition-transform" />
                        查看结果
                      </summary>
                      <div className="mt-1 p-1.5 bg-muted/50 rounded border border-border/50 text-[10px] font-mono whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto scrollbar-thin">
                        {item.result_json}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export function RunHistoryPanel({ sessionId, onRestore, isStreaming }: RunHistoryPanelProps) {
  const [groups, setGroups] = useState<TurnGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadLogs = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const rows = await fetchToolExecutionLogs(sessionId);
      // 按 turn_id 分组
      const map = new Map<string, LogRow[]>();
      for (const row of rows) {
        const arr = map.get(row.turn_id) ?? [];
        arr.push(row);
        map.set(row.turn_id, arr);
      }
      const result: TurnGroup[] = [];
      for (const [turnId, items] of map) {
        result.push({
          turnId,
          startedAt: items[0].started_at,
          items,
          successCount: items.filter(i => i.status === 'success').length,
          errorCount: items.filter(i => i.status === 'error').length,
        });
      }
      // 按时间降序（最新在前）
      result.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      setGroups(result);
      setLastRefreshed(new Date());
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // 初始加载
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleRestore = useCallback(async () => {
    if (!sessionId || isStreaming) return;
    setRestoring(true);
    try {
      const snapshot = await fetchLatestSnapshot(sessionId);
      if (snapshot) {
        onRestore(snapshot.toolHistory);
      }
    } finally {
      setRestoring(false);
    }
  }, [sessionId, isStreaming, onRestore]);

  const totalTools = groups.reduce((s, g) => s + g.items.length, 0);
  const totalSuccess = groups.reduce((s, g) => s + g.successCount, 0);
  const totalError = groups.reduce((s, g) => s + g.errorCount, 0);

  return (
    <div className="flex flex-col h-full bg-background border-l">
      {/* 头部 */}
      <div className="p-3 border-b bg-muted/20 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <History className="w-3.5 h-3.5 shrink-0" />
          <h3 className="text-xs font-semibold uppercase tracking-wider truncate">执行历史</h3>
          {totalTools > 0 && (
            <span className="text-[10px] text-muted-foreground">({totalTools})</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={loadLogs}
            disabled={loading}
            title="刷新"
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          </Button>
          {groups.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleRestore}
              disabled={restoring || isStreaming || !sessionId}
              title="从最新快照恢复工具历史"
            >
              <RotateCcw className={cn('w-3 h-3', restoring && 'animate-spin')} />
            </Button>
          )}
        </div>
      </div>

      {/* 统计条 */}
      {totalTools > 0 && (
        <div className="px-3 py-2 border-b flex items-center gap-3 shrink-0 bg-muted/10">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Wrench className="w-3 h-3" />
            {groups.length} 轮 · {totalTools} 次调用
          </div>
          {totalSuccess > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-green-600">
              <CheckCircle2 className="w-3 h-3" />{totalSuccess} 成功
            </div>
          )}
          {totalError > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-red-500">
              <XCircle className="w-3 h-3" />{totalError} 失败
            </div>
          )}
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin">
        {!sessionId ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
            <div className="bg-muted/50 p-4 rounded-full mb-4">
              <History className="w-8 h-8 opacity-20" />
            </div>
            <p className="text-sm">暂无历史记录</p>
            <p className="text-[10px] mt-1 opacity-60">开始对话后将记录工具执行历史</p>
          </div>
        ) : loading && groups.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            <span className="text-xs">加载中...</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
            <div className="bg-muted/50 p-4 rounded-full mb-4">
              <History className="w-8 h-8 opacity-20" />
            </div>
            <p className="text-sm">本会话暂无执行记录</p>
            <p className="text-[10px] mt-1 opacity-60">AI 完成工具任务后将自动保存</p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {groups.map((group, idx) => (
              <TurnGroupRow
                key={group.turnId}
                group={group}
                defaultOpen={idx === 0}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部：最近刷新时间 + 恢复按钮 */}
      {groups.length > 0 && (
        <div className="px-3 py-2 border-t bg-muted/10 flex items-center justify-between gap-2 shrink-0">
          {lastRefreshed && (
            <span className="text-[10px] text-muted-foreground">
              更新于 {formatTime(lastRefreshed.toISOString())}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[11px] gap-1 ml-auto"
            onClick={handleRestore}
            disabled={restoring || isStreaming || !sessionId}
          >
            <RotateCcw className={cn('w-3 h-3', restoring && 'animate-spin')} />
            恢复工具历史
          </Button>
        </div>
      )}
    </div>
  );
}
