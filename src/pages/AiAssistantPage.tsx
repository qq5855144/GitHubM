// AI 助手页面 v7 - 超时可配置 + 后台断连自动重连 + 原生 fetch SSE
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getRepoBranches } from '@/services/github';
import { sendStreamRequest } from '@/lib/sse';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Bot, User, Send, Square, Trash2, Settings,
  Sparkles, AlertCircle,
  RefreshCw, Plus, GitPullRequest, History, ArrowLeft, Loader2,
  Zap, FolderSearch, PanelRight, Wrench, ListChecks, Clock, WifiOff, CheckCircle2, XCircle,
  Paperclip, X, ImageIcon, FileText, ChevronDown, ChevronRight,
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
import FileBrowserPanel from '@/components/ai/FileBrowserPanel';
import { ToolHistoryPanel } from '@/components/ai/ToolHistoryPanel';
import { TaskPlanPanel, type StepStatus } from '@/components/ai/TaskPlanPanel';
import WorkflowHistoryPanel from '@/components/ai/WorkflowHistoryPanel';
import InlineActivityPanel from '@/components/ai/InlineActivityPanel';
// ── 共享工具层 ────────────────────────────────────────────────────────────────
import {
  getModelDef, loadModelConfig, saveModelConfig,
  parseChunk, parseTypedChunk, renderMarkdown, ThinkingBlock, QUICK_PROMPTS,
} from '@/components/ai/aiUtils';
import { upsertSession, insertMessages } from '@/components/ai/aiSupabase';
import type { Message, ModelConfig, ChatSession, ChatSessionMessage, ToolHistoryItem, TaskPlanStep, InlineStep, InlineTool, Attachment, FileRequest } from '@/components/ai/aiTypes';

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
  // 文件浏览器侧边面板
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  // 工具调用历史侧边面板
  const [showToolHistory, setShowToolHistory] = useState(false);
  const [toolHistory, setToolHistory] = useState<ToolHistoryItem[]>([]);
  // 任务工作流面板
  const [taskPlanSteps, setTaskPlanSteps] = useState<TaskPlanStep[]>([]);
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>({});
  const [stepRetryCounts, setStepRetryCounts] = useState<Record<string, number>>({});
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  // 侧边面板 Tab：'tools' | 'plan' | 'history'
  const [sidePanelTab, setSidePanelTab] = useState<'tools' | 'plan' | 'history'>('plan');
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
  // 附件上传相关
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // ── 断连重连：记录最后一次请求参数，供后台切回时恢复 ─────────────────────────
  /** 上次发送的请求 body（不含 signal），网络中断时用于重连 */
  const lastRequestBodyRef = useRef<Record<string, unknown> | null>(null);
  /** 上次对话的用户原文（重连时注入到重连消息） */
  const lastUserTextRef = useRef<string>('');
  /** 当前是否处于网络中断（非用户主动 Stop）状态 */
  const networkInterruptedRef = useRef(false);
  /** 驱动 UI 显示重连提示条 */
  const [isNetworkInterrupted, setIsNetworkInterrupted] = useState(false);
  /** 当前流式对应的 AI 消息 id，重连时用于定位消息 */
  const streamingAiMsgIdRef = useRef<string | null>(null);

  // Textarea 自动调整高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 112) + 'px'; // max-h-28 = 112px
  }, [input]);

  // 自动滚动到底部
  // 直接操作原生 div（不再经过 Radix ScrollArea 的 viewport 选择器）
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // ── 后台恢复检测：页面从后台切回时，若任务被网络中断则提示重连 ─────────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) return;
      if (!networkInterruptedRef.current) return;
      networkInterruptedRef.current = false;
      setIsNetworkInterrupted(true); // 让 UI 重连条保持可见
      toast.warning('网络连接已断开，AI 任务被中断', {
        duration: 0,
        id: 'reconnect-toast',
        action: {
          label: '重新连接',
          onClick: () => { toast.dismiss('reconnect-toast'); handleReconnect(); },
        },
      });
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // ── 附件工具函数（必须在 handleSend 之前声明）─────────────────────────────

  // 附件文件选择处理
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    files.forEach(file => {
      const isImage = file.type.startsWith('image/');
      const maxSize = isImage ? 5 * 1024 * 1024 : 500 * 1024;
      if (file.size > maxSize) {
        toast.warning(`文件 ${file.name} 超过大小限制（${isImage ? '5MB' : '500KB'}）`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result as string;
        const attachment: Attachment = {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          type: isImage ? 'image' : (file.type.startsWith('text/') || /\.(ts|tsx|js|jsx|json|yaml|yml|md|py|go|kt|swift|sh|env|xml|html|css)$/.test(file.name)) ? 'text' : 'binary',
          mimeType: file.type,
          content: result,
          size: file.size,
        };
        setAttachments(prev => [...prev, attachment]);
      };
      if (isImage) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
    e.target.value = '';
  }, []);

  // 将附件内容格式化为注入到消息的文本
  const formatAttachmentsForMessage = useCallback((atts: Attachment[]): string => {
    if (!atts.length) return '';
    return atts.map(att => {
      if (att.type === 'image') return `\n\n[图片附件: ${att.name}]\n${att.content}`;
      if (att.type === 'text') return `\n\n[文件附件: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\``;
      return `\n\n[二进制附件: ${att.name}（base64）]\n${att.content}`;
    }).join('');
  }, []);

  const handleSend = useCallback(async (text?: string, isRegen = false) => {
    const userText = (text ?? input).trim();
    if (!userText || isStreaming || !selectedRepo || !token) return;

    // 附件内容注入到消息文本
    const pendingAttachments = isRegen ? [] : [...attachments];
    const attachmentText = formatAttachmentsForMessage(pendingAttachments);
    const fullUserText = userText + attachmentText;

    if (!isRegen) {
      setInput('');
      setAttachments([]);
      // 同步重置 textarea 高度
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userText, // 气泡显示原始文字，不含 base64
      attachments: pendingAttachments.length ? pendingAttachments : undefined,
    };
    const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '', streaming: true };
    setMessages(prev => isRegen ? [...prev, aiMsg] : [...prev, userMsg, aiMsg]);
    setIsStreaming(true);

    const baseHistory = messages.filter(m => m.id !== 'welcome');
    // history 用 fullUserText（含附件内容）替换最后一条用户消息，确保 AI 看到完整内容
    const historyUserMsg = { role: 'user' as const, content: fullUserText };
    const history = [...(isRegen ? baseHistory : [...baseHistory, historyUserMsg])].map(m => ({
      role: m.role, content: m.content,
    }));

    abortRef.current = new AbortController();
    let accumulated = '';
    let currentThinking = '';

    // 发起新一轮对话前，如果是新问题，清空旧的工具记录
    if (!isRegen) {
      setToolHistory([]);
      setShowToolHistory(false);
      // 清空任务规划状态
      setTaskPlanSteps([]);
      setStepStatuses({});
      setStepRetryCounts({});
      setCurrentStepId(null);
    }

    // ── 记录请求参数，供断连后重连使用 ─────────────────────────────────────────
    const reqBody = {
      messages: history,
      github_token: token,
      owner: selectedRepo.owner.login,
      repo: selectedRepo.name,
      target_branch: selectedBranch,
      model_config: modelConfig,
      user_id: user?.login || 'anonymous',
    };
    lastRequestBodyRef.current = reqBody;
    lastUserTextRef.current = userText;
    streamingAiMsgIdRef.current = aiMsg.id;
    networkInterruptedRef.current = false;

    // ── 多气泡状态追踪（闭包内局部变量）────────────────────────────────────────
    // 初始气泡 id（等待/planning 占位或简单回答）
    const initMsgId = aiMsg.id;
    // 当前正在更新的步骤气泡 id
    let currentStepBubbleId: string | null = null;
    // 最终回答气泡 id（content 事件触发后创建）
    let answerMsgId: string | null = null;
    // 是否已收到 plan/step 事件（决定是否拆分多气泡）
    let hasSteps = false;
    // 本次对话计划步骤（step_start 时查标题用）
    let planStepsLocal: Array<{ id: string; title: string; desc: string }> = [];
    // 当前步骤 ID（闭包内，不走 setState 避免异步）
    let localCurrentStepId: string | null = null;
    // 当前思考气泡 id
    let thinkingBubbleId: string | null = null;
    // toolCallId → 气泡 id 映射（tool_end 时用于定位并更新）
    const toolBubbleMap = new Map<string, string>();

    await sendStreamRequest({
      functionUrl: `${SUPABASE_URL}/functions/v1/ai-assistant`,
      requestBody: reqBody,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      timeoutMs: modelConfig.timeoutMs ?? 300_000,
      onData: (data) => {
        const chunk = parseTypedChunk(data);
        if (!chunk) return;

        switch (chunk.type) {
          case 'content': {
            // ── 首次 content：若已有步骤气泡则新建 answer 气泡，否则复用初始气泡 ──
            if (answerMsgId === null) {
              if (hasSteps) {
                // 新建 answer 气泡，追加到消息列表末尾
                const newId = `ans-${Date.now()}`;
                answerMsgId = newId;
                streamingAiMsgIdRef.current = newId;
                const answerMsg: Message = { id: newId, role: 'assistant', content: '', streaming: true, bubbleType: 'answer' };
                setMessages(prev => [...prev, answerMsg]);
              } else {
                // 没有步骤时直接复用初始气泡
                answerMsgId = initMsgId;
              }
            }
            accumulated += chunk.content;
            const aid = answerMsgId;
            setMessages(prev => prev.map(m => m.id === aid ? { ...m, content: accumulated } : m));
            break;
          }
          case 'think_start': {
            // 思考气泡：每次思考创建独立气泡
            const tbId = `think-${Date.now()}`;
            thinkingBubbleId = tbId;
            const thinkMsg: Message = {
              id: tbId, role: 'assistant', content: '',
              streaming: true, bubbleType: 'thinking',
              thinkingContent: '', thinkingDone: false,
            };
            setMessages(prev => [...prev, thinkMsg]);
            break;
          }
          case 'think_chunk': {
            currentThinking += chunk.content;
            if (thinkingBubbleId) {
              const tid = thinkingBubbleId;
              setMessages(prev => prev.map(m => m.id === tid ? { ...m, thinkingContent: currentThinking } : m));
            }
            break;
          }
          case 'think_end': {
            if (thinkingBubbleId) {
              const tid = thinkingBubbleId;
              setMessages(prev => prev.map(m => m.id === tid ? { ...m, thinkingDone: true, streaming: false } : m));
            }
            thinkingBubbleId = null;
            currentThinking = '';
            break;
          }
          case 'tool_start': {
            setToolHistory(prev => [...prev, {
              id: chunk.id, tool: chunk.tool,
              label: chunk.label, hint: chunk.hint,
              status: 'running', startedAt: Date.now(),
            }]);
            if (window.innerWidth >= 768) setShowToolHistory(true);
            // 每个工具调用创建独立气泡
            const toolMsgId = `tool-${chunk.id}-${Date.now()}`;
            toolBubbleMap.set(chunk.id, toolMsgId);
            const toolMsg: Message = {
              id: toolMsgId, role: 'assistant', content: '',
              streaming: true, bubbleType: 'tool',
              toolCallId: chunk.id, toolName: chunk.tool,
              toolLabel: chunk.label, toolHint: chunk.hint,
              toolStatus: 'running',
            };
            setMessages(prev => [...prev, toolMsg]);
            break;
          }
          case 'tool_end': {
            setToolHistory(prev => prev.map(item => item.id === chunk.id
              ? { ...item, status: chunk.status, result: chunk.result, elapsedMs: chunk.elapsedMs }
              : item
            ));
            // 更新对应工具气泡
            const toolMsgId = toolBubbleMap.get(chunk.id);
            if (toolMsgId) {
              setMessages(prev => prev.map(m =>
                m.id === toolMsgId
                  ? { ...m, streaming: false, toolStatus: chunk.status, toolElapsedMs: chunk.elapsedMs, toolResult: chunk.result }
                  : m
              ));
            }
            break;
          }
          case 'plan': {
            // 收到计划：初始化侧边面板状态
            hasSteps = true;
            planStepsLocal = chunk.steps;
            setTaskPlanSteps(chunk.steps);
            setStepStatuses(Object.fromEntries(chunk.steps.map(s => [s.id, 'pending' as StepStatus])));
            setStepRetryCounts({});
            setCurrentStepId(null);
            setSidePanelTab('plan');
            if (window.innerWidth >= 768) setShowToolHistory(true);
            // 初始气泡显示计划概览（折叠列表）
            setMessages(prev => prev.map(m => {
              if (m.id !== initMsgId) return m;
              const inlinePlan: InlineStep[] = chunk.steps.map(s => ({ id: s.id, title: s.title, desc: s.desc, status: 'pending' }));
              return { ...m, inlinePlan, bubbleType: 'step', stepTitle: '任务规划' };
            }));
            break;
          }
          case 'step_start': {
            hasSteps = true;
            localCurrentStepId = chunk.stepId;
            setCurrentStepId(chunk.stepId);
            setStepStatuses(prev => ({ ...prev, [chunk.stepId]: 'running' }));

            const stepInfo = planStepsLocal.find(s => s.id === chunk.stepId);
            const stepTitle = stepInfo?.title ?? `步骤 ${chunk.stepId}`;

            // 首个 step：判断是否可复用初始气泡
            const reuseInit = !currentStepBubbleId && !answerMsgId;
            if (reuseInit) {
              // 将初始气泡转换为第一个步骤气泡
              currentStepBubbleId = initMsgId;
              setMessages(prev => prev.map(m =>
                m.id === initMsgId
                  ? { ...m, bubbleType: 'step', stepTitle, stepId: chunk.stepId, inlinePlan: undefined, streaming: true }
                  : m
              ));
            } else {
              // 关闭上一个步骤气泡
              if (currentStepBubbleId) {
                const prevId = currentStepBubbleId;
                setMessages(prev => prev.map(m => m.id === prevId ? { ...m, streaming: false } : m));
              }
              // 新建步骤气泡
              const newId = `step-${chunk.stepId}-${Date.now()}`;
              currentStepBubbleId = newId;
              const stepMsg: Message = {
                id: newId, role: 'assistant', content: '',
                streaming: true, bubbleType: 'step',
                stepTitle, stepId: chunk.stepId,
              };
              setMessages(prev => [...prev, stepMsg]);
            }
            break;
          }
          case 'step_retry': {
            setStepStatuses(prev => ({ ...prev, [chunk.stepId]: 'running' }));
            setStepRetryCounts(prev => ({ ...prev, [chunk.stepId]: chunk.retryCount }));
            setCurrentStepId(chunk.stepId);
            localCurrentStepId = chunk.stepId;
            break;
          }
          case 'step_end': {
            setStepStatuses(prev => ({ ...prev, [chunk.stepId]: chunk.status === 'error' ? 'error' : 'done' }));
            if (chunk.status !== 'error') {
              setCurrentStepId(null);
              localCurrentStepId = null;
            }
            // 关闭当前步骤气泡的 streaming
            if (currentStepBubbleId) {
              const sid = currentStepBubbleId;
              setMessages(prev => prev.map(m => m.id === sid ? { ...m, streaming: false } : m));
              currentStepBubbleId = null;
            }
            break;
          }
          case 'status_info':
            toast.info(chunk.message, { duration: 4000 });
            break;
          case 'status_warning':
            toast.warning(chunk.message, { duration: 5000 });
            break;
          case 'file_request': {
            // 文件请求写入当前活跃气泡
            const tid = answerMsgId ?? currentStepBubbleId ?? initMsgId;
            setMessages(prev => prev.map(m => {
              if (m.id !== tid) return m;
              const req = { id: chunk.id, filename: chunk.filename, description: chunk.description, mime_types: chunk.mime_types, fulfilled: false };
              return { ...m, fileRequests: [...(m.fileRequests ?? []), req] };
            }));
            break;
          }
        }
      },
      onComplete: async () => {
        networkInterruptedRef.current = false;
        setIsNetworkInterrupted(false);
        streamingAiMsgIdRef.current = null;
        // 关闭所有仍在 streaming 的 AI 气泡
        setMessages(prev => prev.map(m =>
          (m.role === 'assistant' && m.streaming) ? { ...m, streaming: false } : m
        ));
        setIsStreaming(false);
        // 持久化：只保存最终回答文本（answerMsgId 对应的气泡内容）
        const newMsgs = isRegen
          ? [{ role: 'assistant', content: accumulated }]
          : [{ role: 'user', content: userText }, { role: 'assistant', content: accumulated }];
        await persistMessages(newMsgs, selectedRepo, selectedBranch);
        pendingMsgsRef.current = [];
      },
      onError: (err) => {
        const isUserAbort = abortRef.current?.signal.aborted;
        const isNetworkDrop = !isUserAbort && (
          err.message.includes('网络') ||
          err.message.includes('Failed to fetch') ||
          err.message.includes('NetworkError') ||
          err.message.includes('超时') ||
          err.message.includes('timeout') ||
          err.message.includes('中断')
        );
        // 错误写入最后一个活跃气泡
        const errTargetId = answerMsgId ?? currentStepBubbleId ?? initMsgId;
        if (isNetworkDrop) {
          networkInterruptedRef.current = true;
          setIsNetworkInterrupted(true);
          setMessages(prev => prev.map(m =>
            m.id === errTargetId
              ? { ...m, content: accumulated + (accumulated ? '\n\n' : '') + `⚠️ 连接中断：${err.message}`, streaming: false }
              : (m.role === 'assistant' && m.streaming ? { ...m, streaming: false } : m)
          ));
          setIsStreaming(false);
          if (!document.hidden) {
            networkInterruptedRef.current = false;
            toast.warning(`连接中断：${err.message}`, {
              duration: 0,
              id: 'reconnect-toast',
              action: {
                label: '重新连接',
                onClick: () => { toast.dismiss('reconnect-toast'); handleReconnect(); },
              },
            });
          }
        } else {
          setMessages(prev => prev.map(m =>
            m.id === errTargetId
              ? { ...m, content: `❌ ${err.message}`, streaming: false }
              : (m.role === 'assistant' && m.streaming ? { ...m, streaming: false } : m)
          ));
          setIsStreaming(false);
          if (!isUserAbort) toast.error(err.message, { duration: 5000 });
        }
      },
      signal: abortRef.current.signal,
    });
  }, [input, attachments, formatAttachmentsForMessage, isStreaming, messages, selectedRepo, token, modelConfig, selectedBranch, persistMessages]);

  // ── 重连：用上次请求的 history + 一条"请继续"提示，重新发起流式请求 ────────────
  const handleReconnect = useCallback(() => {
    if (isStreaming || !lastRequestBodyRef.current || !selectedRepo || !token) return;
    const prevBody = lastRequestBodyRef.current;
    const userText = lastUserTextRef.current;
    // 在 history 末尾追加一条重连提示，让 AI 从中断处继续
    const reconnectHistory = [
      ...((prevBody.messages as Array<{ role: string; content: string }>) ?? []),
      {
        role: 'user',
        content: '⚠️ 系统提示：上一次连接因网络中断，请从中断处继续完成任务，如果有任务计划，继续执行剩余未完成的步骤。',
      },
    ];

    const aiMsg: Message = { id: Date.now().toString(), role: 'assistant', content: '', streaming: true };
    setMessages(prev => [...prev, aiMsg]);
    setIsStreaming(true);
    abortRef.current = new AbortController();
    streamingAiMsgIdRef.current = aiMsg.id;
    networkInterruptedRef.current = false;

    let accumulated = '';
    const newReqBody = { ...prevBody, messages: reconnectHistory };
    lastRequestBodyRef.current = newReqBody as Record<string, unknown>;

    sendStreamRequest({
      functionUrl: `${SUPABASE_URL}/functions/v1/ai-assistant`,
      requestBody: newReqBody,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      timeoutMs: modelConfig.timeoutMs ?? 300_000,
      signal: abortRef.current.signal,
      onData: (data) => {
        const chunk = parseTypedChunk(data);
        if (!chunk) return;
        if (chunk.type === 'content') {
          accumulated += chunk.content;
          setMessages(prev => prev.map(m => m.id === aiMsg.id ? { ...m, content: accumulated } : m));
        }
      },
      onComplete: async () => {
        networkInterruptedRef.current = false;
        setIsNetworkInterrupted(false);
        streamingAiMsgIdRef.current = null;
        setMessages(prev => prev.map(m => m.id === aiMsg.id ? { ...m, streaming: false } : m));
        setIsStreaming(false);
        await persistMessages(
          [{ role: 'user', content: userText + ' [重连续跑]' }, { role: 'assistant', content: accumulated }],
          selectedRepo, selectedBranch,
        );
      },
      onError: (err) => {
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id ? { ...m, content: `❌ 重连失败：${err.message}`, streaming: false } : m
        ));
        setIsStreaming(false);
        toast.error(`重连失败：${err.message}`);
      },
    });
  }, [isStreaming, selectedRepo, token, modelConfig, selectedBranch, persistMessages]);

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setIsNetworkInterrupted(false);
    networkInterruptedRef.current = false;
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
    setShowFileBrowser(false);
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

  // 文件浏览器插入文本（追加到输入框末尾）
  // ⚠️ 必须在所有条件 return 之前声明，否则违反 React Hooks 规则（error #310）
  const handleFileBrowserInsert = useCallback((text: string) => {
    setInput(prev => prev ? `${prev}\n${text}` : text);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

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

  const lastAiIdx = [...messages].map((m, i) => (m.role === 'assistant' && m.bubbleType !== 'step') ? i : -1).filter(i => i !== -1).pop() ?? -1;

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

        {/* 右侧：流式状态 + 文件浏览器切换 */}
        <div className="flex items-center gap-1 shrink-0">
          {isStreaming && (
            <Badge variant="secondary" className="text-xs animate-pulse">
              <span className="hidden sm:inline">思考中</span>
              <Loader2 className="w-3 h-3 animate-spin sm:hidden" />
            </Badge>
          )}
          <button
            onClick={() => setShowFileBrowser(v => !v)}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              showFileBrowser
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
            title={showFileBrowser ? '关闭文件浏览器' : '打开文件浏览器'}
          >
            <FolderSearch className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowToolHistory(v => !v)}
            className={cn(
              'p-1.5 rounded-md transition-colors relative',
              showToolHistory
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
            title={showToolHistory ? '关闭侧边面板' : '打开侧边面板'}
          >
            <Wrench className="w-3.5 h-3.5" />
            {(toolHistory.length > 0 || taskPlanSteps.length > 0) && !showToolHistory && (
              <span className="absolute top-0 right-0 w-2 h-2 bg-primary rounded-full border border-background" />
            )}
          </button>
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

      {/* 主体区：聊天 + 可选文件浏览器 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── 聊天区域 ── */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

          {/* ── 任务进度条（有任务计划时显示在消息列表顶部） ─────────────── */}
          {taskPlanSteps.length > 0 && (() => {
            const total = taskPlanSteps.length;
            const done = taskPlanSteps.filter(s => {
              const st = stepStatuses[s.id];
              return st === 'done' || st === 'error';
            }).length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const allDone = done === total && !isStreaming;
            const hasError = taskPlanSteps.some(s => stepStatuses[s.id] === 'error');
            return (
              <div className={cn(
                'shrink-0 px-3 py-2 border-b border-border/50 transition-all duration-500',
                allDone ? 'bg-green-500/5' : hasError ? 'bg-destructive/5' : 'bg-primary/5'
              )}>
                <div className="flex items-center gap-2.5">
                  {/* 状态图标 */}
                  {isStreaming && !allDone
                    ? <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />
                    : allDone
                      ? <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                      : hasError
                        ? <XCircle className="w-3 h-3 text-destructive shrink-0" />
                        : <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                  }
                  {/* 标签 */}
                  <span className={cn(
                    'text-[11px] font-medium shrink-0',
                    allDone ? 'text-green-600 dark:text-green-400'
                      : hasError ? 'text-destructive'
                        : 'text-primary'
                  )}>
                    {allDone ? '任务完成' : isStreaming ? '执行中' : '已完成'}
                  </span>
                  {/* 进度条 */}
                  <div className="flex-1 h-1.5 rounded-full bg-border/60 overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        allDone ? 'bg-green-500'
                          : hasError ? 'bg-destructive'
                            : 'bg-primary'
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {/* 步骤计数 */}
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                    {done}/{total}
                  </span>
                </div>
              </div>
            );
          })()}

          {/* 消息列表：原生 div 替代 ScrollArea，避免 Android WebView 中 Radix 内部宽度偏差截断文字 */}
          <div
            ref={scrollAreaRef}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div className="flex flex-col gap-3 p-4 pb-2">
              {messages.map((msg, idx) => {
                const isLastAi = idx === lastAiIdx;

                // ── 用户消息 ─────────────────────────────────────────────────
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="flex gap-2.5 flex-row-reverse">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-primary text-primary-foreground">
                        <User className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex flex-col gap-1 min-w-0 max-w-[85%]">
                        <div className="rounded-2xl rounded-tr-sm px-4 py-3 text-sm min-w-0 bg-primary text-primary-foreground">
                          <p className="whitespace-pre-wrap break-words break-all">{msg.content}</p>
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {msg.attachments.map(att => (
                                <div key={att.id} className="flex items-center gap-1 rounded-md border border-primary-foreground/30 bg-primary-foreground/10 px-2 py-1 text-xs text-primary-foreground/90">
                                  {att.type === 'image'
                                    ? <img src={att.content} alt={att.name} className="w-5 h-5 rounded object-cover shrink-0" />
                                    : <FileText className="w-3.5 h-3.5 shrink-0" />}
                                  <span className="truncate max-w-[120px]">{att.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── AI：step 气泡（工具执行节点）────────────────────────────
                if (msg.bubbleType === 'step') {
                  return (
                    <StepBubble
                      key={msg.id}
                      msg={msg}
                      onUploadFile={(msgId, reqId, file) => {
                        setMessages(prev => prev.map(m =>
                          m.id === msgId
                            ? { ...m, fileRequests: m.fileRequests?.map(r => r.id === reqId ? { ...r, fulfilled: true } : r) }
                            : m
                        ));
                        const reader = new FileReader();
                        const isImage = file.type.startsWith('image/');
                        reader.onload = (ev) => {
                          const content = ev.target?.result as string;
                          const att: Attachment = { id: `att-${Date.now()}`, name: file.name, type: isImage ? 'image' : 'text', mimeType: file.type, content, size: file.size };
                          const attText = isImage ? `\n\n[图片附件: ${file.name}]\n${content}` : `\n\n[文件附件: ${file.name}]\n\`\`\`\n${content}\n\`\`\``;
                          handleSend(`已上传文件 ${file.name}，请继续执行任务。${attText}`, false);
                        };
                        if (isImage) reader.readAsDataURL(file);
                        else reader.readAsText(file);
                      }}
                    />
                  );
                }

                // ── AI：思考气泡 ─────────────────────────────────────────────
                if (msg.bubbleType === 'thinking') {
                  return <ThinkingBubble key={msg.id} msg={msg} />;
                }

                // ── AI：工具调用气泡 ─────────────────────────────────────────
                if (msg.bubbleType === 'tool') {
                  return <ToolBubble key={msg.id} msg={msg} />;
                }

                // ── AI：answer 气泡 / 普通单气泡 ─────────────────────────────
                return (
                  <div key={msg.id} className="flex gap-2.5 flex-row">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-muted border border-border">
                      <Bot className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                      <div className={cn(
                        'rounded-2xl rounded-tl-sm px-4 py-3 text-sm min-w-0 bg-muted/60 border border-border text-foreground',
                        !msg.streaming && msg.content.length > 600 ? 'max-h-[60vh] overflow-y-auto' : ''
                      )}>
                        <div className="min-w-0">
                          {/* 正文内容 */}
                          {msg.content ? (
                            msg.content.includes('## 🔧 修复清单')
                              ? <RepairChecklist content={msg.content} />
                              : renderMarkdown(msg.content)
                          ) : (
                            msg.streaming
                              ? <span className="inline-block w-1.5 h-4 bg-primary animate-pulse rounded-sm align-middle" />
                              : <span className="text-muted-foreground text-sm">…</span>
                          )}
                          {msg.streaming && msg.content && (
                            <span className="inline-block w-1.5 h-4 bg-primary ml-0.5 animate-pulse rounded-sm align-middle" />
                          )}
                          {/* 无 step 拆分时的旧式内联面板（兼容简单工具回答） */}
                          {(msg.inlinePlan || msg.inlineTools) && (
                            <InlineActivityPanel
                              inlinePlan={msg.inlinePlan}
                              inlineTools={msg.inlineTools}
                              streaming={msg.streaming}
                            />
                          )}
                          {/* 文件请求 */}
                          {msg.fileRequests && msg.fileRequests.length > 0 && (
                            <div className="mt-3 flex flex-col gap-2">
                              {msg.fileRequests.map(freq => (
                                <FileRequestCard
                                  key={freq.id}
                                  request={freq}
                                  onUpload={(file) => {
                                    setMessages(prev => prev.map(m =>
                                      m.id === msg.id
                                        ? { ...m, fileRequests: m.fileRequests?.map(r => r.id === freq.id ? { ...r, fulfilled: true } : r) }
                                        : m
                                    ));
                                    const reader = new FileReader();
                                    const isImage = file.type.startsWith('image/');
                                    reader.onload = (ev) => {
                                      const content = ev.target?.result as string;
                                      const att: Attachment = { id: `att-${Date.now()}`, name: file.name, type: isImage ? 'image' : 'text', mimeType: file.type, content, size: file.size };
                                      const attText = isImage ? `\n\n[图片附件: ${file.name}]\n${content}` : `\n\n[文件附件: ${file.name}]\n\`\`\`\n${content}\n\`\`\``;
                                      handleSend(`已上传文件 ${file.name}，请继续执行任务。${attText}`, false);
                                    };
                                    if (isImage) reader.readAsDataURL(file);
                                    else reader.readAsText(file);
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* 操作栏：仅 answer/普通气泡 */}
                      {!msg.streaming && msg.content && (
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
                          {isLastAi && (msg.content.includes('✅ 文件') || msg.content.includes('✅ 已 patch') || msg.content.includes('✅ 分支')) && (
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
          </div>

          {/* 快捷指令（首次入场显示） */}
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
            <div className={cn(
              'rounded-xl border bg-background transition-shadow duration-200',
              isStreaming
                ? 'border-primary/40 shadow-sm shadow-primary/10'
                : 'border-border hover:border-border/80 focus-within:border-primary/50 focus-within:shadow-sm focus-within:shadow-primary/10'
            )}>
              {/* 工具栏 */}
              <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
                <div className="flex items-center gap-1">
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
                  {/* 文件浏览器快捷开关（输入框内） */}
                  <button
                    onClick={() => setShowFileBrowser(v => !v)}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors',
                      showFileBrowser
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-primary hover:bg-primary/8'
                    )}
                    title="文件浏览器"
                  >
                    <PanelRight className="w-3 h-3 shrink-0" />
                    <span className="hidden sm:inline">文件</span>
                  </button>
                </div>
                <div className="flex items-center gap-0.5">
                  {sessionId && (
                    <span className="text-[10px] text-green-500 px-1" title="对话已保存">●</span>
                  )}
                  <div className="w-px h-3.5 bg-border mx-0.5" />
                  <button
                    onClick={() => setShowHistory(true)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/8 transition-colors"
                    title="历史对话"
                  >
                    <History className="w-3.5 h-3.5" />
                  </button>
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

              <div className="mx-3 h-px bg-border/60" />

              {/* 断连重连提示条 */}
              {isNetworkInterrupted && !isStreaming && (
                <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="flex-1 min-w-0 text-xs text-amber-700 dark:text-amber-300 truncate">
                    连接已中断，任务未完成
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                    onClick={() => { setIsNetworkInterrupted(false); handleReconnect(); }}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    重新连接
                  </Button>
                  <button
                    className="text-amber-500/60 hover:text-amber-600 dark:hover:text-amber-400 text-xs shrink-0"
                    onClick={() => setIsNetworkInterrupted(false)}
                    title="忽略"
                  >✕</button>
                </div>
              )}

              {/* 附件预览条（有附件时显示在输入框上方） */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                  {attachments.map(att => (
                    <div key={att.id} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-2 py-1 text-xs text-foreground max-w-[180px]">
                      {att.type === 'image'
                        ? <img src={att.content} alt={att.name} className="w-5 h-5 rounded object-cover shrink-0" />
                        : <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                      }
                      <span className="flex-1 min-w-0 truncate">{att.name}</span>
                      <button
                        onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                        className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                        title="移除附件"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 隐藏 file input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,text/*,.ts,.tsx,.js,.jsx,.json,.yaml,.yml,.md,.py,.go,.kt,.swift,.sh,.env,.xml,.html,.css,.txt"
                className="hidden"
                onChange={handleFileSelect}
              />

              <div className="flex items-end gap-2 px-3 py-2">
                {/* 附件上传按钮 */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isStreaming}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/8 transition-colors disabled:opacity-40"
                  title="上传文件或图片"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
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
        </div>

        {/* ── 文件浏览器侧边面板 ──
            手机端：fixed 全屏遮罩（不挤压对话区）
            桌面端：inline w-56 紧贴右侧                   */}
        {showFileBrowser && selectedRepo && (
          <>
            {/* 手机端半透明遮罩（点击关闭） */}
            <div
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
              onClick={() => setShowFileBrowser(false)}
            />
            {/* 面板本体：手机 fixed right 抽屉，桌面 inline */}
            <div className={cn(
              'flex flex-col overflow-hidden border-border bg-background',
              // 手机：从右侧滑出，不压缩对话区
              'fixed inset-y-0 right-0 z-50 w-[85%] max-w-xs shadow-2xl border-l',
              // 桌面：回归原来的内联布局
              'md:static md:w-56 md:shrink-0 md:min-h-0 md:shadow-none md:z-auto'
            )}>
              <FileBrowserPanel
                owner={selectedRepo.owner.login}
                repo={selectedRepo.name}
                branch={selectedBranch}
                onInsert={handleFileBrowserInsert}
                onClose={() => setShowFileBrowser(false)}
              />
            </div>
          </>
        )}

        {/* ── 工具调用 & 任务计划 侧边面板（Tab 切换）──
            手机端：fixed 全屏遮罩（不挤压对话区）
            桌面端：inline w-64 紧贴右侧                   */}
        {showToolHistory && (
          <>
            {/* 手机端半透明遮罩（点击关闭） */}
            <div
              className="fixed inset-0 z-40 bg-black/40 md:hidden"
              onClick={() => setShowToolHistory(false)}
            />
            {/* 面板本体 */}
            <div className={cn(
              'flex flex-col overflow-hidden border-border bg-background',
              'fixed inset-y-0 right-0 z-50 w-[88%] max-w-sm shadow-2xl border-l',
              'md:static md:w-64 md:shrink-0 md:min-h-0 md:shadow-none md:z-auto'
            )}>
              {/* Tab 标签行 */}
              <div className="flex items-stretch border-b border-border shrink-0 bg-muted/20">
                <button
                  onClick={() => setSidePanelTab('plan')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors relative',
                    sidePanelTab === 'plan'
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <ListChecks className="w-3.5 h-3.5 shrink-0" />
                  任务计划
                  {taskPlanSteps.length > 0 && (
                    <span className="text-[9px] font-mono bg-primary/10 text-primary px-1 rounded">
                      {taskPlanSteps.length}
                    </span>
                  )}
                  {sidePanelTab === 'plan' && (
                    <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-t" />
                  )}
                </button>
                <button
                  onClick={() => setSidePanelTab('tools')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-colors relative',
                    sidePanelTab === 'tools'
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Wrench className="w-3.5 h-3.5 shrink-0" />
                  工具历史
                  {toolHistory.length > 0 && (
                    <span className="text-[9px] font-mono bg-muted text-muted-foreground px-1 rounded">
                      {toolHistory.length}
                    </span>
                  )}
                  {sidePanelTab === 'tools' && (
                    <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-t" />
                  )}
                </button>
                {/* 关闭按钮（手机端更大触控区） */}
                <button
                  onClick={() => setShowToolHistory(false)}
                  className="px-3 text-muted-foreground hover:text-foreground transition-colors min-w-[44px] flex items-center justify-center"
                  title="关闭面板"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {/* Tab 内容 */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {sidePanelTab === 'plan' ? (
                  <TaskPlanPanel
                    steps={taskPlanSteps}
                    stepStatuses={stepStatuses}
                    stepRetryCounts={stepRetryCounts}
                    currentStepId={currentStepId}
                  />
                ) : sidePanelTab === 'history' ? (
                  <WorkflowHistoryPanel userId={user?.login ?? 'anonymous'} />
                ) : (
                  <ToolHistoryPanel items={toolHistory} />
                )}
              </div>
            </div>
          </>
        )}
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

// ── FileRequestCard：AI 请求用户上传文件时显示的内联卡片 ──────────────────────
interface FileRequestCardProps {
  request: FileRequest;
  onUpload: (file: File) => void;
}

function FileRequestCard({ request, onUpload }: FileRequestCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = '';
  };

  if (request.fulfilled) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/8 px-3 py-2 text-xs text-green-700 dark:text-green-400">
        <ImageIcon className="w-3.5 h-3.5 shrink-0" />
        <span>文件已上传：{request.filename}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
      <div className="flex items-start gap-2 mb-2">
        <Paperclip className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground">需要上传文件</p>
          <p className="text-xs text-muted-foreground mt-0.5 break-words">{request.description}</p>
          {request.filename && (
            <p className="text-[10px] text-primary/70 mt-0.5">文件名：{request.filename}</p>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={request.mime_types || '*/*'}
        className="hidden"
        onChange={handleChange}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="w-full flex items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium py-1.5 transition-colors"
      >
        <Paperclip className="w-3 h-3" />
        选择文件上传
      </button>
    </div>
  );
}

// ── RepairChecklist：修复清单特殊渲染卡片 ─────────────────────────────────────
interface CheckItem {
  id: string;
  text: string;
  done: boolean;
}

interface RepairSection {
  title: string;
  items: CheckItem[];
  isNote?: boolean;
}

function parseRepairSections(content: string): RepairSection[] {
  const sections: RepairSection[] = [];
  // 按 ### 分割
  const parts = content.split(/^### /m).filter(Boolean);
  for (const part of parts) {
    const lines = part.split('\n');
    const title = lines[0].trim();
    const isNote = title.startsWith('⚠️');
    const items: CheckItem[] = [];
    for (const line of lines.slice(1)) {
      const m = line.match(/^- \[([ xX])\] (.+)/);
      if (m) {
        items.push({ id: crypto.randomUUID(), text: m[2].trim(), done: m[1] !== ' ' });
      } else if (line.match(/^- \*\*/) || (isNote && line.match(/^- /))) {
        // 注意事项条目（非 checkbox）
        items.push({ id: crypto.randomUUID(), text: line.replace(/^- /, '').trim(), done: false });
      }
    }
    if (items.length > 0) sections.push({ title, items, isNote });
  }
  return sections;
}

function RepairChecklist({ content }: { content: string }) {
  // 提取清单部分（从 ## 🔧 修复清单 到下一个 ## 或文末）
  const checklistMatch = content.match(/## 🔧 修复清单[\s\S]+/);
  const rest = content.replace(/## 🔧 修复清单[\s\S]+/, '').trim();
  if (!checklistMatch) return <>{renderMarkdown(content)}</>;

  const checklistRaw = checklistMatch[0];
  const sections = parseRepairSections(checklistRaw);

  // 每个 section 的 items 用 state 管理勾选
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    sections.forEach(s => s.items.forEach(it => { init[it.id] = it.done; }));
    return init;
  });

  const toggle = (id: string) => setChecked(prev => ({ ...prev, [id]: !prev[id] }));

  const totalItems = sections.filter(s => !s.isNote).reduce((acc, s) => acc + s.items.length, 0);
  const doneItems = sections.filter(s => !s.isNote).reduce((acc, s) => acc + s.items.filter(it => checked[it.id]).length, 0);
  const allDone = totalItems > 0 && doneItems === totalItems;

  // 提取引导语（### 之前的文字）
  const introMatch = checklistRaw.match(/## 🔧 修复清单\n+(> [^\n]+\n+)?/);
  const intro = introMatch ? introMatch[0].replace(/## 🔧 修复清单\n+/, '').replace(/^> /, '').trim() : '';

  return (
    <div className="flex flex-col gap-2 min-w-0 w-full">
      {/* 清单前的普通内容 */}
      {rest && renderMarkdown(rest)}

      {/* 修复清单卡片 */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/8 overflow-hidden">
        {/* 卡片头部 */}
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
          <div className="flex items-center gap-2 min-w-0">
            <Wrench className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-semibold text-amber-800 dark:text-amber-300 truncate">修复清单</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {allDone
              ? <span className="text-[11px] text-green-600 dark:text-green-400 font-medium">全部完成 ✓</span>
              : <span className="text-[11px] text-amber-600 dark:text-amber-400">{doneItems}/{totalItems} 已完成</span>
            }
            {/* 进度条 */}
            <div className="w-16 h-1.5 rounded-full bg-amber-200/60 dark:bg-amber-900/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-500 dark:bg-amber-400 transition-all duration-300"
                style={{ width: totalItems ? `${(doneItems / totalItems) * 100}%` : '0%' }}
              />
            </div>
          </div>
        </div>

        {/* 引导语 */}
        {intro && (
          <p className="px-3.5 pt-2.5 pb-0 text-xs text-amber-700 dark:text-amber-400/80 break-words text-pretty">{intro}</p>
        )}

        {/* 各 Section */}
        <div className="px-3.5 py-2.5 flex flex-col gap-3">
          {sections.map((section, si) => (
            <div key={si} className="flex flex-col gap-1.5">
              {/* section 标题 */}
              <p className={`text-xs font-semibold break-words text-balance ${section.isNote ? 'text-muted-foreground' : 'text-foreground'}`}>
                {section.title}
              </p>
              {/* items */}
              <div className="flex flex-col gap-1">
                {section.items.map(item => (
                  <label
                    key={item.id}
                    className={`flex items-start gap-2.5 min-h-[2rem] cursor-pointer group ${section.isNote ? 'cursor-default' : ''}`}
                    onClick={section.isNote ? undefined : () => toggle(item.id)}
                  >
                    {!section.isNote && (
                      <span className={`mt-[2px] shrink-0 w-4 h-4 rounded border-[1.5px] flex items-center justify-center transition-colors
                        ${checked[item.id]
                          ? 'bg-green-500 border-green-500 text-white'
                          : 'border-amber-400/60 group-hover:border-amber-500'
                        }`}>
                        {checked[item.id] && <span className="text-[9px] font-bold leading-none">✓</span>}
                      </span>
                    )}
                    {section.isNote && (
                      <span className="mt-[3px] shrink-0 text-amber-500/60">•</span>
                    )}
                    <span className={`text-xs leading-relaxed break-words min-w-0 flex-1
                      ${!section.isNote && checked[item.id] ? 'line-through text-muted-foreground/60' : 'text-foreground/90'}
                      ${section.isNote ? 'text-muted-foreground' : ''}
                    `}>
                      {item.text}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 底部提示 */}
        <div className="px-3.5 pb-2.5">
          <p className="text-[11px] text-amber-600/70 dark:text-amber-400/60 text-pretty">
            修复完成后，回复「重新构建」即可自动触发 CI 验证。
          </p>
        </div>
      </div>
    </div>
  );
}

// ── StepBubble：任务步骤气泡，完成后自动折叠工具列表 ─────────────────────────
interface StepBubbleProps {
  msg: Message;
  onUploadFile: (msgId: string, reqId: string, file: File) => void;
}

function StepBubble({ msg, onUploadFile }: StepBubbleProps) {
  const hasError = false; // 错误由独立 tool 气泡展示
  const stepDone = !msg.streaming;

  return (
    <div className="flex gap-2.5 flex-row">
      {/* 状态指示列 */}
      <div className="flex flex-col items-center shrink-0 mt-1">
        <div className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center border transition-colors',
          msg.streaming
            ? 'bg-primary/10 border-primary/30'
            : hasError
              ? 'bg-destructive/10 border-destructive/30'
              : 'bg-green-500/10 border-green-500/30'
        )}>
          {msg.streaming
            ? <Loader2 className="w-3 h-3 text-primary animate-spin" />
            : hasError
              ? <XCircle className="w-3 h-3 text-destructive" />
              : <CheckCircle2 className="w-3 h-3 text-green-500" />}
        </div>
        {/* 连接线 */}
        <div className="w-px flex-1 min-h-[8px] bg-border/40 mt-1" />
      </div>

      <div className="flex flex-col gap-1 flex-1 min-w-0 pb-1">
        {/* 标题行 */}
        <div className={cn(
          'flex items-center gap-2 rounded-xl px-3 py-2 border text-sm min-w-0',
          msg.streaming
            ? 'bg-primary/5 border-primary/20'
            : 'bg-muted/40 border-border/50'
        )}>
          <span className={cn(
            'font-medium text-xs truncate flex-1',
            msg.streaming ? 'text-primary' : 'text-foreground/70'
          )}>
            {msg.stepTitle ?? '执行中'}
          </span>
          {msg.streaming && (
            <span className="text-[10px] text-primary/70 shrink-0 animate-pulse">进行中…</span>
          )}
          {stepDone && !hasError && (
            <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
          )}
        </div>

        {/* 计划概览（首个步骤气泡展示任务列表） */}
        {msg.inlinePlan && (
          <div className="pl-1">
            <InlineActivityPanel
              inlinePlan={msg.inlinePlan}
              streaming={msg.streaming}
            />
          </div>
        )}

        {/* 文件请求 */}
        {msg.fileRequests && msg.fileRequests.length > 0 && (
          <div className="flex flex-col gap-2 pl-1">
            {msg.fileRequests.map(freq => (
              <FileRequestCard
                key={freq.id}
                request={freq}
                onUpload={(file) => onUploadFile(msg.id, freq.id, file)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ThinkingBubble：AI 思考过程独立气泡 ──────────────────────────────────────
function ThinkingBubble({ msg }: { msg: Message }) {
  const content = msg.thinkingContent ?? '';
  const done = msg.thinkingDone ?? false;

  // 思考中默认展开；完成后自动折叠（留 600ms 让用户感知完成）
  const [expanded, setExpanded] = useState(!done);
  const prevDoneRef = useRef(done);

  useEffect(() => {
    if (!prevDoneRef.current && done) {
      prevDoneRef.current = true;
      const t = setTimeout(() => setExpanded(false), 600);
      return () => clearTimeout(t);
    }
  }, [done]);

  // 折叠时展示内容摘要（最多 36 字）
  const preview = content.replace(/\s+/g, ' ').trim().slice(0, 36);

  return (
    <div className="flex gap-2 flex-row pl-2">
      {/* 左侧时间轴竖线 */}
      <div className="flex flex-col items-center shrink-0">
        <div className={cn(
          'w-px self-stretch mx-3 rounded-full transition-colors duration-500',
          done ? 'bg-border/30' : 'bg-primary/30'
        )} />
      </div>

      <div className="flex-1 min-w-0 max-w-[92%] py-0.5">
        {/* 折叠头部 */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-0.5 w-full text-left group"
        >
          {done
            ? <CheckCircle2 className="w-3 h-3 text-primary/50 shrink-0" />
            : <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />}

          <span className={cn(
            'font-medium tracking-wide shrink-0',
            done ? 'text-muted-foreground/70' : 'text-muted-foreground'
          )}>
            {done ? '思考完成' : '思考中…'}
          </span>

          {/* 折叠时展示预览文本 */}
          {!expanded && preview && (
            <span className="text-muted-foreground/40 truncate flex-1 italic hidden sm:block">
              {preview}{content.length > 36 ? '…' : ''}
            </span>
          )}

          {content && (
            <span className="ml-auto shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors">
              {expanded
                ? <ChevronDown className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />}
            </span>
          )}
        </button>

        {/* 展开的思考内容 */}
        {expanded && content && (
          <div className={cn(
            'mt-1 rounded-lg border px-3 py-2.5 max-h-[200px] overflow-y-auto scrollbar-thin',
            done
              ? 'bg-muted/10 border-border/30'
              : 'bg-primary/5 border-primary/15 animate-pulse-subtle'
          )}>
            <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap italic break-words">
              {content}
              {!done && <span className="inline-block w-1 h-3 ml-1 bg-primary/50 animate-pulse align-middle rounded-sm" />}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ToolBubble：单个工具调用独立气泡 ─────────────────────────────────────────
function ToolBubble({ msg }: { msg: Message }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = msg.toolStatus === 'running';
  const isFail = msg.toolStatus === 'fail';
  const isSuccess = msg.toolStatus === 'success';
  const result = msg.toolResult ?? '';
  // 结果超过 80 字符时可展开
  const canExpand = result.length > 80;

  return (
    <div className="flex gap-2.5 flex-row pl-2">
      {/* 左侧竖线装饰 */}
      <div className="flex flex-col items-center shrink-0">
        <div className="w-1 self-stretch rounded-full bg-border/30 mx-2.5" />
      </div>

      <div className="flex-1 min-w-0 max-w-[92%]">
        {/* 主行：工具名 + 状态 + 耗时 */}
        <button
          onClick={() => canExpand && setExpanded(v => !v)}
          disabled={!canExpand}
          className={cn(
            'flex items-center gap-2 w-full text-left rounded-lg px-3 py-1.5 border text-xs transition-colors',
            isRunning
              ? 'bg-muted/30 border-border/40'
              : isFail
                ? 'bg-destructive/5 border-destructive/20'
                : 'bg-muted/20 border-border/30 hover:bg-muted/40',
            canExpand && !isRunning ? 'cursor-pointer' : 'cursor-default'
          )}
        >
          {/* 状态图标 */}
          {isRunning && <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />}
          {isSuccess && <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />}
          {isFail && <XCircle className="w-3 h-3 text-destructive shrink-0" />}

          {/* 工具标签 */}
          <span className={cn(
            'font-medium truncate flex-1',
            isRunning ? 'text-foreground/80' : isFail ? 'text-destructive' : 'text-foreground/70'
          )}>
            {msg.toolLabel || msg.toolName || '工具调用'}
          </span>

          {/* 提示（hint） */}
          {msg.toolHint && (
            <span className="text-muted-foreground/60 truncate max-w-[120px] hidden sm:block">
              {msg.toolHint}
            </span>
          )}

          {/* 耗时 */}
          {msg.toolElapsedMs != null && (
            <span className={cn(
              'font-mono shrink-0',
              isFail ? 'text-destructive/70' : 'text-muted-foreground/50'
            )}>
              {msg.toolElapsedMs < 1000
                ? `${msg.toolElapsedMs}ms`
                : `${(msg.toolElapsedMs / 1000).toFixed(1)}s`}
            </span>
          )}

          {/* 展开箭头 */}
          {canExpand && !isRunning && (
            expanded
              ? <ChevronDown className="w-3 h-3 text-muted-foreground/50 shrink-0" />
              : <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          )}
        </button>

        {/* 展开的结果内容 */}
        {expanded && result && (
          <div className="mt-1 rounded-lg border border-border/40 bg-muted/10 px-3 py-2 max-h-[200px] overflow-y-auto scrollbar-thin">
            <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words leading-relaxed font-mono">
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}