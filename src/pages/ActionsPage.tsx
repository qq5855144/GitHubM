// GitHub Actions 工作流管理

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Play,
  RefreshCw,
  XCircle,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  Zap,
  ChevronDown,
  SkipForward,
  GitBranch,
  Plus,
  Trash2,
  Terminal,
  Copy,
  Check,
  ArrowDown,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
} from '@/components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  getWorkflows,
  getWorkflowRuns,
  triggerWorkflow,
  cancelWorkflowRun,
  rerunWorkflowRun,
  getWorkflowRun,
  getWorkflowRunJobs,
  rerunFailedWorkflowRun,
  rerunWorkflowJob,
  getJobLogs,
  getBranches,
  formatRelativeTime,
  getFileContent,
} from '@/services/github';
import type { GitHubWorkflow, GitHubWorkflowRun, GitHubWorkflowJob } from '@/types/types';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { decodeBase64Content } from '@/lib/utils';
import { parse as parseYaml } from 'yaml';
import i18n from "@/i18n";

function RunStatusBadge({ status, conclusion }: { status: string | null; conclusion: string | null }) {
  if (status === 'in_progress' || status === 'queued' || status === 'waiting') {
    return (
      <Badge className="bg-warning/10 text-warning border-warning/30 text-xs flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        {status === 'in_progress' ? i18n.t('运行中') : status === 'queued' ? i18n.t('排队中') : i18n.t('等待中')}
      </Badge>
    );
  }
  if (conclusion === 'success') {
    return <Badge className="bg-success/10 text-success border-success/30 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{i18n.t('成功')}</Badge>;
  }
  if (conclusion === 'failure') {
    return <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs flex items-center gap-1"><XCircle className="w-3 h-3" />{i18n.t('失败')}</Badge>;
  }
  if (conclusion === 'cancelled') {
    return <Badge className="bg-secondary text-muted-foreground border-border text-xs">{i18n.t('已取消')}</Badge>;
  }
  if (conclusion === 'skipped') {
    return <Badge className="bg-secondary text-muted-foreground border-border text-xs flex items-center gap-1"><SkipForward className="w-3 h-3" />{i18n.t('已跳过')}</Badge>;
  }
  if (conclusion === 'timed_out') {
    return <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs flex items-center gap-1"><Clock className="w-3 h-3" />{i18n.t('超时')}</Badge>;
  }
  if (conclusion === 'action_required') {
    return <Badge className="bg-warning/10 text-warning border-warning/30 text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3" />{i18n.t('需要处理')}</Badge>;
  }
  return <Badge className="bg-secondary text-muted-foreground border-border text-xs">{conclusion || status || i18n.t('未知')}</Badge>;
}

function isActiveRun(run: Pick<GitHubWorkflowRun, 'status' | 'conclusion'> | null | undefined): boolean {
  if (!run) return false;
  return run.status === 'queued' || run.status === 'in_progress' || run.status === 'waiting' || run.conclusion === 'action_required';
}

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start) return '';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return '';
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}分${seconds ? `${seconds}秒` : ''}`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}小时${restMinutes ? `${restMinutes}分` : ''}`;
}

// ANSI 颜色码转 Tailwind className（精简版）
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

function AnsiLine({ raw }: { raw: string }) {
  const clean = stripAnsi(raw);
  // 时间戳前缀（GitHub 日志格式 2024-01-01T00:00:00Z  内容）
  const m = clean.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)/);
  if (m) {
    return (
      <span>
        <span className="text-muted-foreground/50 select-none mr-2 text-[10px]">{m[1].replace('T', ' ').replace('Z', '')}</span>
        <span>{m[2]}</span>
      </span>
    );
  }
  return <span>{clean}</span>;
}

interface LogPanelProps {
  jobId: number;
  owner: string;
  repo: string;
  isRunning: boolean;
}

const MAX_LOG_LINES = 2000;

function trimLogLines(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= MAX_LOG_LINES) return text;
  return `${i18n.t('… 日志过长，仅显示最后')} ${MAX_LOG_LINES} ${i18n.t('行')}\n${lines.slice(-MAX_LOG_LINES).join('\n')}`;
}

function LogPanel({ jobId, owner, repo, isRunning }: LogPanelProps) {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const text = await getJobLogs(owner, repo, jobId);
      setLogs(trimLogLines(text));
    } catch (err) {
      const msg = err instanceof Error ? err.message : i18n.t('获取日志失败');
      setLogs(`[错误] ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [owner, repo, jobId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (!document.hidden) await fetchLogs();
      if (!cancelled && isRunning) timer = setTimeout(tick, 3000);
    };

    void tick();
    const handleVisibility = () => {
      if (document.hidden) return;
      if (timer) clearTimeout(timer);
      void tick();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchLogs, isRunning]);

  useEffect(() => {
    if (scrollRef.current && follow) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, follow]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const handleCopy = async () => {
    try {
      await copyToClipboard(stripAnsi(logs));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(i18n.t('复制失败'));
    }
  };

  return (
    <div className="bg-[#0d1117] border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-secondary/20 flex-wrap">
        <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground flex-1 min-w-[96px]">{i18n.t('日志输出')}</span>
        {isRunning && (
          <span className="flex items-center gap-1 text-[10px] text-warning">
            <Loader2 className="w-3 h-3 animate-spin" />{i18n.t('实时刷新')}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 px-2 text-[10px] gap-1 ${follow ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setFollow((prev) => !prev)}
          title={i18n.t('跟随最新日志')}
        >
          <ArrowDown className="w-3 h-3" />{follow ? i18n.t('跟随中') : i18n.t('跟随')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
          onClick={handleCopy}
          disabled={loading || !logs}
        >
          {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
          {copied ? i18n.t('已复制') : i18n.t('复制')}
        </Button>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="overflow-y-auto max-h-96 p-3 font-mono text-xs leading-relaxed text-[#e6edf3]"
      >
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{i18n.t('加载日志...')}</span>
          </div>
        ) : logs ? (
          logs.split('\n').map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all py-0.5 hover:bg-white/5">
              <AnsiLine raw={line} />
            </div>
          ))
        ) : (
          <span className="text-muted-foreground">{i18n.t('暂无日志')}</span>
        )}
      </div>
    </div>
  );
}

function JobItem({
  job,
  owner,
  repo,
  onRerun,
  isRerunning,
}: {
  job: GitHubWorkflowJob;
  owner: string;
  repo: string;
  onRerun: (job: GitHubWorkflowJob) => void;
  isRerunning: boolean;
}) {
  const [open, setOpen] = useState(job.conclusion === 'failure' || job.conclusion === 'timed_out');
  const [showLogs, setShowLogs] = useState(false);
  const isRunning = job.status === 'in_progress' || job.status === 'queued';
  const duration = formatDuration(job.started_at, job.completed_at);

  useEffect(() => {
    if (job.conclusion === 'failure' || job.conclusion === 'timed_out') setOpen(true);
  }, [job.conclusion]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center gap-2 px-4 py-2 hover:bg-secondary/50 transition-colors text-left">
        <ChevronDown className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        <RunStatusBadge status={job.status} conclusion={job.conclusion} />
        <span className="text-sm text-foreground flex-1 min-w-0 truncate">{job.name}</span>
        {duration && <span className="text-[10px] text-muted-foreground shrink-0">{duration}</span>}
        {job.started_at && <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(job.started_at)}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-8 pr-4 pb-2 space-y-0.5">
          {job.steps.map((step) => (
            <div key={step.number} className="flex items-center gap-2 py-0.5">
              {step.conclusion === 'success' ? (
                <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
              ) : step.conclusion === 'failure' ? (
                <XCircle className="w-3 h-3 text-destructive shrink-0" />
              ) : step.status === 'in_progress' ? (
                <Loader2 className="w-3 h-3 text-warning animate-spin shrink-0" />
              ) : (
                <div className="w-3 h-3 rounded-full border border-border shrink-0" />
              )}
              <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{step.name}</span>
            </div>
          ))}
          <div className="pt-2 pb-1 flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 text-xs gap-1.5 border transition-colors ${showLogs ? 'border-primary/40 text-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-secondary'}`}
              onClick={() => setShowLogs(!showLogs)}
            >
              <Terminal className="w-3 h-3" />
              {showLogs ? i18n.t('收起日志') : i18n.t('查看日志')}
              {isRunning && <span className="text-warning text-[10px]">{i18n.t('● 实时')}</span>}
            </Button>
            {job.status === 'completed' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5 border border-border text-muted-foreground hover:bg-secondary"
                onClick={() => onRerun(job)}
                disabled={isRerunning}
              >
                {isRerunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {isRerunning ? i18n.t('触发中...') : i18n.t('重跑任务')}
              </Button>
            )}
          </div>
          {showLogs && (
            <LogPanel jobId={job.id} owner={owner} repo={repo} isRunning={isRunning} />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RunDetail({
  owner,
  repo,
  run,
  onClose,
  onRunUpdate,
  onRefreshList,
}: {
  owner: string;
  repo: string;
  run: GitHubWorkflowRun;
  onClose: () => void;
  onRunUpdate: (run: GitHubWorkflowRun) => void;
  onRefreshList: () => void;
}) {
  const [liveRun, setLiveRun] = useState<GitHubWorkflowRun>(run);
  const [jobs, setJobs] = useState<GitHubWorkflowJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [rerunning, setRerunning] = useState<'all' | 'failed' | null>(null);
  const [rerunningJobId, setRerunningJobId] = useState<number | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const isRunning = isActiveRun(liveRun);
  const isFailed = liveRun.status === 'completed' && (liveRun.conclusion === 'failure' || liveRun.conclusion === 'timed_out');

  const loadDetail = useCallback(async () => {
    const [freshRun, jobsResult] = await Promise.all([
      getWorkflowRun(owner, repo, run.id),
      getWorkflowRunJobs(owner, repo, run.id),
    ]);
    setLiveRun(freshRun);
    setJobs(Array.isArray(jobsResult.jobs) ? jobsResult.jobs : []);
    setLoadingJobs(false);
    onRunUpdate(freshRun);
    return freshRun;
  }, [owner, repo, run.id, onRunUpdate]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      if (document.hidden) {
        timer = setTimeout(tick, 5000);
        return;
      }
      try {
        const freshRun = await loadDetail();
        if (!cancelled && isActiveRun(freshRun)) timer = setTimeout(tick, 5000);
      } catch {
        if (!cancelled) {
          setLoadingJobs(false);
          timer = setTimeout(tick, 10000);
        }
      }
    };

    void tick();
    const handleVisibility = () => {
      if (document.hidden) return;
      if (timer) clearTimeout(timer);
      void tick();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadDetail]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelWorkflowRun(owner, repo, run.id);
      toast.success(i18n.t('已发送取消请求'));
      setCancelOpen(false);
      setTimeout(() => { void loadDetail().catch(() => undefined); }, 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('取消失败'));
    } finally {
      setCancelling(false);
    }
  };

  const handleRerun = async (mode: 'all' | 'failed') => {
    setRerunning(mode);
    try {
      if (mode === 'failed') await rerunFailedWorkflowRun(owner, repo, run.id);
      else await rerunWorkflowRun(owner, repo, run.id);
      toast.success(mode === 'failed' ? i18n.t('已重新触发失败任务') : i18n.t('已重新触发工作流'));
      onClose();
      setTimeout(onRefreshList, 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('重新运行失败'));
    } finally {
      setRerunning(null);
    }
  };

  const handleRerunJob = async (job: GitHubWorkflowJob) => {
    setRerunningJobId(job.id);
    try {
      await rerunWorkflowJob(owner, repo, job.id);
      toast.success(`${i18n.t('已重新触发任务：')}${job.name}`);
      setTimeout(() => { void loadDetail().catch(() => undefined); }, 1200);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('重新运行任务失败'));
    } finally {
      setRerunningJobId(null);
    }
  };

  const duration = formatDuration(liveRun.run_started_at || liveRun.created_at, liveRun.status === 'completed' ? liveRun.updated_at : null);

  return (
    <>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border bg-secondary/30 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
                {i18n.t('← 返回列表')}
              </button>
              <span className="text-muted-foreground text-sm">/</span>
              <RunStatusBadge status={liveRun.status} conclusion={liveRun.conclusion} />
              {isRunning && (
                <span className="text-[11px] text-warning flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />{i18n.t('自动刷新中')}
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-foreground mt-1.5 break-words">
              {liveRun.name} <span className="text-muted-foreground font-normal">#{liveRun.run_number}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto sm:justify-end">
            {isRunning && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:bg-secondary h-8 border border-border"
                onClick={() => setCancelOpen(true)}
              >
                <XCircle className="w-3.5 h-3.5 mr-1" />
                {i18n.t('取消运行')}
              </Button>
            )}
            {isFailed && (
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90 h-8"
                onClick={() => handleRerun('failed')}
                disabled={!!rerunning}
              >
                {rerunning === 'failed' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                {rerunning === 'failed' ? i18n.t('触发中...') : i18n.t('重跑失败项')}
              </Button>
            )}
            {liveRun.status === 'completed' && (
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => handleRerun('all')}
                disabled={!!rerunning}
              >
                {rerunning === 'all' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                {rerunning === 'all' ? i18n.t('触发中...') : i18n.t('全部重跑')}
              </Button>
            )}
            <Button asChild size="sm" variant="ghost" className="h-8 border border-border text-muted-foreground hover:bg-secondary">
              <a href={liveRun.html_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1" />{i18n.t('GitHub')}
              </a>
            </Button>
          </div>
        </div>
        <div className="p-4 space-y-2 text-xs text-muted-foreground border-b border-border">
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-4 gap-y-1.5">
            <span>{i18n.t('触发者：')}<span className="text-foreground">{liveRun.triggering_actor?.login || '-'}</span></span>
            <span>{i18n.t('分支：')}<code className="font-mono text-foreground">{liveRun.head_branch}</code></span>
            <span>{i18n.t('事件：')}<span className="text-foreground">{liveRun.event}</span></span>
            <span>{i18n.t('耗时：')}<span className="text-foreground">{duration || '-'}</span></span>
            <span>{i18n.t('开始：')}<span className="text-foreground">{formatRelativeTime(liveRun.created_at)}</span></span>
          </div>
          <p className="text-foreground text-sm mt-1 break-words">{liveRun.head_commit?.message?.split('\n')[0]}</p>
        </div>
        <div className="divide-y divide-border">
          {loadingJobs ? (
            <div className="p-4 space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-8 bg-muted" />)}</div>
          ) : jobs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">{i18n.t('暂无任务数据')}</div>
          ) : jobs.map((job) => (
            <JobItem
              key={job.id}
              job={job}
              owner={owner}
              repo={repo}
              onRerun={handleRerunJob}
              isRerunning={rerunningJobId === job.id}
            />
          ))}
        </div>
      </div>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{i18n.t('确认取消运行')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {i18n.t('取消后正在执行的任务会被终止，已完成的步骤不会回滚。')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">{i18n.t('返回')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? i18n.t('取消中...') : i18n.t('确认取消')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function ActionsPage() {
  const { owner, repo, runId } = useParams<{ owner: string; repo: string; runId?: string }>();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<GitHubWorkflow[]>([]);
  const [runs, setRuns] = useState<GitHubWorkflowRun[]>([]);
  const [loadingWf, setLoadingWf] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedRun, setSelectedRun] = useState<GitHubWorkflowRun | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [triggering, setTriggering] = useState<number | null>(null);
  // 触发工作流 Dialog 状态
  const [triggerDialog, setTriggerDialog] = useState<GitHubWorkflow | null>(null);
  const [triggerRef, setTriggerRef] = useState('main');
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [inputPairs, setInputPairs] = useState<{ key: string; value: string }[]>([]);
  const [workflowInputs, setWorkflowInputs] = useState<Array<{
    name: string;
    description?: string;
    required?: boolean;
    type?: string;
    options?: string[];
    defaultValue?: string;
  }>>([]);
  const [workflowInputValues, setWorkflowInputValues] = useState<Record<string, string>>({});
  const [loadingInputs, setLoadingInputs] = useState(false);

  useEffect(() => {
    if (!owner || !repo) return;
    getWorkflows(owner, repo)
      .then((res) => setWorkflows(res.workflows))
      .catch(console.error)
      .finally(() => setLoadingWf(false));
  }, [owner, repo]);

  useEffect(() => {
    if (!owner || !repo) return;
    if (!runId) {
      setSelectedRun(null);
      setLoadingRun(false);
      return;
    }
    let cancelled = false;
    setLoadingRun(true);
    getWorkflowRun(owner, repo, Number(runId))
      .then((run) => {
        if (!cancelled) setSelectedRun(run);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(i18n.t('加载运行详情失败'));
        navigate(`/repos/${owner}/${repo}/actions`, { replace: true });
        console.error(err);
      })
      .finally(() => {
        if (!cancelled) setLoadingRun(false);
      });
    return () => { cancelled = true; };
  }, [owner, repo, runId, navigate]);

  // 打开触发 Dialog 时加载分支列表
  const loadWorkflowInputs = useCallback(async (wf: GitHubWorkflow, ref: string) => {
    if (!owner || !repo) return;
    setLoadingInputs(true);
    setWorkflowInputs([]);
    setWorkflowInputValues({});
    try {
      const file = await getFileContent(owner, repo, wf.path, ref);
      const text = file.encoding === 'base64'
        ? decodeBase64Content(file.content)
        : file.content;
      const doc = parseYaml(text) as Record<string, unknown> | null;
      const on = (doc?.on ?? (doc as Record<string, unknown> | null)?.['true']) as Record<string, unknown> | Array<unknown> | undefined;
      const dispatch = (Array.isArray(on)
        ? on.find(v => v === 'workflow_dispatch' || (v && typeof v === 'object' && 'workflow_dispatch' in (v as object)))
        : on?.workflow_dispatch) as Record<string, unknown> | undefined;
      const rawInputs = dispatch?.inputs as Record<string, {
        description?: string;
        required?: boolean;
        type?: string;
        default?: unknown;
        options?: string[];
      }> | undefined;
      if (!rawInputs || typeof rawInputs !== 'object') return;
      const defs = Object.entries(rawInputs).map(([name, def]) => ({
        name,
        description: def?.description,
        required: !!def?.required,
        type: def?.type || 'string',
        options: Array.isArray(def?.options) ? def.options.map(String) : undefined,
        // choice 没有显式 default 时，默认选中第一个 options；
        // boolean 没有 default 时与 GitHub 行为保持一致，默认 false。
        defaultValue: def?.default !== undefined
          ? String(def.default)
          : def?.type === 'choice' && Array.isArray(def?.options) && def.options.length > 0
            ? String(def.options[0])
            : def?.type === 'boolean'
              ? 'false'
              : '',
      }));
      setWorkflowInputs(defs);
      setWorkflowInputValues(Object.fromEntries(defs
        .filter(d => d.defaultValue !== '')
        .map(d => [d.name, d.defaultValue])));
    } catch (err) {
      console.warn('[Actions] 读取 workflow inputs 失败', err);
    } finally {
      setLoadingInputs(false);
    }
  }, [owner, repo]);

  const openTriggerDialog = useCallback(async (wf: GitHubWorkflow) => {
    setTriggerDialog(wf);
    setInputPairs([]);
    setWorkflowInputs([]);
    setWorkflowInputValues({});
    if (!owner || !repo) return;
    setLoadingBranches(true);
    try {
      const result = await getBranches(owner, repo, 1);
      const names = result.data.map((b) => b.name);
      setBranches(names);
      const ref = names[0] || 'main';
      setTriggerRef(ref);
      void loadWorkflowInputs(wf, ref);
    } catch {
      setBranches([]);
      setTriggerRef('main');
      void loadWorkflowInputs(wf, 'main');
    } finally {
      setLoadingBranches(false);
    }
  }, [owner, repo, loadWorkflowInputs]);

  const handleTriggerConfirm = async () => {
    if (!owner || !repo || !triggerDialog) return;
    const inputs: Record<string, string> = { ...workflowInputValues };
    inputPairs.forEach(({ key, value }) => { if (key.trim()) inputs[key.trim()] = value; });
    const missing = workflowInputs.filter(d => d.required && !(inputs[d.name] ?? '').trim());
    if (missing.length) {
      toast.error(`${i18n.t('请填写必填 Inputs：')}${missing.map(d => d.name).join(', ')}`);
      return;
    }
    setTriggering(triggerDialog.id);
    try {
      await triggerWorkflow(owner, repo, triggerDialog.id, triggerRef, inputs);
      toast.success(`工作流 "${triggerDialog.name}" 已在 ${triggerRef} 分支触发`);
      setTriggerDialog(null);
      setTimeout(() => loadRuns(1), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('触发失败，请确保工作流支持 workflow_dispatch'));
    } finally {
      setTriggering(null);
    }
  };

  const loadRuns = useCallback(async (pg = 1, append = false, silent = false) => {
    if (!owner || !repo) return;
    if (!silent) setLoadingRuns(true);
    try {
      const wfId = selectedWorkflow !== 'all' ? selectedWorkflow : undefined;
      const status = statusFilter !== 'all' ? statusFilter : undefined;
      const res = await getWorkflowRuns(owner, repo, { workflow_id: wfId, status, per_page: 20, page: pg });
      if (append) setRuns((prev) => [...prev, ...res.workflow_runs]);
      else setRuns(res.workflow_runs);
      const total = Number(res.total_count ?? 0);
      setTotalCount(total);
      setHasMore(pg * 20 < total);
      setPage(pg);
    } catch (err) {
      if (!silent) toast.error(i18n.t('加载运行记录失败'));
      console.error(err);
    } finally {
      if (!silent) setLoadingRuns(false);
    }
  }, [owner, repo, selectedWorkflow, statusFilter]);

  useEffect(() => { loadRuns(1); }, [loadRuns]);

  const handleRunUpdate = useCallback((updated: GitHubWorkflowRun) => {
    setRuns((prev) => prev.map((item) => item.id === updated.id ? updated : item));
  }, []);

  const hasActiveRuns = runs.some(isActiveRun);
  useEffect(() => {
    if (!hasActiveRuns || selectedRun || page !== 1) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (!document.hidden) void loadRuns(1, false, true);
      timer = setTimeout(tick, 8000);
    };
    timer = setTimeout(tick, 8000);
    const handleVisibility = () => {
      if (document.hidden) return;
      if (timer) clearTimeout(timer);
      void loadRuns(1, false, true);
      timer = setTimeout(tick, 8000);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [hasActiveRuns, selectedRun, page, loadRuns]);

  const selectedWorkflowObj = workflows.find((wf) => String(wf.id) === selectedWorkflow);
  const openSelectedTrigger = () => {
    if (!selectedWorkflowObj) {
      toast.info(i18n.t('请先选择一个工作流'));
      return;
    }
    void openTriggerDialog(selectedWorkflowObj);
  };

  const closeRunDetail = () => {
    setSelectedRun(null);
    if (runId) navigate(`/repos/${owner}/${repo}/actions`);
  };

  return (
    <>
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        {selectedRun ? (
          <button type="button" className="text-muted-foreground hover:text-accent" onClick={closeRunDetail}>Actions</button>
        ) : (
          <span className="text-foreground">Actions</span>
        )}
        {selectedRun && (
          <>
            <ChevronRight className="w-3 h-3" />
            <span className="text-foreground truncate">#{selectedRun.run_number}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground">
          {selectedRun ? i18n.t('Actions 运行详情') : i18n.t('Actions 工作流')}
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 工作流列表 */}
        <div className="hidden md:block bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-secondary/30">
            <p className="text-sm font-medium text-foreground">{i18n.t('工作流')}</p>
          </div>
          {loadingWf ? (
            <div className="p-3 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 bg-muted" />)}</div>
          ) : workflows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{i18n.t('暂无工作流')}</div>
          ) : (
            <div className="divide-y divide-border">
              {workflows.map((wf) => (
                <div key={wf.id} className="flex items-center gap-2 px-3 py-2.5 group">
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => setSelectedWorkflow(String(wf.id))}
                  >
                    <p className={`text-sm truncate ${selectedWorkflow === String(wf.id) ? 'text-primary font-medium' : 'text-foreground'}`}>
                      {wf.name}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{wf.path}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7 opacity-100 md:opacity-0 md:group-hover:opacity-100 group-focus-within:opacity-100 text-muted-foreground hover:text-primary hover:bg-primary/10"
                    onClick={() => openTriggerDialog(wf)}
                    disabled={triggering === wf.id}
                    title={i18n.t('触发工作流')}
                  >
                    {triggering === wf.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 运行记录 */}
        <div className="md:col-span-2 space-y-3">
          {selectedRun ? (
            <RunDetail
              owner={owner!}
              repo={repo!}
              run={selectedRun}
              onClose={closeRunDetail}
              onRunUpdate={handleRunUpdate}
              onRefreshList={() => { void loadRuns(1); }}
            />
          ) : loadingRun ? (
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <Skeleton className="h-8 w-40 bg-muted" />
              <Skeleton className="h-4 w-full bg-muted" />
              <Skeleton className="h-20 w-full bg-muted" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <Select value={selectedWorkflow} onValueChange={(v) => { setSelectedWorkflow(v); setSelectedRun(null); }}>
                  <SelectTrigger className="bg-secondary border-border text-foreground w-36 h-9 text-sm">
                    <SelectValue placeholder={i18n.t('工作流')} />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="all" className="text-foreground text-sm">{i18n.t('全部工作流')}</SelectItem>
                    {workflows.map((wf) => (
                      <SelectItem key={wf.id} value={String(wf.id)} className="text-foreground text-sm">{wf.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="bg-secondary border-border text-foreground w-28 h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="all" className="text-foreground text-sm">{i18n.t('全部状态')}</SelectItem>
                    <SelectItem value="success" className="text-foreground text-sm">{i18n.t('成功')}</SelectItem>
                    <SelectItem value="failure" className="text-foreground text-sm">{i18n.t('失败')}</SelectItem>
                    <SelectItem value="in_progress" className="text-foreground text-sm">{i18n.t('运行中')}</SelectItem>
                    <SelectItem value="cancelled" className="text-foreground text-sm">{i18n.t('已取消')}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:bg-secondary h-9"
                  onClick={() => loadRuns(1)}
                  disabled={loadingRuns}
                  title={i18n.t('刷新运行记录')}
                >
                  <RefreshCw className={`w-4 h-4 ${loadingRuns ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={openSelectedTrigger}
                  title={selectedWorkflowObj ? i18n.t('触发当前工作流') : i18n.t('请先选择工作流')}
                >
                  <Play className="w-3.5 h-3.5" />{i18n.t('运行')}
                </Button>
                <span className="text-[11px] text-muted-foreground ml-auto flex items-center gap-1.5">
                  {hasActiveRuns && <><Loader2 className="w-3 h-3 animate-spin text-warning" />{i18n.t('自动刷新')}</>}
                  {totalCount > 0 && <span>{i18n.t('共')} {totalCount} {i18n.t('条')}</span>}
                </span>
              </div>
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                {loadingRuns && runs.length === 0 ? (
                  <div className="p-4 space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 bg-muted rounded" />)}</div>
                ) : runs.length === 0 ? (
                  <div className="py-12 text-center">
                    <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-foreground font-medium">{i18n.t('暂无运行记录')}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {runs.map((run) => (
                      <button
                        key={run.id}
                        type="button"
                        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors text-left"
                        onClick={() => {
                          setSelectedRun(run);
                          navigate(`/repos/${owner}/${repo}/actions/runs/${run.id}`);
                        }}
                      >
                        <div className="mt-0.5 shrink-0">
                          <RunStatusBadge status={run.status} conclusion={run.conclusion} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {run.name} <span className="text-muted-foreground font-normal">#{run.run_number}</span>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {run.head_commit?.message?.split('\n')[0]}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span>{run.event}</span>
                            <span>·</span>
                            <code className="font-mono">{run.head_branch}</code>
                            <span>·</span>
                            <span>{formatRelativeTime(run.created_at)}</span>
                            {run.status === 'completed' && <><span>·</span><span>{formatDuration(run.run_started_at || run.created_at, run.updated_at)}</span></>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {hasMore && (
                <Button
                  variant="ghost"
                  className="w-full border border-border text-muted-foreground hover:bg-secondary"
                  onClick={() => loadRuns(page + 1, true)}
                  disabled={loadingRuns}
                >
                  {loadingRuns ? i18n.t('加载中...') : i18n.t('加载更多')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

    </div>

    {/* 触发工作流 Dialog */}
    <Dialog open={!!triggerDialog} onOpenChange={(open) => { if (!open) setTriggerDialog(null); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2 text-balance">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            {i18n.t('触发工作流：')}{triggerDialog?.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 分支选择 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-muted-foreground flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5" />{i18n.t('运行分支')}</Label>
            {loadingBranches ? (
              <Skeleton className="h-9 bg-muted w-full" />
            ) : branches.length > 0 ? (
              <Select value={triggerRef} onValueChange={(v) => {
                setTriggerRef(v);
                if (triggerDialog) void loadWorkflowInputs(triggerDialog, v);
              }}>
                <SelectTrigger className="bg-secondary border-border text-foreground h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border max-h-52">
                  {branches.map((b) => (
                    <SelectItem key={b} value={b} className="text-foreground text-sm font-mono">{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                className="bg-secondary border-border text-foreground h-9 text-sm font-mono"
                value={triggerRef}
                onChange={(e) => setTriggerRef(e.target.value)}
                placeholder={i18n.t('分支名称，例如 main')}
              />
            )}
          </div>

          {/* 自动加载 workflow_dispatch.inputs */}
          {loadingInputs ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-28 bg-muted" />
              <Skeleton className="h-9 w-full bg-muted" />
            </div>
          ) : workflowInputs.length > 0 && (
            <div className="space-y-2.5">
              <Label className="text-sm font-normal text-muted-foreground">
                {i18n.t('工作流 Inputs')}</Label>
              {workflowInputs.map((def) => {
                const value = workflowInputValues[def.name] ?? '';
                const setValue = (v: string) => setWorkflowInputValues(prev => ({ ...prev, [def.name]: v }));
                return (
                  <div key={def.name} className="space-y-1">
                    <Label className="text-xs text-foreground font-mono flex items-center gap-1 flex-wrap">
                      {def.name}
                      {def.required && <span className="text-destructive">*</span>}
                      <span className="text-[10px] text-muted-foreground font-sans">{def.type || 'string'}</span>
                    </Label>
                    {def.type === 'choice' && def.options?.length ? (
                      <Select value={value} onValueChange={setValue}>
                        <SelectTrigger className="bg-secondary border-border text-foreground h-9 text-sm">
                          <SelectValue placeholder={i18n.t('请选择')} />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          {def.options.map(opt => <SelectItem key={opt} value={opt} className="text-sm">{opt}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : def.type === 'boolean' ? (
                      <Select value={value || 'false'} onValueChange={setValue}>
                        <SelectTrigger className="bg-secondary border-border text-foreground h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          <SelectItem value="true">true</SelectItem>
                          <SelectItem value="false">false</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className="bg-secondary border-border text-foreground h-9 text-sm"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={def.defaultValue || i18n.t('请输入')}
                      />
                    )}
                    {def.description && (
                      <p className="text-[11px] text-muted-foreground">{def.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 自定义 inputs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-normal text-muted-foreground">
                {i18n.t('自定义 Inputs（可选）')}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary gap-1"
                onClick={() => setInputPairs((prev) => [...prev, { key: '', value: '' }])}
              >
                <Plus className="w-3 h-3" />{i18n.t('添加')}</Button>
            </div>
            {inputPairs.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">
                {i18n.t('无需 inputs 时留空，工作流将使用默认值运行')}</p>
            ) : (
              <div className="space-y-2">
                {inputPairs.map((pair, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      className="bg-secondary border-border text-foreground h-8 text-xs font-mono flex-1"
                      placeholder="key"
                      value={pair.key}
                      onChange={(e) => setInputPairs((prev) => prev.map((p, i) => i === idx ? { ...p, key: e.target.value } : p))}
                    />
                    <Input
                      className="bg-secondary border-border text-foreground h-8 text-xs font-mono flex-1"
                      placeholder="value"
                      value={pair.value}
                      onChange={(e) => setInputPairs((prev) => prev.map((p, i) => i === idx ? { ...p, value: e.target.value } : p))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="w-8 h-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setInputPairs((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            className="border border-border text-muted-foreground hover:bg-secondary"
            onClick={() => setTriggerDialog(null)}
          >
            {i18n.t('取消')}</Button>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5"
            onClick={handleTriggerConfirm}
            disabled={!!triggering || !triggerRef.trim()}
          >
            {triggering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {triggering ? i18n.t('触发中…') : i18n.t('触发运行')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
