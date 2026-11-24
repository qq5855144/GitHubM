// AI 对话轮次展示组件：思考、工具、正文、头像与用户气泡。
import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Copy, Eye, Loader2, Pencil, RefreshCw, Wrench, XCircle, Zap, AtSign, Paperclip } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toolCallLabel } from '@/ai-v2/agent';
import type { ArtifactMeta, UiChatMessage, UiToolRun } from '@/ai-v2/types';
import { buildRenderGroups } from '@/ai-v2/blocks';
import { formatFileSize } from '@/ai-v2/attachments';
import AiExecutionPanel from '@/components/ai/AiExecutionPanel';
import { renderMarkdown } from '@/components/ai/aiUtils';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import i18n from '@/i18n';

const MAX_USER_MESSAGE_CHARS = 4000;
const USER_MESSAGE_PREVIEW_CHARS = 2000;
const STREAMING_PLAIN_LIMIT = 400_000;

function ReasoningPanel({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(Boolean(streaming));
  useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);
  if (!text) return null;
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="inline-flex items-center gap-1 py-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{streaming ? i18n.t('思考中') : i18n.t('已思考')}</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="mt-1.5 whitespace-pre-wrap border-l-2 border-border/70 pl-3 text-[13px] leading-6 text-muted-foreground">
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

/** 等待首个 token 的三点动画（参考 DeepSeek chat 的等待态） */
function WaitingDots() {
  return (
    <div className="flex items-center gap-1 py-2" aria-label={i18n.t('思考中…')}>
      {[0, 1, 2].map(index => (
        <span
          key={index}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
          style={{ animation: `fading 0.9s linear ${index * 0.12}s infinite` }}
        />
      ))}
    </div>
  );
}

function AssistantTextBlock({ text, streaming, error, onApplyDiff }: {
  text: string;
  streaming?: boolean;
  error?: boolean;
  onApplyDiff: (path: string, diff: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // 流式阶段不解析 Markdown：只渲染纯文本，流结束后再渲染一次
  const base = streaming && text.length > STREAMING_PLAIN_LIMIT
    ? `…
${text.slice(-STREAMING_PLAIN_LIMIT)}`
    : text;
  const isLong = !streaming && base.length > 12000;
  const display = isLong && !expanded ? `${base.slice(0, 12000)}

…` : base;
  return (
    <div className={cn(
      'min-w-0 text-[15px] leading-7 break-words',
      error ? 'text-destructive' : 'text-foreground',
    )}>
      {streaming ? (
        <p className="whitespace-pre-wrap break-words">
          {display}
          <span className="ml-0.5 inline-block h-4 w-1 animate-pulse rounded-sm bg-primary align-middle" />
        </p>
      ) : (
        renderMarkdown(display, onApplyDiff)
      )}
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="mt-1 text-[10px] text-primary hover:underline"
        >
          {expanded ? i18n.t('收起内容') : i18n.t('展开全文')}
        </button>
      )}
    </div>
  );
}

function AssistantTurn({ message, onOpenArtifact, onApplyDiff, onRegenerate }: {
  message: UiChatMessage;
  onOpenArtifact: (meta: ArtifactMeta) => void;
  onApplyDiff: (path: string, diff: string) => void;
  onRegenerate?: () => void;
}) {
  const blocks = message.blocks || [];
  const tools = message.tools || [];
  const isStreaming = Boolean(message.streaming);

  const hasBody = blocks.length > 0 || Boolean(message.content || message.reasoning) || tools.length > 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success(i18n.t('已复制回答'));
    } catch {
      toast.error(i18n.t('复制失败'));
    }
  };

  // 新消息按区块顺序渲染：思考 → 工具 → 正文 → 工具 → 正文…
  // 区块合并成展示分组：连续工具调用收进执行面板，正文保持独立
  const groups = buildRenderGroups(blocks);
  const lastGroupIndex = groups.length - 1;
  const renderedBlocks = groups.map((group, index) => {
    const isLast = index === lastGroupIndex;
    if (group.kind === 'reasoning') {
      return <ReasoningPanel key={group.id} text={group.text} streaming={isStreaming && isLast} />;
    }
    if (group.kind === 'execution') {
      const groupTools = group.toolIds
        .map(id => tools.find(item => item.id === id))
        .filter((tool): tool is UiToolRun => Boolean(tool));
      if (!groupTools.length) return null;
      return (
        <AiExecutionPanel
          key={group.id}
          tools={groupTools}
          onOpenArtifact={onOpenArtifact}
        />
      );
    }
    return (
      <AssistantTextBlock
        key={group.id}
        text={group.text}
        streaming={isStreaming && isLast}
        error={message.error && !message.errorDetail && isLast}
        onApplyDiff={onApplyDiff}
      />
    );
  });

  return (
    <div className="min-w-0">
      {groups.length > 0 ? (
        <div className="space-y-2">{renderedBlocks}</div>
      ) : (
        <>
          <ReasoningPanel text={message.reasoning || ''} streaming={message.streaming} />
          <ToolActivity tools={tools} onOpenArtifact={onOpenArtifact} />
          {message.content ? (
            <AssistantTextBlock
              text={message.content}
              streaming={isStreaming}
              error={message.error && !message.errorDetail}
              onApplyDiff={onApplyDiff}
            />
          ) : null}
        </>
      )}

      {isStreaming && !hasBody && <WaitingDots />}
      {message.errorDetail && (
        <p role="status" className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
          {message.errorDetail}
        </p>
      )}

      {!message.streaming && message.content && (
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={copy}
            title={i18n.t('复制')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Copy className="h-4 w-4" />
          </button>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              title={i18n.t('重新生成')}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export interface ConversationTurn {
  id: string;
  user: UiChatMessage | null;
  assistants: UiChatMessage[];
}

export function buildTurns(messages: UiChatMessage[]): ConversationTurn[] {
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

/** 助手头像：应用 logo，浅色圆底 */
function AssistantAvatar() {
  return (
    <img
      src={`${import.meta.env.BASE_URL}assets/logo.svg`}
      alt=""
      aria-hidden
      className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-primary/10 p-1"
    />
  );
}

/** 用户头像：有 GitHub 头像用头像，否则用首字母 */
function UserAvatar({ avatarUrl, login }: { avatarUrl?: string; login?: string }) {
  const initial = (login || 'U').slice(0, 1).toUpperCase();
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        aria-hidden
        className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-border/60"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground ring-1 ring-border/60"
    >
      {initial}
    </span>
  );
}

export function ConversationTurnView({ turn, onOpenArtifact, onApplyDiff, onEditUser, onRegenerate, regenerateId }: {
  turn: ConversationTurn;
  index: number;
  onOpenArtifact: (meta: ArtifactMeta) => void;
  onApplyDiff: (path: string, diff: string) => void;
  onEditUser: (message: UiChatMessage) => void;
  onRegenerate: (message: UiChatMessage) => void;
  regenerateId?: string;
}) {
  const { user: authUser } = useAuth();
  const [userExpanded, setUserExpanded] = useState(false);
  const userContent = turn.user?.content || '';
  const userIsLong = userContent.length > MAX_USER_MESSAGE_CHARS;
  const shownUserContent = userIsLong && !userExpanded
    ? `${userContent.slice(0, USER_MESSAGE_PREVIEW_CHARS)}

…`
    : userContent;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      {turn.user && (
        <div className="flex min-w-0 items-start gap-2.5">
          {/* 左侧固定占位：与助手头像列同宽，用户内容不进入该区域 */}
          <div className="w-7 shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col items-end gap-1.5">
            <div className="max-w-full min-w-0 rounded-2xl rounded-br-md bg-muted px-3.5 py-2.5 text-[15px] leading-7 text-foreground">
              <span className="whitespace-pre-wrap break-words">{shownUserContent}</span>
              {userIsLong && (
                <button
                  type="button"
                  onClick={() => setUserExpanded(value => !value)}
                  className="mt-1 block text-[10px] text-primary underline-offset-2 hover:underline"
                >
                  {userExpanded
                    ? i18n.t('收起内容')
                    : i18n.t('展开全部（共 {{count}} 字）', { count: userContent.length })}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => onEditUser(turn.user!)}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              {i18n.t('编辑重发')}
            </button>
            {turn.user.attachments && turn.user.attachments.length > 0 && (
              <div className="flex max-w-full flex-wrap justify-end gap-1">
                {turn.user.attachments.map(attachment => (
                  <span
                    key={attachment.id}
                    className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[9px] text-muted-foreground"
                    title={attachment.path || attachment.name}
                  >
                    {attachment.kind === 'image' && (attachment.thumbDataUrl || attachment.dataUrl) ? (
                      <img src={attachment.thumbDataUrl || attachment.dataUrl} alt={attachment.name} className="h-5 w-5 shrink-0 rounded object-cover" />
                    ) : attachment.source === 'repo' ? <AtSign className="h-2.5 w-2.5 shrink-0 text-primary" /> : <Paperclip className="h-2.5 w-2.5 shrink-0" />}
                    <span className="truncate">{attachment.path || attachment.name}</span>
                    <span className="shrink-0 opacity-70">{formatFileSize(attachment.size)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <UserAvatar avatarUrl={authUser?.avatar_url} login={authUser?.login} />
        </div>
      )}

      <div className="flex min-w-0 items-start gap-2.5">
        <AssistantAvatar />
        <div className="min-w-0 flex-1">
          {turn.assistants.length > 0 ? (
            <div className="min-w-0 space-y-4">
              {turn.assistants.map(message => (
                <div key={message.id} className="min-w-0">
                  <AssistantTurn
                    message={message}
                    onOpenArtifact={onOpenArtifact}
                    onApplyDiff={onApplyDiff}
                    onRegenerate={regenerateId === message.id && turn.user ? () => onRegenerate(turn.user!) : undefined}
                  />
                </div>
              ))}
            </div>
          ) : (
            <WaitingDots />
          )}
        </div>
        {/* 右侧固定占位：与用户头像列同宽，助手内容不进入该区域 */}
        <div className="w-7 shrink-0" aria-hidden />
      </div>
    </section>
  );
}
