import { flushSync } from 'react-dom';
// AI Assistant V2 — 通用聊天优先，仓库可选，Operit 风格对话流
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { runGeneralAgent, toAgentHistory } from '@/ai-v2/agent';
import { verifyGitHubWrite } from '@/ai-v2/tools/github';
import { createTaskMemory, historicalTaskActivity, recordTaskActivity, scopedTaskHistory, taskMemoryScope } from '@/ai-v2/taskMemory';
import type { AgentCheckpoint, AgentEvent, ApprovalRequest, ArtifactMeta, RepoContext, UiChatMessage, UiToolRun } from '@/ai-v2/types';
import { readArtifact } from '@/ai-v2/artifacts';
import { appendRunEvent, clearRunSnapshot, clearRunSnapshots, finishRun, hasUnresolvedRunWrite, latestRunSnapshot, resumeRun, runBinding, saveRunSnapshot, startRun } from '@/ai-v2/runStore';
import type { RunSnapshot } from '@/ai-v2/runStore';
import { loadV2Settings } from '@/ai-v2/settings';
import { applyUnifiedDiff, diffStats } from '@/ai-v2/patch';
import {
  buildModelUserParts,
  filterRepoFiles,
  formatFileSize,
  hydrateAttachmentImages,
  hydrateMessageImages,
  isTextFilePath,
  makeAttachmentId,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  prepareImageAttachment,
} from '@/ai-v2/attachments';
import type { UiAttachment } from '@/ai-v2/attachments';
import { deleteImageBlob, putImageBlob } from '@/ai-v2/imageStore';
import { loadActiveCharacter } from '@/ai-v2/characters';
import type { CharacterCard } from '@/ai-v2/characters';
import {
  collectSessionImages,
  deleteSessionMessages,
  getSessionClearVersion,
  isClearingSessions,
  LEGACY_SESSION_PREFIX,
  loadSessionIndex,
  loadSessionMessages,
  queueSessionWrite,
  registerSessionClearGuard,
  sessionImageIds,
  subscribeSessionClear,
  saveSessionIndex,
  saveSessionMessages,
  toSessionMeta,
} from '@/ai-v2/sessionStore';
import type { V2Session } from '@/ai-v2/sessionStore';
import { appendBlockDelta, appendToolBlock, ensureBlocks } from '@/ai-v2/blocks';
import { ConversationTurnView, buildTurns, retainTurnsForLastMessage } from '@/components/ai/ChatTurn';
import { deriveSessionTitle } from '@/ai-v2/sessionTitle';
import { createSessionMarkdown } from '@/ai-v2/sessionExport';
import { extractPdfText, MAX_PDF_BYTES } from '@/ai-v2/pdf';
import RepoSelector from '@/components/ai/RepoSelector';
import {
  MODEL_DEFS,
  ModelAvatar,
  getModelDef,
  loadCustomModelSettings,
  loadModelConfig,
  loadProviderKey,
  modelDisplayName,
} from '@/components/ai/aiUtils';
import { getDefaultProviderModel } from '@/components/ai/aiProviders';
import type { ModelType } from '@/components/ai/aiTypes';
import { getModelCapabilities } from '@/ai-v2/modelCapabilities';
import type { ModelConfig } from '@/components/ai/aiTypes';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { GitHubRepo } from '@/types/types';
import { Button } from '@/components/ui/button';
import { confirmAction } from '@/components/ui/confirm-dialog';
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
import { triggerBlobDownload } from '@/lib/blobDownload';
import { toast } from 'sonner';
import i18n from '@/i18n';
import {
  ArrowDown,
  AtSign,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  Eye,
  FileText,
  GitBranch,
  Loader2,
  Menu,
  MessageSquarePlus,
  Paperclip,
  PanelRight,
  Pencil,
  Plus,
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

const EMPTY_MESSAGES: UiChatMessage[] = [];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 流式增量合并窗口（毫秒）：只做渲染合批，不做速度限制 */
const STREAM_FLUSH_MS = 24;

function readFileAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

const CLOUDFLARE_FALLBACK_CONFIG: ModelConfig = {
  type: 'cloudflare',
  supportsTools: false,
  api_key: 'cloudflare-free',
  model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
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

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function newSession(): V2Session {
  const now = new Date().toISOString();
  return {
    id: makeId('s'),
    title: i18n.t('新对话'),
    titleSource: 'auto',
    messages: [],
    repo: null,
    createdAt: now,
    updatedAt: now,
  };
}

function migrateLegacyRoundLimit(messages: UiChatMessage[]): UiChatMessage[] {
  if (!messages.some(message => message.streaming || message.tools?.some(tool => tool.status === 'running'))) return messages;
  return messages.map(message => {
    // 上次运行被中断时，消息可能停在 streaming / running 状态，加载时统一收尾
    let next = message.streaming ? { ...message, streaming: false } : message;
    if (next.tools?.some(tool => tool.status === 'running')) {
      next = {
        ...next,
        tools: next.tools.map(tool => (tool.status === 'running'
          ? { ...tool, status: 'error' as const, content: tool.content || i18n.t('已中断') }
          : tool)),
      };
    }
    return next;
  });
}

function messageForStorage(message: UiChatMessage): UiChatMessage {
  if (!message.modelContent && !message.attachments?.some(item => item.imageBlobId && item.dataUrl)) return message;
  return {
    ...message,
    modelContent: undefined,
    attachments: message.attachments?.map(attachment => (
      attachment.imageBlobId ? { ...attachment, dataUrl: undefined } : attachment
    )),
  };
}

type AgentBridge = { startAgentTask?: (title: string) => void; stopAgentTask?: () => void };

let androidTaskOwner: AbortController | undefined;

function setAndroidTask(owner: AbortController, title?: string) {
  const bridge = (window as Window & { AndroidBridge?: AgentBridge }).AndroidBridge;
  try {
    if (title) {
      androidTaskOwner = owner;
      bridge?.startAgentTask?.(title);
    } else if (androidTaskOwner === owner) {
      androidTaskOwner = undefined;
      bridge?.stopAgentTask?.();
    }
  } catch (error) {
    console.warn('Android AI task service unavailable', error);
  }
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
      <DialogContent className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto p-4 md:max-w-xl">
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

function ModelPickerDialog({
  open,
  onOpenChange,
  providers,
  currentType,
  currentModel,
  capabilities,
  onSelect,
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: typeof MODEL_DEFS;
  currentType: string;
  currentModel: string;
  capabilities: ReturnType<typeof getModelCapabilities>;
  onSelect: (type: string, model: string) => void;
  onOpenSettings: () => void;
}) {
  const currentProvider = providers.find(item => item.type === currentType) || providers[0];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto p-4 md:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ModelAvatar modelDef={currentProvider} size="sm" />
            {i18n.t('会话模型')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          <Badge variant="secondary" className="text-[9px]">{currentProvider.label}</Badge>
          <Badge variant="outline" className="text-[9px]">{i18n.t('上下文')} {Math.round(capabilities.contextWindow / 1000)}K</Badge>
          <Badge variant="outline" className="text-[9px]">{capabilities.supportsTools ? i18n.t('支持工具') : i18n.t('仅聊天')}</Badge>
          {capabilities.supportsVision && <Badge variant="outline" className="text-[9px]">{i18n.t('支持图片')}</Badge>}
        </div>
        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {providers.map(provider => (
            <div key={provider.type}>
              <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
                <ModelAvatar modelDef={provider} size="sm" />
                <span className="font-medium">{modelDisplayName(provider.label)}</span>
                {provider.needKey && !loadProviderKey(provider.type) && provider.type !== currentType && <span>· {i18n.t('未配置 Key')}</span>}
              </div>
              <div className="space-y-1">
                {(provider.models || []).map(model => {
                  const selected = provider.type === currentType && model.value === currentModel;
                  return (
                    <button
                      key={`${provider.type}:${model.value}`}
                      type="button"
                      onClick={() => {
                        onSelect(provider.type, model.value);
                        onOpenChange(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs',
                        selected
                          ? 'border-primary/35 bg-primary/10 text-primary'
                          : 'border-border hover:bg-muted/50',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{modelDisplayName(model.label)}</span>
                        <span className="block truncate font-mono text-[9px] text-muted-foreground">{model.value}</span>
                      </span>
                      {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={onOpenSettings}>
          <Settings className="h-3.5 w-3.5" />
          {i18n.t('打开模型设置')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function BranchPickerDialog({
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
  onSelect: (branch: string) => void;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !repo || !token) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setQuery('');
    fetch(`https://api.github.com/repos/${repo.fullName}/branches?per_page=100`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<Array<{ name?: string }>>;
    }).then(data => {
      if (!cancelled) setBranches(data.map(item => item.name).filter((name): name is string => Boolean(name)));
    }).catch(reason => {
      if (!cancelled) setError((reason as Error).message || String(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, repo, token]);

  const visible = branches.filter(name => !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase()));
  const current = repo?.branch || repo?.defaultBranch || '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto p-4 md:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-primary" />
            {i18n.t('切换分支')}
          </DialogTitle>
        </DialogHeader>
        <div className="relative">
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={i18n.t('搜索分支')}
            autoFocus
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
        <div className="max-h-[50vh] min-h-[180px] overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {i18n.t('读取分支…')}
            </div>
          ) : error ? (
            <p className="px-3 py-6 text-center text-xs text-destructive">{error}</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">{i18n.t('没有匹配的分支')}</p>
          ) : (
            <div className="divide-y divide-border/60">
              {visible.map(branch => (
                <button
                  key={branch}
                  type="button"
                  onClick={() => {
                    onSelect(branch);
                    onOpenChange(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50',
                    branch === current && 'bg-primary/10 text-primary',
                  )}
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono">{branch}</span>
                  {branch === repo?.defaultBranch && <Badge variant="secondary" className="text-[9px]">{i18n.t('默认')}</Badge>}
                  {branch === current && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">{i18n.t('显示前 100 个分支')}</p>
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
      <DialogContent className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto p-4 md:max-w-xl">
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
            className="h-9 w-full min-w-0 rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus:border-primary/50"
          />
        </div>
        <div className="min-h-[140px] max-h-[38dvh] overflow-y-auto rounded-lg border border-border md:max-h-[320px]">
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
  exportingId,
  onSelect,
  onRename,
  onExport,
  onDelete,
}: {
  sessions: V2Session[];
  activeId: string;
  streaming: boolean;
  exportingId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onExport: (id: string) => void;
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
                      onClick={() => onExport(session.id)}
                      disabled={!!exportingId || (streaming && session.id === activeId)}
                      aria-busy={exportingId === session.id}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                      title={i18n.t('导出对话为 Markdown')}
                      aria-label={i18n.t('导出对话为 Markdown')}
                    >
                      {exportingId === session.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Download className="h-3 w-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(session.id)}
                      disabled={streaming || exportingId === session.id}
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
  onSwitchBranch,
}: {
  repo: RepoContext | null;
  modelLabel: string;
  characterLabel: string;
  onAddRepo: () => void;
  onRemoveRepo: () => void;
  onSwitchBranch: () => void;
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
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{i18n.t('仓库')}</p>
        {repo ? (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-start gap-2">
              <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-primary">{repo.fullName}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{i18n.t('分支')}：{repo.branch || repo.defaultBranch}</p>
                <button type="button" onClick={onSwitchBranch} className="mt-1 text-[10px] text-primary hover:underline">
                  {i18n.t('切换分支')}
                </button>
              </div>
              <button type="button" onClick={onRemoveRepo} className="rounded p-1 text-muted-foreground hover:bg-primary/10">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAddRepo}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            {i18n.t('选择仓库')}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AiAssistantV2Page({ visible = true, compactKeyboard = false }: { visible?: boolean; compactKeyboard?: boolean } = {}) {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<V2Session[]>([]);
  const [activeId, setActiveId] = useState('');
  const [input, setInput] = useState('');
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const isAndroid = useMemo(
    () => typeof window !== 'undefined' && !!(window as unknown as { AndroidBridge?: unknown }).AndroidBridge,
    [],
  );
  const [streaming, setStreaming] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(loadModelConfig);
  const [character, setCharacter] = useState<CharacterCard>(() => loadActiveCharacter(user?.login));
  const [v2Settings, setV2Settings] = useState(() => loadV2Settings());
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const sessionExportRef = useRef<AbortController | null>(null);
  useEffect(() => () => {
    sessionExportRef.current?.abort();
    sessionExportRef.current = null;
  }, [user?.login]);
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [artifactMeta, setArtifactMeta] = useState<ArtifactMeta | null>(null);
  const [artifactContent, setArtifactContent] = useState('');
  const [artifactDialogOpen, setArtifactDialogOpen] = useState(false);
  const [checkingWrite, setCheckingWrite] = useState(false);
  const verificationRef = useRef<AbortController | null>(null);
  const [resumableSnapshot, setResumableSnapshot] = useState<RunSnapshot | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<UiAttachment[]>([]);
  const draftAttachments = useRef<UiAttachment[]>([]);
  const draftImages = useRef(new Map<string, Blob>());
  const draftGeneration = useRef(0);
  const setAttachments = useCallback((next: UiAttachment[] | ((current: UiAttachment[]) => UiAttachment[])) => {
    const items = typeof next === 'function' ? next(draftAttachments.current) : next;
    draftAttachments.current = items;
    for (const id of draftImages.current.keys()) {
      if (!items.some(item => item.id === id)) draftImages.current.delete(id);
    }
    setPendingAttachments(items);
  }, []);
  const resetAttachments = useCallback(() => {
    draftGeneration.current++;
    setAttachments([]);
  }, [setAttachments]);
  const [repoFileDialogOpen, setRepoFileDialogOpen] = useState(false);
  const [patchRequest, setPatchRequest] = useState<{ path: string; diff: string } | null>(null);
  const [storageError, setStorageError] = useState('');
  const [sessionLoading, setSessionLoading] = useState(true);
  const sessionLoadSequence = useRef(0);
  const deletingSessionRef = useRef<string | null>(null);
  const pendingSessionSaveRef = useRef<(() => void) | null>(null);
  const sessionWritesRef = useRef(Promise.resolve());
  const sessionWriteFailure = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedSessionsRef = useRef<Set<string>>(new Set());
  const queuedMessagesRef = useRef(new Map<string, UiChatMessage[]>());
  const durableMessagesRef = useRef(new Map<string, UiChatMessage[]>());
  const durableIndexRef = useRef('');
  const unsavedPlaceholder = useRef('');
  const [saveRevision, setSaveRevision] = useState(0);
  const clearVersion = useSyncExternalStore(subscribeSessionClear, getSessionClearVersion, getSessionClearVersion);
  const runCapabilitiesRef = useRef<string[]>([]);
  const runMetricsRef = useRef<{ runId: string; startedAt: number; firstTokenAt?: number } | null>(null);
  const pendingStreamRef = useRef<{ assistantId: string; content: string; reasoning: string } | null>(null);
  const streamFlushTimerRef = useRef<number | null>(null);
  const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const abortRef = useRef<AbortController | null>(null);
  const [nativeViewportHeight, setNativeViewportHeight] = useState(() => (
    typeof window === 'undefined' ? 800 : window.innerHeight
  ));
  useEffect(() => {
    if (!isAndroid) return;
    let timer = 0;
    const apply = () => {
      const next = window.innerHeight;
      setNativeViewportHeight(prev => (Math.abs(prev - next) > 1 ? next : prev));
    };
    // 键盘弹出/收起是一段连续 resize，逐帧改高度会让整页反复重排（抖动）
    const sync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(apply, 120);
    };
    apply();
    window.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('resize', sync);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('resize', sync);
    };
  }, [isAndroid]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const scrollFrame = useRef<number | null>(null);
  const scrollOffsets = useRef(new Map<string, number>());
  const restoreScroll = useRef(false);
  const forceScroll = useRef(false);
  const hydratedRef = useRef(false);

  const legacyKey = user?.login ? `${LEGACY_SESSION_PREFIX}${user.login}` : '';
  const activeSession = useMemo(
    () => sessions.find(session => session.id === activeId) || sessions[0] || null,
    [sessions, activeId],
  );
  const messages = activeSession?.messages || EMPTY_MESSAGES;
  const activeSessionIdRef = useRef(activeId);
  activeSessionIdRef.current = activeId;
  const repoContext = activeSession?.repo || null;
  const hasConversation = messages.length > 0;
  const turns = useMemo(() => visible ? buildTurns(messages) : [], [messages, visible]);
  const turnKey = useCallback((index: number) => turns[index]?.id ?? index, [turns]);
  const virtualizer = useVirtualizer({
    count: turns.length,
    enabled: visible,
    getItemKey: turnKey,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 240,
    overscan: 4,
  });
  const sessionType = (activeSession?.modelType as ModelType | undefined) || modelConfig.type;
  const providerDef = useMemo(() => getModelDef(sessionType), [sessionType]);
  const defaultProviderModel = providerDef.models?.[0]?.value || '';
  const customSettings = useMemo(() => loadCustomModelSettings(modelConfig), [modelConfig]);
  const customModel = customSettings.model?.trim() || getDefaultProviderModel('custom');
  const sessionModel = activeSession?.model || (
    sessionType === 'custom' ? customModel
      : sessionType === modelConfig.type ? modelConfig.model || '' : defaultProviderModel
  );
  const sessionApiKey = (sessionType === modelConfig.type ? modelConfig.api_key : loadProviderKey(sessionType)) || '';
  const sessionEndpoint = sessionType === 'custom' ? customSettings.endpoint : undefined;
  const effectiveConfig = useMemo<ModelConfig>(() => {
    const capabilities = getModelCapabilities(sessionType, sessionModel);
    return {
      ...modelConfig, type: sessionType, model: sessionModel, api_key: sessionApiKey, endpoint: sessionEndpoint,
      stream: sessionType === 'custom' ? customSettings.stream : undefined,
      supportsTools: sessionType === 'custom' ? customSettings.supportsTools ?? capabilities.supportsTools : capabilities.supportsTools,
      supportsVision: sessionType === 'custom' ? customSettings.supportsVision ?? capabilities.supportsVision : capabilities.supportsVision,
    };
  }, [modelConfig, sessionType, sessionModel, sessionApiKey, sessionEndpoint, customSettings]);
  const pickerProviders = useMemo(() => MODEL_DEFS.map(provider => {
    if (provider.type !== 'custom' || !customSettings.endpoint?.trim()) return provider;
    const models = new Set([customModel]);
    if (sessionType === 'custom' && sessionModel) models.add(sessionModel);
    return { ...provider, models: [...models].map(value => ({ value, label: value })) };
  }), [customSettings.endpoint, customModel, sessionType, sessionModel]);
  const binding = useMemo(() => runBinding(repoContext, effectiveConfig), [repoContext, effectiveConfig]);
  const modelDef = providerDef;
  const hasModelKey = sessionType === 'custom' || Boolean(effectiveConfig.api_key?.trim());
  const needsCustomEndpoint = sessionType === 'custom' && !sessionEndpoint?.trim();
  const modelCapabilities = useMemo(
    () => ({
      ...getModelCapabilities(effectiveConfig.type, sessionModel),
      supportsTools: effectiveConfig.supportsTools !== false,
      supportsVision: effectiveConfig.supportsVision === true,
    }),
    [effectiveConfig, sessionModel],
  );
  const modelLabel = useMemo(() => {
    const option = modelDef.models?.find(item => item.value === sessionModel);
    return modelDisplayName(option?.label || sessionModel || modelDef.label);
  }, [modelDef, sessionModel]);

  useEffect(() => {
    if (!visible) return;
    setModelConfig(loadModelConfig());
    setV2Settings(loadV2Settings());
    setCharacter(loadActiveCharacter(user?.login));
  }, [user?.login, visible]);

  useLayoutEffect(() => registerSessionClearGuard(() =>
    !abortRef.current && !verificationRef.current && !deletingSessionRef.current,
  ), []);

  useEffect(() => {
    hydratedRef.current = false;
    pendingSessionSaveRef.current = null;
    sessionLoadSequence.current++;
    resetAttachments();
    setInput('');
    setEditTargetId(null);
    setResumableSnapshot(null);
    setExportingId(null);
    setSessionLoading(Boolean(user?.login));
    loadedSessionsRef.current = new Set();
    queuedMessagesRef.current.clear();
    durableMessagesRef.current.clear();
    scrollOffsets.current.clear();
    durableIndexRef.current = '';
    unsavedPlaceholder.current = '';
    let cancelled = false;
    const isStale = () => cancelled || clearVersion !== getSessionClearVersion();
    if (!user?.login) {
      setSessions([]);
      setActiveId('');
      hydratedRef.current = true;
      setSessionLoading(false);
      return;
    }
    const login = user.login;
    void (async () => {
      let index = await loadSessionIndex(login);
      if (isStale()) return;
      if (!index?.sessions?.length) {
        try {
          const legacyRaw = legacyKey ? localStorage.getItem(legacyKey) : null;
          if (legacyRaw) {
            const legacy = JSON.parse(legacyRaw) as { messages?: UiChatMessage[]; repo?: RepoContext | null };
            const migrated = newSession();
            const legacyMessages = Array.isArray(legacy.messages) ? migrateLegacyRoundLimit(legacy.messages) : [];
            migrated.messages = legacyMessages;
            migrated.repo = legacy.repo || null;
            migrated.title = deriveSessionTitle(legacyMessages);
            migrated.titleSource = 'auto';
            const saved = await saveSessionMessages(login, migrated.id, legacyMessages, 0, messageForStorage);
            if (isStale()) return;
            if (!saved.ok) throw new Error(saved.error);
            const migratedIndex = { sessions: [toSessionMeta(migrated)], activeId: migrated.id };
            const savedIndex = await saveSessionIndex(login, migratedIndex);
            if (isStale()) return;
            if (!savedIndex.ok) throw new Error(savedIndex.error);
            index = migratedIndex;
            if (legacyKey) localStorage.removeItem(legacyKey);
          }
        } catch {
          // ignore
        }
      }
      const metas = (index?.sessions?.length ? index.sessions : [toSessionMeta(newSession())])
        .map(meta => {
          const looksLikePrompt = /^(请|帮我|请帮我|解释|阅读|分析|Actions|README|写一个)/.test(meta.title);
          const titleSource: 'auto' | 'manual' = meta.titleSource === 'manual' && !looksLikePrompt ? 'manual' : 'auto';
          return { ...meta, titleSource };
        });
      const nextActive = index?.activeId && metas.some(meta => meta.id === index?.activeId)
        ? index.activeId
        : metas[0].id;
      // 只有当前会话的消息进入内存，其余会话等待切换时再加载
      if (!index) unsavedPlaceholder.current = nextActive;
      const rawMessages = index ? await loadSessionMessages(login, nextActive) : EMPTY_MESSAGES;
      const loadedMessages = migrateLegacyRoundLimit(rawMessages);
      if (isStale()) return;
      loadedSessionsRef.current.add(nextActive);
      durableMessagesRef.current.set(nextActive, rawMessages);
      if (index) durableIndexRef.current = JSON.stringify(index);
      setSessions(metas.map(meta => ({
        ...meta,
        messages: meta.id === nextActive ? loadedMessages : [],
      })));
      setActiveId(nextActive);
      hydratedRef.current = true;
      setSessionLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.login, legacyKey, clearVersion, resetAttachments]);
  useLayoutEffect(() => {
    if (!hydratedRef.current || !user?.login || !activeId || isClearingSessions()) return;
    const login = user.login;
    const only = sessions.length === 1 ? sessions[0] : undefined;
    if (only?.id === unsavedPlaceholder.current && !only.messages.length && !only.repo && !only.model && !only.modelType) return;
    const flush = () => {
      if (pendingSessionSaveRef.current !== flush) return;
      pendingSessionSaveRef.current = null;
      const changed = sessions.filter(session => loadedSessionsRef.current.has(session.id)
        && deletingSessionRef.current !== session.id
        && durableMessagesRef.current.get(session.id) !== session.messages
        && queuedMessagesRef.current.get(session.id) !== session.messages);
      for (const session of changed) queuedMessagesRef.current.set(session.id, session.messages);
      const index = { sessions: sessions.map(toSessionMeta), activeId };
      const retiredImages = new Set<string>();
      sessionWritesRef.current = queueSessionWrite(login, async () => {
        let failure = '';
        let fallback = false;
        for (const session of changed) {
          const previous = durableMessagesRef.current.get(session.id) || EMPTY_MESSAGES;
          let firstChanged = 0;
          while (firstChanged < Math.min(previous.length, session.messages.length)
            && previous[firstChanged] === session.messages[firstChanged]) firstChanged++;
          const result = await saveSessionMessages(login, session.id, session.messages, firstChanged, messageForStorage);
          if (queuedMessagesRef.current.get(session.id) === session.messages) queuedMessagesRef.current.delete(session.id);
          if (result.ok) {
            durableMessagesRef.current.set(session.id, session.messages);
            if (firstChanged < previous.length) {
              const kept = sessionImageIds(session.messages.slice(firstChanged));
              for (const id of sessionImageIds(previous.slice(firstChanged))) {
                if (!kept.has(id)) retiredImages.add(id);
              }
            }
          } else {
            failure = result.error || i18n.t('会话保存失败，可能存储空间不足');
          }
          fallback ||= Boolean(result.fallback);
        }
        const serializedIndex = JSON.stringify(index);
        if (!failure && serializedIndex !== durableIndexRef.current) {
          const result = await saveSessionIndex(login, index);
          if (result.ok) durableIndexRef.current = serializedIndex;
          else failure = result.error || i18n.t('会话保存失败，可能存储空间不足');
          fallback ||= Boolean(result.fallback);
        }
        sessionWriteFailure.current = failure;
        setStorageError(failure || (fallback ? i18n.t('存储受限，已使用兼容模式保存') : ''));
        if (!visibleRef.current || changed.some(session => session.id !== activeSessionIdRef.current)) {
          setSaveRevision(revision => revision + 1);
        }
      });
      void sessionWritesRef.current.then(() => collectSessionImages(retiredImages)).catch(() => {});
    };
    pendingSessionSaveRef.current = flush;
    const timer = window.setTimeout(flush, 300);
    return () => window.clearTimeout(timer);
  }, [sessions, activeId, user?.login]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (!visible) pendingSessionSaveRef.current?.();
    const evicted = new Set<string>();
    for (const session of sessions) {
      if (session.id === activeId && (visible || streaming || abortRef.current || verificationRef.current || sessionLoading)) continue;
      if (!session.messages.length || durableMessagesRef.current.get(session.id) !== session.messages) continue;
      evicted.add(session.id);
      loadedSessionsRef.current.delete(session.id);
      durableMessagesRef.current.delete(session.id);
    }
    if (evicted.size) {
      setSessions(current => current.map(session => evicted.has(session.id) && !loadedSessionsRef.current.has(session.id)
        ? { ...session, messages: EMPTY_MESSAGES } : session));
    }
  }, [activeId, saveRevision, sessionLoading, sessions, streaming, visible]);

  useLayoutEffect(() => {
    const save = () => pendingSessionSaveRef.current?.();
    const onVisibility = () => { if (document.visibilityState === 'hidden') save(); };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!user?.login || !activeId) {
      setResumableSnapshot(null);
      return;
    }
    let active = true;
    setResumableSnapshot(null);
    void latestRunSnapshot(user.login, activeId).then(snapshot => {
      if (active) setResumableSnapshot(snapshot);
    });
    return () => { active = false; };
  }, [user?.login, activeId]);

  useEffect(() => {
    return () => {
      approvalResolverRef.current?.(false);
      approvalResolverRef.current = null;
      abortRef.current?.abort();
      verificationRef.current?.abort();
      if (abortRef.current) setAndroidTask(abortRef.current);
      if (streamFlushTimerRef.current !== null) window.clearTimeout(streamFlushTimerRef.current);
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    };
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    if (!visibleRef.current || (!force && !stickToBottomRef.current)) return;
    forceScroll.current ||= force;
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const shouldScroll = forceScroll.current || stickToBottomRef.current;
      forceScroll.current = false;
      const el = scrollRef.current;
      if (!el || !shouldScroll) return;
      el.scrollTop = el.scrollHeight;
      setShowScrollButton(false);
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streaming, scrollToBottom]);

  // 只滚动消息容器，避免浏览器为焦点自动平移页面时同它争用。
  const virtualTotalSize = virtualizer.getTotalSize();
  useEffect(() => {
    scrollToBottom();
  }, [nativeViewportHeight, virtualTotalSize, scrollToBottom]);

  useEffect(() => {
    if (isAndroid || !visible || typeof ResizeObserver === 'undefined' || !scrollRef.current) return;
    const observer = new ResizeObserver(() => scrollToBottom());
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [isAndroid, visible, scrollToBottom]);

  useLayoutEffect(() => {
    if (!visible) {
      restoreScroll.current = true;
      return;
    }
    if (!restoreScroll.current || sessionLoading || !loadedSessionsRef.current.has(activeId)) return;
    restoreScroll.current = false;
    const offset = scrollOffsets.current.get(activeId);
    if (offset === undefined || stickToBottomRef.current) scrollToBottom();
    else virtualizer.scrollToOffset(offset);
  }, [activeId, messages, scrollToBottom, sessionLoading, virtualizer, visible]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || !visible || sessionLoading || restoreScroll.current) return;
    scrollOffsets.current.set(activeId, el.scrollTop);
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    stickToBottomRef.current = nearBottom;
    setShowScrollButton(!nearBottom);
  };

  const resolveApproval = useCallback((approved: boolean) => {
    approvalResolverRef.current?.(approved);
  }, []);

  const requestApproval = useCallback((request: ApprovalRequest, signal: AbortSignal) => {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      const onAbort = () => finish(false);
      const finish = (approved: boolean) => {
        signal.removeEventListener('abort', onAbort);
        approvalResolverRef.current = null;
        setApprovalRequest(null);
        resolve(approved);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      approvalResolverRef.current = finish;
      setApprovalRequest(request);
      if (!visibleRef.current) toast.info(i18n.t('AI 助手正在等待写入确认'));
    });
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

  const updateActiveSession = useCallback((
    updater: (session: V2Session) => V2Session,
  ) => {
    setSessions(prev => prev.map(session => session.id === activeId ? updater(session) : session));
  }, [activeId]);

  const setMessages = useCallback((
    updater: UiChatMessage[] | ((previous: UiChatMessage[]) => UiChatMessage[]),
    streamDelta = false,
  ) => {
    updateActiveSession(session => {
      const nextMessages = typeof updater === 'function' ? updater(session.messages) : updater;
      if (nextMessages === session.messages) return session;
      const previousLast = session.messages[session.messages.length - 1];
      const nextLast = nextMessages[nextMessages.length - 1];
      if (streamDelta && nextLast !== previousLast && nextLast?.id === previousLast?.id) {
        retainTurnsForLastMessage(session.messages, nextMessages);
      }
      return {
        ...session,
        messages: nextMessages,
        title: streamDelta || session.titleSource === 'manual' ? session.title : deriveSessionTitle(nextMessages),
        titleSource: session.titleSource || 'auto',
        updatedAt: streamDelta ? session.updatedAt : new Date().toISOString(),
      };
    });
  }, [updateActiveSession]);

  const setRepoContext = useCallback((repo: RepoContext | null) => {
    if (abortRef.current) return;
    updateActiveSession(session => ({
      ...session,
      repo,
      updatedAt: new Date().toISOString(),
    }));
  }, [updateActiveSession]);

  const patchAssistant = useCallback((id: string, patch: Partial<UiChatMessage>) => {
    setMessages(prev => prev.map(message => message.id === id ? { ...message, ...patch } : message));
  }, [setMessages]);

  const patchMetrics = useCallback((id: string, patch: NonNullable<UiChatMessage['metrics']>) => {
    setMessages(prev => prev.map(message => message.id === id
      ? { ...message, metrics: { ...message.metrics, ...patch } }
      : message));
  }, [setMessages]);

  const flushStreamDelta = useCallback(() => {
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }
    const pending = pendingStreamRef.current;
    pendingStreamRef.current = null;
    if (!pending) return;
    setMessages(prev => {
      const lastIndex = prev.length - 1;
      const index = prev[lastIndex]?.id === pending.assistantId
        ? lastIndex : prev.findIndex(message => message.id === pending.assistantId);
      if (index < 0) return prev;
      const message = prev[index];
      let blocks = message.blocks;
      if (pending.content) blocks = appendBlockDelta(blocks, 'text', pending.content);
      if (pending.reasoning) blocks = appendBlockDelta(blocks, 'reasoning', pending.reasoning);
      const next = prev.slice();
      next[index] = {
        ...message,
        content: pending.content ? message.content + pending.content : message.content,
        reasoning: pending.reasoning ? (message.reasoning || '') + pending.reasoning : message.reasoning,
        blocks,
      };
      return next;
    }, true);
  }, [setMessages]);

  const queueStreamDelta = useCallback((id: string, patch: { content?: string; reasoning?: string }) => {
    if (pendingStreamRef.current && pendingStreamRef.current.assistantId !== id) {
      flushStreamDelta();
    }
    const pending = pendingStreamRef.current || { assistantId: id, content: '', reasoning: '' };
    pending.content += patch.content || '';
    pending.reasoning += patch.reasoning || '';
    pendingStreamRef.current = pending;
    if (streamFlushTimerRef.current === null) {
      streamFlushTimerRef.current = window.setTimeout(() => {
        streamFlushTimerRef.current = null;
        flushStreamDelta();
      }, STREAM_FLUSH_MS);
    }
  }, [flushStreamDelta]);

  /** 运行结束时把仍在执行中的工具标成已停止，避免一直转圈 */
  const settleRunningTools = useCallback((assistantId: string) => {
    setMessages(prev => prev.map(message => {
      if (message.id !== assistantId) return message;
      const tools = message.tools || [];
      if (!tools.some(tool => tool.status === 'running')) return message;
      return {
        ...message,
        tools: tools.map(tool => (tool.status === 'running'
          ? { ...tool, status: 'error' as const, content: tool.content || i18n.t('已停止'), endedAt: tool.endedAt || Date.now() }
          : tool)),
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
        if (runMetricsRef.current?.runId === runId && !runMetricsRef.current.firstTokenAt) {
          runMetricsRef.current.firstTokenAt = Date.now();
          patchMetrics(assistantId, { firstTokenMs: runMetricsRef.current.firstTokenAt - runMetricsRef.current.startedAt });
        }
        queueStreamDelta(assistantId, { content: event.text });
        break;
      case 'reasoning_delta':
        if (runMetricsRef.current?.runId === runId && !runMetricsRef.current.firstTokenAt) {
          runMetricsRef.current.firstTokenAt = Date.now();
          patchMetrics(assistantId, { firstTokenMs: runMetricsRef.current.firstTokenAt - runMetricsRef.current.startedAt });
        }
        queueStreamDelta(assistantId, { reasoning: event.text });
        break;
      case 'tool_start':
        flushStreamDelta();
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
              blocks: appendToolBlock(ensureBlocks(message), event.call.id),
            }
          : message));
        break;
      case 'tool_end':
        flushStreamDelta();
        patchTool(assistantId, event.call.id, {
          status: event.ok ? 'done' : 'error',
          content: event.content,
          artifact: event.artifact,
          endedAt: Date.now(),
        });
        break;
      case 'usage':
        patchMetrics(assistantId, {
          promptTokens: event.usage.prompt_tokens,
          completionTokens: event.usage.completion_tokens,
          totalTokens: event.usage.total_tokens,
        });
        break;
      case 'error':
        flushStreamDelta();
        patchAssistant(assistantId, {
          errorDetail: event.message,
          streaming: false,
          error: true,
        });
        if (runMetricsRef.current?.runId === runId) {
          patchMetrics(assistantId, { durationMs: Date.now() - runMetricsRef.current.startedAt });
        }
        break;
      case 'done':
        flushStreamDelta();
        patchAssistant(assistantId, { streaming: false });
        if (runMetricsRef.current?.runId === runId) {
          patchMetrics(assistantId, { durationMs: Date.now() - runMetricsRef.current.startedAt });
        }
        if (user?.login) void clearRunSnapshot(user.login, runId);
        setResumableSnapshot(null);
        break;
      default:
        break;
    }
  }, [flushStreamDelta, patchAssistant, patchMetrics, patchTool, queueStreamDelta, setMessages, user?.login]);

  const persistRunSnapshot = useCallback((
    runId: string,
    assistantId: string,
    sessionId: string,
    title: string,
    binding: ReturnType<typeof runBinding>,
  ) => async (snapshot: AgentCheckpoint) => {
    if (!user?.login) return false;
    if (!snapshot.toolCalls || snapshot.writeInFlight) {
      pendingSessionSaveRef.current?.();
      await sessionWritesRef.current;
      if (sessionWriteFailure.current) return false;
    }
    const saved = await saveRunSnapshot(user.login, {
      ...snapshot,
      runId,
      assistantId,
      sessionId,
      title,
      binding,
      capabilities: runCapabilitiesRef.current,
      savedAt: new Date().toISOString(),
    });
    if (!saved || !snapshot.taskMemory) return saved;
    const taskProgress = snapshot.taskMemory.progress;
    if (snapshot.finished) {
      flushSync(() => {
        flushStreamDelta();
        patchAssistant(assistantId, { taskProgress });
      });
      pendingSessionSaveRef.current?.();
      await sessionWritesRef.current;
      if (sessionWriteFailure.current) return false;
    } else {
      patchAssistant(assistantId, { taskProgress });
    }
    return true;
  }, [flushStreamDelta, patchAssistant, user?.login]);

  const addAttachment = useCallback((attachment: UiAttachment) => {
    const current = draftAttachments.current;
    if (current.length >= MAX_ATTACHMENTS) {
      toast.warning(i18n.t('最多添加 {{count}} 个附件', { count: MAX_ATTACHMENTS }));
      return false;
    }
    if (current.some(item => (item.path || item.name) === (attachment.path || attachment.name))) {
      toast.warning(i18n.t('该文件已经添加'));
      return false;
    }
    setAttachments([...current, attachment]);
    return true;
  }, [setAttachments]);

  const handleLocalFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const generation = draftGeneration.current;
    const candidates = Array.from(files).slice(0, MAX_ATTACHMENTS);
    for (const file of candidates) {
      if (generation !== draftGeneration.current) return;
      if (file.type.startsWith('image/')) {
        if (!modelCapabilities.supportsVision) {
          toast.error(i18n.t('当前模型不支持图片，请切换到 Gemini 或 GPT-4o 等视觉模型'));
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          toast.error(i18n.t('{{name}} 超过 5 MB', { name: file.name }));
          continue;
        }
        try {
          const prepared = await prepareImageAttachment(file);
          const imageId = makeAttachmentId('image');
          if (generation !== draftGeneration.current) return;
          const added = addAttachment({
            id: imageId,
            name: file.name,
            source: 'local',
            kind: 'image',
            size: prepared.size,
            content: '',
            thumbDataUrl: prepared.thumbDataUrl,
            width: prepared.width,
            height: prepared.height,
          });
          if (added) draftImages.current.set(imageId, prepared.blob);
        } catch {
          toast.error(i18n.t('图片处理失败：{{name}}', { name: file.name }));
        }
        continue;
      }
      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        if (file.size > MAX_PDF_BYTES) {
          toast.error(i18n.t('{{name}} 超过 10 MB', { name: file.name }));
          continue;
        }
        try {
          const extracted = await extractPdfText(await file.arrayBuffer());
          if (!extracted.trim()) {
            toast.warning(i18n.t('{{name}} 没有可提取的文本（可能是扫描件）', { name: file.name }));
            continue;
          }
          addAttachment({
            id: makeAttachmentId('pdf'),
            name: file.name,
            source: 'local',
            size: file.size,
            content: `[PDF 文本提取]\n${extracted}`,
          });
        } catch {
          toast.error(i18n.t('PDF 解析失败：{{name}}', { name: file.name }));
        }
        continue;
      }
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

  const handleSend = async (options?: { text?: string; attachments?: UiAttachment[]; editTargetId?: string }) => {
    const text = (options?.text ?? input).trim();
    const attachments = options ? (options.attachments ?? []) : pendingAttachments;
    if ((!text && !attachments.length) || isClearingSessions() || deletingSessionRef.current || abortRef.current || sessionLoading || !activeSession || !hydratedRef.current) return;
    if (resumableSnapshot?.sessionId === activeId && resumableSnapshot.writeInFlight) {
      toast.warning(i18n.t('请先核对上次仓库写入的结果'));
      return;
    }
    if (attachments.some(item => item.kind === 'image') && !modelCapabilities.supportsVision) {
      toast.error(i18n.t('当前模型不支持图片，请切换到视觉模型'));
      return;
    }
    if (!token) {
      toast.error(i18n.t('登录状态已失效，请重新登录'));
      return;
    }
    if (!hasModelKey || needsCustomEndpoint) {
      navigate('/ai-settings/model');
      toast.error(needsCustomEndpoint ? i18n.t('请先填写接口地址') : i18n.t('请先配置模型 API Key'));
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setResumableSnapshot(null);
    const stagedImages: string[] = [];
    let attachmentsCommitted = false;
    try {
      if (user?.login && await hasUnresolvedRunWrite(user.login, activeId)) {
        setResumableSnapshot(await latestRunSnapshot(user.login, activeId));
        toast.warning(i18n.t('请先核对上次仓库写入的结果'));
        return;
      }
      if (controller.signal.aborted) return;
      const userText = text || i18n.t('请查看附件');
      const savedAttachments: UiAttachment[] = [];
      for (const attachment of attachments) {
        const blob = draftImages.current.get(attachment.id);
        if (!blob) {
          savedAttachments.push(attachment);
        } else if (await putImageBlob(attachment.id, blob)) {
          stagedImages.push(attachment.id);
          savedAttachments.push({ ...attachment, imageBlobId: attachment.id });
        } else {
          savedAttachments.push({ ...attachment, dataUrl: await readFileAsDataUrl(blob) });
        }
      }
      const hydratedAttachments = await hydrateAttachmentImages(savedAttachments);
      const modelContent = buildModelUserParts(userText, hydratedAttachments);
      const displayText = text || `${i18n.t('请查看附件')}：${attachments.map(item => item.path || item.name).join('、')}`;
      if (controller.signal.aborted) return;
      const now = new Date().toISOString();
      const scope = taskMemoryScope(repoContext);
      const userMessage: UiChatMessage = {
        id: makeId('user'),
        role: 'user',
        taskScope: scope,
        content: displayText,
        attachments: savedAttachments.length ? savedAttachments : undefined,
        createdAt: now,
      };
      const assistantId = makeId('assistant');
      const assistantMessage: UiChatMessage = {
        id: assistantId,
        role: 'assistant',
        taskScope: scope,
        content: '',
        reasoning: '',
        tools: [],
        blocks: [],
        streaming: true,
        metrics: { model: effectiveConfig.model },
        createdAt: now,
      };

      const targetId = options?.editTargetId ?? editTargetId ?? undefined;
      const targetIndex = targetId ? messages.findIndex(message => message.id === targetId) : -1;
      const baseMessages = targetIndex >= 0 ? messages.slice(0, targetIndex) : messages;
      const scopeHistory = scopedTaskHistory(baseMessages, scope);
      // 大图只为最近消息回填，较早的文字与任务记录仍可进入上下文。
      const historyMessages = await hydrateMessageImages(scopeHistory.slice(-20));
      if (controller.signal.aborted) return;
      const previousHistory = toAgentHistory([
        ...scopeHistory.slice(0, -20).map(({ role, content }) => ({ role, content })),
        ...historyMessages,
      ]);
      const taskMemory = createTaskMemory(baseMessages, userText, repoContext);
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      runCapabilitiesRef.current = [];
      startRun({
        login: user?.login,
        id: runId,
        sessionId: activeSession?.id,
        title: text || `${i18n.t('附件')} ${attachments[0]?.name || ''}`,
      });
      flushSync(() => {
        setMessages([...baseMessages, userMessage, assistantMessage]);
        setInput('');
        resetAttachments();
        setEditTargetId(null);
      });
      attachmentsCommitted = true;
      stickToBottomRef.current = true;
      setAndroidTask(controller, i18n.t('AI 助手正在执行任务'));
      runMetricsRef.current = { runId, startedAt: Date.now() };

      const onEvent = (event: AgentEvent) => handleAgentEvent(assistantId, runId, event);

      const history = previousHistory;
      let runStatus: 'done' | 'error' | 'stopped' = 'done';
      let runError: string | undefined;

      try {
        await runGeneralAgent({
          token,
          userLogin: user?.login,
          runId,
          repo: repoContext || undefined,
          config: effectiveConfig,
          history,
          taskMemory,
          taskHistory: () => historicalTaskActivity(scopeHistory),
          currentUserContent: modelContent,
          currentUserText: userText,
          contextBudget: Math.min(v2Settings.contextBudget, modelCapabilities.contextWindow),
          memoryEnabled: v2Settings.memoryEnabled,
          persona: character.prompt,
          signal: controller.signal,
          requestApproval,
          onSnapshot: persistRunSnapshot(runId, assistantId, activeSession.id, text, binding),
          onEvent,
        });
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          runStatus = 'stopped';
          patchAssistant(assistantId, { streaming: false });
        } else {
          let message = (error as Error)?.message || String(error);

          // OpenRouter 免费额度用尽：无仓库上下文时自动切到 Cloudflare Workers AI 免费额度。
          const fallbackProxy = modelConfig.proxy_url?.trim().replace(/\/+$/, '') || '';
          if (!controller.signal.aborted && isOpenRouterDailyLimit(message) && effectiveConfig.type === 'openrouter' && !repoContext && fallbackProxy) {
            toast.info(i18n.t('OpenRouter 免费额度已用尽，正在切换 Cloudflare AI 重试'));
            patchAssistant(assistantId, {
              content: `> ${i18n.t('OpenRouter 免费额度已用尽，已切换到 Cloudflare AI 重试。')}\n\n`,
              reasoning: '',
              tools: [],
              blocks: [],
              streaming: true,
              error: false,
            });
            try {
              await runGeneralAgent({
                token,
                userLogin: user?.login,
                runId,
                config: { ...CLOUDFLARE_FALLBACK_CONFIG, proxy_url: fallbackProxy },
                history,
                taskMemory,
                currentUserContent: modelContent,
                currentUserText: userText,
                contextBudget: Math.min(v2Settings.contextBudget, modelCapabilities.contextWindow),
                memoryEnabled: v2Settings.memoryEnabled,
                persona: character.prompt,
                signal: controller.signal,
                requestApproval,
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
            const failureText = `${i18n.t('请求失败：')}${friendlyModelError(message)}`;
            patchAssistant(assistantId, {
              errorDetail: failureText,
              streaming: false,
              error: true,
            });
            toast.error(friendlyModelError(message).slice(0, 160));
          }
        }
      } finally {
        flushStreamDelta();
        settleRunningTools(assistantId);
        finishRun(user?.login, runId, runStatus, runError);
        if (runStatus !== 'done' && user?.login) {
          void latestRunSnapshot(user.login, activeSession?.id).then(snapshot => setResumableSnapshot(snapshot));
        }
        pendingSessionSaveRef.current?.();
        scrollToBottom(true);
      }
    } catch (error) {
      if (!controller.signal.aborted) toast.error((error as Error).message);
    } finally {
      if (!attachmentsCommitted) void Promise.all(stagedImages.map(deleteImageBlob));
      setStreaming(false);
      abortRef.current = null;
      setAndroidTask(controller);
    }
  };

  const handleEditUser = useCallback((message: UiChatMessage) => {
    if (abortRef.current || isClearingSessions()) return;
    setInput(message.content);
    draftGeneration.current++;
    setAttachments(message.attachments || []);
    setEditTargetId(message.id);
  }, [setAttachments]);

  const sendRef = useRef(handleSend);
  useLayoutEffect(() => { sendRef.current = handleSend; }, [handleSend]);

  const handleRegenerate = useCallback((userMessage: UiChatMessage) => {
    if (abortRef.current) return;
    void sendRef.current({
      text: userMessage.content,
      attachments: userMessage.attachments,
      editTargetId: userMessage.id,
    });
  }, []);
  const handleVerifyWrite = async () => {
    const snapshot = resumableSnapshot;
    const pending = snapshot?.pendingWrite;
    if (isClearingSessions() || deletingSessionRef.current || !snapshot || !pending?.verification || !token || !user?.login || verificationRef.current
      || snapshot.sessionId !== activeId) return;
    const controller = new AbortController();
    verificationRef.current = controller;
    setCheckingWrite(true);
    try {
      if (!await verifyGitHubWrite(pending.verification, token, controller.signal)) {
        toast.warning(i18n.t('远端状态尚未匹配，任务仍暂停'));
        return;
      }
      if (controller.signal.aborted) return;
      const resultText = '已在 GitHub 核对目标状态；该写入不再执行。';
      const verified: RunSnapshot = {
        ...snapshot,
        writeInFlight: false,
        pendingWrite: undefined,
        taskMemory: snapshot.taskMemory ? recordTaskActivity({
          ...snapshot.taskMemory,
          progress: {
            ...snapshot.taskMemory.progress,
            pending: snapshot.taskMemory.progress.pending?.filter(item => item.id !== pending.callId),
          },
        }, {
          id: pending.callId, name: pending.tool, arguments: JSON.stringify(pending.verification),
        }, true, resultText) : undefined,
        completedWrites: [...(snapshot.completedWrites || []), pending.id],
        messages: snapshot.messages.map(message => message.tool_call_id === pending.callId
          ? { ...message, content: resultText }
          : message),
      };
      if (!await saveRunSnapshot(user.login, verified)) throw new Error('无法保存核对结果');
      if (snapshot.assistantId) {
        patchTool(snapshot.assistantId, pending.callId, { status: 'done', content: resultText, endedAt: Date.now() });
        if (verified.taskMemory) patchAssistant(snapshot.assistantId, { taskProgress: verified.taskMemory.progress });
      }
      setResumableSnapshot(current => current?.runId === snapshot.runId ? verified : current);
      toast.success(i18n.t('已核对远端写入结果'));
    } catch (error) {
      if (!controller.signal.aborted) toast.error((error as Error).message);
    } finally {
      verificationRef.current = null;
      setCheckingWrite(false);
    }
  };

  const handleResume = async () => {
    const snapshot = resumableSnapshot;
    if (!snapshot || isClearingSessions() || deletingSessionRef.current || abortRef.current || sessionLoading || !token || !user?.login || snapshot.sessionId !== activeId) return;
    if (!snapshot.binding || snapshot.writeInFlight || JSON.stringify(snapshot.binding) !== JSON.stringify(binding)) {
      toast.warning(i18n.t('恢复任务需保持原仓库、分支和模型。存在未确认写入时，请先在 GitHub 核对结果。'));
      return;
    }
    const assistantId = snapshot.assistantId;
    const assistantExists = assistantId && messages.some(message => message.id === assistantId);
    if (!assistantId || !assistantExists) {
      toast.error(i18n.t('原会话消息已不存在，无法继续'));
      return;
    }

    setResumableSnapshot(null);
    setStreaming(true);
    patchAssistant(assistantId, { streaming: true, error: false, errorDetail: undefined, metrics: { model: effectiveConfig.model } });
    runCapabilitiesRef.current = snapshot.capabilities;
    runMetricsRef.current = { runId: snapshot.runId, startedAt: Date.now() };
    if (user?.login) resumeRun(user.login, snapshot.runId);

    const controller = new AbortController();
    abortRef.current = controller;
    setAndroidTask(controller, i18n.t('AI 助手正在执行任务'));
    const onEvent = (event: AgentEvent) => handleAgentEvent(assistantId, snapshot.runId, event);
    let runStatus: 'done' | 'error' | 'stopped' = 'done';
    let runError: string | undefined;

    try {
      await runGeneralAgent({
        token,
        userLogin: user?.login,
        runId: snapshot.runId,
        repo: repoContext || undefined,
        config: effectiveConfig,
        history: [],
        taskMemory: snapshot.taskMemory || createTaskMemory(
          messages.slice(0, messages.findIndex(message => message.id === assistantId) + 1),
          snapshot.title, repoContext,
        ),
        taskHistory: () => historicalTaskActivity(scopedTaskHistory(
          messages.slice(0, messages.findIndex(message => message.id === assistantId) + 1),
          taskMemoryScope(repoContext),
        )),
        resumeMessages: snapshot.messages,
        resumeSteps: snapshot.steps,
        resumeToolCalls: snapshot.toolCalls,
        completedWrites: snapshot.completedWrites,
        contextBudget: Math.min(v2Settings.contextBudget, modelCapabilities.contextWindow),
        memoryEnabled: v2Settings.memoryEnabled,
        persona: character.prompt,
        signal: controller.signal,
        requestApproval,
        onSnapshot: persistRunSnapshot(snapshot.runId, assistantId, activeId, snapshot.title, snapshot.binding),
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
        const failureText = `${i18n.t('恢复失败：')}${friendlyModelError(message)}`;
        patchAssistant(assistantId, {
          errorDetail: failureText,
          streaming: false,
          error: true,
        });
        toast.error(friendlyModelError(message).slice(0, 160));
      }
    } finally {
      flushStreamDelta();
      settleRunningTools(assistantId);
      finishRun(user?.login, snapshot.runId, runStatus, runError);
      if (runStatus !== 'done' && user?.login) {
        void latestRunSnapshot(user.login, activeSession?.id).then(snapshot => setResumableSnapshot(snapshot));
      }
      pendingSessionSaveRef.current?.();
      setStreaming(false);
      abortRef.current = null;
      setAndroidTask(controller);
      scrollToBottom(true);
    }
  };

  const handleStop = () => {
    flushStreamDelta();
    pendingStreamRef.current = null;
    if (streamFlushTimerRef.current !== null) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = null;
    }
    approvalResolverRef.current?.(false);
    approvalResolverRef.current = null;
    setApprovalRequest(null);
    abortRef.current?.abort();
  };

  const handleNewSession = () => {
    if (streaming || sessionLoading || isClearingSessions() || deletingSessionRef.current) return;
    if (activeSession && loadedSessionsRef.current.has(activeSession.id) && activeSession.messages.length === 0) {
      setSessionDialogOpen(false);
      scrollToBottom(true);
      return;
    }
    const session = newSession();
    loadedSessionsRef.current.add(session.id);
    setSessions([session, ...sessions]);
    setActiveId(session.id);
    setInput('');
    resetAttachments();
    setSessionDialogOpen(false);
    scrollToBottom(true);
  };
  const handleSelectSession = (id: string) => {
    if (streaming || isClearingSessions() || deletingSessionRef.current) return;
    setSessionDialogOpen(false);
    resetAttachments();
    stickToBottomRef.current = true;
    if (id !== activeId) setActiveId(id);
    scrollToBottom(true);
  };

  useLayoutEffect(() => {
    if (!visible) {
      if (hydratedRef.current) setSessionLoading(false);
      return;
    }
    if (!hydratedRef.current || !user?.login || !activeId || isClearingSessions()) return;
    if (loadedSessionsRef.current.has(activeId)) {
      setSessionLoading(false);
      return;
    }
    const login = user.login;
    const sequence = ++sessionLoadSequence.current;
    setSessionLoading(true);
    void loadSessionMessages(login, activeId)
      .then(rawMessages => {
        if (sessionLoadSequence.current !== sequence) return;
        const nextMessages = migrateLegacyRoundLimit(rawMessages);
        loadedSessionsRef.current.add(activeId);
        durableMessagesRef.current.set(activeId, rawMessages);
        setSessions(prev => prev.map(session => session.id === activeId
          ? {
              ...session,
              messages: nextMessages,
              title: session.titleSource === 'manual' ? session.title : deriveSessionTitle(nextMessages) || session.title,
            }
          : session));
      })
      .finally(() => { if (sessionLoadSequence.current === sequence) setSessionLoading(false); });
    return () => { sessionLoadSequence.current++; };
  }, [activeId, user?.login, visible]);

  const handleSelectModel = (type: string, model: string) => {
    if (abortRef.current || sessionLoading) return;
    updateActiveSession(session => ({
      ...session,
      modelType: type,
      model,
      updatedAt: new Date().toISOString(),
    }));
    toast.success(i18n.t('已切换当前会话模型'));
  };

  const handleRenameSession = (id: string, title: string) => {
    const nextTitle = title.trim().slice(0, 80);
    if (!nextTitle) return;
    setSessions(prev => prev.map(session => session.id === id
      ? { ...session, title: nextTitle, titleSource: 'manual', updatedAt: new Date().toISOString() }
      : session));
    toast.success(i18n.t('对话已重命名'));
  };

  const handleExportSession = async (id: string) => {
    const login = user?.login;
    const session = sessions.find(item => item.id === id);
    if (!login || !session || !hydratedRef.current || sessionExportRef.current || (streaming && id === activeId)) return;

    const exportController = new AbortController();
    sessionExportRef.current = exportController;
    setExportingId(id);
    try {
      // 未打开的会话在列表中只有元信息。直接读取消息分片，避免切换会话。
      const history = loadedSessionsRef.current.has(id)
        ? session.messages
        : await loadSessionMessages(login, id);
      if (exportController.signal.aborted) return;

      const file = createSessionMarkdown(session, history);
      if (!file) {
        toast.info(i18n.t('该对话没有可导出的消息'));
        return;
      }
      await triggerBlobDownload(file.blob, file.filename);
      if (!exportController.signal.aborted && !isAndroid) toast.success(i18n.t('已发起下载'));
    } catch {
      if (!exportController.signal.aborted) toast.error(i18n.t('导出失败，请稍后重试'));
    } finally {
      if (sessionExportRef.current === exportController) {
        sessionExportRef.current = null;
        if (!exportController.signal.aborted) setExportingId(null);
      }
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (streaming) return;
    const target = sessions.find(session => session.id === id);
    if (!target) return;
    const confirmed = await confirmAction({
      title: i18n.t('删除这段对话？'),
      description: i18n.t('「{{title}}」及其消息将被永久删除，无法恢复。', { title: target.title || i18n.t('新对话') }),
      confirmText: i18n.t('删除'),
    });
    if (!confirmed || abortRef.current || isClearingSessions() || deletingSessionRef.current || !user?.login) return;
    const login = user.login;
    deletingSessionRef.current = id;
    try {
      if (await hasUnresolvedRunWrite(login, id)) {
        toast.warning(i18n.t('请先核对上次仓库写入的结果'));
        return;
      }
      pendingSessionSaveRef.current?.();
      await sessionWritesRef.current;
      const history = loadedSessionsRef.current.has(id) ? target.messages : await loadSessionMessages(login, id);
      await queueSessionWrite(login, () => deleteSessionMessages(login, id));
      loadedSessionsRef.current.delete(id);
      durableMessagesRef.current.delete(id);
      queuedMessagesRef.current.delete(id);
      scrollOffsets.current.delete(id);
      const remaining = sessions.filter(session => session.id !== id);
      const next = remaining.length ? remaining : [newSession()];
      if (!remaining.length) loadedSessionsRef.current.add(next[0].id);
      const nextActive = id === activeId ? next[0].id : activeId;
      if (id === activeId) {
        sessionLoadSequence.current++;
        resetAttachments();
        setInput('');
        setEditTargetId(null);
        setResumableSnapshot(null);
        stickToBottomRef.current = true;
      }
      flushSync(() => {
        setSessions(next);
        setActiveId(nextActive);
      });
      pendingSessionSaveRef.current?.();
      await sessionWritesRef.current;
      await clearRunSnapshots(login, id);
      void collectSessionImages(sessionImageIds(history)).catch(() => {});
    } catch {
      toast.error(i18n.t('清除失败'));
    } finally {
      deletingSessionRef.current = null;
    }
  };

  const handleClear = async () => {
    if (streaming || isClearingSessions() || deletingSessionRef.current) return;
    if (hasConversation) {
      const confirmed = await confirmAction({
        title: i18n.t('清空当前对话？'),
        description: i18n.t('当前对话的所有消息都会被删除，无法恢复。'),
        confirmText: i18n.t('清空'),
      });
      if (!confirmed) return;
    }
    if (abortRef.current || isClearingSessions() || !activeSession?.id || activeSession.id !== activeSessionIdRef.current) return;
    if (user?.login && await hasUnresolvedRunWrite(user.login, activeSession.id)) {
      toast.warning(i18n.t('请先核对上次仓库写入的结果'));
      return;
    }
    if (abortRef.current || isClearingSessions() || activeSession.id !== activeSessionIdRef.current) return;
    setMessages([]);
    setInput('');
    resetAttachments();
    if (user?.login) void clearRunSnapshots(user.login, activeSession.id);
    setResumableSnapshot(null);
  };

  const handleSelectRepo = (repo: GitHubRepo) => {
    setRepoContext({
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      branch: repo.default_branch,
    });
    setRepoDialogOpen(false);
    toast.success(i18n.t('已选择仓库'));
  };

  if (!visible) return null;

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
      className={cn("flex min-h-0 w-full min-w-0 overflow-hidden bg-background", !isAndroid && "h-full flex-1")}
      style={isAndroid ? { height: Math.max(240, nativeViewportHeight - 56) } : undefined}
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
            exportingId={exportingId}
            onSelect={handleSelectSession}
            onRename={handleRenameSession}
            onExport={handleExportSession}
            onDelete={handleDeleteSession}
          />
        </div>
      </aside>

      {/* 主聊天列 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={compactKeyboard ? "flex min-h-0 max-h-[35%] flex-col overflow-y-auto" : "contents"}>
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

          {(!hasModelKey || needsCustomEndpoint) && (
            <button
              type="button"
              onClick={() => navigate('/ai-settings/model')}
              className="mx-2 mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-700 dark:text-amber-300 sm:mx-3"
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span className="flex-1">{needsCustomEndpoint
                ? i18n.t('请先填写接口地址')
                : i18n.t('还没有配置模型，点击选择 DeepSeek / OpenRouter / Gemini')}</span>
              <ChevronRight className="h-4 w-4 shrink-0" />
            </button>
          )}
          {storageError && (
            <div className="mx-2 mt-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive sm:mx-3">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{storageError}</span>
              <button type="button" onClick={() => setStorageError('')} className="shrink-0 opacity-70 hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {resumableSnapshot && resumableSnapshot.sessionId === activeId && resumableSnapshot.taskMemory && !streaming && (
            <details className="mx-2 mt-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs">
              <summary className="cursor-pointer font-medium">{i18n.t('已保存的任务进度')}</summary>
              <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto break-words text-muted-foreground">
                <p className="whitespace-pre-wrap">{resumableSnapshot.taskMemory.goal}</p>
                {resumableSnapshot.taskMemory.progress.activity.slice(-3).map((item, index) => (
                  <p key={`${item.tool}-${index}`}>{item.ok ? '✓' : '×'} {item.tool} {item.target}</p>
                ))}
                {resumableSnapshot.taskMemory.progress.pending?.map(item => (
                  <p key={item.id}>{i18n.t('待执行')} · {item.title}</p>
                ))}
              </div>
            </details>
          )}
          {resumableSnapshot && resumableSnapshot.sessionId === activeId && !streaming && (
            <div className="mx-2 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs sm:mx-3">
              <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">
                {i18n.t('上次运行中断于第 {{step}} 步', { step: resumableSnapshot.steps })}：{resumableSnapshot.title}
              </span>
              {resumableSnapshot.binding && !resumableSnapshot.writeInFlight
                && JSON.stringify(resumableSnapshot.binding) === JSON.stringify(binding) ? (
                  <Button type="button" size="sm" className="h-7 gap-1 px-2 text-[10px]" onClick={() => void handleResume()}>
                    {i18n.t('继续/重试')}
                  </Button>
                ) : (
                  <p className="text-[11px]">
                    {resumableSnapshot.writeInFlight
                      ? i18n.t('上次写入结果未确认，请在 GitHub 核对后再发起任务。')
                      : i18n.t('此恢复点需使用原仓库、分支与模型。旧版恢复点请重新发起任务。')}
                  </p>
                )}
              {resumableSnapshot.writeInFlight && resumableSnapshot.pendingWrite?.verification && (
                <Button type="button" size="sm" variant="outline" disabled={checkingWrite} onClick={() => void handleVerifyWrite()}>
                  {checkingWrite ? i18n.t('正在核对…') : i18n.t('核对 GitHub 状态')}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] text-muted-foreground"
                disabled={checkingWrite}
                onClick={async () => {
                  if (resumableSnapshot.writeInFlight && !await confirmAction({
                    title: i18n.t('放弃恢复这项写入？'),
                    description: i18n.t('请先检查 GitHub 的实际结果。放弃只会移除本地恢复点。'),
                    confirmText: i18n.t('放弃恢复'),
                  })) return;
                  if (user?.login) await clearRunSnapshot(user.login, resumableSnapshot.runId);
                  setResumableSnapshot(current => current?.runId === resumableSnapshot.runId ? null : current);
                }}
              >
                {resumableSnapshot.writeInFlight ? i18n.t('放弃恢复') : i18n.t('忽略')}
              </Button>
            </div>
          )}

        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [overflow-anchor:none]"
        >
          <div className="mx-auto w-full max-w-3xl px-3.5 py-4 sm:px-6">
            {sessionLoading ? (
              <div className="flex min-h-[28vh] items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {i18n.t('正在加载对话…')}
              </div>
            ) : !hasConversation ? (
              <div className="flex min-h-[28vh] flex-col items-center justify-center text-center">
                <h2 className="text-base font-semibold">{i18n.t('开始一段对话')}</h2>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {quickPrompts.map(prompt => (
                    <button
                      key={prompt.label}
                      type="button"
                      onClick={() => setInput(prompt.text)}
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {prompt.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              (() => {
                const virtualItems = virtualizer.getVirtualItems();
                // 极端情况下（容器高度为 0、ResizeObserver 不可用）退化为只渲染最近几轮
                if (!virtualItems.length) {
                  const recent = typeof ResizeObserver === 'undefined' ? turns : turns.slice(-12);
                  return (
                    <div className="space-y-6">
                      {recent.map((turn, index) => (
                        <ConversationTurnView
                          key={turn.id}
                          turn={turn}
                          index={turns.length - recent.length + index}
                          onOpenArtifact={openArtifact}
                          onApplyDiff={handleApplyDiff}
                          onEditUser={handleEditUser}
                          onRegenerate={handleRegenerate}
                          regenerateId={messages[messages.length - 1]?.role === 'assistant' ? messages[messages.length - 1]?.id : undefined}
                        />
                      ))}
                    </div>
                  );
                }
                return (
                  <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
                    {virtualItems.map(item => {
                      const turn = turns[item.index];
                      if (!turn) return null;
                      return (
                        <div
                          key={turn.id}
                          data-index={item.index}
                          ref={virtualizer.measureElement}
                          className="absolute left-0 top-0 w-full pb-6"
                          style={{ transform: `translateY(${item.start}px)` }}
                        >
                          <ConversationTurnView
                            turn={turn}
                            index={item.index}
                            onOpenArtifact={openArtifact}
                            onApplyDiff={handleApplyDiff}
                            onEditUser={handleEditUser}
                            onRegenerate={handleRegenerate}
                            regenerateId={messages[messages.length - 1]?.role === 'assistant' ? messages[messages.length - 1]?.id : undefined}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )}
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

        <div
          className={cn("w-full min-w-0 shrink-0 border-t border-border bg-background/95 px-2 py-2 sm:px-3", compactKeyboard && "max-h-full overflow-y-auto")}
        >
          <div className="mx-auto w-full min-w-0 max-w-3xl">
            <div className="rounded-[22px] border border-border/80 bg-card p-2 shadow-sm transition-colors">
              <div className="mb-1 flex flex-wrap items-center gap-1.5 px-1">
                {repoContext ? (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] text-primary">
                    <GitBranch className="h-3 w-3 shrink-0" />
                    <button type="button" onClick={() => setBranchDialogOpen(true)} className="truncate hover:underline" title={i18n.t('切换分支')}>
                      {repoContext.fullName} · {repoContext.branch || repoContext.defaultBranch}
                    </button>
                    <button type="button" onClick={() => setRepoContext(null)} className="rounded-full p-0.5 hover:bg-primary/10">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRepoDialogOpen(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-3 w-3" />
                    {i18n.t('选择仓库')}
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".txt,.md,.markdown,.json,.jsonc,.yaml,.yml,.toml,.ini,.env,.js,.jsx,.ts,.tsx,.mjs,.cjs,.css,.scss,.html,.htm,.xml,.svg,.vue,.svelte,.py,.go,.rs,.java,.kt,.kts,.gradle,.c,.h,.cpp,.hpp,.cs,.php,.rb,.sh,.bash,.sql,.csv,.log,.pdf,.png,.jpg,.jpeg,.webp,.gif,Dockerfile,Makefile"
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
                      {attachment.kind === 'image' && (attachment.thumbDataUrl || attachment.dataUrl) ? (
                        <img src={attachment.thumbDataUrl || attachment.dataUrl} alt={attachment.name} className="h-5 w-5 shrink-0 rounded object-cover" />
                      ) : attachment.source === 'repo' ? <AtSign className="h-3 w-3 shrink-0 text-primary" /> : <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span className="max-w-[160px] truncate">{attachment.path || attachment.name}</span>
                      <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.size)}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments(prev => prev.filter(item => item.id !== attachment.id))}
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
                disabled={streaming || sessionLoading}
                className="max-h-44 min-h-[42px] resize-none border-0 bg-transparent px-2.5 py-2 text-sm shadow-none outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
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
                  disabled={streaming || sessionLoading}
                  onClick={() => setModelDialogOpen(true)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ModelAvatar modelDef={modelDef} size="sm" />
                  <span className="max-w-[110px] truncate">{modelLabel}</span>
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </button>
                <Button
                  type="button"
                  size="icon"
                  className="ml-auto h-9 w-9 shrink-0 rounded-full"
                  onClick={streaming ? handleStop : () => { void handleSend(); }}
                  disabled={!streaming && (sessionLoading || (!input.trim() && pendingAttachments.length === 0) || !token)}
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
            modelLabel={modelLabel}
            characterLabel={character.name}
            onAddRepo={() => setRepoDialogOpen(true)}
            onRemoveRepo={() => setRepoContext(null)}
            onSwitchBranch={() => setBranchDialogOpen(true)}
          />
        </div>
      </aside>

      <Dialog
        open={visible && Boolean(approvalRequest)}
        onOpenChange={open => {
          if (!open) resolveApproval(false);
        }}
      >
        <DialogContent className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto p-4 md:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              {i18n.t('需要确认写操作')}
            </DialogTitle>
          </DialogHeader>
          {approvalRequest && (() => {
const args = approvalRequest.arguments as Record<string, unknown>;
             const files = Array.isArray(args.files)
               ? args.files as Array<{ path?: unknown; content?: unknown }>
               : [];
             const target = approvalRequest.target;
            return (
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                  {i18n.t('该工具会修改仓库。确认后才会执行，本次允许仅对当前调用有效。')}
                </div>
                <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3 text-xs">
                  <p className="flex items-center gap-1.5 font-mono font-medium"><Wrench className="h-3.5 w-3.5" />{approvalRequest.toolName}</p>
                  <p className="text-[11px] leading-5 text-muted-foreground">{approvalRequest.description}</p>
                  {target && <>
                    <p className="break-all font-mono">{target.repository}</p>
                    {(target.branch || target.baseBranch) && (
                      <p className="break-all">{[target.branch, target.baseBranch].filter(Boolean).join(' → ')}</p>
                    )}
                    {target.pullTitle && <p>{target.pullTitle}</p>}
                    {target.createsBranch && <p>{i18n.t('新建分支')}</p>}
                    {(target.fileSha || target.headSha || target.baseSha) && (
                      <p className="break-all font-mono text-[10px]">{target.fileSha || target.headSha || target.baseSha}</p>
                    )}
                  </>}
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
                  {target?.changes?.map(change => (
                    <details key={change.path} open={target.changes?.length === 1}>
                      <summary className="break-all font-mono">{change.path}</summary>
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 font-mono text-[10px]">{change.diff || i18n.t('无文本变更')}</pre>
                    </details>
                  ))}
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

      <Dialog open={visible && artifactDialogOpen} onOpenChange={setArtifactDialogOpen}>
        <DialogContent className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto p-4 md:max-w-2xl">
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

      <Dialog open={visible && repoDialogOpen} onOpenChange={setRepoDialogOpen}>
        <DialogContent className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto p-4 md:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base">{i18n.t('选择仓库')}</DialogTitle>
          </DialogHeader>
          <p className="-mt-1 text-xs text-muted-foreground">
            {i18n.t('仓库是可选的。选择后会加载只读 GitHub 工具。')}
          </p>
          <RepoSelector onSelect={handleSelectRepo} />
        </DialogContent>
      </Dialog>

      <ModelPickerDialog
        open={visible && modelDialogOpen}
        onOpenChange={setModelDialogOpen}
        providers={pickerProviders}
        currentType={sessionType}
        currentModel={sessionModel}
        capabilities={modelCapabilities}
        onSelect={handleSelectModel}
        onOpenSettings={() => {
          setModelDialogOpen(false);
          navigate('/ai-settings/model');
        }}
      />

      <BranchPickerDialog
        open={visible && branchDialogOpen}
        onOpenChange={setBranchDialogOpen}
        repo={repoContext}
        token={token || ''}
        onSelect={branch => {
          if (!repoContext) return;
          setRepoContext({ ...repoContext, branch });
          toast.success(i18n.t('已切换到分支 {{branch}}', { branch }));
        }}
      />

      <RepoFilePicker
        open={visible && repoFileDialogOpen}
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
        request={visible ? patchRequest : null}
        repo={repoContext}
        token={token || ''}
        onClose={() => setPatchRequest(null)}
      />

      <Sheet open={visible && sessionDialogOpen} onOpenChange={setSessionDialogOpen}>
        <SheetContent side="left" aria-describedby={undefined} className="flex w-[86vw] max-w-sm flex-col gap-0 p-0">
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3 pr-14">
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
              exportingId={exportingId}
              onSelect={handleSelectSession}
              onRename={handleRenameSession}
              onExport={handleExportSession}
              onDelete={handleDeleteSession}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={visible && contextDialogOpen} onOpenChange={setContextDialogOpen}>
        <DialogContent className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto p-4 md:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{i18n.t('会话上下文')}</DialogTitle>
          </DialogHeader>
          <ContextContent
            repo={repoContext}
            modelLabel={modelLabel}
            characterLabel={character.name}
            onAddRepo={() => {
              setContextDialogOpen(false);
              setRepoDialogOpen(true);
            }}
            onRemoveRepo={() => setRepoContext(null)}
            onSwitchBranch={() => {
              setContextDialogOpen(false);
              setBranchDialogOpen(true);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
