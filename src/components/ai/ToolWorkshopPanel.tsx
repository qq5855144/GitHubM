// 工具改进工坊面板
// 展示 AI 在执行过程中自主上报的工具问题和改进提案，支持审核、拒绝、标记应用
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Wrench, RefreshCw, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronRight, Loader2, AlertTriangle,
  Code2, Sparkles, Bot, Copy, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const SUPABASE_URL    = import.meta.env.VITE_SUPABASE_URL    as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── 类型 ──────────────────────────────────────────────────────────────────
export interface Proposal {
  id: string;
  tool_name: string;
  issue: string;
  severity: 'low' | 'medium' | 'high';
  context: string | null;
  code_before: string | null;
  code_after: string | null;
  explanation: string | null;
  status: 'pending' | 'approved' | 'applied' | 'rejected';
  submitted_by: string | null;
  applied_at: string | null;
  created_at: string;
}

interface Stats {
  total: number;
  pending: number;
  approved: number;
  applied: number;
  rejected: number;
  high: number;
  medium: number;
  low: number;
}

interface ToolWorkshopPanelProps {
  refreshTrigger?: number;
  onProposalCount?: (count: number) => void;
}

// ── 工具函数 ─────────────────────────────────────────────────────────────
async function callWorkshop(action: string, body?: Record<string, unknown>) {
  const isGet = !body;
  const url   = isGet
    ? `${SUPABASE_URL}/functions/v1/tool-workshop?action=${action}`
    : `${SUPABASE_URL}/functions/v1/tool-workshop`;

  const res = await fetch(url, {
    method: isGet ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: isGet ? undefined : JSON.stringify({ action, ...body }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.error || res.statusText);
  }
  return res.json();
}

function severityColor(s: string) {
  if (s === 'high')   return 'bg-destructive/15 text-destructive border-destructive/30';
  if (s === 'medium') return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
  return 'bg-muted text-muted-foreground border-border';
}

function severityLabel(s: string) {
  if (s === 'high')   return '严重';
  if (s === 'medium') return '中等';
  return '轻微';
}

function statusBadge(s: string) {
  switch (s) {
    case 'pending':  return <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 border-amber-500/40 text-amber-600 dark:text-amber-400"><Clock className="w-2.5 h-2.5" />待审</Badge>;
    case 'approved': return <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 border-blue-500/40 text-blue-600 dark:text-blue-400"><CheckCircle2 className="w-2.5 h-2.5" />已通过</Badge>;
    case 'applied':  return <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 border-green-500/40 text-green-600 dark:text-green-400"><CheckCircle2 className="w-2.5 h-2.5" />已应用</Badge>;
    case 'rejected': return <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5 border-muted text-muted-foreground"><XCircle className="w-2.5 h-2.5" />已拒绝</Badge>;
    default: return null;
  }
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── 代码块组件 ────────────────────────────────────────────────────────────
function CodeBlock({ label, code, colorClass }: { label: string; code: string; colorClass: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', colorClass)}>{label}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="text-[11px] leading-relaxed bg-muted/60 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ── 提案卡片 ──────────────────────────────────────────────────────────────
function ProposalCard({
  proposal,
  onApprove,
  onReject,
  onApply,
}: {
  proposal: Proposal;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onApply: (proposal: Proposal) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const hasCode = !!(proposal.code_before || proposal.code_after);

  const handleApprove = async () => {
    setLoading(true);
    try { await onApprove(proposal.id); }
    finally { setLoading(false); }
  };

  return (
    <div className={cn(
      'border rounded-lg text-sm transition-colors',
      proposal.status === 'rejected' ? 'opacity-50' : '',
      proposal.status === 'applied'  ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-card',
    )}>
      {/* 卡片头 */}
      <button
        className="w-full flex items-start gap-2 p-3 text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">
              {proposal.tool_name}
            </code>
            <Badge variant="outline" className={cn('text-[10px] h-4 px-1.5 border', severityColor(proposal.severity))}>
              {severityLabel(proposal.severity)}
            </Badge>
            {statusBadge(proposal.status)}
            {hasCode && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <Code2 className="w-3 h-3" />有代码
              </span>
            )}
          </div>
          <p className="text-xs text-foreground/90 text-pretty line-clamp-2">{proposal.issue}</p>
          <p className="text-[10px] text-muted-foreground">
            {formatTime(proposal.created_at)}
            {proposal.submitted_by && ` · ${proposal.submitted_by.split('@')[0]}`}
          </p>
        </div>
        <span className="shrink-0 mt-0.5 text-muted-foreground">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
          {proposal.context && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground mb-1">执行上下文</p>
              <p className="text-[11px] text-foreground/80 bg-muted/50 rounded px-2 py-1.5">{proposal.context}</p>
            </div>
          )}
          {proposal.explanation && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground mb-1">改进说明</p>
              <p className="text-[11px] text-foreground/80">{proposal.explanation}</p>
            </div>
          )}
          {proposal.code_before && (
            <CodeBlock label="修改前" code={proposal.code_before} colorClass="bg-destructive/10 text-destructive" />
          )}
          {proposal.code_after && (
            <CodeBlock label="修改后" code={proposal.code_after} colorClass="bg-green-500/10 text-green-600 dark:text-green-400" />
          )}

          {/* 操作按钮 */}
          {proposal.status === 'pending' && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" className="h-7 text-xs flex-1" onClick={handleApprove} disabled={loading}>
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                审核通过
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/5"
                onClick={() => setRejectOpen(true)} disabled={loading}>
                <XCircle className="w-3 h-3" />
                拒绝
              </Button>
            </div>
          )}
          {proposal.status === 'approved' && (
            <Button size="sm" className="h-7 text-xs w-full bg-green-600 hover:bg-green-700 text-white"
              onClick={() => onApply(proposal)}>
              <Sparkles className="w-3 h-3" />
              应用改进
            </Button>
          )}
          {proposal.status === 'applied' && (
            <p className="text-[11px] text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              已于 {proposal.applied_at ? formatTime(proposal.applied_at) : '—'} 标记应用
            </p>
          )}
        </div>
      )}

      {/* 拒绝确认弹窗 */}
      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>确认拒绝该提案？</AlertDialogTitle>
            <AlertDialogDescription>
              工具 <strong>{proposal.tool_name}</strong> 的改进提案将被标记为已拒绝。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onReject(proposal.id)}>
              确认拒绝
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── 应用提案弹窗 ──────────────────────────────────────────────────────────
function ApplyDialog({
  proposal,
  open,
  onClose,
  onApplied,
}: {
  proposal: Proposal | null;
  open: boolean;
  onClose: () => void;
  onApplied: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  if (!proposal) return null;

  const handleApply = async () => {
    setLoading(true);
    try {
      await callWorkshop('apply', { id: proposal.id });
      toast.success('提案已标记为已应用，请部署更新的 Edge Function');
      onApplied(proposal.id);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-balance">
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
            应用工具改进：{proposal.tool_name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                <p className="font-medium">应用步骤说明</p>
                <ol className="list-decimal list-inside space-y-0.5 text-amber-700/80 dark:text-amber-300/80">
                  <li>点击「确认应用」将提案标记为已应用</li>
                  <li>将下方代码改动合并到 ai-assistant Edge Function</li>
                  <li>重新部署 Edge Function 使改动生效</li>
                </ol>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">工具问题</p>
            <p className="text-sm text-foreground/90 bg-muted/50 rounded p-2">{proposal.issue}</p>
          </div>

          {proposal.explanation && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">改进说明</p>
              <p className="text-sm text-foreground/90">{proposal.explanation}</p>
            </div>
          )}

          {proposal.code_before && (
            <CodeBlock label="修改前（需要替换）" code={proposal.code_before} colorClass="bg-destructive/10 text-destructive" />
          )}
          {proposal.code_after && (
            <CodeBlock label="修改后（替换为此内容）" code={proposal.code_after} colorClass="bg-green-500/10 text-green-600 dark:text-green-400" />
          )}
          {!proposal.code_before && !proposal.code_after && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded p-3 text-center">
              本提案没有具体代码片段，请根据问题描述和改进说明手动修改工具实现。
            </p>
          )}
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <Button variant="outline" onClick={onClose} className="flex-1 h-9 text-sm">取消</Button>
          <Button onClick={handleApply} disabled={loading} className="flex-1 h-9 text-sm bg-green-600 hover:bg-green-700 text-white">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            确认应用
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────
export default function ToolWorkshopPanel({ refreshTrigger = 0, onProposalCount }: ToolWorkshopPanelProps) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [stats, setStats]         = useState<Stats | null>(null);
  const [loading, setLoading]     = useState(false);
  const [filter, setFilter]       = useState<string>('pending');
  const [applyTarget, setApplyTarget] = useState<Proposal | null>(null);
  const [applyOpen, setApplyOpen]     = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        callWorkshop(`list&status=${filter}`),
        callWorkshop('stats'),
      ]);
      setProposals(listRes.proposals ?? []);
      setStats(statsRes.stats ?? null);
      onProposalCount?.(statsRes.stats?.pending ?? 0);
    } catch (e) {
      if (!silent) toast.error('加载失败：' + (e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter, onProposalCount]);

  useEffect(() => { load(); }, [load, refreshTrigger]);

  const handleApprove = async (id: string) => {
    await callWorkshop('approve', { id });
    toast.success('提案已审核通过');
    setProposals(prev => prev.map(p => p.id === id ? { ...p, status: 'approved' } : p));
    load(true);
  };

  const handleReject = async (id: string) => {
    await callWorkshop('reject', { id });
    toast.success('提案已拒绝');
    setProposals(prev => prev.map(p => p.id === id ? { ...p, status: 'rejected' } : p));
    load(true);
  };

  const handleApply = (proposal: Proposal) => {
    setApplyTarget(proposal);
    setApplyOpen(true);
  };

  const handleApplied = (id: string) => {
    setProposals(prev => prev.map(p =>
      p.id === id ? { ...p, status: 'applied', applied_at: new Date().toISOString() } : p
    ));
    load(true);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶部统计栏 */}
      {stats && (
        <div className="grid grid-cols-4 gap-px bg-border shrink-0">
          {[
            { label: '待审', value: stats.pending,  color: 'text-amber-600 dark:text-amber-400' },
            { label: '已通过', value: stats.approved, color: 'text-blue-600 dark:text-blue-400' },
            { label: '已应用', value: stats.applied,  color: 'text-green-600 dark:text-green-400' },
            { label: '严重', value: stats.high,     color: 'text-destructive' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-background flex flex-col items-center py-2">
              <span className={cn('text-base font-bold tabular-nums', color)}>{value}</span>
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* 过滤器 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Select value={filter} onValueChange={v => setFilter(v)}>
          <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">待审核</SelectItem>
            <SelectItem value="approved">已通过</SelectItem>
            <SelectItem value="applied">已应用</SelectItem>
            <SelectItem value="rejected">已拒绝</SelectItem>
            <SelectItem value="all">全部</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => load()} disabled={loading}>
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* 提案列表 */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {loading && proposals.length === 0 && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />加载中…
            </div>
          )}

          {!loading && proposals.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3 text-muted-foreground">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Bot className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">暂无改进提案</p>
                <p className="text-xs mt-1">
                  {filter === 'pending'
                    ? 'AI 在自主模式下执行任务时，发现工具不足会自动上报'
                    : '当前筛选条件下没有提案'}
                </p>
              </div>
              <div className="bg-muted/60 rounded-lg p-3 text-left text-[11px] max-w-[220px] space-y-1">
                <p className="font-medium text-foreground flex items-center gap-1">
                  <Wrench className="w-3 h-3" />如何触发
                </p>
                <p>在自主模式下执行复杂任务时，AI 会在发现工具局限时自动调用 report_tool_issue 上报问题，并可进一步调用 propose_tool_fix 提交修复代码。</p>
              </div>
            </div>
          )}

          {proposals.map(p => (
            <ProposalCard
              key={p.id}
              proposal={p}
              onApprove={handleApprove}
              onReject={handleReject}
              onApply={handleApply}
            />
          ))}
        </div>
      </ScrollArea>

      {/* 应用提案弹窗 */}
      <ApplyDialog
        proposal={applyTarget}
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        onApplied={handleApplied}
      />
    </div>
  );
}
