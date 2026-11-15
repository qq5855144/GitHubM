// AI Assistant V2 — 通用聊天优先，仓库可选，Operit 风格对话流
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { runGeneralAgent, toAgentHistory, toolCallLabel } from '@/ai-v2/agent';
import type { AgentEvent, ApprovalRequest, ArtifactMeta, RepoContext, UiChatMessage, UiToolRun, V2ProviderMessage } from '@/ai-v2/types';
import { readArtifact } from '@/ai-v2/artifacts';
import { appendRunEvent, clearRunSnapshot, finishRun, latestRunSnapshot, resumeRun, saveRunSnapshot, startRun } from '@/ai-v2/runStore';
import type { RunSnapshot } from '@/ai-v2/runStore';
import { loadV2Settings } from '@/ai-v2/settings';
import { buildUnifiedDiff } from '@/ai-v2/diff';
import { applyUnifiedDiff, diffStats } from '@/ai-v2/patch';
import {
  buildModelUserContent,
  filterRepoFiles,
  formatFileSize,
  isTextFilePath,
  makeAttachmentId,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
} from '@/ai-v2/attachments';
import type { UiAttachment } from '@/ai-v2/attachments';
import { loadActiveCharacter } from '@/ai-v2/characters';
import type { CharacterCard } from '@/ai-v2/characters';
import RepoSelector from '@/components/ai/RepoSelector';
import {
  ModelAvatar,
  getModelDef,
  loadModelConfig,
  renderMarkdown,
} from '@/components/ai/aiUtils';
import type { ModelConfig } from '@/components/ai/aiTypes';
import type { GitHubRepo } from '@/types/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import i18n from '@/i18n';
import {
  ArrowDown,
  AtSign,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  FileText,
  GitBranch,
  Layers,
  Loader2,
  Menu,
  MessageSquarePlus,
  Paperclip,
  PanelRight,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
  XCircle,
  Zap,
} from 'lucide-react';

const STORE_PREFIX = 'githubm_ai_v2_store:';
const LEGACY_PREFIX = 'githubm_ai_v2_session:';
const MAX_SESSIONS = 20;
const MAX_SAVED_MESSAGES = 40;
const MAX_TOOL_RESULT = 4000;

const CLOUDFLARE_FALLBACK_CONFIG: ModelConfig = {
  type: 'cloudflare',
  api_key: 'cloudflare-free',
  model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  proxy_url: 'https://llm.callact.xyz',
};

function isOpenRouterDailyLimit(message: string): boolean {
  return /429/.test(message) && /free-models-per-day|free model requests per day/i.test(message);
}

function friendlyModelError(message: string): string {
  if (message.includes('Cloudflare AI 兜底也失败：')) {
    const detail = message.split('Cloudflare AI 兜底也失败：').pop() || '';
    return `OpenRouter 免费额度已用完，Cloudflare AI 兜底也失败：${detail}`;
  }
  if (isOpenRouterDailyLimit(message)) {
    return 'OpenRouter 免费模型今日额度已用完。可等待额度重置，或切换到其他模型平台。';
  }
  if (/HTTP 429/.test(message)) {
    return '请求过于频繁，已触发模型平台限流，请稍后再试。';
  }
  return message;
}

interface V2Session {
  id: string;
  title: string;
  messages: UiChatMessage[];
  repo: RepoContext | null;
  createdAt: string;
  updatedAt: string;
}

interface SessionStore {
  sessions: V2Session[];
  activeId: string;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function newSession(): V2Session {
  const now = new Date().toISOString();
  return {
    id: makeId('s'),
    title: i18n.t('新对话'),
    messages: [],
    repo: null,
    createdAt: now,
    updatedAt: now,
  };
}

function deriveTitle(messages: UiChatMessage[]): string {
  const first = messages.find(message => message.role === 'user')?.content.trim();
  if (!first) return i18n.t('新对话');
  return first.replace(/\s+/g, ' ').slice(0, 32);
}
function migrateLegacyRoundLimit(messages: UiChatMessage[]): UiChatMessage[] {
  return messages.map(message => {
    if (message.role !== 'assistant' || !message.content.includes('已达到最大工具轮数')) return message;
    return {
      ...message,
      content: i18n.t('这条消息来自旧版 AI（v1.0.528 之前）。V2 已移除固定工具轮数限制，可以直接继续任务。'),
      error: false,
      streaming: false,
    };
  });
}

function compactMessages(messages: UiChatMessage[]): UiChatMessage[] {
  return messages.slice(-MAX_SAVED_MESSAGES).map(message => {
    let attachmentBudget = 30_000;
    const attachments = message.attachments?.map(attachment => {
      const content = attachment.content.slice(0, Math.max(0, attachmentBudget));
      attachmentBudget -= content.length;
      return { ...attachment, content };
    });
    return {
      ...message,
      content: message.content.slice(0, 20000),
      modelContent: undefined,
      attachments,
      reasoning: message.reasoning?.slice(0, 8000),
      tools: message.tools?.map(tool => ({
        ...tool,
        content: tool.content?.slice(0, MAX_TOOL_RESULT),
      })),
    };
  });
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function groupSessions(sessions: V2Session[]): Array<{ label: string; items: V2Session[] }> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const groups = [
    { label: i18n.t('今天'), items: [] as V2Session[] },
    { label: i18n.t('昨天'), items: [] as V2Session[] },
    { label: i18n.t('更早'), items: [] as V2Session[] },
  ];
  for (const session of [...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))) {
    const time = Date.parse(session.updatedAt) || 0;
    if (time >= today) groups[0].items.push(session);
    else if (time >= yesterday) groups[1].items.push(session);
    else groups[2].items.push(session);
  }
  return groups.filter(group => group.items.length > 0);
}

function ReasoningPanel({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(Boolean(streaming));

  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);

  if (!text) return null;
  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-border/70 bg-muted/25">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] text-muted-foreground hover:bg-muted/40"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">{streaming ? i18n.t('思考中…') : i18n.t('已完成思考')}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto border-t border-border/60 px-3 py-2 text-xs leading-5 text-muted-foreground whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

function ToolCard({ tool, onOpenArtifact }: { tool: UiToolRun; onOpenArtifact: (meta: ArtifactMeta) => void }) {
  const [open, setOpen] = useState(false);
  const duration = tool.startedAt && tool.endedAt
    ? `${Math.max(0.1, (tool.endedAt - tool.startedAt) / 1000).toFixed(1)}s`
    : '';
  const statusIcon = tool.status === 'running'
    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    : tool.status === 'done'
      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
      : <XCircle className="h-3.5 w-3.5 text-destructive" />;

  return (
    <div className={cn(
      'overflow-hidden rounded-lg border bg-card/70',
      tool.status === 'error' ? 'border-destructive/30' : 'border-border',
    )}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/35"
      >
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono">{toolCallLabel({ id: tool.id, name: tool.name, arguments: tool.arguments })}</span>
        {duration && <span className="shrink-0 text-[10px] text-muted-foreground">{duration}</span>}
        {statusIcon}
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">{i18n.t('参数')}</p>
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 text-[10px] font-mono">{tool.arguments || '{}'}</pre>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">{i18n.t('结果')}</p>
            {tool.status === 'running' ? (
              <p className="text-xs text-muted-foreground">{i18n.t('正在执行…')}</p>
            ) : (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-[10px] font-mono">{tool.content || i18n.t('无输出')}</pre>
            )}
            {tool.artifact && (
              <button
                type="button"
                onClick={() => onOpenArtifact(tool.artifact!)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2 py-1 text-[10px] text-primary hover:bg-primary/10"
              >
                <Eye className="h-3 w-3" />
                {i18n.t('查看完整结果')} · {tool.artifact.size.toLocaleString()} {i18n.t('字符')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolActivity({ tools, onOpenArtifact }: { tools: UiToolRun[]; onOpenArtifact: (meta: ArtifactMeta) => void }) {
  if (!tools.length) return null;
  return (
    <div className="my-2 space-y-1.5 border-l-2 border-primary/20 pl-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Zap className="h-3 w-3" />
        {i18n.t('工具调用')}
        <span className="rounded-full bg-muted px-1.5 text-[9px]">{tools.length}</span>
      </div>
      {tools.map(tool => <ToolCard key={tool.id} tool={tool} onOpenArtifact={onOpenArtifact} />)}
    </div>
  );
}

function AssistantTurn({ message, onOpenArtifact, onApplyDiff }: {
  message: UiChatMessage;
  onOpenArtifact: (meta: ArtifactMeta) => void;
  onApplyDiff: (path: string, diff: string) => void;
}) {
  const hasBody = Boolean(message.content || message.reasoning || (message.tools || []).length);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success(i18n.t('已复制回答'));
    } catch {
      toast.error(i18n.t('复制失败'));
    }
  };

  return (
    <div className="min-w-0">
      <ReasoningPanel text={message.reasoning || ''} streaming={message.streaming} />
      <ToolActivity tools={message.tools || []} onOpenArtifact={onOpenArtifact} />

      {message.content ? (
        <div className={cn(
          'min-w-0 text-sm leading-6 break-words',
          message.error ? 'text-destructive' : 'text-foreground',
        )}>
          {renderMarkdown(message.content, onApplyDiff)}
          {message.streaming && (
            <span className="ml-0.5 inline-block h-4 w-1 animate-pulse rounded-sm bg-primary align-middle" />
          )}
        </div>
      ) : message.streaming && !hasBody ? (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {i18n.t('思考中…')}
        </div>
      ) : null}

      {message.content && !message.streaming && (
        <div className="mt-1.5 flex items-center gap-1">
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
            {i18n.t('复制')}
          </button>
        </div>
      )}
    </div>
  );
}

interface ConversationTurn {
  id: string;
  user: UiChatMessage | null;
  assistants: UiChatMessage[];
}

function buildTurns(messages: UiChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | null = null;
  for (const message of messages) {
    if (message.role === 'user') {
      current = { id: message.id, user: message, assistants: [] };
      turns.push(current);
      continue;
    }
    if (!current) {
      current = { id: message.id, user: null, assistants: [] };
      turns.push(current);
    }
    current.assistants.push(message);
  }
  return turns;
}

function ConversationTurnView({ turn, index, onOpenArtifact, onApplyDiff }: {
  turn: ConversationTurn;
  index: number;
  onOpenArtifact: (meta: ArtifactMeta) => void;
  onApplyDiff: (path: string, diff: string) => void;
}) {
  const streaming = turn.assistants.some(message => message.streaming);
  const hasError = turn.assistants.some(message => message.error);

  return (
    <section
      className={cn(
        'rounded-xl border p-3 transition-colors sm:p-4',
        streaming
          ? 'border-primary/25 bg-card/60 shadow-sm'
          : 'border-border/80 bg-card/35',
      )}
    >
      {turn.user && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Prompt
            </span>
            <span className="text-[9px] text-muted-foreground/70">
              {formatTime(turn.user.createdAt)}
            </span>
          </div>
          <div className="flex justify-end">
            <div className="max-w-[90%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-6 text-primary-foreground break-words">
              {turn.user.content}
            </div>
          </div>
          {turn.user.attachments && turn.user.attachments.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1">
              {turn.user.attachments.map(attachment => (
                <span
                  key={attachment.id}
                  className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[9px] text-muted-foreground"
                  title={attachment.path || attachment.name}
                >
                  {attachment.source === 'repo' ? <AtSign className="h-2.5 w-2.5 shrink-0 text-primary" /> : <Paperclip className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{attachment.path || attachment.name}</span>
                  <span className="shrink-0 opacity-70">{formatFileSize(attachment.size)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={cn(turn.user && 'mt-3 border-t border-border/60 pt-3')}>
        <div className="mb-1.5 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Response
          </span>
          {streaming && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              {i18n.t('正在生成')}
            </span>
          )}
          {hasError && <Badge variant="destructive" className="px-1.5 py-0 text-[9px]">{i18n.t('失败')}</Badge>}
          <span className="ml-auto text-[9px] text-muted-foreground/60">#{index + 1}</span>
        </div>

        {turn.assistants.length > 0 ? (
          <div className="space-y-3">
            {turn.assistants.map(message => <AssistantTurn key={message.id} message={message} onOpenArtifact={onOpenArtifact} onApplyDiff={onApplyDiff} />)}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {i18n.t('思考中…')}
          </div>
        )}
      </div>
    </section>
  );
}

function ApplyPatchDialog({
  request,
  repo,
  token,
  onClose,
}: {
  request: { path: string; diff: string } | null;
  repo: RepoContext | null;
  token: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!request) return;
    setMessage(`Apply AI patch to ${request.path}`);
    setApplying(false);
    setError('');
  }, [request]);

  const stats = useMemo(() => request ? diffStats(request.diff) : { additions: 0, deletions: 0 }, [request]);

  const apply = async () => {
    if (!request || !repo || !token || applying) return;
    const branch = repo.branch || repo.defaultBranch || 'main';
    setApplying(true);
    setError('');
    try {
      const encodedPath = request.path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
      const response = await fetch(
        `https://api.github.com/repos/${repo.fullName}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );
      if (response.status === 404) throw new Error(i18n.t('目标文件不存在，无法应用补丁'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { content?: string; encoding?: string; sha?: string };
      if (!data.content || data.encoding !== 'base64' || !data.sha) throw new Error(i18n.t('无法读取目标文件'));
      const binary = atob(data.content.replace(/\s/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      const original = new TextDecoder().decode(bytes);
      const next = applyUnifiedDiff(original, request.diff);

      const encoded = new TextEncoder().encode(next);
      let text = '';
      for (let index = 0; index < encoded.length; index += 0x8000) {
        text += String.fromCharCode(...encoded.subarray(index, index + 0x8000));
      }
      const put = await fetch(`https://api.github.com/repos/${repo.fullName}/contents/${encodedPath}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          message: message.trim() || `Apply AI patch to ${request.path}`,
          content: btoa(text),
          branch,
          sha: data.sha,
        }),
      });
      if (!put.ok) {
        const detail = await put.text();
        throw new Error(`HTTP ${put.status}: ${detail.slice(0, 200)}`);
      }
      toast.success(i18n.t('补丁已应用'));
      onClose();
    } catch (reason) {
      setError((reason as Error).message || String(reason));
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] p-4 md:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-primary" />
            {i18n.t('应用 AI 补丁')}
          </DialogTitle>
        </DialogHeader>
        {request && (
          <div className="space-y-3">
            <div className="space-y-1 rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <p><span className="text-muted-foreground">{i18n.t('文件')}：</span><span className="font-mono">{request.path}</span></p>
              <p><span className="text-muted-foreground">{i18n.t('分支')}：</span><span className="font-mono">{repo?.branch || repo?.defaultBranch || 'main'}</span></p>
              <p className="text-[11px] text-muted-foreground">+{stats.additions} / -{stats.deletions}</p>
            </div>
            <div>
              <p className="mb-1 text-[10px] text-muted-foreground">{i18n.t('Diff 预览')}</p>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-2 font-mono text-[10px] leading-4">{request.diff.slice(0, 20000)}</pre>
            </div>
            <input
              value={message}
              onChange={event => setMessage(event.target.value)}
              placeholder={i18n.t('提交信息')}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
            />
            {error && <p className="rounded-lg bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={applying}>
                {i18n.t('取消')}
              </Button>
              <Button type="button" size="sm" onClick={() => void apply()} disabled={applying || !message.trim()}>
                {applying && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {i18n.t('应用补丁')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RepoFilePicker({
  open,
  onOpenChange,
  repo,
  token,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repo: RepoContext | null;
  token: string;
  onSelect: (attachment: UiAttachment) => void;
}) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [selecting, setSelecting] = useState('');

  useEffect(() => {
    if (!open || !repo || !token) return;
    const branch = repo.branch || repo.defaultBranch || 'main';
    const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');
    let cancelled = false;
    setLoading(true);
    setError('');
    setQuery('');
    setFiles([]);
    setTruncated(false);
    fetch(`https://api.github.com/repos/${repo.fullName}/git/trees/${encodedBranch}?recursive=1`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<{
        tree?: Array<{ path?: string; type?: string }>;
        truncated?: boolean;
      }>;
    }).then(data => {
      if (cancelled) return;
      const paths = (data.tree || [])
        .filter(item => item.type === 'blob' && item.path && isTextFilePath(item.path))
        .map(item => String(item.path))
        .sort((a, b) => a.localeCompare(b));
      setFiles(paths);
      setTruncated(Boolean(data.truncated));
    }).catch(reason => {
      if (!cancelled) setError((reason as Error).message || String(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, repo, token]);

  const visible = useMemo(() => filterRepoFiles(files, query, 120), [files, query]);

  const selectFile = async (path: string) => {
    if (!repo || !token || selecting) return;
    const branch = repo.branch || repo.defaultBranch || 'main';
    setSelecting(path);
    setError('');
    try {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(
        `https://api.github.com/repos/${repo.fullName}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { content?: string; encoding?: string; size?: number; type?: string };
      if (data.type === 'dir' || !data.content || data.encoding !== 'base64') throw new Error(i18n.t('该文件无法作为文本读取'));
      if ((data.size || 0) > MAX_ATTACHMENT_BYTES) throw new Error(i18n.t('文件超过 200 KB'));
      const binary = atob(data.content.replace(/\s/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      const content = new TextDecoder().decode(bytes);
      onSelect({
        id: makeAttachmentId('repo'),
        name: path.split('/').pop() || path,
        path,
        source: 'repo',
        size: bytes.length,
        content,
      });
      onOpenChange(false);
    } catch (reason) {
      setError((reason as Error).message || String(reason));
    } finally {
      setSelecting('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] p-4 md:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AtSign className="h-4 w-4 text-primary" />
            {i18n.t('引用仓库文件')}
          </DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={i18n.t('搜索文件路径')}
            autoFocus
            className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
        <div className="min-h-[180px] max-h-[50vh] overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {i18n.t('读取仓库文件列表…')}
            </div>
          ) : error ? (
            <p className="px-3 py-6 text-center text-xs text-destructive">{error}</p>
          ) : !visible.length ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">{i18n.t('没有匹配的文本文件')}</p>
          ) : (
            <div className="divide-y divide-border/60">
              {visible.map(path => (
                <button
                  key={path}
                  type="button"
                  onClick={() => void selectFile(path)}
                  disabled={Boolean(selecting)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50 disabled:opacity-60"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
                  {selecting === path && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{i18n.t('仅显示文本文件')} · {files.length}</span>
          {truncated && <span className="text-amber-500">{i18n.t('仓库文件过多，列表已截断')}</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SessionList({
  sessions,
  activeId,
  streaming,
  onSelect,
  onRename,
  onDelete,
}: {
  sessions: V2Session[];
  activeId: string;
  streaming: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [renameTarget, setRenameTarget] = useState<V2Session | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? sessions.filter(session => {
        if ((session.title || '').toLowerCase().includes(normalized)) return true;
        return session.messages.some(message => message.content.toLowerCase().includes(normalized));
      })
    : sessions;
  const groups = groupSessions(filtered);

  return (
    <>
      <div className="sticky top-0 z-10 bg-background/95 px-2 pb-2 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={i18n.t('搜索对话')}
            className="h-8 w-full rounded-lg border border-border bg-muted/30 pl-7 pr-7 text-[11px] outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {!groups.length ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {normalized ? i18n.t('没有匹配的对话') : i18n.t('暂无对话')}
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map(group => (
            <div key={group.label}>
              <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map(session => (
                  <div
                    key={session.id}
                    className={cn(
                      'group flex items-center gap-0.5 rounded-lg px-2 py-2 text-xs transition-colors',
                      session.id === activeId ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(session.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate">{session.title || i18n.t('新对话')}</span>
                      <span className="mt-0.5 block text-[9px] opacity-70">
                        {session.messages.length ? i18n.t('{{count}} 条消息', { count: session.messages.length }) : i18n.t('空对话')}
                        {' · '}
                        {formatTime(session.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameTarget(session);
                        setRenameValue(session.title || '');
                      }}
                      className="shrink-0 rounded p-1 opacity-100 hover:bg-primary/10 hover:text-primary sm:opacity-0 sm:group-hover:opacity-100"
                      title={i18n.t('重命名对话')}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(session.id)}
                      disabled={streaming}
                      className="shrink-0 rounded p-1 opacity-100 hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                      title={i18n.t('删除对话')}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={Boolean(renameTarget)} onOpenChange={open => { if (!open) setRenameTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{i18n.t('重命名对话')}</DialogTitle>
          </DialogHeader>
          <input
            value={renameValue}
            onChange={event => setRenameValue(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && renameTarget && renameValue.trim()) {
                onRename(renameTarget.id, renameValue.trim());
                setRenameTarget(null);
              }
            }}
            autoFocus
            maxLength={80}
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
            placeholder={i18n.t('输入对话名称')}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setRenameTarget(null)}>
              {i18n.t('取消')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (!renameTarget || !renameValue.trim()) return;
                onRename(renameTarget.id, renameValue.trim());
                setRenameTarget(null);
              }}
            >
              {i18n.t('保存')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ContextContent({
  repo,
  modelLabel,
  characterLabel,
  onAddRepo,
  onRemoveRepo,
}: {
  repo: RepoContext | null;
  modelLabel: string;
  characterLabel: string;
  onAddRepo: () => void;
  onRemoveRepo: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{i18n.t('当前模式')}</p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">{repo ? i18n.t('通用 + 仓库') : i18n.t('通用聊天')}</p>
            <p className="truncate text-[10px] text-muted-foreground">{modelLabel}</p>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{i18n.t('角色卡')}</p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{characterLabel}</p>
            <button type="button" onClick={() => window.location.hash = '#/ai-settings/characters'} className="mt-0.5 text-[10px] text-muted-foreground hover:text-primary">
              {i18n.t('更换角色卡')}
            </button>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{i18n.t('仓库上下文')}</p>
        {repo ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-start gap-2">
              <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-primary">{repo.fullName}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{i18n.t('分支')}：{repo.branch || repo.defaultBranch}</p>
              </div>
              <button type="button" onClick={onRemoveRepo} className="rounded p-1 text-muted-foreground hover:bg-primary/10">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-3 space-y-1 border-t border-primary/10 pt-2 text-[10px] text-muted-foreground">
              <p className="flex items-center gap-1.5"><BookOpen className="h-3 w-3" /> github_list_files</p>
              <p className="flex items-center gap-1.5"><Code2 className="h-3 w-3" /> github_read_file</p>
              <p className="flex items-center gap-1.5"><RefreshCw className="h-3 w-3" /> github_search_code</p>
              <p className="flex items-center gap-1.5"><Wrench className="h-3 w-3" /> github_write_file <span className="text-amber-600">写操作需确认</span></p>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAddRepo}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-left text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            {i18n.t('添加仓库作为可选上下文')}
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3 text-[10px] leading-5 text-muted-foreground">
        <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
          <Layers className="h-3.5 w-3.5" />
          {i18n.t('自由对话模式')}
        </p>
        {i18n.t('AI 会自行判断是否需要工具，不再强制规划、验证或交付检查。')}
      </div>
    </div>
  );
}

export default function AiAssistantV2Page() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<V2Session[]>([]);
  const [activeId, setActiveId] = useState('');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [modelConfig] = useState<ModelConfig>(() => loadModelConfig());
  const [character, setCharacter] = useState<CharacterCard>(() => loadActiveCharacter(user?.login));
  const [v2Settings] = useState(() => loadV2Settings());
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [artifactMeta, setArtifactMeta] = useState<ArtifactMeta | null>(null);
  const [artifactContent, setArtifactContent] = useState('');
  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false);
  const [approvalDiff, setApprovalDiff] = useState('');
  const [approvalDiffLoading, setApprovalDiffLoading] = useState(false);
  const [approvalRemoteMissing, setApprovalRemoteMissing] = useState(false);
  const [resumableSnapshot, setResumableSnapshot] = useState<RunSnapshot | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<UiAttachment[]>([]);
  const [repoFileDialogOpen, setRepoFileDialogOpen] = useState(false);
  const [patchRequest, setPatchRequest] = useState<{ path: string; diff: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runCapabilitiesRef = useRef<string[]>([]);
  const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const hydratedRef = useRef(false);

  const storeKey = user?.login ? `${STORE_PREFIX}${user.login}` : '';
  const legacyKey = user?.login ? `${LEGACY_PREFIX}${user.login}` : '';
  const modelDef = useMemo(() => getModelDef(modelConfig.type), [modelConfig.type]);
  const isAndroid = useMemo(
    () => typeof window !== 'undefined' && !!(window as unknown as { AndroidBridge?: unknown }).AndroidBridge,
    [],
  );
  const hasModelKey = Boolean(modelConfig.api_key?.trim());
  const activeSession = useMemo(
    () => sessions.find(session => session.id === activeId) || sessions[0] || null,
    [sessions, activeId],
  );
  const messages = activeSession?.messages || [];
  const repoContext = activeSession?.repo || null;
  const hasConversation = messages.length > 0;

  useEffect(() => {
    setCharacter(loadActiveCharacter(user?.login));
  }, [user?.login]);

  useEffect(() => {
    hydratedRef.current = false;
    if (!storeKey) {
      setSessions([]);
      setActiveId('');
      hydratedRef.current = true;
      return;
    }
    let loaded: SessionStore | null = null;
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) loaded = JSON.parse(raw) as SessionStore;
    } catch {
      loaded = null;
    }

    if (!loaded?.sessions?.length) {
      try {
        const legacyRaw = legacyKey ? localStorage.getItem(legacyKey) : null;
        if (legacyRaw) {
          const legacy = JSON.parse(legacyRaw) as { messages?: UiChatMessage[]; repo?: RepoContext | null };
          const migrated = newSession();
          migrated.messages = Array.isArray(legacy.messages) ? legacy.messages : [];
          migrated.repo = legacy.repo || null;
          migrated.title = deriveTitle(migrated.messages);
          loaded = { sessions: [migrated], activeId: migrated.id };
        }
      } catch {
        // ignore
      }
    }

    const nextSessions = (loaded?.sessions?.length ? loaded.sessions : [newSession()])
      .map(session => ({ ...session, messages: migrateLegacyRoundLimit(session.messages || []) }));
    const nextActive = loaded?.activeId && nextSessions.some(session => session.id === loaded?.activeId)
      ? loaded.activeId
      : nextSessions[0].id;
    setSessions(nextSessions);
    setActiveId(nextActive);
    hydratedRef.current = true;
  }, [storeKey, legacyKey]);

  useEffect(() => {
    if (!hydratedRef.current || !storeKey) return;
    const timer = window.setTimeout(() => {
      try {
        const payload: SessionStore = {
          sessions: sessions.slice(0, MAX_SESSIONS).map(session => ({
            ...session,
            messages: compactMessages(session.messages),
          })),
          activeId,
        };
        localStorage.setItem(storeKey, JSON.stringify(payload));
      } catch {
        // ignore quota errors
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [sessions, activeId, storeKey]);

  useEffect(() => {
    if (!user?.login || !activeId) {
      setResumableSnapshot(null);
      return;
    }
    setResumableSnapshot(latestRunSnapshot(user.login, activeId));
  }, [user?.login, activeId]);

  useEffect(() => {
    return () => {
      approvalResolverRef.current?.(false);
      approvalResolverRef.current = null;
      abortRef.current?.abort();
    };
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    if (!force && !stickToBottomRef.current) return;
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
    setShowScrollButton(false);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streaming, scrollToBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    stickToBottomRef.current = nearBottom;
    setShowScrollButton(!nearBottom);
  };

  const requestApproval = useCallback((request: ApprovalRequest) => {
    if (v2Settings.allowAllPermissions) return Promise.resolve(true);
    return new Promise<boolean>(resolve => {
      approvalResolverRef.current = resolve;
      setApprovalRequest(request);
    });
  }, [v2Settings.allowAllPermissions]);

  const resolveApproval = useCallback((approved: boolean) => {
    approvalResolverRef.current?.(approved);
    approvalResolverRef.current = null;
    setApprovalRequest(null);
  }, []);

  const handleApplyDiff = useCallback((path: string, diff: string) => {
    if (!repoContext || !token) {
      toast.warning(i18n.t('请先选择仓库并登录，再应用补丁'));
      return;
    }
    if (!path || path === '/dev/null') {
      toast.warning(i18n.t('无法确定补丁目标文件'));
      return;
    }
    setPatchRequest({ path: path.replace(/^\/+/, ''), diff });
  }, [repoContext, token]);

  const openArtifact = useCallback(async (meta: ArtifactMeta) => {
    const result = await readArtifact(user?.login, meta.id, 0, 100000);
    setArtifactMeta(meta);
    setArtifactContent(result.content || i18n.t('无法读取 Artifact 内容'));
    setArtifactDialogOpen(true);
  }, [user?.login]);

  useEffect(() => {
    setApprovalDiff('');
    setApprovalRemoteMissing(false);
    if (!approvalRequest || approvalRequest.toolName !== 'github_write_file' || !repoContext || !token) {
      setApprovalDiffLoading(false);
      return;
    }
    const args = approvalRequest.arguments as Record<string, unknown>;
    const path = String(args.path || '');
    const branch = String(args.branch || repoContext.branch || repoContext.defaultBranch || 'main');
    const nextContent = String(args.content || '');
    if (!path) return;

    let cancelled = false;
    setApprovalDiffLoading(true);
    const encodedPath = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    fetch(`https://api.github.com/repos/${repoContext.fullName}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }).then(async response => {
      if (cancelled) return;
      if (response.status === 404) {
        setApprovalRemoteMissing(true);
        setApprovalDiff(buildUnifiedDiff('', nextContent));
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { content?: string; encoding?: string };
      if (!data.content || data.encoding !== 'base64') throw new Error('无法读取远端文件');
      const binary = atob(data.content.replace(/\s/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      const oldContent = new TextDecoder().decode(bytes);
      setApprovalDiff(buildUnifiedDiff(oldContent, nextContent));
    }).catch(error => {
      if (!cancelled) setApprovalDiff(`无法生成 Diff：${(error as Error).message}`);
    }).finally(() => {
      if (!cancelled) setApprovalDiffLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [approvalRequest, repoContext, token]);

  const updateActiveSession = useCallback((
    updater: (session: V2Session) => V2Session,
  ) => {
    setSessions(prev => prev.map(session => session.id === activeId ? updater(session) : session));
  }, [activeId]);

  const setMessages = useCallback((
    updater: UiChatMessage[] | ((previous: UiChatMessage[]) => UiChatMessage[]),
  ) => {
    updateActiveSession(session => {
      const nextMessages = typeof updater === 'function' ? updater(session.messages) : updater;
      return {
        ...session,
        messages: nextMessages,
        title: session.title && session.title !== i18n.t('新对话')
          ? session.title
          : deriveTitle(nextMessages),
        updatedAt: new Date().toISOString(),
      };
    });
  }, [updateActiveSession]);

  const setRepoContext = useCallback((repo: RepoContext | null) => {
    updateActiveSession(session => ({
      ...session,
      repo,
      updatedAt: new Date().toISOString(),
    }));
  }, [updateActiveSession]);

  const patchAssistant = useCallback((id: string, patch: Partial<UiChatMessage>) => {
    setMessages(prev => prev.map(message => message.id === id ? { ...message, ...patch } : message));
  }, [setMessages]);

  const appendAssistant = useCallback((id: string, patch: { content?: string; reasoning?: string }) => {
    setMessages(prev => prev.map(message => {
      if (message.id !== id) return message;
      return {
        ...message,
        content: patch.content ? message.content + patch.content : message.content,
        reasoning: patch.reasoning ? (message.reasoning || '') + patch.reasoning : message.reasoning,
      };
    }));
  }, [setMessages]);

  const patchTool = useCallback((assistantId: string, callId: string, patch: Partial<UiToolRun>) => {
    setMessages(prev => prev.map(message => {
      if (message.id !== assistantId) return message;
      return {
        ...message,
        tools: (message.tools || []).map(tool => tool.id === callId ? { ...tool, ...patch } : tool),
      };
    }));
  }, [setMessages]);

  const handleAgentEvent = useCallback((assistantId: string, runId: string, event: AgentEvent) => {
    appendRunEvent(user?.login, runId, event);
    switch (event.type) {
      case 'run_start':
        runCapabilitiesRef.current = event.capabilities || [];
        break;
      case 'text_delta':
        appendAssistant(assistantId, { content: event.text });
        break;
      case 'reasoning_delta':
        appendAssistant(assistantId, { reasoning: event.text });
        break;
      case 'tool_start':
        setMessages(prev => prev.map(message => message.id === assistantId
          ? {
              ...message,
              tools: [
                ...(message.tools || []),
                {
                  id: event.call.id,
                  name: event.call.name,
                  arguments: event.call.arguments,
                  status: 'running' as const,
                  startedAt: Date.now(),
                },
              ],
            }
          : message));
        break;
      case 'tool_end':
        patchTool(assistantId, event.call.id, {
          status: event.ok ? 'done' : 'error',
          content: event.content,
          artifact: event.artifact,
          endedAt: Date.now(),
        });
        break;
      case 'error':
        patchAssistant(assistantId, {
          content: event.message,
          streaming: false,
          error: true,
        });
        break;
      case 'done':
        patchAssistant(assistantId, { streaming: false });
        if (user?.login) clearRunSnapshot(user.login, runId);
        setResumableSnapshot(null);
        break;
      default:
        break;
    }
  }, [appendAssistant, patchAssistant, patchTool, setMessages, user?.login]);

  const persistRunSnapshot = useCallback((
    runId: string,
    assistantId: string,
    sessionId: string,
    title: string,
  ) => (snapshot: { messages: V2ProviderMessage[]; steps: number }) => {
    if (!user?.login) return;
    saveRunSnapshot(user.login, {
      runId,
      assistantId,
      sessionId,
      title,
      messages: snapshot.messages,
      steps: snapshot.steps,
      capabilities: runCapabilitiesRef.current,
      savedAt: new Date().toISOString(),
    });
  }, [user?.login]);

  const addAttachment = useCallback((attachment: UiAttachment) => {
    setPendingAttachments(prev => {
      if (prev.length >= MAX_ATTACHMENTS) {
        toast.warning(i18n.t('最多添加 {{count}} 个附件', { count: MAX_ATTACHMENTS }));
        return prev;
      }
      const duplicate = prev.some(item => (item.path || item.name) === (attachment.path || attachment.name));
      if (duplicate) {
        toast.warning(i18n.t('该文件已经添加'));
        return prev;
      }
      return [...prev, attachment];
    });
  }, []);

  const handleLocalFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const candidates = Array.from(files).slice(0, MAX_ATTACHMENTS);
    for (const file of candidates) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(i18n.t('{{name}} 超过 200 KB', { name: file.name }));
        continue;
      }
      const isText = file.type.startsWith('text/')
        || ['application/json', 'application/xml', 'application/javascript'].includes(file.type)
        || /\.(txt|md|markdown|json|jsonc|ya?ml|toml|ini|env|js|jsx|ts|tsx|mjs|cjs|css|scss|html?|xml|svg|vue|svelte|py|go|rs|java|kt|kts|gradle|c|h|cpp|hpp|cs|php|rb|sh|bash|sql|csv|log)$/i.test(file.name)
        || /^\.env/.test(file.name)
        || file.name === 'Dockerfile'
        || file.name === 'Makefile';
      if (!isText) {
        toast.error(i18n.t('{{name}} 不是文本文件', { name: file.name }));
        continue;
      }
      try {
        const content = await file.text();
        addAttachment({
          id: makeAttachmentId('file'),
          name: file.name,
          source: 'local',
          size: file.size,
          content,
        });
      } catch {
        toast.error(i18n.t('读取 {{name}} 失败', { name: file.name }));
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async () => {
    const text = input.trim();
    const attachments = pendingAttachments;
    if ((!text && !attachments.length) || streaming) return;
    const modelText = buildModelUserContent(text || i18n.t('请查看附件'), attachments);
    const displayText = text || `${i18n.t('请查看附件')}：${attachments.map(item => item.path || item.name).join('、')}`;
    if (!token) {
      toast.error(i18n.t('登录状态已失效，请重新登录'));
      return;
    }
    if (!hasModelKey) {
      navigate('/ai-settings/model');
      toast.error(i18n.t('请先配置模型 API Key'));
      return;
    }

    const now = new Date().toISOString();
    const userMessage: UiChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: displayText,
      modelContent: modelText,
      attachments: attachments.length ? attachments : undefined,
      createdAt: now,
    };
    const assistantId = `a-${Date.now()}`;
    const assistantMessage: UiChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      reasoning: '',
      tools: [],
      streaming: true,
      createdAt: now,
    };

    const previousHistory = toAgentHistory(messages.map(message => ({
      role: message.role,
      content: message.content,
      modelContent: message.modelContent,
    })));
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    runCapabilitiesRef.current = [];
    startRun({
      login: user?.login,
      id: runId,
      sessionId: activeSession?.id,
      title: text || `${i18n.t('附件')} ${attachments[0]?.name || ''}`,
    });
    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput('');
    setPendingAttachments([]);
    setStreaming(true);
    stickToBottomRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    const onEvent = (event: AgentEvent) => handleAgentEvent(assistantId, runId, event);

    const history = [...previousHistory, { role: 'user' as const, content: modelText }];
    let runStatus: 'done' | 'error' | 'stopped' = 'done';
    let runError: string | undefined;

    try {
      await runGeneralAgent({
        token,
        userLogin: user?.login,
        runId,
        repo: repoContext || undefined,
        config: modelConfig,
        history,
        contextBudget: v2Settings.contextBudget,
        memoryEnabled: v2Settings.memoryEnabled,
        persona: character.prompt,
        signal: controller.signal,
        requestApproval,
        onSnapshot: persistRunSnapshot(runId, assistantId, activeSession?.id || '', text),
        onEvent,
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        runStatus = 'stopped';
        patchAssistant(assistantId, { streaming: false });
      } else {
        let message = (error as Error)?.message || String(error);

        // OpenRouter 免费额度用尽：无仓库上下文时自动切到 Cloudflare Workers AI 免费额度。
        if (isOpenRouterDailyLimit(message) && modelConfig.type === 'openrouter' && !repoContext) {
          toast.info(i18n.t('OpenRouter 免费额度已用尽，正在切换 Cloudflare AI 重试'));
          patchAssistant(assistantId, {
            content: `> ${i18n.t('OpenRouter 免费额度已用尽，已切换到 Cloudflare AI 重试。')}\n\n`,
            reasoning: '',
            tools: [],
            streaming: true,
            error: false,
          });
          try {
            await runGeneralAgent({
              token,
              userLogin: user?.login,
              runId,
              config: CLOUDFLARE_FALLBACK_CONFIG,
              history,
              contextBudget: v2Settings.contextBudget,
              memoryEnabled: v2Settings.memoryEnabled,
              persona: character.prompt,
              signal: controller.signal,
              requestApproval,
              onSnapshot: persistRunSnapshot(runId, assistantId, activeSession?.id || '', text),
              onEvent,
            });
            message = '';
          } catch (fallbackError) {
            if ((fallbackError as Error)?.name === 'AbortError') {
              runStatus = 'stopped';
              patchAssistant(assistantId, { streaming: false });
              message = '';
            } else {
              runStatus = 'error';
              const fallbackMessage = (fallbackError as Error)?.message || String(fallbackError);
              message = `${message}\n\nCloudflare AI 兜底也失败：${fallbackMessage}`;
            }
          }
        }

        if (message) {
          runStatus = runStatus === 'stopped' ? 'stopped' : 'error';
          runError = message;
          patchAssistant(assistantId, {
            content: `${i18n.t('请求失败：')}${friendlyModelError(message)}`,
            streaming: false,
            error: true,
          });
          toast.error(friendlyModelError(message).slice(0, 160));
        }
      }
    } finally {
      finishRun(user?.login, runId, runStatus, runError);
      if (runStatus !== 'done' && user?.login) {
        setResumableSnapshot(latestRunSnapshot(user.login, activeSession?.id));
      }
      setStreaming(false);
      abortRef.current = null;
      scrollToBottom(true);
    }
  };

  const handleResume = async () => {
    const snapshot = resumableSnapshot;
    if (!snapshot || streaming || !token) return;
    const assistantId = snapshot.assistantId;
    const assistantExists = assistantId && messages.some(message => message.id === assistantId);
    if (!assistantId || !assistantExists) {
      if (user?.login) clearRunSnapshot(user.login, snapshot.runId);
      setResumableSnapshot(null);
      toast.error(i18n.t('原会话消息已不存在，无法继续'));
      return;
    }

    setResumableSnapshot(null);
    setStreaming(true);
    patchAssistant(assistantId, { streaming: true, error: false });
    runCapabilitiesRef.current = snapshot.capabilities;
    if (user?.login) resumeRun(user.login, snapshot.runId);

    const controller = new AbortController();
    abortRef.current = controller;
    const onEvent = (event: AgentEvent) => handleAgentEvent(assistantId, snapshot.runId, event);
    let runStatus: 'done' | 'error' | 'stopped' = 'done';
    let runError: string | undefined;

    try {
      await runGeneralAgent({
        token,
        userLogin: user?.login,
        runId: snapshot.runId,
        repo: repoContext || undefined,
        config: modelConfig,
        history: [],
        resumeMessages: snapshot.messages as V2ProviderMessage[],
        resumeSteps: snapshot.steps,
        contextBudget: v2Settings.contextBudget,
        memoryEnabled: v2Settings.memoryEnabled,
        persona: character.prompt,
        signal: controller.signal,
        requestApproval,
        onSnapshot: persistRunSnapshot(snapshot.runId, assistantId, snapshot.sessionId || activeSession?.id || '', snapshot.title),
        onEvent,
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        runStatus = 'stopped';
        patchAssistant(assistantId, { streaming: false });
      } else {
        runStatus = 'error';
        const message = (error as Error)?.message || String(error);
        runError = message;
        patchAssistant(assistantId, {
          content: `${i18n.t('恢复失败：')}${friendlyModelError(message)}`,
          streaming: false,
          error: true,
        });
        toast.error(friendlyModelError(message).slice(0, 160));
      }
    } finally {
      finishRun(user?.login, snapshot.runId, runStatus, runError);
      if (runStatus !== 'done' && user?.login) {
        setResumableSnapshot(latestRunSnapshot(user.login, activeSession?.id));
      }
      setStreaming(false);
      abortRef.current = null;
      scrollToBottom(true);
    }
  };

  const handleStop = () => {
    approvalResolverRef.current?.(false);
    approvalResolverRef.current = null;
    setApprovalRequest(null);
    abortRef.current?.abort();
    setStreaming(false);
  };

  const handleNewSession = () => {
    if (streaming) return;
    if (activeSession && activeSession.messages.length === 0) {
      setSessionDialogOpen(false);
      return;
    }
    const session = newSession();
    setSessions(prev => [session, ...prev].slice(0, MAX_SESSIONS));
    setActiveId(session.id);
    setInput('');
    setPendingAttachments([]);
    setSessionDialogOpen(false);
    requestAnimationFrame(() => scrollToBottom(true));
  };

  const handleSelectSession = (id: string) => {
    if (streaming) return;
    setActiveId(id);
    setSessionDialogOpen(false);
    setPendingAttachments([]);
    stickToBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom(true));
  };

  const handleRenameSession = (id: string, title: string) => {
    const nextTitle = title.trim().slice(0, 80);
    if (!nextTitle) return;
    setSessions(prev => prev.map(session => session.id === id
      ? { ...session, title: nextTitle, updatedAt: new Date().toISOString() }
      : session));
    toast.success(i18n.t('对话已重命名'));
  };

  const handleDeleteSession = (id: string) => {
    if (streaming) return;
    const remaining = sessions.filter(session => session.id !== id);
    if (remaining.length === 0) {
      const session = newSession();
      setSessions([session]);
      setActiveId(session.id);
      return;
    }
    setSessions(remaining);
    if (id === activeId) setActiveId(remaining[0].id);
  };

  const handleClear = () => {
    if (streaming) return;
    if (hasConversation && !window.confirm(i18n.t('确定清空当前对话？'))) return;
    setMessages([]);
    setInput('');
    setPendingAttachments([]);
  };

  const handleSelectRepo = (repo: GitHubRepo) => {
    setRepoContext({
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      branch: repo.default_branch,
    });
    setRepoDialogOpen(false);
    toast.success(i18n.t('已添加仓库上下文'));
  };

  const quickPrompts = repoContext
    ? [
        { label: i18n.t('总结仓库'), text: '请阅读当前仓库的 README 和主要目录，简要说明它是什么、技术栈和入口文件。' },
        { label: i18n.t('找入口文件'), text: '请找出当前仓库最可能的入口文件，并说明理由。' },
        { label: i18n.t('解释项目结构'), text: '请用 github_list_files 查看当前仓库目录结构，并解释主要目录的职责。' },
      ]
    : [
        { label: i18n.t('解释代码'), text: '请解释这段代码的作用，并指出潜在问题：\n```\n\n```' },
        { label: i18n.t('写一个工具函数'), text: '请用 TypeScript 写一个通用工具函数：安全地解析 JSON，失败时返回默认值。' },
        { label: i18n.t('制定计划'), text: '帮我把一个模糊目标拆成可执行的小步骤，并指出第一步。' },
      ];

  return (
    <div
      className="flex min-h-0 w-full overflow-hidden bg-background"
      style={{ height: `calc(100dvh - ${isAndroid ? 56 : 120}px)` }}
    >
      {/* 桌面端会话侧栏 */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-muted/10 2xl:flex">
        <div className="flex h-12 items-center justify-between border-b border-border px-3">
          <span className="text-xs font-medium">{i18n.t('对话')}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleNewSession}
            disabled={streaming}
            title={i18n.t('新对话')}
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <SessionList
            sessions={sessions}
            activeId={activeSession?.id || ''}
            streaming={streaming}
            onSelect={handleSelectSession}
            onRename={handleRenameSession}
            onDelete={handleDeleteSession}
          />
        </div>
      </aside>

      {/* 主聊天列 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2 sm:px-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 2xl:hidden"
            onClick={() => setSessionDialogOpen(true)}
            title={i18n.t('会话列表')}
          >
            <Menu className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-sm font-semibold">{activeSession?.title || i18n.t('AI 助手')}</h1>
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[9px]">V2</Badge>
              {v2Settings.allowAllPermissions && (
                <Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-[9px]">
                  {i18n.t('全局权限')}
                </Badge>
              )}
            </div>
            <p className="truncate text-[10px] text-muted-foreground">
              {repoContext ? `${repoContext.fullName} · ${repoContext.branch || repoContext.defaultBranch}` : i18n.t('通用模式 · 仓库可选')}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setContextDialogOpen(true)}
            title={i18n.t('上下文')}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={handleClear}
            disabled={streaming || !hasConversation}
            title={i18n.t('清空当前对话')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </header>

        {!hasModelKey && (
          <button
            type="button"
            onClick={() => navigate('/ai-settings/model')}
            className="mx-2 mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-700 dark:text-amber-300 sm:mx-3"
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span className="flex-1">{i18n.t('还没有配置模型，点击选择 DeepSeek / OpenRouter / Gemini')}</span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </button>
        )}
        {resumableSnapshot && !streaming && (
          <div className="mx-2 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs sm:mx-3">
            <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">
              {i18n.t('上次运行中断于第 {{step}} 步', { step: resumableSnapshot.steps })}：{resumableSnapshot.title}
            </span>
            <Button type="button" size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={() => void handleResume()}>
              {i18n.t('继续')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] text-muted-foreground"
              onClick={() => {
                if (user?.login) clearRunSnapshot(user.login, resumableSnapshot.runId);
                setResumableSnapshot(null);
              }}
            >
              {i18n.t('忽略')}
            </Button>
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          <div className="mx-auto w-full max-w-3xl space-y-5 px-3 py-4 sm:px-5">
            {!hasConversation ? (
              <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Sparkles className="h-7 w-7" />
                </div>
                <h2 className="text-lg font-semibold">{i18n.t('开始一段对话')}</h2>
                <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                  {i18n.t('直接提问即可。需要仓库能力时，再把仓库添加为上下文。')}
                </p>
                <div className="mt-5 grid w-full max-w-md gap-2 sm:grid-cols-2">
                  {quickPrompts.map(prompt => (
                    <button
                      key={prompt.label}
                      type="button"
                      onClick={() => setInput(prompt.text)}
                      className="rounded-xl border border-border bg-card px-3 py-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <span className="mb-0.5 block font-medium text-foreground">{prompt.label}</span>
                      <span className="line-clamp-1">{prompt.text.replace(/```/g, '').slice(0, 40)}</span>
                    </button>
                  ))}
                </div>
                {!repoContext && (
                  <button
                    type="button"
                    onClick={() => setRepoDialogOpen(true)}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {i18n.t('添加仓库上下文')}
                  </button>
                )}
              </div>
            ) : (
              buildTurns(messages).map((turn, index) => (
                <ConversationTurnView key={turn.id} turn={turn} index={index} onOpenArtifact={openArtifact} onApplyDiff={handleApplyDiff} />
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {showScrollButton && (
            <button
              type="button"
              onClick={() => scrollToBottom(true)}
              className="sticky bottom-3 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background/95 text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
              title={i18n.t('回到底部')}
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-background/95 px-2 pb-2 pt-2 sm:px-3">
          <div className="mx-auto w-full max-w-3xl">
            <div className="rounded-2xl border border-border bg-card p-2 shadow-sm transition-colors focus-within:border-primary/40">
              <div className="mb-1 flex flex-wrap items-center gap-1.5 px-1">
                {repoContext ? (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] text-primary">
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <span className="truncate">{repoContext.fullName}</span>
                    <button type="button" onClick={() => setRepoContext(null)} className="rounded-full p-0.5 hover:bg-primary/10">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRepoDialogOpen(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  >
                    <Plus className="h-3 w-3" />
                    {i18n.t('仓库上下文')}
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".txt,.md,.markdown,.json,.jsonc,.yaml,.yml,.toml,.ini,.env,.js,.jsx,.ts,.tsx,.mjs,.cjs,.css,.scss,.html,.htm,.xml,.svg,.vue,.svelte,.py,.go,.rs,.java,.kt,.kts,.gradle,.c,.h,.cpp,.hpp,.cs,.php,.rb,.sh,.bash,.sql,.csv,.log,Dockerfile,Makefile"
                className="hidden"
                onChange={event => void handleLocalFiles(event.target.files)}
              />
              {pendingAttachments.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1 px-1">
                  {pendingAttachments.map(attachment => (
                    <span
                      key={attachment.id}
                      className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border bg-muted/40 px-2 py-1 text-[10px]"
                      title={attachment.path || attachment.name}
                    >
                      {attachment.source === 'repo' ? <AtSign className="h-3 w-3 shrink-0 text-primary" /> : <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span className="max-w-[160px] truncate">{attachment.path || attachment.name}</span>
                      <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size)}</span>
                      <button
                        type="button"
                        onClick={() => setPendingAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                        className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Textarea
                value={input}
                onChange={event => {
                  const next = event.target.value;
                  setInput(next);
                  if (next.endsWith('@') && repoContext && !repoFileDialogOpen) setRepoFileDialogOpen(true);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={i18n.t('输入消息… Enter 发送，Shift+Enter 换行')}
                rows={1}
                disabled={streaming}
                className="max-h-44 min-h-[40px] resize-none border-0 bg-transparent px-2 py-1.5 text-sm shadow-none focus-visible:ring-0"
              />

              <div className="flex items-center gap-1 px-1 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming}
                  title={i18n.t('添加文本附件')}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground"
                  onClick={() => {
                    if (!repoContext) {
                      toast.warning(i18n.t('请先选择仓库，再引用仓库文件'));
                      return;
                    }
                    setRepoFileDialogOpen(true);
                  }}
                  disabled={streaming}
                  title={i18n.t('@ 引用仓库文件')}
                >
                  <AtSign className="h-3.5 w-3.5" />
                </Button>
                <button
                  type="button"
                  onClick={() => navigate('/ai-settings')}
                  className="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ModelAvatar modelDef={modelDef} size="sm" />
                  <span className="max-w-[110px] truncate">{modelDef.label}</span>
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </button>
                <span className="ml-auto text-[9px] text-muted-foreground">
                  {v2Settings.allowAllPermissions
                  ? i18n.t('全局权限已允许')
                  : repoContext
                    ? i18n.t('仓库工具 · 写操作需确认')
                    : i18n.t('纯聊天')}
                </span>
                <Button
                  type="button"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-lg"
                  onClick={streaming ? handleStop : handleSend}
                  disabled={!streaming && ((!input.trim() && pendingAttachments.length === 0) || !token)}
                  title={streaming ? i18n.t('停止生成') : i18n.t('发送')}
                >
                  {streaming ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
          </div>
        </div>
      </div>
      </div>

      {/* 大屏上下文档 */}
      <aside className="hidden w-72 shrink-0 flex-col border-l border-border bg-muted/10 2xl:flex">
        <div className="flex h-12 items-center border-b border-border px-3">
          <span className="text-xs font-medium">{i18n.t('会话上下文')}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <ContextContent
            repo={repoContext}
            modelLabel={modelDef.label}
            characterLabel={character.name}
            onAddRepo={() => setRepoDialogOpen(true)}
            onRemoveRepo={() => setRepoContext(null)}
          />
        </div>
      </aside>

      <Dialog
        open={Boolean(approvalRequest)}
        onOpenChange={open => {
          if (!open) resolveApproval(false);
        }}
      >
        <DialogContent className="max-w-[calc(100%-2rem)] p-4 md:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              {i18n.t('需要确认写操作')}
            </DialogTitle>
          </DialogHeader>
          {approvalRequest && (() => {
const args = approvalRequest.arguments as Record<string, unknown>;
             const content = String(args.content || '');
             const files = Array.isArray(args.files)
               ? args.files as Array<{ path?: unknown; content?: unknown }>
               : [];
             const previewContent = content || String(files[0]?.content || '');
             const isSingleWrite = approvalRequest.toolName === 'github_write_file';
            return (
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                  {i18n.t('该工具会修改仓库。确认后才会执行，本次允许仅对当前调用有效。')}
                </div>
                <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3 text-xs">
                  <p className="flex items-center gap-1.5 font-mono font-medium"><Wrench className="h-3.5 w-3.5" />{approvalRequest.toolName}</p>
                  <p className="text-[11px] leading-5 text-muted-foreground">{approvalRequest.description}</p>
{args.path !== undefined && <p><span className="text-muted-foreground">{i18n.t('路径')}：</span><span className="font-mono">{String(args.path)}</span></p>}
                   {args.branch !== undefined && <p><span className="text-muted-foreground">{i18n.t('分支')}：</span><span className="font-mono">{String(args.branch)}</span></p>}
                   {args.base_branch !== undefined && <p><span className="text-muted-foreground">{i18n.t('基础分支')}：</span><span className="font-mono">{String(args.base_branch)}</span></p>}
                   {args.message !== undefined && <p><span className="text-muted-foreground">{i18n.t('提交信息')}：</span>{String(args.message)}</p>}
                   {args.title !== undefined && <p><span className="text-muted-foreground">{i18n.t('标题')}：</span>{String(args.title)}</p>}
                   {args.head !== undefined && <p><span className="text-muted-foreground">{i18n.t('来源分支')}：</span><span className="font-mono">{String(args.head)}</span></p>}
                   {args.base !== undefined && <p><span className="text-muted-foreground">{i18n.t('目标分支')}：</span><span className="font-mono">{String(args.base)}</span></p>}
                   {args.number !== undefined && <p><span className="text-muted-foreground">{i18n.t('PR 编号')}：</span>#{String(args.number)}</p>}
                   {args.merge_method !== undefined && <p><span className="text-muted-foreground">{i18n.t('合并方式')}：</span>{String(args.merge_method)}</p>}
                   {files.length > 0 && (
                     <div>
                       <p className="mb-1 text-[10px] text-muted-foreground">{i18n.t('批量文件')} · {files.length} {i18n.t('个')}</p>
                       <div className="max-h-28 space-y-0.5 overflow-auto rounded bg-background/70 p-2 font-mono text-[10px]">
                         {files.map((file, index) => (
                           <p key={`${String(file.path)}-${index}`} className="truncate">
                             {String(file.path)} <span className="text-muted-foreground">({String(file.content || '').length})</span>
                           </p>
                         ))}
                       </div>
                     </div>
                   )}
                   {isSingleWrite && (
                     <div>
                       <p className="mb-1 text-[10px] text-muted-foreground">
                         {i18n.t('变更预览')} {approvalRemoteMissing && `· ${i18n.t('新建文件')}`}
                       </p>
                       {approvalDiffLoading ? (
                         <div className="flex items-center gap-2 py-2 text-[11px] text-muted-foreground">
                           <Loader2 className="h-3.5 w-3.5 animate-spin" />
                           {i18n.t('正在生成 Diff…')}
                         </div>
                       ) : (
                         <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 font-mono text-[10px] leading-4">{approvalDiff || i18n.t('无法读取远端版本，仅显示新内容预览。')}</pre>
                       )}
                     </div>
                   )}
                   {previewContent && (
                     <div>
                       <p className="mb-1 text-[10px] text-muted-foreground">{files.length > 0 ? i18n.t('首个文件内容') : i18n.t('内容预览')} · {previewContent.length} {i18n.t('字符')}</p>
                       <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 font-mono text-[10px]">{previewContent.slice(0, 2000)}</pre>
                     </div>
                   )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => resolveApproval(false)}>
                    <X className="h-3.5 w-3.5" />
                    {i18n.t('拒绝')}
                  </Button>
                  <Button type="button" size="sm" className="h-8 gap-1 text-xs" onClick={() => resolveApproval(true)}>
                    <Check className="h-3.5 w-3.5" />
                    {i18n.t('允许一次')}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={artifactDialogOpen} onOpenChange={setArtifactDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] p-4 md:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" />
              {artifactMeta?.title || i18n.t('工具结果')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Badge variant="secondary" className="text-[9px]">{artifactMeta?.mime || 'text/plain'}</Badge>
            <span>{artifactMeta?.size.toLocaleString()} {i18n.t('字符')}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-7 gap-1 px-2 text-[10px]"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(artifactContent);
                  toast.success(i18n.t('已复制 Artifact'));
                } catch {
                  toast.error(i18n.t('复制失败'));
                }
              }}
            >
              <Copy className="h-3 w-3" />
              {i18n.t('复制')}
            </Button>
          </div>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/25 p-3 font-mono text-[11px] leading-5">{artifactContent}</pre>
        </DialogContent>
      </Dialog>

      <Dialog open={repoDialogOpen} onOpenChange={setRepoDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] p-4 md:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base">{i18n.t('选择仓库上下文')}</DialogTitle>
          </DialogHeader>
          <p className="-mt-1 text-xs text-muted-foreground">
            {i18n.t('仓库是可选的。选择后会加载只读 GitHub 工具。')}
          </p>
          <RepoSelector onSelect={handleSelectRepo} />
        </DialogContent>
      </Dialog>

      <RepoFilePicker
        open={repoFileDialogOpen}
        onOpenChange={setRepoFileDialogOpen}
        repo={repoContext}
        token={token || ''}
        onSelect={attachment => {
          addAttachment(attachment);
          setInput(prev => {
            const base = prev.endsWith('@') ? prev.slice(0, -1) : prev;
            const separator = base && !/\s$/.test(base) ? ' ' : '';
            return `${base}${separator}@${attachment.path || attachment.name} `;
          });
        }}
      />

      <ApplyPatchDialog
        request={patchRequest}
        repo={repoContext}
        token={token || ''}
        onClose={() => setPatchRequest(null)}
      />

      <Sheet open={sessionDialogOpen} onOpenChange={setSessionDialogOpen}>
        <SheetContent side="left" className="flex w-[86vw] max-w-sm flex-col gap-0 p-0">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3 pr-9">
            <SheetTitle className="text-sm font-semibold">{i18n.t('对话历史')}</SheetTitle>
            <Button type="button" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={handleNewSession} disabled={streaming}>
              <Plus className="h-3.5 w-3.5" />
              {i18n.t('新对话')}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <SessionList
              sessions={sessions}
              activeId={activeSession?.id || ''}
              streaming={streaming}
              onSelect={handleSelectSession}
              onRename={handleRenameSession}
              onDelete={handleDeleteSession}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={contextDialogOpen} onOpenChange={setContextDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] p-4 md:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{i18n.t('会话上下文')}</DialogTitle>
          </DialogHeader>
          <ContextContent
            repo={repoContext}
            modelLabel={modelDef.label}
            characterLabel={character.name}
            onAddRepo={() => {
              setContextDialogOpen(false);
              setRepoDialogOpen(true);
            }}
            onRemoveRepo={() => setRepoContext(null)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}