import React from 'react';
import { 
  Wrench, CheckCircle2, XCircle, Clock, 
  ChevronRight, ChevronDown, Play,
  FolderOpen, Search, Pencil, Trash2,
  GitBranch, GitCommit, GitMerge, ListChecks,
  AlertCircle, MessageSquarePlus, Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolHistoryItem } from './aiTypes';

interface ToolHistoryPanelProps {
  items: ToolHistoryItem[];
}

const TOOL_ICONS: Record<string, any> = {
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
  default: Terminal
};

export function ToolHistoryPanel({ items }: ToolHistoryPanelProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
        <div className="bg-muted/50 p-4 rounded-full mb-4">
          <Wrench className="w-8 h-8 opacity-20" />
        </div>
        <p className="text-sm">暂无工具调用历史</p>
        <p className="text-[10px] mt-1 opacity-60">AI 执行任务时会在此显示步骤</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background border-l">
      <div className="p-4 border-b bg-muted/20 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
          <Wrench className="w-3.5 h-3.5" />
          任务执行过程 ({items.length})
        </h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {items.map((item, idx) => {
          const Icon = TOOL_ICONS[item.tool] || TOOL_ICONS.default;
          return (
            <div key={item.id} className="relative pl-6 group">
              {/* 连接线 */}
              {idx < items.length - 1 && (
                <div className="absolute left-[11px] top-[24px] bottom-[-16px] w-[1px] bg-border group-hover:bg-primary/30 transition-colors" />
              )}
              
              {/* 状态圆点/图标 */}
              <div className={cn(
                "absolute left-0 top-1 w-6 h-6 rounded-full border bg-background flex items-center justify-center z-10",
                item.status === 'running' && "border-primary text-primary animate-pulse",
                item.status === 'success' && "border-green-500/50 text-green-500 bg-green-500/5",
                item.status === 'fail' && "border-red-500/50 text-red-500 bg-red-500/5"
              )}>
                {item.status === 'running' ? (
                  <Play className="w-3 h-3 fill-current" />
                ) : item.status === 'success' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium leading-tight">
                    {item.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                    {item.elapsedMs ? `${item.elapsedMs}ms` : '执行中...'}
                  </span>
                </div>
                
                <p className="text-[10px] text-muted-foreground break-all line-clamp-2 leading-relaxed">
                  {item.hint}
                </p>

                {item.result && (
                  <details className="mt-2 group/details">
                    <summary className="text-[10px] text-primary/70 hover:text-primary cursor-pointer list-none flex items-center gap-1 transition-colors select-none">
                      <ChevronRight className="w-3 h-3 group-open/details:rotate-90 transition-transform" />
                      查看执行结果
                    </summary>
                    <div className="mt-1.5 p-2 bg-muted/50 rounded border border-border/50 text-[10px] font-mono whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto scrollbar-thin">
                      {item.result}
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
