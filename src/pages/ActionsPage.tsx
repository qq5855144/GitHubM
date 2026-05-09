// GitHub Actions 工作流管理

import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  formatRelativeTime,
} from '@/services/github';
import type { GitHubWorkflow, GitHubWorkflowRun, GitHubWorkflowJob } from '@/types/types';
import { toast } from 'sonner';

function RunStatusBadge({ status, conclusion }: { status: string | null; conclusion: string | null }) {
  if (status === 'in_progress' || status === 'queued' || status === 'waiting') {
    return (
      <Badge className="bg-warning/10 text-warning border-warning/30 text-xs flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        {status === 'in_progress' ? '运行中' : status === 'queued' ? '排队中' : '等待中'}
      </Badge>
    );
  }
  if (conclusion === 'success') {
    return <Badge className="bg-success/10 text-success border-success/30 text-xs flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />成功</Badge>;
  }
  if (conclusion === 'failure') {
    return <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs flex items-center gap-1"><XCircle className="w-3 h-3" />失败</Badge>;
  }
  if (conclusion === 'cancelled') {
    return <Badge className="bg-secondary text-muted-foreground border-border text-xs">已取消</Badge>;
  }
  if (conclusion === 'skipped') {
    return <Badge className="bg-secondary text-muted-foreground border-border text-xs flex items-center gap-1"><SkipForward className="w-3 h-3" />已跳过</Badge>;
  }
  if (conclusion === 'timed_out') {
    return <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs flex items-center gap-1"><Clock className="w-3 h-3" />超时</Badge>;
  }
  return <Badge className="bg-secondary text-muted-foreground border-border text-xs">{conclusion || status || '未知'}</Badge>;
}

function JobItem({ job }: { job: GitHubWorkflowJob }) {
  const [open, setOpen] = useState(false);
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
              <span className="text-xs text-muted-foreground">{step.name}</span>
            </div>
          ))}
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

  useEffect(() => {
    getWorkflowRunJobs(owner, repo, run.id)
      .then((res) => setJobs(res.jobs))
      .catch(console.error)
      .finally(() => setLoadingJobs(false));
  }, [owner, repo, run.id]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelWorkflowRun(owner, repo, run.id);
      toast.success('已取消工作流运行');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取消失败');
    } finally {
      setCancelling(false);
    }
  };

  const handleRerun = async () => {
    setRerunning(true);
    try {
      await rerunWorkflowRun(owner, repo, run.id);
      toast.success('已重新触发工作流');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重新运行失败');
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="p-4 border-b border-border bg-secondary/30 flex items-center gap-3 flex-wrap">
        <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">← 返回列表</button>
        <span className="text-muted-foreground text-sm">/</span>
        <span className="text-sm font-medium text-foreground truncate max-w-xs">{run.name} #{run.run_number}</span>
        <RunStatusBadge status={run.status} conclusion={run.conclusion} />
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
              {cancelling ? '取消中...' : '取消运行'}
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
              {rerunning ? '触发中...' : '重新运行'}
            </Button>
          )}
        </div>
      </div>
      <div className="p-4 space-y-1 text-xs text-muted-foreground border-b border-border">
        <div className="flex gap-4 flex-wrap">
          <span>触发者：<span className="text-foreground">{run.triggering_actor?.login}</span></span>
          <span>分支：<code className="font-mono text-foreground">{run.head_branch}</code></span>
          <span>事件：<span className="text-foreground">{run.event}</span></span>
          <span>开始：<span className="text-foreground">{formatRelativeTime(run.created_at)}</span></span>
        </div>
        <p className="text-foreground text-sm mt-1">{run.head_commit?.message?.split('\n')[0]}</p>
      </div>
      <div className="divide-y divide-border">
        {loadingJobs ? (
          <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 bg-muted" />)}</div>
        ) : jobs.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">暂无任务数据</div>
        ) : jobs.map((job) => <JobItem key={job.id} job={job} />)}
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

  useEffect(() => {
    if (!owner || !repo) return;
    getWorkflows(owner, repo)
      .then((res) => setWorkflows(res.workflows))
      .catch(console.error)
      .finally(() => setLoadingWf(false));
  }, [owner, repo]);

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
      toast.error('加载运行记录失败');
      console.error(err);
    } finally {
      setLoadingRuns(false);
    }
  }, [owner, repo, selectedWorkflow, statusFilter]);

  useEffect(() => { loadRuns(1); }, [loadRuns]);

  const handleTrigger = async (wf: GitHubWorkflow) => {
    if (!owner || !repo) return;
    setTriggering(wf.id);
    try {
      await triggerWorkflow(owner, repo, wf.id, 'main');
      toast.success(`工作流 "${wf.name}" 已触发`);
      setTimeout(() => loadRuns(1), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '触发失败，请确保工作流支持 workflow_dispatch');
    } finally {
      setTriggering(null);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>仓库</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Actions</span>
      </div>

      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground">Actions 工作流</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 工作流列表 */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-secondary/30">
            <p className="text-sm font-medium text-foreground">工作流</p>
          </div>
          {loadingWf ? (
            <div className="p-3 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 bg-muted" />)}</div>
          ) : workflows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无工作流</div>
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
                    onClick={() => handleTrigger(wf)}
                    disabled={triggering === wf.id}
                    title="触发工作流"
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
                    <SelectValue placeholder="工作流" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="all" className="text-foreground text-sm">全部工作流</SelectItem>
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
                    <SelectItem value="all" className="text-foreground text-sm">全部状态</SelectItem>
                    <SelectItem value="success" className="text-foreground text-sm">成功</SelectItem>
                    <SelectItem value="failure" className="text-foreground text-sm">失败</SelectItem>
                    <SelectItem value="in_progress" className="text-foreground text-sm">运行中</SelectItem>
                    <SelectItem value="cancelled" className="text-foreground text-sm">已取消</SelectItem>
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
                    <p className="text-foreground font-medium">暂无运行记录</p>
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
                  {loadingRuns ? '加载中...' : '加载更多'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
