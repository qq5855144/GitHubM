import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Trash2,
  RefreshCw,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── 类型 ──────────────────────────────────────────────────────────────────

interface WorkflowRow {
  id: string;
  user_id: string;
  repo: string;
  task_summary: string;
  status: 'running' | 'done' | 'partial_fail';
  total_steps: number;
  done_steps: number;
  fail_steps: number;
  created_at: string;
  finished_at: string | null;
}

interface StepRow {
  id: string;
  workflow_id: string;
  step_id: string;
  seq: number;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'error';
  retry_count: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

interface Props {
  userId: string;
}

// ── 辅助 ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function WorkflowStatusBadge({ status }: { status: WorkflowRow['status'] }) {
  const cfg = {
    done:         { label: '已完成',   cls: 'bg-green-500/15 text-green-600 border-green-500/30' },
    partial_fail: { label: '部分失败', cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
    running:      { label: '执行中',   cls: 'bg-blue-500/15 text-blue-500 border-blue-500/30' },
  }[status] ?? { label: status, cls: '' };
  return <Badge variant="outline" className={cn('text-xs shrink-0', cfg.cls)}>{cfg.label}</Badge>;
}

function StepStatusIcon({ status }: { status: StepRow['status'] }) {
  switch (status) {
    case 'done':    return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
    case 'error':   return <XCircle      className="w-4 h-4 text-destructive shrink-0" />;
    case 'running': return <Loader2      className="w-4 h-4 text-blue-500 animate-spin shrink-0" />;
    default:        return <Clock        className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
}

// ── 步骤详情弹窗 ──────────────────────────────────────────────────────────

function StepDetailDialog({
  workflow,
  open,
  onClose,
}: {
  workflow: WorkflowRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!workflow || !open) return;
    setLoading(true);
    supabase
      .from('task_workflow_steps')
      .select('*')
      .eq('workflow_id', workflow.id)
      .order('seq', { ascending: true })
      .then(({ data }) => {
        setSteps((data as StepRow[]) ?? []);
        setLoading(false);
      });
  }, [workflow, open]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-balance pr-4">任务详情</DialogTitle>
          {workflow && (
            <p className="text-sm text-muted-foreground text-pretty mt-1 line-clamp-2">
              {workflow.task_summary}
            </p>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="pr-3 space-y-2">
              {steps.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">暂无步骤数据</p>
              )}
              {steps.map((step, idx) => (
                <div
                  key={step.id}
                  className="border border-border rounded-lg p-3 space-y-1.5"
                >
                  <div className="flex items-start gap-2">
                    <StepStatusIcon status={step.status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                        <span className="text-sm font-medium text-balance">{step.title}</span>
                        {step.retry_count > 0 && (
                          <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                            重试 {step.retry_count} 次
                          </Badge>
                        )}
                      </div>
                      {step.description && (
                        <p className="text-xs text-muted-foreground text-pretty mt-0.5">{step.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pl-6">
                    {step.started_at && (
                      <span>开始：{fmtTime(step.started_at)}</span>
                    )}
                    {step.finished_at && (
                      <span>完成：{fmtTime(step.finished_at)}</span>
                    )}
                    {step.started_at && step.finished_at && (
                      <span>耗时：{fmtDuration(step.started_at, step.finished_at)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────

export default function WorkflowHistoryPanel({ userId }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | WorkflowRow['status']>('all');
  const [selected, setSelected] = useState<WorkflowRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await supabase
      .from('task_workflows')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    setWorkflows((data as WorkflowRow[]) ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    await supabase.from('task_workflows').delete().eq('id', id);
    setWorkflows(prev => prev.filter(w => w.id !== id));
  };

  const filtered = workflows.filter(w =>
    statusFilter === 'all' ? true : w.status === statusFilter
  );

  return (
    <div className="flex flex-col h-full">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Select
          value={statusFilter}
          onValueChange={v => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="h-7 text-xs w-28 shrink-0">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="done">已完成</SelectItem>
            <SelectItem value="partial_fail">部分失败</SelectItem>
            <SelectItem value="running">执行中</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={load}
          title="刷新"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* 列表 */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1.5">
          {loading && workflows.length === 0 && (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <AlertCircle className="w-8 h-8" />
              <p className="text-sm">暂无历史工作流</p>
            </div>
          )}

          {filtered.map(wf => (
            <div
              key={wf.id}
              className="group border border-border rounded-lg p-3 hover:bg-muted/40 transition-colors cursor-pointer"
              onClick={() => { setSelected(wf); setDetailOpen(true); }}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0 space-y-1">
                  {/* 摘要 + 状态 */}
                  <div className="flex items-start gap-2">
                    <p className="text-sm flex-1 min-w-0 line-clamp-2 text-pretty leading-snug">
                      {wf.task_summary}
                    </p>
                    <WorkflowStatusBadge status={wf.status} />
                  </div>

                  {/* 仓库 + 步骤统计 */}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="truncate max-w-[120px]">{wf.repo}</span>
                    <span>
                      {wf.done_steps}/{wf.total_steps} 步完成
                      {wf.fail_steps > 0 && ` · ${wf.fail_steps} 失败`}
                    </span>
                  </div>

                  {/* 时间 */}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{fmtTime(wf.created_at)}</span>
                    {wf.finished_at && (
                      <span>耗时 {fmtDuration(wf.created_at, wf.finished_at)}</span>
                    )}
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-1 shrink-0 ml-1">
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => e.stopPropagation()}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent
                      className="max-w-[calc(100%-2rem)] md:max-w-sm"
                      onClick={e => e.stopPropagation()}
                    >
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认删除</AlertDialogTitle>
                        <AlertDialogDescription>
                          此操作不可撤销，将永久删除该工作流及所有步骤记录。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => handleDelete(wf.id)}
                        >
                          删除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* 步骤详情弹窗 */}
      <StepDetailDialog
        workflow={selected}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
}
