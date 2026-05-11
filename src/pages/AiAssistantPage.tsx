// AI 助手页面 v3 - 分支管理 + PR 创建 + 对话历史持久化
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserRepos, getRepoBranches } from '@/services/github';
import { supabase } from '@/db/supabase';
import { sendStreamRequest } from '@/lib/sse';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Bot, User, Send, Square, Trash2, Settings,
  GitBranch, Sparkles, AlertCircle, Search,
  Star, Lock, Globe, ChevronRight, RefreshCw, Eye, EyeOff,
  RotateCw, CheckCircle2, XCircle, Copy, Check, ChevronDown,
  Plus, GitPullRequest, History, MessageSquare, ArrowLeft, Loader2,
  FolderOpen, BookOpen, GitCommit, LayoutDashboard, Pencil, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { GitHubRepo } from '@/types/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const MODEL_CONFIG_KEY = 'ai_assistant_model_config';

// ── 对话历史类型 ───────────────────────────────────────────────────────────────

interface ChatSession {
  id: string;
  github_login: string;
  repo_full_name: string;
  branch: string;
  title: string;
  model_type: string;
  model_name?: string;
  created_at: string;
  updated_at: string;
}

interface ChatSessionMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// 保存会话（新建或更新标题）
async function upsertSession(session: Omit<ChatSession, 'created_at' | 'updated_at'>): Promise<string | null> {
  const { data, error } = await supabase
    .from('ai_chat_sessions')
    .upsert({ ...session }, { onConflict: 'id' })
    .select('id')
    .maybeSingle();
  if (error) { console.error('保存会话失败', error); return null; }
  return data?.id ?? null;
}

// 批量插入消息
async function insertMessages(sessionId: string, msgs: Array<{ role: string; content: string }>): Promise<void> {
  const rows = msgs.map(m => ({ session_id: sessionId, role: m.role, content: m.content }));
  const { error } = await supabase.from('ai_chat_messages').insert(rows);
  if (error) console.error('保存消息失败', error);
}

// 获取指定用户的会话列表（按仓库分组）
async function fetchSessions(login: string): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from('ai_chat_sessions')
    .select('*')
    .eq('github_login', login)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

// 获取会话的消息记录
async function fetchSessionMessages(sessionId: string): Promise<ChatSessionMessage[]> {
  const { data, error } = await supabase
    .from('ai_chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

// 删除会话（级联删消息）
async function deleteSession(sessionId: string): Promise<void> {
  await supabase.from('ai_chat_sessions').delete().eq('id', sessionId);
}

// ── 模型定义 ──────────────────────────────────────────────────────────────────

export type ModelType = 'wenxin' | 'deepseek' | 'openai' | 'custom';

export interface ModelConfig {
  type: ModelType;
  api_key?: string;
  endpoint?: string;
  model?: string;
}

interface ModelDef {
  type: ModelType;
  label: string;
  desc: string;
  badge?: string;
  models?: { value: string; label: string }[];
  needKey: boolean;
  needEndpoint: boolean;
  keyPlaceholder?: string;
  docsUrl?: string;
}

const MODEL_DEFS: ModelDef[] = [
  {
    type: 'wenxin',
    label: '文心 ERNIE 4.5',
    desc: '百度文心大模型，平台内置免费使用',
    badge: '免费',
    needKey: false,
    needEndpoint: false,
  },
  {
    type: 'deepseek',
    label: 'DeepSeek',
    desc: '需填入 DeepSeek API Key',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat（推荐）' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner（R1）' },
    ],
    needKey: true,
    needEndpoint: false,
    keyPlaceholder: 'sk-xxxxxxxxxxxxxxxx',
    docsUrl: 'https://platform.deepseek.com/api-keys',
  },
  {
    type: 'openai',
    label: 'OpenAI',
    desc: '需填入 OpenAI API Key',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini（推荐）' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ],
    needKey: true,
    needEndpoint: false,
    keyPlaceholder: 'sk-xxxxxxxxxxxxxxxx',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    type: 'custom',
    label: '自定义接口',
    desc: '兼容 OpenAI 格式的任意接口',
    needKey: true,
    needEndpoint: true,
    keyPlaceholder: 'Bearer token 或 API Key',
  },
];

function getModelDef(type: ModelType) {
  return MODEL_DEFS.find(m => m.type === type) ?? MODEL_DEFS[0];
}

function loadModelConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(MODEL_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { type: 'wenxin' };
}

function saveModelConfig(cfg: ModelConfig) {
  localStorage.setItem(MODEL_CONFIG_KEY, JSON.stringify(cfg));
}

// ── Markdown 渲染 ─────────────────────────────────────────────────────────────

/**
 * 渲染 Markdown 为 React 节点。
 * 修复：
 * - 代码块内容用 JSX 文本节点渲染，避免任何编码/转义导致的乱码
 * - 所有文本强制 break-words + whitespace-pre-wrap，防止超出视口
 * - 支持 # / ## / ### 标题、有序/无序列表、粗体、行内代码
 */
function renderMarkdown(text: string) {
  if (!text) return null;
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let i = 0, key = 0;

  const renderInline = (raw: string, baseKey: number) => {
    // 将行内 **bold** 和 `code` 解析为 span 数组
    const segs = raw.split(/(`[^`]*`|\*\*[^*]+\*\*)/g);
    return segs.map((seg, si) => {
      if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4)
        return <strong key={`${baseKey}-b${si}`} className="font-semibold">{seg.slice(2, -2)}</strong>;
      if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2)
        return <code key={`${baseKey}-c${si}`} className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono break-all">{seg.slice(1, -1)}</code>;
      return seg || null;
    });
  };

  while (i < lines.length) {
    const line = lines[i];

    // ── 代码块 ──────────────────────────────────────────────────────
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      // 使用纯文本内容，避免任何 HTML 编码引发的乱码
      const codeText = codeLines.join('\n');
      result.push(
        <div key={key++} className="my-2 rounded-lg border border-border bg-muted overflow-hidden">
          {lang && (
            <div className="flex items-center justify-between px-3 py-1 bg-muted border-b border-border">
              <span className="text-[10px] font-mono text-muted-foreground select-none">{lang}</span>
            </div>
          )}
          <pre className="overflow-x-auto p-3 text-[11px] font-mono leading-relaxed">
            <code className="break-normal whitespace-pre">{codeText}</code>
          </pre>
        </div>
      );
      i++; continue;
    }

    // ── 标题 ─────────────────────────────────────────────────────────
    if (line.startsWith('# ')) {
      result.push(<h1 key={key++} className="text-lg font-bold mt-4 mb-1.5 break-words text-balance">{line.slice(2)}</h1>);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      result.push(<h2 key={key++} className="text-base font-semibold mt-3 mb-1 break-words text-balance">{line.slice(3)}</h2>);
      i++; continue;
    }
    if (line.startsWith('### ')) {
      result.push(<h3 key={key++} className="text-sm font-semibold mt-2.5 mb-1 break-words text-balance">{line.slice(4)}</h3>);
      i++; continue;
    }

    // ── 无序列表 ─────────────────────────────────────────────────────
    if (/^[-*+] /.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        listItems.push(lines[i].slice(2));
        i++;
      }
      result.push(
        <ul key={key++} className="my-1.5 space-y-0.5 pl-4">
          {listItems.map((item, li) => (
            <li key={li} className="flex gap-1.5 text-sm break-words">
              <span className="text-primary mt-[3px] shrink-0">•</span>
              <span className="min-w-0 break-words">{renderInline(item, key * 100 + li)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // ── 有序列表 ─────────────────────────────────────────────────────
    if (/^\d+\. /.test(line)) {
      const listItems: Array<{n: number; text: string}> = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        const m = lines[i].match(/^(\d+)\. (.*)/);
        if (m) listItems.push({ n: parseInt(m[1]), text: m[2] });
        i++;
      }
      result.push(
        <ol key={key++} className="my-1.5 space-y-0.5 pl-4">
          {listItems.map((item, li) => (
            <li key={li} className="flex gap-1.5 text-sm break-words">
              <span className="text-primary shrink-0 font-mono text-xs mt-[3px]">{item.n}.</span>
              <span className="min-w-0 break-words">{renderInline(item.text, key * 100 + li)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // ── 分隔线 ───────────────────────────────────────────────────────
    if (/^---+$/.test(line.trim())) {
      result.push(<hr key={key++} className="my-2 border-border" />);
      i++; continue;
    }

    // ── 空行 ─────────────────────────────────────────────────────────
    if (line.trim() === '') {
      // 连续空行只加一个间距
      if (result.length > 0) result.push(<div key={key++} className="h-1" />);
      i++; continue;
    }

    // ── 普通段落 ─────────────────────────────────────────────────────
    result.push(
      <p key={key++} className="text-sm leading-relaxed break-words min-w-0 text-pretty">
        {renderInline(line, key)}
      </p>
    );
    i++;
  }
  return <div className="flex flex-col gap-0.5 min-w-0 max-w-full overflow-hidden">{result}</div>;
}

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

function parseChunk(data: string): string {
  if (data === '[DONE]') return '';
  try { return JSON.parse(data).choices?.[0]?.delta?.content ?? ''; } catch { return ''; }
}

// ── 模型设置弹窗 ───────────────────────────────────────────────────────────────

// 获取模型列表状态
type FetchState = 'idle' | 'loading' | 'success' | 'error';

async function fetchModelsFromAPI(
  type: ModelType,
  apiKey: string,
  endpoint: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${supabaseUrl}/functions/v1/list-ai-models`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ type, api_key: apiKey, endpoint }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data.models || [];
}

function ModelSettingsDialog({
  open, onClose, config, onSave,
}: {
  open: boolean;
  onClose: () => void;
  config: ModelConfig;
  onSave: (cfg: ModelConfig) => void;
}) {
  const [draft, setDraft] = useState<ModelConfig>(config);
  const [showKey, setShowKey] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [fetchError, setFetchError] = useState('');
  // 动态获取的模型列表（每个 type 独立缓存）
  const [fetchedModels, setFetchedModels] = useState<Record<string, Array<{ id: string; name: string }>>>({});
  const def = getModelDef(draft.type);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setFetchState('idle');
      setFetchError('');
    }
  }, [open, config]);

  // 切换 type 时重置模型选择
  const handleTypeChange = (type: ModelType) => {
    setDraft({ type });
    setFetchState('idle');
    setFetchError('');
  };

  // 动态获取模型列表
  const handleFetchModels = async () => {
    if (!draft.api_key?.trim()) { toast.error('请先填写 API Key'); return; }
    if (draft.type === 'custom' && !draft.endpoint?.trim()) { toast.error('请先填写接口地址'); return; }
    setFetchState('loading');
    setFetchError('');
    try {
      const models = await fetchModelsFromAPI(
        draft.type,
        draft.api_key || '',
        draft.endpoint || '',
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
      );
      if (!models.length) throw new Error('未返回任何模型，请检查 API Key 或接口地址');
      setFetchedModels(prev => ({ ...prev, [draft.type]: models }));
      // 自动选择第一个模型
      if (!draft.model || !models.find(m => m.id === draft.model)) {
        setDraft(prev => ({ ...prev, model: models[0].id }));
      }
      setFetchState('success');
    } catch (e) {
      setFetchError((e as Error).message);
      setFetchState('error');
    }
  };

  // 当前 type 的模型列表：优先用动态获取的，回退到静态定义
  const availableModels: Array<{ id: string; name: string }> = (() => {
    const dynamic = fetchedModels[draft.type];
    if (dynamic?.length) return dynamic;
    if (def.models?.length) return def.models.map(m => ({ id: m.value, name: m.label }));
    return [];
  })();

  const handleSave = () => {
    if (def.needKey && !draft.api_key?.trim()) { toast.error('请填写 API Key'); return; }
    if (def.needEndpoint && !draft.endpoint?.trim()) { toast.error('请填写接口地址'); return; }
    onSave(draft);
    onClose();
    toast.success('模型配置已保存');
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">AI 模型配置</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 pt-1">
          {/* 平台选择 */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-normal">选择平台</Label>
            <Select value={draft.type} onValueChange={v => handleTypeChange(v as ModelType)}>
              <SelectTrigger className="px-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODEL_DEFS.map(m => (
                  <SelectItem key={m.type} value={m.type}>
                    <div className="flex items-center gap-2">
                      <span>{m.label}</span>
                      {m.badge && <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{m.badge}</Badge>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{def.desc}</p>
          </div>

          {/* 自定义接口地址 */}
          {def.needEndpoint && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-normal">接口地址</Label>
              <Input
                className="px-3"
                placeholder="https://your-api.com/v1/chat/completions"
                value={draft.endpoint || ''}
                onChange={e => setDraft(prev => ({ ...prev, endpoint: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">兼容 OpenAI Chat Completions 格式（/v1/chat/completions）</p>
            </div>
          )}

          {/* API Key + 获取模型按钮 */}
          {def.needKey && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-normal">API Key</Label>
                {def.docsUrl && (
                  <a href={def.docsUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline">获取 Key →</a>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <Input
                    className="px-3 pr-10"
                    type={showKey ? 'text' : 'password'}
                    placeholder={def.keyPlaceholder}
                    value={draft.api_key || ''}
                    onChange={e => {
                      setDraft(prev => ({ ...prev, api_key: e.target.value }));
                      // key 变化后重置获取状态
                      setFetchState('idle');
                    }}
                  />
                  <button type="button" onClick={() => setShowKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {/* 获取模型列表按钮 */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 h-9 gap-1.5 px-3 whitespace-nowrap"
                  onClick={handleFetchModels}
                  disabled={fetchState === 'loading' || !draft.api_key?.trim()}
                >
                  {fetchState === 'loading' ? (
                    <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  ) : fetchState === 'success' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                  ) : fetchState === 'error' ? (
                    <XCircle className="w-3.5 h-3.5 text-destructive" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  {fetchState === 'loading' ? '获取中…' : '获取模型'}
                </Button>
              </div>

              {/* 错误提示 */}
              {fetchState === 'error' && fetchError && (
                <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  <XCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive break-words">{fetchError}</p>
                </div>
              )}
              {/* 成功提示 */}
              {fetchState === 'success' && fetchedModels[draft.type]?.length > 0 && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  ✓ 已获取 {fetchedModels[draft.type].length} 个可用模型
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                Key 仅保存在本地，通过服务端安全转发，不会上传至第三方
              </p>
            </div>
          )}

          {/* 模型选择 */}
          {availableModels.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-normal">选择模型</Label>
                {fetchedModels[draft.type]?.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    共 {fetchedModels[draft.type].length} 个模型
                  </span>
                )}
              </div>
              <Select
                value={draft.model || availableModels[0]?.id || ''}
                onValueChange={v => setDraft(prev => ({ ...prev, model: v }))}
              >
                <SelectTrigger className="px-3"><SelectValue placeholder="请选择模型" /></SelectTrigger>
                <SelectContent className="max-h-48">
                  {availableModels.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="font-mono text-xs">{m.id}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* custom：没有获取模型时显示手动输入框 */}
          {draft.type === 'custom' && availableModels.length === 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-normal">模型名称（可选）</Label>
              <Input
                className="px-3"
                placeholder="如：llama3, qwen-turbo, claude-3-5-sonnet"
                value={draft.model || ''}
                onChange={e => setDraft(prev => ({ ...prev, model: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">填入 API Key 后点击「获取模型」可自动拉取</p>
            </div>
          )}

          {/* 文心免费说明 */}
          {draft.type === 'wenxin' && (
            <div className="flex items-start gap-2 bg-primary/5 border border-primary/20 rounded-lg p-3">
              <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                文心 ERNIE 4.5 由平台提供，无需配置密钥，直接免费使用。
              </p>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={handleSave}>保存配置</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 仓库选择器 ────────────────────────────────────────────────────────────────

function RepoSelector({ onSelect }: { onSelect: (repo: GitHubRepo) => void }) {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const res = await getUserRepos({ sort: 'updated', per_page: 30, page: p, type: 'all' });
      if (p === 1) setRepos(res.data);
      else setRepos(prev => [...prev, ...res.data]);
      setHasMore(res.hasNextPage);
      setPage(p);
    } catch {
      toast.error('获取仓库列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1); }, [load]);

  const filtered = repos.filter(r =>
    r.full_name.toLowerCase().includes(query.toLowerCase()) ||
    (r.description || '').toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4 w-full max-w-lg">
      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9 px-9"
          placeholder="搜索仓库名称或描述…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* 列表 */}
      <ScrollArea className="h-[360px] rounded-lg border border-border">
        <div className="flex flex-col divide-y divide-border">
          {loading && repos.length === 0 ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-3 flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3 bg-muted" />
                <Skeleton className="h-3 w-full bg-muted" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {query ? `未找到匹配 "${query}" 的仓库` : '暂无仓库'}
            </div>
          ) : (
            filtered.map(repo => (
              <button
                key={repo.id}
                onClick={() => onSelect(repo)}
                className="flex items-start gap-3 p-3 text-left hover:bg-muted/60 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">
                      {repo.full_name}
                    </span>
                    {repo.private ? (
                      <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
                    ) : (
                      <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 text-pretty">
                      {repo.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1">
                    {repo.language && (
                      <span className="text-[10px] text-muted-foreground">{repo.language}</span>
                    )}
                    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Star className="w-3 h-3" />{repo.stargazers_count}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {repo.default_branch}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))
          )}

          {/* 加载更多 */}
          {hasMore && !loading && (
            <button
              onClick={() => load(page + 1)}
              className="p-3 text-center text-sm text-primary hover:bg-muted/60 transition-colors"
            >
              加载更多仓库…
            </button>
          )}
          {loading && repos.length > 0 && (
            <div className="p-3 text-center text-xs text-muted-foreground">加载中…</div>
          )}
        </div>
      </ScrollArea>

      <button
        onClick={() => load(1)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors self-end"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        刷新列表
      </button>
    </div>
  );
}

// ── 快捷指令 ──────────────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { icon: FolderOpen,      label: '列出根目录', text: '请列出仓库根目录下的所有文件和文件夹' },
  { icon: BookOpen,        label: '查看 README', text: '请读取并展示 README.md 的内容' },
  { icon: GitBranch,       label: '列出分支', text: '请列出该仓库所有的分支' },
  { icon: GitCommit,       label: '提交历史', text: '请展示仓库最近 10 条提交记录' },
  { icon: Search,          label: '搜索 TODO', text: '搜索仓库中所有包含 TODO 注释的代码位置' },
  { icon: LayoutDashboard, label: '项目结构', text: '帮我分析一下这个仓库的整体项目结构和技术栈' },
  { icon: Pencil,          label: '优化 README', text: '请读取 README.md，帮我优化内容并重新写入' },
];

// ── 复制按钮 ────────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={handleCopy}
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title="复制内容">
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ── 分支选择器下拉 ────────────────────────────────────────────────────────────

function BranchPicker({
  branches, value, onChange, loading,
}: { branches: string[]; value: string; onChange: (b: string) => void; loading: boolean; }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={loading || branches.length === 0}>
      <SelectTrigger className="h-7 px-2 text-xs gap-1 border-border bg-muted/40 hover:bg-muted min-w-0 max-w-[160px]">
        <GitBranch className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="truncate font-medium">{loading ? '加载中…' : value}</span>
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 ml-0.5" />
      </SelectTrigger>
      <SelectContent className="max-h-48">
        {branches.map(b => (
          <SelectItem key={b} value={b}>
            <span className="font-mono text-xs">{b}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── 新建分支对话框 ────────────────────────────────────────────────────────────

function CreateBranchDialog({
  open, onClose, branches, currentBranch, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  branches: string[];
  currentBranch: string;
  onCreated: (name: string, from: string) => void;
}) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState(currentBranch);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (open) { setName(''); setFrom(currentBranch); } }, [open, currentBranch]);

  const handleCreate = async () => {
    const trimmed = name.trim().replace(/\s+/g, '-');
    if (!trimmed) { toast.error('请填写分支名称'); return; }
    if (branches.includes(trimmed)) { toast.error('该分支已存在'); return; }
    setLoading(true);
    try {
      onCreated(trimmed, from);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            新建分支
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-1">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-normal">分支名称</Label>
            <Input
              className="px-3 font-mono text-sm"
              placeholder="feature/my-feature"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-normal">从分支创建</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger className="px-3"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-40">
                {branches.map(b => (
                  <SelectItem key={b} value={b}><span className="font-mono text-xs">{b}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose} disabled={loading}>取消</Button>
            <Button onClick={handleCreate} disabled={loading || !name.trim()} className="gap-1.5">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              创建分支
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── 历史会话面板 ──────────────────────────────────────────────────────────────

function HistoryPanel({
  open, onClose, login,
  onLoad,
}: {
  open: boolean;
  onClose: () => void;
  login: string;
  onLoad: (session: ChatSession, messages: ChatSessionMessage[]) => void;
}) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!login) return;
    setLoading(true);
    const data = await fetchSessions(login);
    setSessions(data);
    setLoading(false);
  }, [login]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const handleLoad = async (session: ChatSession) => {
    const msgs = await fetchSessionMessages(session.id);
    onLoad(session, msgs);
    onClose();
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(id);
    await deleteSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    setDeleting(null);
    toast.success('对话已删除');
  };

  // 按仓库分组
  const grouped: Record<string, ChatSession[]> = {};
  for (const s of sessions) {
    if (!grouped[s.repo_full_name]) grouped[s.repo_full_name] = [];
    grouped[s.repo_full_name].push(s);
  }

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-sm p-0 flex flex-col bg-card [&>button]:hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <History className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground flex-1">历史对话</span>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClose}>
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full bg-muted" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <MessageSquare className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">暂无历史对话</p>
            </div>
          ) : (
            <div className="flex flex-col py-2">
              {Object.entries(grouped).map(([repo, list]) => (
                <div key={repo}>
                  <div className="flex items-center gap-1.5 px-4 py-2">
                    <GitBranch className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground truncate">{repo}</span>
                  </div>
                  {list.map(s => (
                    <button
                      key={s.id}
                      onClick={() => handleLoad(s)}
                      className="w-full text-left flex items-start gap-3 px-4 py-2.5 hover:bg-muted/60 transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate text-balance">{s.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] font-mono text-muted-foreground">{s.branch}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(s.updated_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={e => handleDelete(s.id, e)}
                        className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                        title="删除对话"
                      >
                        {deleting === s.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function AiAssistantPage() {
  const { token, user } = useAuth();
  const [step, setStep] = useState<'repo' | 'chat'>('repo');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(loadModelConfig);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  // 当前会话 ID（用于持久化）
  const [sessionId, setSessionId] = useState<string | null>(null);
  // 待持久化消息队列（本轮对话新增的）
  const pendingMsgsRef = useRef<Array<{ role: string; content: string }>>([]);
  // 分支相关
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [isProtectedBranch, setIsProtectedBranch] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Textarea 自动调整高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 112) + 'px'; // max-h-28 = 112px
  }, [input]);

  // 自动滚动到底部
  // ScrollArea 的 viewport 是 [data-radix-scroll-area-viewport]，需要直接滚动它
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]'
    ) as HTMLElement | null;
    if (viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
    } else {
      // 降级：直接 scrollIntoView
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // 加载分支列表
  const loadBranches = useCallback(async (repo: GitHubRepo) => {
    setBranchesLoading(true);
    try {
      const list = await getRepoBranches(repo.owner.login, repo.name);
      const names = (list as Array<{ name: string }>).map(b => b.name);
      setBranches(names);
      const def = repo.default_branch || 'main';
      setSelectedBranch(names.includes(def) ? def : (names[0] || def));
    } catch {
      setBranches([]);
      setSelectedBranch(repo.default_branch || 'main');
    } finally {
      setBranchesLoading(false);
    }
  }, []);

  // 选择仓库后进入对话（新会话）
  const handleSelectRepo = useCallback((repo: GitHubRepo) => {
    setSelectedRepo(repo);
    setSelectedBranch(repo.default_branch || 'main');
    setSessionId(null);
    pendingMsgsRef.current = [];
    const welcome: Message = {
      id: 'welcome',
      role: 'assistant',
      content: `你好！我已连接到仓库 **${repo.full_name}**（${repo.private ? '私有' : '公开'}）。

默认分支：\`${repo.default_branch}\`${repo.description ? `

> ${repo.description}` : ''}

你可以在顶部切换目标分支、新建分支，AI 可帮你写文件并提交 PR。告诉我需要什么帮助！`,
    };
    setMessages([welcome]);
    loadBranches(repo);
    setStep('chat');
  }, [loadBranches]);

  // 加载历史对话
  const handleLoadHistory = useCallback((session: ChatSession, histMsgs: ChatSessionMessage[]) => {
    // 找到对应仓库信息（只设置必要字段）
    const fakeRepo: GitHubRepo = {
      id: 0,
      name: session.repo_full_name.split('/')[1] || session.repo_full_name,
      full_name: session.repo_full_name,
      private: false,
      owner: {
        id: 0, login: session.repo_full_name.split('/')[0], name: null, email: null,
        avatar_url: '', bio: null, company: null, location: null, blog: null,
        twitter_username: null, public_repos: 0, public_gists: 0,
        followers: 0, following: 0, created_at: '', updated_at: '', html_url: '',
      },
      description: null,
      html_url: '',
      clone_url: '',
      default_branch: session.branch,
      stargazers_count: 0,
      language: null,
      updated_at: '',
      created_at: '',
      forks_count: 0,
      watchers_count: 0,
      open_issues_count: 0,
      topics: [],
      size: 0,
      pushed_at: '',
      visibility: 'public',
      fork: false,
      ssh_url: '',
      archived: false,
      disabled: false,
      license: null,
    };
    setSelectedRepo(fakeRepo);
    setSelectedBranch(session.branch);
    setSessionId(session.id);
    setIsProtectedBranch(session.branch === 'main' || session.branch === 'master');
    pendingMsgsRef.current = [];
    const converted: Message[] = histMsgs.map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    setMessages(converted.length > 0 ? converted : [{
      id: 'welcome',
      role: 'assistant',
      content: `已加载历史对话：**${session.repo_full_name}** 分支 \`${session.branch}\``,
    }]);
    loadBranches(fakeRepo);
    setStep('chat');
  }, [loadBranches]);

  // 切换分支
  const handleBranchChange = (b: string) => {
    setSelectedBranch(b);
    setIsProtectedBranch(b === 'main' || b === 'master');
  };

  // 新建分支（由对话框回调，实际创建由 AI 工具链完成）
  const handleBranchCreated = (name: string, from: string) => {
    // 追加到分支列表并切换
    setBranches(prev => [...prev, name]);
    setSelectedBranch(name);
    setIsProtectedBranch(false);
    // 发送提示让 AI 执行创建
    handleSend(`请帮我新建分支 \`${name}\`，从 \`${from}\` 创建。`, false);
  };

  const handleSaveModelConfig = (cfg: ModelConfig) => {
    setModelConfig(cfg);
    saveModelConfig(cfg);
  };

  const currentModelDef = getModelDef(modelConfig.type);

  // 持久化：确保 session 存在，批量保存消息
  const persistMessages = useCallback(async (
    newMsgs: Array<{ role: string; content: string }>,
    repo: GitHubRepo,
    branch: string,
  ) => {
    if (!user?.login) return;
    let sid = sessionId;
    if (!sid) {
      const firstUser = newMsgs.find(m => m.role === 'user');
      const title = firstUser
        ? firstUser.content.slice(0, 40) + (firstUser.content.length > 40 ? '…' : '')
        : '新对话';
      sid = crypto.randomUUID();
      setSessionId(sid);
      await upsertSession({
        id: sid,
        github_login: user.login,
        repo_full_name: repo.full_name,
        branch,
        title,
        model_type: modelConfig.type,
        model_name: modelConfig.model,
      });
    }
    await insertMessages(sid, newMsgs);
  }, [sessionId, user?.login, modelConfig.type, modelConfig.model]);

  // 重新生成
  const handleRegenerate = useCallback(async () => {
    if (isStreaming) return;
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    setMessages(prev => {
      const idx = [...prev].reverse().findIndex(m => m.role === 'assistant');
      if (idx === -1) return prev;
      return prev.slice(0, prev.length - 1 - idx);
    });
    await handleSend(lastUser.content, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, messages]);

  // 发送消息
  const handleSend = useCallback(async (text?: string, isRegen = false) => {
    const userText = (text ?? input).trim();
    if (!userText || isStreaming || !selectedRepo || !token) return;

    if (!isRegen) {
      setInput('');
      // 同步重置 textarea 高度
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: userText };
    const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '', streaming: true };
    setMessages(prev => isRegen ? [...prev, aiMsg] : [...prev, userMsg, aiMsg]);
    setIsStreaming(true);

    const baseHistory = messages.filter(m => m.id !== 'welcome');
    const history = [...(isRegen ? baseHistory : [...baseHistory, userMsg])].map(m => ({
      role: m.role, content: m.content,
    }));

    abortRef.current = new AbortController();
    let accumulated = '';

    await sendStreamRequest({
      functionUrl: `${SUPABASE_URL}/functions/v1/ai-assistant`,
      requestBody: {
        messages: history,
        github_token: token,
        owner: selectedRepo.owner.login,
        repo: selectedRepo.name,
        target_branch: selectedBranch,
        model_config: modelConfig,
      },
      supabaseAnonKey: SUPABASE_ANON_KEY,
      onData: (data) => {
        const chunk = parseChunk(data);
        if (!chunk) return;
        accumulated += chunk;
        setMessages(prev => prev.map(m => m.id === aiMsg.id ? { ...m, content: accumulated } : m));
      },
      onComplete: async () => {
        setMessages(prev => prev.map(m => m.id === aiMsg.id ? { ...m, streaming: false } : m));
        setIsStreaming(false);
        // 持久化本轮新消息
        const newMsgs = isRegen
          ? [{ role: 'assistant', content: accumulated }]
          : [{ role: 'user', content: userText }, { role: 'assistant', content: accumulated }];
        await persistMessages(newMsgs, selectedRepo, selectedBranch);
        pendingMsgsRef.current = [];
      },
      onError: (err) => {
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id ? { ...m, content: `❌ 请求失败：${err.message}`, streaming: false } : m
        ));
        setIsStreaming(false);
        toast.error('AI 响应失败');
      },
      signal: abortRef.current.signal,
    });
  }, [input, isStreaming, messages, selectedRepo, token, modelConfig, selectedBranch, persistMessages]);

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleBack = () => {
    setStep('repo');
    setSelectedRepo(null);
    setMessages([]);
    setBranches([]);
    setSelectedBranch('');
    setSessionId(null);
    pendingMsgsRef.current = [];
  };

  const handleClearChat = () => {
    if (!selectedRepo) return;
    setSessionId(null);
    pendingMsgsRef.current = [];
    setMessages([{
      id: 'welcome-' + Date.now(),
      role: 'assistant',
      content: `对话已清空。当前目标分支：\`${selectedBranch}\`。有什么可以帮你？`,
    }]);
  };

  // ── 仓库选择步骤 ─────────────────────────────────────────────────────────

  if (step === 'repo') {
    return (
      <div className="flex flex-col items-center gap-6 p-4 md:p-8 max-w-2xl mx-auto">
        {/* 标题区 */}
        <div className="flex flex-col items-center gap-3 text-center w-full">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground text-balance">AI 仓库助手</h1>
          <p className="text-sm text-muted-foreground text-pretty max-w-sm">
            选择一个仓库，AI 将帮你浏览、搜索并修改其中的文件
          </p>
        </div>

        {/* 顶部操作：模型设置 + 历史对话 */}
        <div className="flex items-center gap-3 w-full max-w-lg">
          <div className="flex items-center gap-3 flex-1 min-w-0 bg-muted/40 rounded-xl px-4 py-3 border border-border">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">当前模型</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-sm font-medium text-foreground">{currentModelDef.label}</span>
                {currentModelDef.badge && (
                  <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{currentModelDef.badge}</Badge>
                )}
                {modelConfig.model && (
                  <span className="text-xs text-muted-foreground truncate">· {modelConfig.model}</span>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowModelSettings(true)} className="shrink-0 h-8 gap-1.5">
              <Settings className="w-3.5 h-3.5" />
              切换
            </Button>
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() => setShowHistory(true)}
            className="shrink-0 h-12 gap-1.5 flex-col text-xs"
          >
            <History className="w-4 h-4" />
            历史
          </Button>
        </div>

        {/* 仓库选择器 */}
        <RepoSelector onSelect={handleSelectRepo} />

        {/* 风险提示 */}
        <div className="flex items-start gap-2 w-full max-w-lg bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-600 dark:text-amber-400 text-pretty">
            AI 写入文件时将使用你的 GitHub Token 直接提交，建议先在测试仓库或非主分支上操作。
          </p>
        </div>

        <ModelSettingsDialog
          open={showModelSettings}
          onClose={() => setShowModelSettings(false)}
          config={modelConfig}
          onSave={handleSaveModelConfig}
        />
        <HistoryPanel
          open={showHistory}
          onClose={() => setShowHistory(false)}
          login={user?.login || ''}
          onLoad={handleLoadHistory}
        />
      </div>
    );
  }

  // ── 对话步骤 ─────────────────────────────────────────────────────────────

  const lastAiIdx = [...messages].map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i !== -1).pop() ?? -1;

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] md:h-[calc(100dvh-1rem)] overflow-hidden">
      {/* 顶部栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
        {/* 返回按钮 */}
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="切换仓库"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-semibold text-foreground truncate hidden sm:block max-w-[100px]">
            {selectedRepo?.name}
          </span>
        </button>

        {/* 分支选择器 + 新建分支按钮 */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <BranchPicker
            branches={branches}
            value={selectedBranch}
            onChange={handleBranchChange}
            loading={branchesLoading}
          />
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setShowCreateBranch(true)}
            title="新建分支"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* 右侧：流式状态 */}
        <div className="flex items-center shrink-0">
          {isStreaming && (
            <Badge variant="secondary" className="text-xs animate-pulse">
              <span className="hidden sm:inline">思考中</span>
              <Loader2 className="w-3 h-3 animate-spin sm:hidden" />
            </Badge>
          )}
        </div>
      </div>

      {/* 分支警告条 */}
      {isProtectedBranch && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
          <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-600 dark:text-amber-400 flex-1 min-w-0">
            当前分支 <span className="font-semibold">{selectedBranch}</span> 受保护，建议
            <button onClick={() => setShowCreateBranch(true)} className="underline ml-1 hover:text-amber-700">
              新建功能分支
            </button>
          </p>
        </div>
      )}

      {/* 消息列表 */}
      <div ref={scrollAreaRef} className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col"><ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-4 p-4 pb-2">
          {messages.map((msg, idx) => {
            const isLastAi = idx === lastAiIdx;
            return (
              <div key={msg.id} className={cn('flex gap-2.5', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                <div className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                  msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted border border-border'
                )}>
                  {msg.role === 'user'
                    ? <User className="w-3.5 h-3.5" />
                    : <Bot className="w-3.5 h-3.5 text-muted-foreground" />}
                </div>
                <div className="flex flex-col gap-1 max-w-[85%] min-w-0 overflow-hidden">
                  <div className={cn(
                    'rounded-2xl px-4 py-3 text-sm min-w-0 max-w-full overflow-hidden',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-muted/60 border border-border text-foreground rounded-tl-sm'
                  )}>
                    {msg.role === 'user'
                      ? <p className="whitespace-pre-wrap break-words min-w-0 max-w-full">{msg.content}</p>
                      : (
                        <div className="min-w-0 max-w-full overflow-hidden">
                          {msg.content ? renderMarkdown(msg.content) : (
                            msg.streaming
                              ? <span className="inline-block w-1.5 h-4 bg-primary animate-pulse rounded-sm align-middle" />
                              : <span className="text-muted-foreground text-sm">…</span>
                          )}
                          {msg.streaming && msg.content && (
                            <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 animate-pulse rounded-sm align-middle" />
                          )}
                        </div>
                      )}
                  </div>
                  {/* 操作栏（AI消息） */}
                  {msg.role === 'assistant' && !msg.streaming && msg.content && (
                    <div className="flex items-center gap-0.5 self-start ml-1">
                      <CopyButton text={msg.content} />
                      {isLastAi && (
                        <button
                          onClick={handleRegenerate}
                          disabled={isStreaming}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                          title="重新生成"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {/* 快速 PR 按钮（最后一条 AI 消息且写过文件） */}
                      {isLastAi && msg.content.includes('✅ 文件') && (
                        <button
                          onClick={() => handleSend(`请帮我从当前分支 \`${selectedBranch}\` 向默认分支提交一个 PR，标题总结刚才的修改内容`)}
                          disabled={isStreaming}
                          className="flex items-center gap-1 p-1 px-2 rounded text-xs text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                          title="一键提交 PR"
                        >
                          <GitPullRequest className="w-3.5 h-3.5" />
                          提交 PR
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea></div>

      {/* 快捷指令 */}
      {messages.length <= 1 && !isStreaming && (
        <div className="px-3 pb-2 shrink-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Zap className="w-3 h-3 text-primary/70" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">快捷指令</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {QUICK_PROMPTS.map(q => {
              const Icon = q.icon;
              return (
                <button
                  key={q.label}
                  onClick={() => handleSend(q.text)}
                  className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-primary/5 hover:border-primary/30 hover:text-primary text-muted-foreground transition-all duration-150 whitespace-nowrap group"
                >
                  <Icon className="w-3 h-3 shrink-0 group-hover:text-primary" />
                  <span>{q.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 输入区 */}
      <div className="px-3 py-3 shrink-0 bg-card">
        {/* 统一输入卡片 */}
        <div className={cn(
          'rounded-xl border bg-background transition-shadow duration-200',
          isStreaming
            ? 'border-primary/40 shadow-sm shadow-primary/10'
            : 'border-border hover:border-border/80 focus-within:border-primary/50 focus-within:shadow-sm focus-within:shadow-primary/10'
        )}>
          {/* 工具栏 */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
            <div className="flex items-center gap-1">
              {/* 模型标签 */}
              <button
                onClick={() => setShowModelSettings(true)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-primary hover:bg-primary/8 transition-colors group"
                title="切换模型"
              >
                <Sparkles className="w-3 h-3 group-hover:text-primary shrink-0" />
                <span className="font-medium">{currentModelDef.label}</span>
                {modelConfig.model && (
                  <span className="hidden sm:inline text-[10px] opacity-70">· {modelConfig.model}</span>
                )}
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              {/* 分支信息 */}
              <button
                onClick={() => setShowCreateBranch(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors font-mono"
                title="新建分支"
              >
                <GitBranch className="w-3 h-3 shrink-0" />
                <span className="max-w-[80px] truncate">{selectedBranch}</span>
              </button>
              {sessionId && (
                <span className="text-[10px] text-green-500 px-1" title="对话已保存">●</span>
              )}
              <div className="w-px h-3.5 bg-border mx-0.5" />
              {/* 历史 */}
              <button
                onClick={() => setShowHistory(true)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/8 transition-colors"
                title="历史对话"
              >
                <History className="w-3.5 h-3.5" />
              </button>
              {/* 清空 */}
              <button
                onClick={handleClearChat}
                disabled={isStreaming}
                className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-colors disabled:opacity-40"
                title="清空对话"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 分隔线 */}
          <div className="mx-3 h-px bg-border/60" />

          {/* 文本框 + 发送 */}
          <div className="flex items-end gap-2 px-3 py-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息… （Enter 发送，Shift+Enter 换行）"
              className="flex-1 min-w-0 min-h-[36px] max-h-28 resize-none border-0 shadow-none bg-transparent px-0 py-0.5 text-sm focus-visible:ring-0 placeholder:text-muted-foreground/60 overflow-y-auto"
              disabled={isStreaming}
              rows={1}
              style={{ height: 'auto' }}
            />
            {/* 发送 / 停止 按钮 */}
            {isStreaming ? (
              <button
                onClick={handleStop}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 transition-colors"
                title="停止生成"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                title="发送（Enter）"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 弹窗 */}
      <ModelSettingsDialog
        open={showModelSettings}
        onClose={() => setShowModelSettings(false)}
        config={modelConfig}
        onSave={handleSaveModelConfig}
      />
      <CreateBranchDialog
        open={showCreateBranch}
        onClose={() => setShowCreateBranch(false)}
        branches={branches}
        currentBranch={selectedBranch}
        onCreated={handleBranchCreated}
      />
      <HistoryPanel
        open={showHistory}
        onClose={() => setShowHistory(false)}
        login={user?.login || ''}
        onLoad={handleLoadHistory}
      />
    </div>
  );
}
