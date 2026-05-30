// 内联任务活动面板 —— 直接嵌入 AI 聊天气泡
// 在移动端和桌面端均可见，无需打开侧边面板
import React, { useState, useEffect } from 'react';
import {
  CheckCircle2, XCircle, Loader2, Clock,
  ChevronDown, ChevronRight,
  Circle, PlayCircle,
  FolderOpen, FileSearch, FilePen, Trash2,
  GitBranch, GitCommit, GitMerge, ListChecks,
  Terminal, Search, MessageSquarePlus, AlertCircle,
  FileCode, Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InlineStep, InlineTool } from './aiTypes';
import i18n from "@/i18n";

// ── 工具图标映射 ───────────────────────────────────────────────────────────────
const TOOL_ICONS: Record<string, React.ElementType> = {
  list_files: FolderOpen,
  read_file: FileSearch,
  write_file: FilePen,
  patch_file: FilePen,
  delete_file: Trash2,
  search_code: Search,
  file_tree: FolderOpen,
  grep_in_file: FileCode,
  batch_read: FileSearch,
  list_branches: GitBranch,
  create_branch: GitBranch,
  list_commits: GitCommit,
  list_pull_requests: GitMerge,
  create_pr: GitMerge,
  merge_pull_request: GitMerge,
  list_issues: AlertCircle,
  create_issue: MessageSquarePlus,
  list_workflows: ListChecks,
  get_workflow_runs: ListChecks,
  get_run_jobs: ListChecks,
  get_job_logs: Terminal,
  trigger_workflow: PlayCircle,
  cancel_workflow_run: XCircle,
  rerun_workflow_run: PlayCircle,
  list_actions_secrets: Wrench,
};

// ── 步骤状态图标 ───────────────────────────────────────────────────────────────
function StepIcon({ status }: { status: InlineStep['status'] }) {
  if (status === 'running') return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />;
  if (status === 'done') return <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />;
  if (status === 'error') return <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />;
  return <Circle className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />;
}

// ── 工具调用卡片 ──────────────────────────────────────────────────────────────
function ToolRow({ tool }: { tool: InlineTool }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[tool.tool] ?? Terminal;

  return (
    <div className={cn(
      'rounded-lg border text-[11px] overflow-hidden transition-colors',
      tool.status === 'running' && 'border-primary/30 bg-primary/5',
      tool.status === 'success' && 'border-green-500/20 bg-green-500/5',
      tool.status === 'fail' && 'border-destructive/20 bg-destructive/5',
    )}>
      {/* 主行 */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        {/* 工具图标 */}
        <Icon className={cn(
          'w-3.5 h-3.5 shrink-0',
          tool.status === 'running' && 'text-primary',
          tool.status === 'success' && 'text-green-500',
          tool.status === 'fail' && 'text-destructive',
          tool.status === 'running' || 'opacity-80',
        )} />

        {/* 名称 + hint */}
        <div className="flex-1 min-w-0">
          <span className="font-medium text-foreground">{tool.label}</span>
          {tool.hint && (
            <span className="text-muted-foreground ml-1 truncate inline-block max-w-[140px] align-bottom">
              · {tool.hint}
            </span>
          )}
        </div>

        {/* 右侧：状态 + 耗时 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {tool.status === 'running' && (
            <Loader2 className="w-3 h-3 text-primary animate-spin" />
          )}
          {tool.status === 'success' && (
            <CheckCircle2 className="w-3 h-3 text-green-500" />
          )}
          {tool.status === 'fail' && (
            <XCircle className="w-3 h-3 text-destructive" />
          )}
          {tool.elapsedMs !== undefined && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {tool.elapsedMs < 1000
                ? `${tool.elapsedMs}ms`
                : `${(tool.elapsedMs / 1000).toFixed(1)}s`}
            </span>
          )}
          {/* 展开结果按钮 */}
          {tool.result && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title={expanded ? i18n.t('收起') : i18n.t('查看结果')}
            >
              {expanded
                ? <ChevronDown className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>

      {/* 展开的结果区域 */}
      {expanded && tool.result && (
        <div className="px-2.5 pb-2 border-t border-border/40 mt-0.5">
          <div className="mt-1.5 bg-muted/60 rounded p-2 font-mono text-[10px] whitespace-pre-wrap break-all max-h-40 overflow-y-auto text-foreground/80">
            {tool.result}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────
interface InlineActivityPanelProps {
  inlinePlan?: InlineStep[];
  inlineTools?: InlineTool[];
  /** 是否正在 streaming（影响折叠默认状态） */
  streaming?: boolean;
}

export default function InlineActivityPanel({
  inlinePlan,
  inlineTools,
  streaming,
}: InlineActivityPanelProps) {
  const [planCollapsed, setPlanCollapsed] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(false);

  // 流式结束后自动折叠任务面板，避免遮挡最终回答文字
  useEffect(() => {
    if (streaming === false) {
      // 延迟 400ms 折叠，让用户感知到任务完成状态后再收起
      const t = setTimeout(() => {
        setPlanCollapsed(true);
        setToolsCollapsed(true);
      }, 400);
      return () => clearTimeout(t);
    } else {
      // 新任务开始时重新展开
      setPlanCollapsed(false);
      setToolsCollapsed(false);
    }
  }, [streaming]);

  const hasPlan = inlinePlan && inlinePlan.length > 0;
  const hasTools = inlineTools && inlineTools.length > 0;

  if (!hasPlan && !hasTools) return null;

  // 正在执行的步骤数 / 已完成数
  const doneSteps = inlinePlan?.filter(s => s.status === 'done' || s.status === 'error').length ?? 0;
  const totalSteps = inlinePlan?.length ?? 0;
  // 正在执行的工具
  const runningTool = inlineTools?.find(t => t.status === 'running');

  return (
    <div className="mb-3 space-y-2">
      {/* ── 任务计划 ─────────────────────────────────────────────────── */}
      {hasPlan && (
        <div className="rounded-xl border border-border/60 overflow-hidden bg-background/50">
          {/* 标题行（可折叠） */}
          <button
            onClick={() => setPlanCollapsed(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-foreground hover:bg-muted/40 transition-colors"
          >
            <ListChecks className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="flex-1 text-left">{i18n.t('任务计划')}</span>
            {/* 进度徽章 */}
            <span className={cn(
              'text-[10px] font-mono px-1.5 py-0.5 rounded-full',
              doneSteps === totalSteps
                ? 'bg-green-500/10 text-green-600'
                : 'bg-primary/10 text-primary'
            )}>
              {doneSteps}/{totalSteps}
            </span>
            {planCollapsed
              ? <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
              : <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />}
          </button>

          {/* 步骤列表 */}
          {!planCollapsed && (
            <div className="px-3 pb-2.5 space-y-1.5 border-t border-border/40">
              {inlinePlan.map((step, idx) => (
                <div key={step.id} className="flex items-start gap-2 pt-1.5">
                  {/* 竖线连接 */}
                  <div className="relative flex flex-col items-center shrink-0 mt-0.5">
                    <StepIcon status={step.status} />
                    {idx < inlinePlan.length - 1 && (
                      <div className="w-px flex-1 bg-border/50 mt-1 min-h-[10px]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        'text-[11px] font-medium leading-tight',
                        step.status === 'running' && 'text-primary',
                        step.status === 'done' && 'text-foreground',
                        step.status === 'error' && 'text-destructive',
                        step.status === 'pending' && 'text-muted-foreground',
                      )}>
                        {step.title}
                      </span>
                      {step.retryCount && step.retryCount > 0 && (
                        <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1 rounded">
                          {i18n.t('重试')}{step.retryCount}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug text-pretty">
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 工具调用列表 ─────────────────────────────────────────────── */}
      {hasTools && (
        <div className="rounded-xl border border-border/60 overflow-hidden bg-background/50">
          {/* 标题行（可折叠） */}
          <button
            onClick={() => setToolsCollapsed(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-foreground hover:bg-muted/40 transition-colors"
          >
            <Wrench className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="flex-1 text-left min-w-0 truncate">
              {runningTool
                ? <span className="flex items-center gap-1.5 text-primary">
                    <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                    <span className="truncate">{runningTool.label}{runningTool.hint ? ` · ${runningTool.hint}` : ''}</span>
                  </span>
                : <span className="text-muted-foreground">{i18n.t('已调用')}{inlineTools.length} {i18n.t('个工具')}</span>}
            </span>
            {!runningTool && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full shrink-0 ${
                inlineTools.filter(t => t.status === 'fail').length > 0
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-green-500/10 text-green-600'
              }`}>
                {inlineTools.filter(t => t.status === 'success').length}/{inlineTools.length}
              </span>
            )}
            {toolsCollapsed
              ? <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
              : <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />}
          </button>

          {/* 工具卡片列表 */}
          {!toolsCollapsed && (
            <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-border/40 pt-2">
              {inlineTools.map(tool => (
                <ToolRow key={tool.id} tool={tool} />
              ))}
              {/* 正在运行时的占位动效 */}
              {streaming && runningTool && (
                <div className="flex items-center gap-2 px-2.5 py-1 text-[10px] text-muted-foreground">
                  <Clock className="w-3 h-3 animate-pulse" />
                  {i18n.t('执行中，请稍候…')}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
