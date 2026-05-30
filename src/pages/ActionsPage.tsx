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
  getWorkflowRunJobs,
  getJobLogs,
  getBranches,
  formatRelativeTime,
} from '@/services/github';
import type { GitHubWorkflow, GitHubWorkflowRun, GitHubWorkflowJob } from '@/types/types';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
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
  return <Badge className="bg-secondary text-muted-foreground border-border text-xs">{conclusion || status || i18n.t('未知')}</Badge>;
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

// 日志面板
interface LogPanelProps {
  jobId: number;
  owner: string;
  repo: string;
  isRunning: boolean;
}

function LogPanel({ jobId, owner, repo, isRunning }: LogPanelProps) {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const text = await getJobLogs(owner, repo, jobId);
      setLogs(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : i18n.t('获取日志失败');
      setLogs(`[错误] ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [owner, repo, jobId]);

  useEffect(() => {
    fetchLogs();
    if (isRunning) {
      intervalRef.current = setInterval(fetchLogs, 3000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchLogs, isRunning]);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current && isRunning) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isRunning]);

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
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-secondary/20">
        <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground flex-1">{i18n.t('日志输出')}</span>
        {isRunning && (
          <span className="flex items-center gap-1 text-[10px] text-warning">
            <Loader2 className="w-3 h-3 animate-spin" />{i18n.t('实时刷新')}</span>
        )}
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

function JobItem({ job, owner, repo }: { job: GitHubWorkflowJob; owner: string; repo: string }) {
  const [open, setOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const isRunning = job.status === 'in_progress' || job.status === 'queued';

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center gap-2 px-4 py-2 hover:bg-secondary/50 transition-colors text-left">
        <ChevronDown className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        <RunStatusBadge status={job.status} conclusion={job.conclusion} />
        <span className="text-sm text-foreground flex-1 min-w-0 truncate">{job.name}</span>
        <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(job.started_at)}</span>
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
          {/* 日志查看按钮 */}
          <div className="pt-2 pb-1">
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
          </div>
          {showLogs && (
            <LogPanel jobId={job.id} owner={owner} repo={repo} isRunning={isRunning} />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RunDetail({ owner, repo, run, onClose }: {
  owner: string; repo: string;
  run: GitHubWorkflowRun;
  onClose: () => void;
}) {
  const [jobs, setJobs] = useState<GitHubWorkflowJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRunning = run.status === 'in_progress' || run.status === 'queued';

  const loadJobs = useCallback(() => {
    getWorkflowRunJobs(owner, repo, run.id)
      .then((res) => setJobs(res.jobs))
      .catch(console.error)
      .finally(() => setLoadingJobs(false));
  }, [owner, repo, run.id]);

  useEffect(() => {
    loadJobs();
    if (isRunning) {
      intervalRef.current = setInterval(loadJobs, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadJobs, isRunning]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelWorkflowRun(owner, repo, run.id);
      toast.success(i18n.t('已取消工作流运行'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('取消失败'));
    } finally {
      setCancelling(false);
    }
  };

  const handleRerun = async () => {
    setRerunning(true);
    try {
      await rerunWorkflowRun(owner, repo, run.id);
      toast.success(i18n.t('已重新触发工作流'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('重新运行失败'));
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="p-4 border-b border-border bg-secondary/30 flex items-center gap-3 flex-wrap">
        <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">{i18n.t('← 返回列表')}</button>
        <span className="text-muted-foreground text-sm">/</span>
        <span className="text-sm font-medium text-foreground truncate max-w-xs">{run.name} #{run.run_number}</span>
        <RunStatusBadge status={run.status} conclusion={run.conclusion} />
        {isRunning && (
          <span className="text-[11px] text-warning flex items-center gap-1 ml-1">
            <Loader2 className="w-3 h-3 animate-spin" />{i18n.t('自动刷新中')}</span>
        )}
        <div className="ml-auto flex gap-2">
          {(run.status === 'in_progress' || run.status === 'queued') && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:bg-secondary h-8 border border-border"
              onClick={handleCancel}
              disabled={cancelling}
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              {cancelling ? i18n.t('取消中...') : i18n.t('取消运行')}
            </Button>
          )}
          {run.status === 'completed' && (
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90 h-8"
              onClick={handleRerun}
              disabled={rerunning}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              {rerunning ? i18n.t('触发中...') : i18n.t('重新运行')}
            </Button>
          )}
        </div>
      </div>
      <div className="p-4 space-y-1 text-xs text-muted-foreground border-b border-border">
        <div className="flex gap-4 flex-wrap">
          <span>{i18n.t('触发者：')}<span className="text-foreground">{run.triggering_actor?.login}</span></span>
          <span>{i18n.t('分支：')}<code className="font-mono text-foreground">{run.head_branch}</code></span>
          <span>{i18n.t('事件：')}<span className="text-foreground">{run.event}</span></span>
          <span>{i18n.t('开始：')}<span className="text-foreground">{formatRelativeTime(run.created_at)}</span></span>
        </div>
        <p className="text-foreground text-sm mt-1">{run.head_commit?.message?.split('\n')[0]}</p>
      </div>
      <div className="divide-y divide-border">
        {loadingJobs ? (
          <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 bg-muted" />)}</div>
        ) : jobs.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">{i18n.t('暂无任务数据')}</div>
        ) : jobs.map((job) => <JobItem key={job.id} job={job} owner={owner} repo={repo} />)}
      </div>
    </div>
  );
}

export default function ActionsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<GitHubWorkflow[]>([]);
  const [runs, setRuns] = useState<GitHubWorkflowRun[]>([]);
  const [loadingWf, setLoadingWf] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedRun, setSelectedRun] = useState<GitHubWorkflowRun | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [triggering, setTriggering] = useState<number | null>(null);
  // 触发工作流 Dialog 状态
  const [triggerDialog, setTriggerDialog] = useState<GitHubWorkflow | null>(null);
  const [triggerRef, setTriggerRef] = useState('main');
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [inputPairs, setInputPairs] = useState<{ key: string; value: string }[]>([]);

  useEffect(() => {
    if (!owner || !repo) return;
    getWorkflows(owner, repo)
      .then((res) => setWorkflows(res.workflows))
      .catch(console.error)
      .finally(() => setLoadingWf(false));
  }, [owner, repo]);

  // 打开触发 Dialog 时加载分支列表
  const openTriggerDialog = useCallback(async (wf: GitHubWorkflow) => {
    setTriggerDialog(wf);
    setInputPairs([]);
    if (!owner || !repo) return;
    setLoadingBranches(true);
    try {
      const result = await getBranches(owner, repo, 1);
      const names = result.data.map((b) => b.name);
      setBranches(names);
      setTriggerRef(names[0] || 'main');
    } catch {
      setBranches([]);
      setTriggerRef('main');
    } finally {
      setLoadingBranches(false);
    }
  }, [owner, repo]);

  const handleTriggerConfirm = async () => {
    if (!owner || !repo || !triggerDialog) return;
    const inputs: Record<string, string> = {};
    inputPairs.forEach(({ key, value }) => { if (key.trim()) inputs[key.trim()] = value; });
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

  const loadRuns = useCallback(async (pg = 1, append = false) => {
    if (!owner || !repo) return;
    setLoadingRuns(true);
    try {
      const wfId = selectedWorkflow !== 'all' ? selectedWorkflow : undefined;
      const status = statusFilter !== 'all' ? statusFilter : undefined;
      const res = await getWorkflowRuns(owner, repo, { workflow_id: wfId, status, per_page: 20, page: pg });
      if (append) setRuns((prev) => [...prev, ...res.workflow_runs]);
      else setRuns(res.workflow_runs);
      setHasMore(res.workflow_runs.length === 20);
      setPage(pg);
    } catch (err) {
      toast.error(i18n.t('加载运行记录失败'));
      console.error(err);
    } finally {
      setLoadingRuns(false);
    }
  }, [owner, repo, selectedWorkflow, statusFilter]);

  useEffect(() => { loadRuns(1); }, [loadRuns]);

  return (
    <>
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Actions</span>
      </div>

      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground">{i18n.t('Actions 工作流')}</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 工作流列表 */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
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
                    className="w-7 h-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary hover:bg-primary/10"
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
            <RunDetail owner={owner!} repo={repo!} run={selectedRun} onClose={() => setSelectedRun(null)} />
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
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
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
                        onClick={() => setSelectedRun(run)}
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
              <Select value={triggerRef} onValueChange={setTriggerRef}>
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
