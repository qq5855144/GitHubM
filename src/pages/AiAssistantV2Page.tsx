// AI Assistant V2 — 通用聊天优先，仓库上下文可选，无固定规划/验证流程
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { runGeneralAgent, toAgentHistory, toolCallLabel } from '@/ai-v2/agent';
import type { AgentEvent, RepoContext, UiChatMessage, UiToolRun } from '@/ai-v2/types';
import ModelSettingsDialog from '@/components/ai/ModelSettingsDialog';
import RepoSelector from '@/components/ai/RepoSelector';
import {
  ModelAvatar,
  ThinkingBlock,
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
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  GitBranch,
  Loader2,
  Plus,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';

const SESSION_PREFIX = 'githubm_ai_v2_session:';
const MAX_SAVED_MESSAGES = 40;
const MAX_TOOL_RESULT = 4000;

interface PersistedV2Session {
  messages: UiChatMessage[];
  repo: RepoContext | null;
  savedAt: string;
}

interface ToolCardProps {
  tool: UiToolRun;
}

function ToolCard({ tool }: ToolCardProps) {
  const [open, setOpen] = useState(false);
  const statusIcon = tool.status === 'running'
    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    : tool.status === 'done'
      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
      : <XCircle className="h-3.5 w-3.5 text-destructive" />;

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-secondary/25">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-secondary/40"
      >
        <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono">{toolCallLabel({ id: tool.id, name: tool.name, arguments: tool.arguments })}</span>
        {statusIcon}
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          <div className="mb-2">
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">参数</p>
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-background/70 p-2 text-[10px] font-mono">{tool.arguments || '{}'}</pre>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">结果</p>
            {tool.status === 'running' ? (
              <p className="text-xs text-muted-foreground">{i18n.t('工具执行中…')}</p>
            ) : (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-[10px] font-mono">{tool.content || i18n.t('无输出')}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: UiChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm text-primary-foreground break-words">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn(
          'rounded-2xl rounded-tl-md border px-3.5 py-2.5 text-sm',
          message.error ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-card',
        )}>
          {message.reasoning && (
            <ThinkingBlock content={message.reasoning} done={!message.streaming} />
          )}
          {(message.tools || []).map(tool => <ToolCard key={tool.id} tool={tool} />)}
          {message.content ? (
            <div className="min-w-0 break-words leading-6">{renderMarkdown(message.content)}</div>
          ) : message.streaming && !message.reasoning && !(message.tools || []).length ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {i18n.t('思考中…')}
            </div>
          ) : null}
          {message.streaming && message.content && (
            <span className="ml-0.5 inline-block h-4 w-1 animate-pulse rounded-sm bg-primary align-middle" />
          )}
        </div>
        {message.streaming && (
          <p className="mt-1 pl-1 text-[10px] text-muted-foreground">{i18n.t('正在生成…')}</p>
        )}
      </div>
    </div>
  );
}

export default function AiAssistantV2Page() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<UiChatMessage[]>([]);
  const [repoContext, setRepoContext] = useState<RepoContext | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => loadModelConfig());
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const hydratedRef = useRef(false);

  const modelDef = useMemo(() => getModelDef(modelConfig.type), [modelConfig.type]);
  const hasModelKey = Boolean(modelConfig.api_key?.trim());
  const sessionKey = user?.login ? `${SESSION_PREFIX}${user.login}` : '';
  const hasConversation = messages.length > 0;

  // 按用户恢复本地会话
  useEffect(() => {
    hydratedRef.current = false;
    if (!sessionKey) {
      setMessages([]);
      setRepoContext(null);
      hydratedRef.current = true;
      return;
    }
    try {
      const raw = localStorage.getItem(sessionKey);
      if (raw) {
        const saved = JSON.parse(raw) as PersistedV2Session;
        setMessages(Array.isArray(saved.messages) ? saved.messages : []);
        setRepoContext(saved.repo || null);
      } else {
        setMessages([]);
        setRepoContext(null);
      }
    } catch {
      setMessages([]);
      setRepoContext(null);
    }
    hydratedRef.current = true;
  }, [sessionKey]);

  // 防抖持久化，避免每个 token 都写 localStorage
  useEffect(() => {
    if (!hydratedRef.current || !sessionKey) return;
    const timer = window.setTimeout(() => {
      try {
        const compact = messages.slice(-MAX_SAVED_MESSAGES).map(message => ({
          ...message,
          content: message.content.slice(0, 20000),
          reasoning: message.reasoning?.slice(0, 8000),
          tools: message.tools?.map(tool => ({
            ...tool,
            content: tool.content?.slice(0, MAX_TOOL_RESULT),
          })),
        }));
        const payload: PersistedV2Session = {
          messages: compact,
          repo: repoContext,
          savedAt: new Date().toISOString(),
        };
        localStorage.setItem(sessionKey, JSON.stringify(payload));
      } catch {
        // localStorage 满时静默，下一次减少内容再试
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [messages, repoContext, sessionKey]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    if (!force && !stickToBottomRef.current) return;
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streaming, scrollToBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const patchAssistant = useCallback((id: string, patch: Partial<UiChatMessage>) => {
    setMessages(prev => prev.map(message => message.id === id ? { ...message, ...patch } : message));
  }, []);

  const appendAssistant = useCallback((id: string, patch: { content?: string; reasoning?: string }) => {
    setMessages(prev => prev.map(message => {
      if (message.id !== id) return message;
      return {
        ...message,
        content: patch.content ? message.content + patch.content : message.content,
        reasoning: patch.reasoning ? (message.reasoning || '') + patch.reasoning : message.reasoning,
      };
    }));
  }, []);

  const patchTool = useCallback((assistantId: string, callId: string, patch: Partial<UiToolRun>) => {
    setMessages(prev => prev.map(message => {
      if (message.id !== assistantId) return message;
      return {
        ...message,
        tools: (message.tools || []).map(tool => tool.id === callId ? { ...tool, ...patch } : tool),
      };
    }));
  }, []);

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
                  { id: event.call.id, name: event.call.name, arguments: event.call.arguments, status: 'running' as const },
                ],
              }
            : message));
          break;
        case 'tool_end':
          patchTool(assistantId, event.call.id, {
            status: event.ok ? 'done' : 'error',
            content: event.content,
          });
          break;
        case 'error':
          patchAssistant(assistantId, {
            content: `${event.message}`,
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
      const history = [...previousHistory, { role: 'user' as const, content: text }];
      await runGeneralAgent({
        token,
        repo: repoContext || undefined,
        config: modelConfig,
        history,
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
      scrollToBottom();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const handleClear = () => {
    if (streaming) return;
    if (hasConversation && !window.confirm(i18n.t('确定清空当前对话？'))) return;
    setMessages([]);
    if (sessionKey) localStorage.removeItem(sessionKey);
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
        oldPrompt('总结这个仓库', '请阅读当前仓库的 README 和主要目录，简要说明它是什么、技术栈和入口文件。'),
        oldPrompt('找入口文件', '请找出当前仓库最可能的入口文件，并说明理由。'),
        oldPrompt('解释项目结构', '请用 github_list_files 查看当前仓库目录结构，并解释主要目录的职责。'),
      ]
    : [
        oldPrompt('解释代码', '请解释这段代码的作用，并指出潜在问题：\n```\n\n```'),
        oldPrompt('写一个工具函数', '请用 TypeScript 写一个通用工具函数：安全地解析 JSON，失败时返回默认值。'),
        oldPrompt('制定计划', '帮我把一个模糊目标拆成可执行的小步骤，并指出第一步。'),
      ];

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] min-h-[520px] w-full max-w-3xl flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-base font-semibold">{i18n.t('AI 助手')}</h1>
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">V2</Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">{i18n.t('通用模式 · 仓库可选')}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            onClick={() => setModelDialogOpen(true)}
          >
            <ModelAvatar modelDef={modelDef} size="sm" />
            <span className="hidden max-w-[120px] truncate sm:inline">{modelDef.label}</span>
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground"
            onClick={() => navigate('/ai-assistant-v1')}
            title={i18n.t('打开经典版')}
          >
            {i18n.t('经典版')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={handleClear}
            disabled={streaming || !hasConversation}
            title={i18n.t('清空对话')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {!hasModelKey && (
        <button
          type="button"
          onClick={() => setModelDialogOpen(true)}
          className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-700 dark:text-amber-300"
        >
          <Bot className="h-4 w-4 shrink-0" />
          <span className="flex-1">{i18n.t('还没有配置模型，点击这里选择 DeepSeek / OpenRouter / Gemini 等')}</span>
          <ChevronRight className="h-4 w-4 shrink-0" />
        </button>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain py-3"
      >
        {!hasConversation ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-semibold">{i18n.t('通用 AI 助手')}</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {i18n.t('直接聊天即可。需要时再把仓库作为上下文，不再受固定工作流限制。')}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {quickPrompts.map(prompt => (
                <button
                  key={prompt.label}
                  type="button"
                  onClick={() => setInput(prompt.text)}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {prompt.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 text-[10px] text-muted-foreground">
              <Code2 className="h-3.5 w-3.5" />
              {i18n.t('代码、写作、分析、计划，都可以直接问')}
            </div>
          </div>
        ) : (
          messages.map(message => <MessageBubble key={message.id} message={message} />)
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-border bg-background/95 pt-2">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {repoContext ? (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-xs text-primary">
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{repoContext.fullName}</span>
              <button
                type="button"
                onClick={() => setRepoContext(null)}
                className="rounded-full p-0.5 hover:bg-primary/10"
                title={i18n.t('移除仓库上下文')}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setRepoDialogOpen(true)}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              {i18n.t('添加仓库上下文（可选）')}
            </button>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {repoContext ? i18n.t('只读仓库工具') : i18n.t('纯聊天模式')}
          </span>
        </div>

        <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-sm focus-within:border-primary/40">
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
            className="max-h-40 min-h-[38px] resize-none border-0 bg-transparent px-1 py-2 text-sm shadow-none focus-visible:ring-0"
          />
          <Button
            type="button"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg"
            onClick={streaming ? handleStop : handleSend}
            disabled={!streaming && (!input.trim() || !token)}
            title={streaming ? i18n.t('停止生成') : i18n.t('发送')}
          >
            {streaming ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
          {i18n.t('AI 可能会出错，重要内容请自行核实。')}
        </p>
      </div>

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
    </div>
  );
}

function oldPrompt(label: string, text: string) {
  return { label: i18n.t(label), text };
}