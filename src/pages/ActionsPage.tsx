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
  Search,
  Tag,
  Power,
  MoreHorizontal,
  ChevronsUpDown,
  Download,
  Package,
  ShieldCheck,
  ShieldX,
  Save,
  KeyRound,
  Sparkles,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  getWorkflows,
  getWorkflowRuns,
  triggerWorkflow,
  cancelWorkflowRun,
  rerunWorkflowRun,
  getWorkflowRun,
  getWorkflowRunJobs,
  getRunArtifacts,
  getTags,
  enableWorkflow,
  disableWorkflow,
  getPendingDeployments,
  reviewPendingDeployments,
  getToken,
  rerunFailedWorkflowRun,
  rerunWorkflowJob,
  getJobLogs,
  getBranches,
  getRepo,
  formatRelativeTime,
  getFileContent,
} from '@/services/github';
import type { GitHubWorkflow, GitHubWorkflowRun, GitHubWorkflowJob } from '@/types/types';
import type { GitHubArtifact, GitHubPendingDeployment, GitHubTagRef } from '@/services/github';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { decodeBase64Content } from '@/lib/utils';
import { parse as parseYaml } from 'yaml';
import { buildActionsFailurePrompt } from '@/lib/actionsAiPrompt';
import { setAiTaskHandoff } from '@/lib/aiTaskHandoff';
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

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 90) || 'download';
}

/** 原生下载 API 资源；浏览器环境回退到 GitHub 页面。 */
function downloadApiResource(apiUrl: string, fileName: string, fallbackUrl: string): void {
  const token = getToken();
  if (!token) {
    toast.error(i18n.t('请先登录后再下载'));
    return;
  }
  const bridge = (window as unknown as { AndroidBridge?: { downloadFile?: (url: string, name: string, token: string) => void } }).AndroidBridge;
  if (bridge?.downloadFile) {
    bridge.downloadFile(apiUrl, fileName, token);
    toast.success(`${i18n.t('开始下载')} ${fileName}`);
    return;
  }
  window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
  toast.info(i18n.t('已打开 GitHub 页面，请在浏览器中下载'));
}

interface TriggerPreset {
  id: string;
  name: string;
  ref: string;
  inputs: Record<string, string>;
  createdAt: number;
}

const TRIGGER_PRESET_KEY = 'actions_trigger_presets_v1';

function triggerPresetKey(owner: string, repo: string, workflowId: number): string {
  return `${TRIGGER_PRESET_KEY}:${owner}/${repo}/${workflowId}`;
}

function triggerLastKey(owner: string, repo: string, workflowId: number): string {
  return `actions_trigger_last:${owner}/${repo}/${workflowId}`;
}

function loadTriggerPresets(owner: string, repo: string, workflowId: number): TriggerPreset[] {
  try {
    const raw = localStorage.getItem(triggerPresetKey(owner, repo, workflowId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TriggerPreset[];
    return Array.isArray(parsed) ? parsed.filter((p) => p && p.id && p.ref) : [];
  } catch {
    return [];
  }
}

function saveTriggerPresets(owner: string, repo: string, workflowId: number, presets: TriggerPreset[]): void {
  try {
    localStorage.setItem(triggerPresetKey(owner, repo, workflowId), JSON.stringify(presets.slice(0, 20)));
  } catch { /* ignore */ }
}

interface LastTrigger {
  ref: string;
  inputs: Record<string, string>;
}

function loadLastTrigger(owner: string, repo: string, workflowId: number): LastTrigger | null {
  try {
    const raw = localStorage.getItem(triggerLastKey(owner, repo, workflowId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastTrigger;
    return parsed?.ref ? { ref: parsed.ref, inputs: parsed.inputs ?? {} } : null;
  } catch {
    return null;
  }
}

function saveLastTrigger(owner: string, repo: string, workflowId: number, last: LastTrigger): void {
  try {
    localStorage.setItem(triggerLastKey(owner, repo, workflowId), JSON.stringify(last));
  } catch { /* ignore */ }
}

function RefSelector({
  value,
  onChange,
  branches,
  tags,
  disabled,
}: {
  value: string;
  onChange: (ref: string) => void;
  branches: string[];
  tags: string[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full h-10 justify-between bg-secondary border-border text-foreground font-mono text-sm"
          disabled={disabled}
        >
          <span className="flex items-center gap-2 min-w-0">
            <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{value || i18n.t('选择分支或 Tag')}</span>
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0 bg-popover border-border">
        <Command>
          <CommandInput placeholder={i18n.t('搜索分支或 Tag...')} />
          <CommandList className="max-h-72">
            <CommandEmpty>{i18n.t('没有匹配的分支或 Tag')}</CommandEmpty>
            {branches.length > 0 && (
              <CommandGroup heading={`${i18n.t('分支')} (${branches.length})`}>
                {branches.map((name) => (
                  <CommandItem
                    key={`branch:${name}`}
                    value={`branch:${name}`}
                    onSelect={() => { onChange(name); setOpen(false); }}
                  >
                    <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-mono truncate">{name}</span>
                    {value === name && <Check className="w-3.5 h-3.5 ml-auto text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {tags.length > 0 && (
              <CommandGroup heading={`Tags (${tags.length})`}>
                {tags.map((name) => (
                  <CommandItem
                    key={`tag:${name}`}
                    value={`tag:${name}`}
                    onSelect={() => { onChange(name); setOpen(false); }}
                  >
                    <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-mono truncate">{name}</span>
                    {value === name && <Check className="w-3.5 h-3.5 ml-auto text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
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
  jobName: string;
  jobConclusion?: string | null;
  jobHtmlUrl?: string;
  branch?: string;
  failedSteps?: string[];
}
const MAX_LOG_LINES = 2000;
function trimLogLines(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= MAX_LOG_LINES) return text;
  return `${i18n.t('… 日志过长，仅显示最后')} ${MAX_LOG_LINES} ${i18n.t('行')}\n${lines.slice(-MAX_LOG_LINES).join('\n')}`;
}
function LogPanel({
  jobId,
  owner,
  repo,
  isRunning,
  jobName,
  jobConclusion,
  jobHtmlUrl,
  branch,
  failedSteps,
}: LogPanelProps) {
  const navigate = useNavigate();
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
  const handleAnalyzeWithAi = () => {
    const prompt = buildActionsFailurePrompt({
      repoFullName: `${owner}/${repo}`,
      branch,
      jobName,
      conclusion: jobConclusion,
      htmlUrl: jobHtmlUrl,
      failedSteps,
      logs: stripAnsi(logs),
    });
    if (!setAiTaskHandoff({
      prompt,
      repoFullName: `${owner}/${repo}`,
      branch,
      source: 'actions',
    })) {
      toast.error(i18n.t('无法传递给 AI 助手，请重试'));
      return;
    }
    toast.success(i18n.t('已发送失败日志到 AI 助手'));
    navigate('/ai-assistant');
  };

  return (
    <div className="bg-[#0d1117] border border-border rounded-lg overflow-hidden">
      <div className="flex flex-nowrap items-center gap-1.5 px-3 py-2 border-b border-border bg-secondary/20 overflow-hidden">
        <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{i18n.t('日志输出')}</span>
        {isRunning && (
          <span className="hidden sm:flex items-center gap-1 text-[10px] text-warning">
            <Loader2 className="w-3 h-3 animate-spin" />{i18n.t('实时刷新')}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 px-1.5 sm:px-2 text-[10px] gap-1 shrink-0 whitespace-nowrap ${follow ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setFollow((prev) => !prev)}
          title={i18n.t('跟随最新日志')}
        >
          <ArrowDown className="w-3 h-3" /><span className="hidden sm:inline">{follow ? i18n.t('跟随中') : i18n.t('跟随')}</span>
        </Button>
        {!isRunning && (jobConclusion === 'failure' || jobConclusion === 'timed_out') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 sm:px-2 text-xs text-primary hover:text-primary hover:bg-primary/10 gap-1 shrink-0 whitespace-nowrap"
            onClick={handleAnalyzeWithAi}
            disabled={loading || !logs}
            title={i18n.t('发送失败日志给 AI 分析')}
          >
            <Sparkles className="w-3 h-3" />
            <span>{i18n.t('AI分析')}</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 sm:px-2 text-xs text-muted-foreground hover:text-foreground gap-1 shrink-0 whitespace-nowrap"
          onClick={handleCopy}
          disabled={loading || !logs}
        >
          {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
          <span className="hidden sm:inline">{copied ? i18n.t('已复制') : i18n.t('复制')}</span>
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
  branch,
  onRerun,
  isRerunning,
}: {
  job: GitHubWorkflowJob;
  owner: string;
  repo: string;
  branch?: string;
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
            <LogPanel
              jobId={job.id}
              owner={owner}
              repo={repo}
              isRunning={isRunning}
              jobName={job.name}
              jobConclusion={job.conclusion}
              jobHtmlUrl={job.html_url}
              branch={branch}
              failedSteps={job.steps.filter((step) => step.conclusion === 'failure').map((step) => step.name)}
            />
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
  const [pendingDeployments, setPendingDeployments] = useState<GitHubPendingDeployment[]>([]);
  const [artifacts, setArtifacts] = useState<GitHubArtifact[]>([]);
  const [loadingArtifacts, setLoadingArtifacts] = useState(true);
  const [reviewingEnv, setReviewingEnv] = useState<number | null>(null);
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
    if (freshRun.status === 'waiting' || freshRun.conclusion === 'action_required') {
      try {
        setPendingDeployments(await getPendingDeployments(owner, repo, run.id));
      } catch {
        setPendingDeployments([]);
      }
    } else {
      setPendingDeployments([]);
    }
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

  const completed = liveRun.status === 'completed';
  useEffect(() => {
    let cancelled = false;
    setLoadingArtifacts(true);
    getRunArtifacts(owner, repo, run.id)
      .then((res) => {
        if (!cancelled) setArtifacts(Array.isArray(res.artifacts) ? res.artifacts : []);
      })
      .catch(() => {
        if (!cancelled) setArtifacts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingArtifacts(false);
      });
    return () => { cancelled = true; };
  }, [owner, repo, run.id, completed]);

  const handleReviewDeployment = async (deployment: GitHubPendingDeployment, decision: 'approved' | 'rejected') => {
    setReviewingEnv(deployment.environment.id);
    try {
      await reviewPendingDeployments(owner, repo, run.id, [deployment.environment.id], decision);
      toast.success(decision === 'approved' ? i18n.t('已批准部署') : i18n.t('已拒绝部署'));
      setTimeout(() => { void loadDetail().catch(() => undefined); }, 800);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('部署审批失败'));
    } finally {
      setReviewingEnv(null);
    }
  };

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
        {pendingDeployments.length > 0 && (
          <div className="p-4 border-b border-border">
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 space-y-2.5">
              <div className="flex items-center gap-2 text-warning">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <p className="text-sm font-medium">{i18n.t('待审批部署')}</p>
              </div>
              {pendingDeployments.map((deployment) => (
                <div key={deployment.environment.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-card/80 border border-border p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{deployment.environment.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {deployment.current_user_can_approve
                        ? i18n.t('等待你审批后继续执行')
                        : i18n.t('等待其他审批人处理')}
                      {!!deployment.wait_timer && ` · ${i18n.t('等待计时')} ${deployment.wait_timer}${i18n.t('分钟')}`}
                    </p>
                  </div>
                  {deployment.current_user_can_approve && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                        onClick={() => handleReviewDeployment(deployment, 'rejected')}
                        disabled={reviewingEnv === deployment.environment.id}
                      >
                        <ShieldX className="w-3.5 h-3.5" />{i18n.t('拒绝')}
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => handleReviewDeployment(deployment, 'approved')}
                        disabled={reviewingEnv === deployment.environment.id}
                      >
                        {reviewingEnv === deployment.environment.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <ShieldCheck className="w-3.5 h-3.5" />}
                        {i18n.t('批准')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
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
              branch={liveRun.head_branch || ''}
              onRerun={handleRerunJob}
              isRerunning={rerunningJobId === job.id}
            />
          ))}
        </div>
        <div className="border-t border-border">
          <div className="px-4 py-3 flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{i18n.t('Artifacts')}</p>
            {!loadingArtifacts && artifacts.length > 0 && (
              <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">{artifacts.length}</Badge>
            )}
          </div>
          {loadingArtifacts ? (
            <div className="px-4 pb-4 space-y-2">
              <Skeleton className="h-10 bg-muted" />
              <Skeleton className="h-10 bg-muted" />
            </div>
          ) : artifacts.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              {completed ? i18n.t('本次运行没有产物') : i18n.t('运行完成后可查看产物')}
            </p>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <Package className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground font-mono truncate">{artifact.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatBytes(artifact.size_in_bytes)}
                      {artifact.expired && ` · ${i18n.t('已过期')}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 shrink-0"
                    disabled={artifact.expired}
                    onClick={() => downloadApiResource(
                      artifact.archive_download_url,
                      `${safeFileName(artifact.name)}.zip`,
                      liveRun.html_url,
                    )}
                  >
                    <Download className="w-3.5 h-3.5" />{i18n.t('下载')}
                  </Button>
                </div>
              ))}
            </div>
          )}
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
  const [tags, setTags] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [presets, setPresets] = useState<TriggerPreset[]>([]);
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [workflowSearch, setWorkflowSearch] = useState('');
  const [togglingWorkflow, setTogglingWorkflow] = useState<number | null>(null);
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
  const workflowInputRequestRef = useRef(0);

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
  const loadWorkflowInputs = useCallback(async (wf: GitHubWorkflow, ref: string, initialValues?: Record<string, string>) => {
    if (!owner || !repo) return;
    const requestId = ++workflowInputRequestRef.current;
    setLoadingInputs(true);
    setWorkflowInputs([]);
    setWorkflowInputValues({});
    try {
      const file = await getFileContent(owner, repo, wf.path, ref);
      if (requestId !== workflowInputRequestRef.current) return;
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
      const defaultValues = Object.fromEntries(defs
        .filter(d => d.defaultValue !== '')
        .map(d => [d.name, d.defaultValue]));
      setWorkflowInputValues({ ...defaultValues, ...(initialValues ?? {}) });
      const definedNames = new Set(defs.map((d) => d.name));
      setInputPairs(Object.entries(initialValues ?? {})
        .filter(([key]) => !definedNames.has(key))
        .map(([key, value]) => ({ key, value })));
    } catch (err) {
      if (requestId === workflowInputRequestRef.current) {
        console.warn('[Actions] 读取 workflow inputs 失败', err);
      }
    } finally {
      if (requestId === workflowInputRequestRef.current) setLoadingInputs(false);
    }
  }, [owner, repo]);

  const openTriggerDialog = useCallback(async (wf: GitHubWorkflow) => {
    setTriggerDialog(wf);
    setInputPairs([]);
    setWorkflowInputs([]);
    setWorkflowInputValues({});
    setTags([]);
    setShowPresetForm(false);
    setPresetName('');
    if (!owner || !repo) return;
    setPresets(loadTriggerPresets(owner, repo, wf.id));
    setLoadingBranches(true);
    try {
      const [result, repoInfo, tagRefs] = await Promise.all([
        getBranches(owner, repo, 1, 100),
        getRepo(owner, repo).catch(() => null),
        getTags(owner, repo, 100).catch(() => [] as GitHubTagRef[]),
      ]);
      const names = result.data.map((b) => b.name);
      const defaultBranch = repoInfo?.default_branch;
      const branchOptions = defaultBranch && !names.includes(defaultBranch)
        ? [defaultBranch, ...names]
        : names;
      setBranches(branchOptions);
      setTags(tagRefs.map((tag) => tag.name));
      const last = loadLastTrigger(owner, repo, wf.id);
      const ref = last?.ref || defaultBranch || names[0] || 'main';
      setTriggerRef(ref);
      void loadWorkflowInputs(wf, ref, last?.inputs);
    } catch {
      setBranches([]);
      setTriggerRef('main');
      void loadWorkflowInputs(wf, 'main');
    } finally {
      setLoadingBranches(false);
    }
  }, [owner, repo, loadWorkflowInputs]);

  const collectTriggerInputs = () => {
    const inputs: Record<string, string> = { ...workflowInputValues };
    inputPairs.forEach(({ key, value }) => { if (key.trim()) inputs[key.trim()] = value; });
    return inputs;
  };

  const handleSavePreset = () => {
    if (!owner || !repo || !triggerDialog) return;
    const name = presetName.trim() || `${i18n.t('预设')} ${presets.length + 1}`;
    const preset: TriggerPreset = {
      id: crypto.randomUUID(),
      name,
      ref: triggerRef,
      inputs: collectTriggerInputs(),
      createdAt: Date.now(),
    };
    const next = [preset, ...presets].slice(0, 20);
    setPresets(next);
    saveTriggerPresets(owner, repo, triggerDialog.id, next);
    setShowPresetForm(false);
    setPresetName('');
    toast.success(i18n.t('预设已保存'));
  };

  const applyPreset = (preset: TriggerPreset) => {
    if (!triggerDialog) return;
    setTriggerRef(preset.ref);
    void loadWorkflowInputs(triggerDialog, preset.ref, preset.inputs);
    toast.success(`${i18n.t('已应用预设：')}${preset.name}`);
  };

  const deletePreset = (id: string) => {
    if (!owner || !repo || !triggerDialog) return;
    const next = presets.filter((preset) => preset.id !== id);
    setPresets(next);
    saveTriggerPresets(owner, repo, triggerDialog.id, next);
  };

  const handleToggleWorkflow = async (wf: GitHubWorkflow) => {
    setTogglingWorkflow(wf.id);
    const enable = wf.state !== 'active';
    try {
      if (enable) await enableWorkflow(owner!, repo!, wf.id);
      else await disableWorkflow(owner!, repo!, wf.id);
      setWorkflows((prev) => prev.map((item) => item.id === wf.id
        ? { ...item, state: enable ? 'active' : 'disabled_manually' }
        : item));
      toast.success(enable ? i18n.t('工作流已启用') : i18n.t('工作流已禁用'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('工作流状态切换失败'));
    } finally {
      setTogglingWorkflow(null);
    }
  };

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
      saveLastTrigger(owner, repo, triggerDialog.id, { ref: triggerRef, inputs });
      toast.success(`工作流 "${triggerDialog.name}" 已在 ${triggerRef} 触发`);
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
    if (selectedWorkflowObj.state !== 'active') {
      toast.error(i18n.t('工作流已禁用，请先启用'));
      return;
    }
    void openTriggerDialog(selectedWorkflowObj);
  };
  const filteredWorkflows = workflows.filter((wf) => {
    const query = workflowSearch.trim().toLowerCase();
    return !query || wf.name.toLowerCase().includes(query) || wf.path.toLowerCase().includes(query);
  });

  const closeRunDetail = () => {
    setSelectedRun(null);
    if (runId) navigate(`/repos/${owner}/${repo}/actions`);
  };

  return (
    <>
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
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

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Zap className="w-5 h-5 text-primary shrink-0" />
          <h1 className="text-xl font-bold text-foreground truncate">
            {selectedRun ? i18n.t('Actions 运行详情') : i18n.t('Actions 工作流')}
          </h1>
        </div>
        {!selectedRun && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 bg-card border-border"
              onClick={() => navigate(`/repos/${owner}/${repo}/actions/secrets`)}
              title={i18n.t('Actions 密钥与变量')}
            >
              <KeyRound className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 bg-card border-border"
              onClick={() => loadRuns(1)}
              disabled={loadingRuns}
              title={i18n.t('刷新运行记录')}
            >
              <RefreshCw className={`w-4 h-4 ${loadingRuns ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
        {/* 工作流列表 */}
        <div className="hidden md:flex md:flex-col bg-card border border-border rounded-xl overflow-hidden md:sticky md:top-4">
          <div className="px-3 py-3 border-b border-border bg-secondary/30 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">{i18n.t('工作流')}</p>
              <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">{workflows.length}</Badge>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={workflowSearch}
                onChange={(e) => setWorkflowSearch(e.target.value)}
                placeholder={i18n.t('搜索工作流')}
                className="h-8 pl-8 text-xs bg-background border-border"
              />
            </div>
          </div>
          {loadingWf ? (
            <div className="p-3 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 bg-muted" />)}</div>
          ) : filteredWorkflows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {workflowSearch ? i18n.t('没有匹配的工作流') : i18n.t('暂无工作流')}
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[calc(100vh-18rem)] overflow-y-auto">
              {filteredWorkflows.map((wf) => {
                const selected = selectedWorkflow === String(wf.id);
                const active = wf.state === 'active';
                return (
                  <div key={wf.id} className={`flex items-center gap-1 pr-1 ${selected ? 'bg-primary/5' : 'hover:bg-secondary/40'} transition-colors`}>
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex items-start gap-2 px-3 py-2.5 text-left"
                      onClick={() => {
                        setSelectedWorkflow(String(wf.id));
                        if (selectedRun) closeRunDetail();
                      }}
                    >
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${active ? 'bg-success' : 'bg-muted-foreground/40'}`} />
                      <span className="min-w-0">
                        <span className={`block text-sm truncate ${selected ? 'text-primary font-medium' : 'text-foreground'}`}>{wf.name}</span>
                        <span className="block text-[10px] text-muted-foreground font-mono truncate mt-0.5">{wf.path}</span>
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 shrink-0 text-muted-foreground hover:text-foreground"
                          title={i18n.t('工作流操作')}
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44 bg-popover border-border">
                        <DropdownMenuItem
                          onSelect={() => openTriggerDialog(wf)}
                          disabled={!active}
                          className="gap-2 text-sm"
                        >
                          <Play className="w-3.5 h-3.5" />{i18n.t('运行工作流')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem
                          onSelect={() => handleToggleWorkflow(wf)}
                          disabled={togglingWorkflow === wf.id}
                          className="gap-2 text-sm"
                        >
                          {togglingWorkflow === wf.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Power className="w-3.5 h-3.5" />}
                          {active ? i18n.t('禁用工作流') : i18n.t('启用工作流')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 运行记录 */}
        <div className="min-w-0 space-y-3">
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
              <div className="bg-card border border-border rounded-xl p-3 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select value={selectedWorkflow} onValueChange={(v) => { setSelectedWorkflow(v); setSelectedRun(null); }}>
                    <SelectTrigger className="bg-secondary border-border text-foreground w-full sm:w-56 h-9 text-sm">
                      <SelectValue placeholder={i18n.t('工作流')} />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="all" className="text-foreground text-sm">{i18n.t('全部工作流')}</SelectItem>
                      {workflows.map((wf) => (
                        <SelectItem key={wf.id} value={String(wf.id)} className="text-foreground text-sm">{wf.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2 min-w-0">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="bg-secondary border-border text-foreground w-[116px] h-9 text-sm shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="all" className="text-foreground text-sm">{i18n.t('全部状态')}</SelectItem>
                        <SelectItem value="success" className="text-foreground text-sm">{i18n.t('成功')}</SelectItem>
                        <SelectItem value="failure" className="text-foreground text-sm">{i18n.t('失败')}</SelectItem>
                        <SelectItem value="queued" className="text-foreground text-sm">{i18n.t('排队中')}</SelectItem>
                        <SelectItem value="in_progress" className="text-foreground text-sm">{i18n.t('运行中')}</SelectItem>
                        <SelectItem value="cancelled" className="text-foreground text-sm">{i18n.t('已取消')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="h-9 gap-1.5 flex-1 sm:flex-none px-3"
                      onClick={openSelectedTrigger}
                      disabled={!selectedWorkflowObj || selectedWorkflowObj.state !== 'active'}
                      title={selectedWorkflowObj ? i18n.t('触发当前工作流') : i18n.t('请先选择工作流')}
                    >
                      <Play className="w-3.5 h-3.5" />{i18n.t('运行')}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0 bg-card border-border"
                          disabled={!selectedWorkflowObj}
                          title={i18n.t('工作流操作')}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44 bg-popover border-border">
                        <DropdownMenuItem
                          onSelect={openSelectedTrigger}
                          disabled={!selectedWorkflowObj || selectedWorkflowObj.state !== 'active'}
                          className="gap-2 text-sm"
                        >
                          <Play className="w-3.5 h-3.5" />{i18n.t('运行工作流')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem
                          onSelect={() => { if (selectedWorkflowObj) void handleToggleWorkflow(selectedWorkflowObj); }}
                          disabled={!selectedWorkflowObj || togglingWorkflow === selectedWorkflowObj.id}
                          className="gap-2 text-sm"
                        >
                          {selectedWorkflowObj && togglingWorkflow === selectedWorkflowObj.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Power className="w-3.5 h-3.5" />}
                          {selectedWorkflowObj?.state === 'active' ? i18n.t('禁用工作流') : i18n.t('启用工作流')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {hasActiveRuns && (
                      <span className="flex items-center gap-1 text-warning">
                        <Loader2 className="w-3 h-3 animate-spin" />{i18n.t('自动刷新')}
                      </span>
                    )}
                    {selectedWorkflowObj && (
                      <span className={selectedWorkflowObj.state === 'active' ? 'text-success' : 'text-muted-foreground'}>
                        {selectedWorkflowObj.state === 'active' ? i18n.t('已启用') : i18n.t('已禁用')}
                      </span>
                    )}
                  </div>
                  {totalCount > 0 && <span className="shrink-0">{i18n.t('共')} {totalCount} {i18n.t('条')}</span>}
                </div>
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
      <DialogContent className="max-w-[calc(100%-1.5rem)] md:max-w-2xl max-h-[92vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground flex items-center gap-2 text-balance">
            <Zap className="w-4 h-4 text-primary shrink-0" />
            {i18n.t('触发工作流：')}{triggerDialog?.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-3">
          {/* 分支 / Tag 搜索选择 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-muted-foreground flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5" />{i18n.t('运行分支 / Tag')}
            </Label>
            {loadingBranches ? (
              <Skeleton className="h-10 bg-muted w-full" />
            ) : (
              <RefSelector
                value={triggerRef}
                onChange={(ref) => {
                  setTriggerRef(ref);
                  if (triggerDialog) void loadWorkflowInputs(triggerDialog, ref);
                }}
                branches={branches}
                tags={tags}
              />
            )}
          </div>

          {/* 触发预设 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm font-normal text-muted-foreground">{i18n.t('触发预设')}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary gap-1"
                onClick={() => setShowPresetForm((prev) => !prev)}
              >
                <Save className="w-3 h-3" />{i18n.t('保存当前')}
              </Button>
            </div>
            {showPresetForm && (
              <div className="flex items-center gap-2">
                <Input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder={i18n.t('预设名称（可选）')}
                  className="h-8 text-xs bg-secondary border-border flex-1"
                />
                <Button type="button" size="sm" className="h-8 shrink-0" onClick={handleSavePreset}>
                  {i18n.t('保存')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 shrink-0 text-muted-foreground"
                  onClick={() => { setShowPresetForm(false); setPresetName(''); }}
                >
                  {i18n.t('取消')}
                </Button>
              </div>
            )}
            {presets.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {i18n.t('可将当前分支与 Inputs 保存为预设，下次一键复用')}
              </p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {presets.map((preset) => (
                  <div key={preset.id} className="shrink-0 flex items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-2 py-1.5 max-w-[210px]">
                    <button type="button" className="min-w-0 text-left" onClick={() => applyPreset(preset)}>
                      <span className="block text-xs font-medium text-foreground truncate">{preset.name}</span>
                      <span className="block text-[10px] font-mono text-muted-foreground truncate max-w-[150px]">{preset.ref}</span>
                    </button>
                    <button
                      type="button"
                      className="w-5 h-5 shrink-0 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center"
                      onClick={() => deletePreset(preset.id)}
                      title={i18n.t('删除预设')}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
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
                {i18n.t('工作流 Inputs')}
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {workflowInputs.map((def) => {
                  const value = workflowInputValues[def.name] ?? '';
                  const setValue = (v: string) => setWorkflowInputValues(prev => ({ ...prev, [def.name]: v }));
                  return (
                    <div key={def.name} className="space-y-1 min-w-0">
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
            </div>
          )}

          {/* 自定义 inputs */}
          <Collapsible className="border-t border-border pt-3">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full h-8 px-2 justify-between text-xs text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                <span>{i18n.t('自定义 Inputs（可选）')}</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-2">
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary gap-1"
                  onClick={() => setInputPairs((prev) => [...prev, { key: '', value: '' }])}
                >
                  <Plus className="w-3 h-3" />{i18n.t('添加')}
                </Button>
              </div>
              {inputPairs.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">
                  {i18n.t('无需 inputs 时留空，工作流将使用默认值运行')}
                </p>
              ) : (
                <div className="space-y-2">
                  {inputPairs.map((pair, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        className="bg-secondary border-border text-foreground h-8 text-xs font-mono flex-1 min-w-0"
                        placeholder="key"
                        value={pair.key}
                        onChange={(e) => setInputPairs((prev) => prev.map((p, i) => i === idx ? { ...p, key: e.target.value } : p))}
                      />
                      <Input
                        className="bg-secondary border-border text-foreground h-8 text-xs font-mono flex-1 min-w-0"
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
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter className="gap-2 sticky bottom-0 -mx-6 -mb-6 px-6 pb-4 pt-3 border-t border-border bg-card">
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
