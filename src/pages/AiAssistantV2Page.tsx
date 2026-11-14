// AI Assistant V2 — 通用聊天优先，仓库可选，Operit 风格对话流
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { runGeneralAgent, toAgentHistory, toolCallLabel } from '@/ai-v2/agent';
import type { AgentEvent, RepoContext, UiChatMessage, UiToolRun } from '@/ai-v2/types';
import ModelSettingsDialog from '@/components/ai/ModelSettingsDialog';
import RepoSelector from '@/components/ai/RepoSelector';
import {
  ModelAvatar,
  getModelDef,
  loadModelConfig,
  renderMarkdown,
  saveModelConfig,
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
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import i18n from '@/i18n';
import {
  ArrowDown,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  GitBranch,
  History,
  Layers,
  Loader2,
  Menu,
  MessageSquarePlus,
  PanelRight,
  Plus,
  RefreshCw,
  Send,
  Settings,
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

function compactMessages(messages: UiChatMessage[]): UiChatMessage[] {
  return messages.slice(-MAX_SAVED_MESSAGES).map(message => ({
    ...message,
    content: message.content.slice(0, 20000),
    reasoning: message.reasoning?.slice(0, 8000),
    tools: message.tools?.map(tool => ({
      ...tool,
      content: tool.content?.slice(0, MAX_TOOL_RESULT),
    })),
  }));
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

function ToolCard({ tool }: { tool: UiToolRun }) {
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
          </div>
        </div>
      )}
    </div>
  );
}

function ToolActivity({ tools }: { tools: UiToolRun[] }) {
  if (!tools.length) return null;
  return (
    <div className="my-2 space-y-1.5 border-l-2 border-primary/20 pl-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Zap className="h-3 w-3" />
        {i18n.t('工具调用')}
        <span className="rounded-full bg-muted px-1.5 text-[9px]">{tools.length}</span>
      </div>
      {tools.map(tool => <ToolCard key={tool.id} tool={tool} />)}
    </div>
  );
}

function AssistantTurn({ message }: { message: UiChatMessage }) {
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
      <ToolActivity tools={message.tools || []} />

      {message.content ? (
        <div className={cn(
          'min-w-0 text-sm leading-6 break-words',
          message.error ? 'text-destructive' : 'text-foreground',
        )}>
          {renderMarkdown(message.content)}
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

function ConversationTurnView({ turn, index }: { turn: ConversationTurn; index: number }) {
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
            {turn.assistants.map(message => <AssistantTurn key={message.id} message={message} />)}
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

function SessionList({
  sessions,
  activeId,
  streaming,
  onSelect,
  onDelete,
}: {
  sessions: V2Session[];
  activeId: string;
  streaming: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const groups = groupSessions(sessions);
  if (!groups.length) {
    return <p className="px-3 py-6 text-center text-xs text-muted-foreground">{i18n.t('暂无对话')}</p>;
  }
  return (
    <div className="space-y-3">
      {groups.map(group => (
        <div key={group.label}>
          <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</p>
          <div className="space-y-0.5">
            {group.items.map(session => (
              <div
                key={session.id}
                className={cn(
                  'group flex items-center gap-1 rounded-lg px-2 py-2 text-xs transition-colors',
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
                  onClick={() => onDelete(session.id)}
                  disabled={streaming}
                  className="shrink-0 rounded p-1 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
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
  );
}

function ContextContent({
  repo,
  modelLabel,
  onAddRepo,
  onRemoveRepo,
}: {
  repo: RepoContext | null;
  modelLabel: string;
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
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => loadModelConfig());
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
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

    const nextSessions = loaded?.sessions?.length ? loaded.sessions : [newSession()];
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
    return () => abortRef.current?.abort();
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    if (!token) {
      toast.error(i18n.t('登录状态已失效，请重新登录'));
      return;
    }
    if (!hasModelKey) {
      setModelDialogOpen(true);
      toast.error(i18n.t('请先配置模型 API Key'));
      return;
    }

    const now = new Date().toISOString();
    const userMessage: UiChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
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
    })));
    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput('');
    setStreaming(true);
    stickToBottomRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    const onEvent = (event: AgentEvent) => {
      switch (event.type) {
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
          break;
        default:
          break;
      }
    };

    try {
      await runGeneralAgent({
        token,
        repo: repoContext || undefined,
        config: modelConfig,
        history: [...previousHistory, { role: 'user', content: text }],
        signal: controller.signal,
        onEvent,
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        patchAssistant(assistantId, { streaming: false });
      } else {
        const message = (error as Error)?.message || String(error);
        patchAssistant(assistantId, {
          content: `${i18n.t('请求失败：')}${message}`,
          streaming: false,
          error: true,
        });
        toast.error(message.slice(0, 160));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      scrollToBottom(true);
    }
  };

  const handleStop = () => {
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
    setSessionDialogOpen(false);
    requestAnimationFrame(() => scrollToBottom(true));
  };

  const handleSelectSession = (id: string) => {
    if (streaming) return;
    setActiveId(id);
    setSessionDialogOpen(false);
    stickToBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom(true));
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
            onDelete={handleDeleteSession}
          />
        </div>
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => navigate('/ai-assistant-v1')}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" />
            {i18n.t('打开经典版')}
          </button>
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden h-8 w-8 text-muted-foreground sm:inline-flex"
            onClick={() => navigate('/ai-assistant-v1')}
            title={i18n.t('经典版')}
          >
            <History className="h-4 w-4" />
          </Button>
        </header>

        {!hasModelKey && (
          <button
            type="button"
            onClick={() => setModelDialogOpen(true)}
            className="mx-2 mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-700 dark:text-amber-300 sm:mx-3"
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span className="flex-1">{i18n.t('还没有配置模型，点击选择 DeepSeek / OpenRouter / Gemini')}</span>
            <ChevronRight className="h-4 w-4 shrink-0" />
          </button>
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
                <ConversationTurnView key={turn.id} turn={turn} index={index} />
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

              <Textarea
                value={input}
                onChange={event => setInput(event.target.value)}
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
                <button
                  type="button"
                  onClick={() => setModelDialogOpen(true)}
                  className="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ModelAvatar modelDef={modelDef} size="sm" />
                  <span className="max-w-[110px] truncate">{modelDef.label}</span>
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </button>
                <span className="ml-auto text-[9px] text-muted-foreground">
                  {repoContext ? i18n.t('只读仓库工具') : i18n.t('纯聊天')}
                </span>
                <Button
                  type="button"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-lg"
                  onClick={streaming ? handleStop : handleSend}
                  disabled={!streaming && (!input.trim() || !token)}
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
            onAddRepo={() => setRepoDialogOpen(true)}
            onRemoveRepo={() => setRepoContext(null)}
          />
        </div>
      </aside>

      <ModelSettingsDialog
        open={modelDialogOpen}
        onClose={() => setModelDialogOpen(false)}
        config={modelConfig}
        onSave={(config) => {
          setModelConfig(config);
          saveModelConfig(config);
        }}
      />

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

      <Dialog open={sessionDialogOpen} onOpenChange={setSessionDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] p-4 md:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-base">
              <span>{i18n.t('对话')}</span>
              <Button type="button" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={handleNewSession} disabled={streaming}>
                <Plus className="h-3.5 w-3.5" />
                {i18n.t('新对话')}
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto">
            <SessionList
              sessions={sessions}
              activeId={activeSession?.id || ''}
              streaming={streaming}
              onSelect={handleSelectSession}
              onDelete={handleDeleteSession}
            />
          </div>
          <button
            type="button"
            onClick={() => navigate('/ai-assistant-v1')}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50"
          >
            <History className="h-4 w-4" />
            {i18n.t('打开经典版')}
          </button>
        </DialogContent>
      </Dialog>

      <Dialog open={contextDialogOpen} onOpenChange={setContextDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] p-4 md:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{i18n.t('会话上下文')}</DialogTitle>
          </DialogHeader>
          <ContextContent
            repo={repoContext}
            modelLabel={modelDef.label}
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