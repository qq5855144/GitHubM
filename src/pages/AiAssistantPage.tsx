// AI 助手页面 v4 - 组件拆分 + React.memo 优化
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getRepoBranches } from '@/services/github';
import { sendStreamRequest } from '@/lib/sse';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Bot, User, Send, Square, Trash2, Settings,
  Sparkles, AlertCircle,
  RefreshCw, Plus, GitPullRequest, History, ArrowLeft, Loader2,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { GitHubRepo } from '@/types/types';
// ── 拆分的子组件（均应用 React.memo）──────────────────────────────────────────
import ModelSettingsDialog from '@/components/ai/ModelSettingsDialog';
import RepoSelector from '@/components/ai/RepoSelector';
import CopyButton from '@/components/ai/CopyButton';
import BranchPicker from '@/components/ai/BranchPicker';
import CreateBranchDialog from '@/components/ai/CreateBranchDialog';
import HistoryPanel from '@/components/ai/HistoryPanel';
// ── 共享工具层 ────────────────────────────────────────────────────────────────
import {
  getModelDef, loadModelConfig, saveModelConfig,
  parseChunk, renderMarkdown, QUICK_PROMPTS,
} from '@/components/ai/aiUtils';
import { upsertSession, insertMessages } from '@/components/ai/aiSupabase';
import type { Message, ModelConfig, ChatSession, ChatSessionMessage } from '@/components/ai/aiTypes';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
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
      <div ref={scrollAreaRef} className="flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col"><ScrollArea className="flex-1 min-h-0 min-w-0">
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
                {/* overflow-x-hidden 只阻断横向溢出，不阻断纵向；气泡内 pre 的横向滚动条可正常工作 */}
                <div className="flex flex-col gap-1 max-w-[85%] min-w-0 overflow-x-hidden">
                  {/* 消息气泡：内容超过阈值后启用独立滚动，避免整个列表被撑开 */}
                  {/* 气泡：overflow-x-auto 让宽代码块可横向滚动而非截断；
                       长内容流式结束后加 max-h+overflow-y-auto 防止无限撑高列表 */}
                  <div className={cn(
                    'rounded-2xl px-4 py-3 text-sm min-w-0 max-w-full overflow-x-auto',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-muted/60 border border-border text-foreground rounded-tl-sm',
                    !msg.streaming && msg.content.length > 600
                      ? 'max-h-[60vh] overflow-y-auto'
                      : ''
                  )}>
                    {msg.role === 'user'
                      ? <p className="whitespace-pre-wrap break-words min-w-0 max-w-full">{msg.content}</p>
                      : (
                        <div className="min-w-0 max-w-full">
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
