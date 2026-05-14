// 工具调用历史侧边栏面板
import { memo } from 'react';
import {
  FolderOpen, FileCode2, Search, Pencil, Trash2, GitBranch,
  GitPullRequest, GitCommit, ListChecks, Play, FileSearch,
  Files, BugPlay, Wrench, CheckCircle2, XCircle, Loader2,
  Clock, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolHistoryItem } from '@/components/ai/aiTypes';

// ── 工具名 → 图标映射 ──────────────────────────────────────────────────────────
const TOOL_ICON_MAP: Record<string, React.ElementType> = {
  list_files: FolderOpen,
  read_file: FileCode2,
  batch_read: Files,
  write_file: Pencil,
  patch_file: Pencil,
  delete_file: Trash2,
  search_code: Search,
  file_tree: FolderOpen,
  grep_in_file: FileSearch,
  list_branches: GitBranch,
  create_branch: GitBranch,
  list_commits: GitCommit,
  list_pull_requests: GitPullRequest,
  create_pr: GitPullRequest,
  merge_pull_request: GitPullRequest,
  list_issues: ListChecks,
  create_issue: ListChecks,
  list_workflows: Play,
  get_workflow_runs: Play,
  get_run_jobs: BugPlay,
  get_job_logs: BugPlay,
  trigger_workflow: Play,
  cancel_workflow_run: Play,
  rerun_workflow_run: Play,
  list_actions_secrets: Files,
};

function ToolIcon({ tool, className }: { tool: string; className?: string }) {
  const Icon = TOOL_ICON_MAP[tool] ?? Wrench;
  return <Icon className={className} />;
}

// ── 单条历史条目 ───────────────────────────────────────────────────────────────
function HistoryItem({ item, index }: { item: ToolHistoryItem; index: number }) {
  const isRunning = item.status === 'running';
  const isSuccess = item.status === 'success';

  return (
    <div className="flex items-start gap-2 py-2 px-3 hover:bg-muted/40 transition-colors group">
      {/* 序号 */}
      <span className="text-[10px] text-muted-foreground/50 w-4 shrink-0 mt-[3px] font-mono tabular-nums">
        {index + 1}
      </span>

      {/* 工具图标 */}
      <div className={cn(
        'w-5 h-5 rounded flex items-center justify-center shrink-0 mt-[1px]',
        isRunning ? 'bg-primary/10' : isSuccess ? 'bg-green-500/10' : 'bg-destructive/10',
      )}>
        {isRunning
          ? <Loader2 className="w-3 h-3 text-primary animate-spin" />
          : isSuccess
            ? <ToolIcon tool={item.tool} className="w-3 h-3 text-green-600 dark:text-green-400" />
            : <XCircle className="w-3 h-3 text-destructive" />}
      </div>

      {/* 标签 + 参数 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs font-medium text-foreground truncate">{item.label}</span>
          {isSuccess && <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />}
        </div>
        {item.hint && (
          <p className="text-[10px] text-muted-foreground truncate mt-0.5 font-mono">{item.hint}</p>
        )}
      </div>

      {/* 耗时 */}
      <div className="shrink-0 flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
        {isRunning
          ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
          : item.elapsedMs >= 0
            ? (
              <>
                <Clock className="w-2.5 h-2.5" />
                <span className="font-mono tabular-nums">
                  {item.elapsedMs >= 1000
                    ? `${(item.elapsedMs / 1000).toFixed(1)}s`
                    : `${item.elapsedMs}ms`}
                </span>
              </>
            )
            : null}
      </div>
    </div>
  );
}

// ── 主面板 ─────────────────────────────────────────────────────────────────────
interface ToolHistoryPanelProps {
  items: ToolHistoryItem[];
  onClose: () => void;
}

export default memo(function ToolHistoryPanel({ items, onClose }: ToolHistoryPanelProps) {
  const totalMs = items
    .filter(i => i.elapsedMs >= 0)
    .reduce((s, i) => s + i.elapsedMs, 0);
  const running = items.filter(i => i.status === 'running').length;
  const errors = items.filter(i => i.status === 'error').length;

  return (
    <div className="flex flex-col h-full min-h-0 bg-card border-l border-border">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Wrench className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold text-foreground flex-1 min-w-0">工具调用历史</span>
        {running > 0 && (
          <span className="text-[10px] text-primary flex items-center gap-0.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            {running}
          </span>
        )}
        {errors > 0 && (
          <span className="text-[10px] text-destructive flex items-center gap-0.5">
            <XCircle className="w-3 h-3" />
            {errors}
          </span>
        )}
        <button
          onClick={onClose}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="关闭"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 统计条 */}
      {items.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-muted/30 border-b border-border/50 shrink-0">
          <span className="text-[10px] text-muted-foreground">
            共 <span className="font-semibold text-foreground">{items.length}</span> 次调用
          </span>
          {totalMs > 0 && (
            <span className="text-[10px] text-muted-foreground">
              累计 <span className="font-semibold text-foreground font-mono">
                {totalMs >= 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`}
              </span>
            </span>
          )}
        </div>
      )}

      {/* 历史列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
            <Wrench className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">本次对话暂无工具调用</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {items.map((item, idx) => (
              <HistoryItem key={item.id} item={item} index={idx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
