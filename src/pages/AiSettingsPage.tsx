// AI 设置中心 — 功能入口 + 次级配置页
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  MODEL_DEFS,
  ModelAvatar,
  getModelDef,
  loadModelConfig,
  loadProviderKey,
  saveModelConfig,
  saveProviderKey,
} from '@/components/ai/aiUtils';
import {
  fetchModelsFromAPI,
  getDefaultProviderModel,
  testProviderConnection,
} from '@/components/ai/aiProviders';
import type { ModelConfig } from '@/components/ai/aiTypes';
import { clearArtifacts, listArtifacts } from '@/ai-v2/artifacts';
import { clearRuns, listRuns } from '@/ai-v2/runStore';
import { clearMemories, deleteMemory, listMemories } from '@/ai-v2/memory';
import { SKILLS } from '@/ai-v2/skills';
import { loadV2Settings, saveV2Settings } from '@/ai-v2/settings';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import i18n from '@/i18n';
import {
  Activity,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Database,
  FileText,
  HardDrive,
  GitBranch,
  GitPullRequest,
  KeyRound,
  Loader2,
  Network,
  RefreshCw,
  Save,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal,
  Timer,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';

type Section = 'model' | 'generation' | 'proxy' | 'context' | 'tools' | 'skills' | 'diagnostics';

const SECTIONS: Array<{
  id: Section;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'model', title: '模型与提供商', desc: 'Provider、API Key、默认模型', icon: Cpu },
  { id: 'generation', title: '生成参数', desc: '超时、思考强度与输出行为', icon: SlidersHorizontal },
  { id: 'proxy', title: '模型代理', desc: '内置代理或自定义 Worker 地址', icon: Network },
  { id: 'context', title: '上下文与记忆', desc: '会话存储、清理与本地数据', icon: Database },
  { id: 'tools', title: '工具与权限', desc: '当前可用工具和风险边界', icon: Wrench },
  { id: 'skills', title: '技能', desc: '按任务自动加载的内置技能', icon: BrainCircuit },
  { id: 'diagnostics', title: '诊断与测试', desc: '连接测试、模型列表与错误排查', icon: Activity },
];

const TIMEOUT_OPTIONS = [
  { value: 60000, label: '1 分钟' },
  { value: 180000, label: '3 分钟' },
  { value: 300000, label: '5 分钟（推荐）' },
  { value: 600000, label: '10 分钟' },
  { value: 900000, label: '15 分钟' },
];

const REASONING_OPTIONS = [
  { value: 'auto', label: '自动（模型默认）' },
  { value: 'off', label: '关闭思考' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'max', label: '最大' },
];

const RUN_STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  done: '完成',
  error: '失败',
  stopped: '已停止',
};

const CONTEXT_BUDGET_OPTIONS = [
  { value: 16000, label: '16K（轻量）' },
  { value: 32000, label: '32K（推荐）' },
  { value: 64000, label: '64K' },
  { value: 128000, label: '128K（长任务）' },
];

function SectionHeader({
  title,
  desc,
  onBack,
  onSave,
}: {
  title: string;
  desc: string;
  onBack: () => void;
  onSave?: () => void;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <Button type="button" variant="ghost" size="icon" className="mt-0.5 h-8 w-8 shrink-0" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      {onSave && (
        <Button type="button" size="sm" className="h-8 shrink-0 gap-1 px-3" onClick={onSave}>
          <Save className="h-3.5 w-3.5" />
          {i18n.t('保存')}
        </Button>
      )}
    </div>
  );
}

function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-normal">{label}</Label>
      {children}
      {desc && <p className="text-[11px] leading-5 text-muted-foreground">{desc}</p>}
    </div>
  );
}

export default function AiSettingsPage() {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [config, setConfig] = useState<ModelConfig>(() => loadModelConfig());
  const [v2Settings, setV2Settings] = useState(() => loadV2Settings());
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testResult, setTestResult] = useState('');
  const [modelsState, setModelsState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [modelsError, setModelsError] = useState('');
  const [fetchedModels, setFetchedModels] = useState<Array<{ id: string; name: string }>>([]);
  const [storageVersion, setStorageVersion] = useState(0);

  const activeSection = SECTIONS.find(item => item.id === section);
  const modelDef = useMemo(() => getModelDef(config.type), [config.type]);
  const hasKey = Boolean(config.api_key?.trim());

  useEffect(() => {
    setConfig(loadModelConfig());
    setV2Settings(loadV2Settings());
    setTestState('idle');
    setTestResult('');
    setModelsState('idle');
    setModelsError('');
    setFetchedModels([]);
  }, [section]);

  const go = (next: Section | '') => {
    navigate(next ? `/ai-settings/${next}` : '/ai-settings');
  };

  const saveConfig = (next: ModelConfig, validateProvider = true) => {
    const def = getModelDef(next.type);
    if (validateProvider && def.needKey && !next.api_key?.trim()) {
      toast.error(i18n.t('请先填写 API Key'));
      return;
    }
    if (validateProvider && def.needEndpoint && !next.endpoint?.trim()) {
      toast.error(i18n.t('请先填写接口地址'));
      return;
    }
    if (next.api_key) saveProviderKey(next.type, next.api_key);
    saveModelConfig(next);
    setConfig(next);
    toast.success(i18n.t('设置已保存'));
    go('');
  };

  const changeProvider = (type: ModelConfig['type']) => {
    const savedKey = loadProviderKey(type);
    setConfig(prev => ({
      ...prev,
      type,
      api_key: savedKey || undefined,
      endpoint: type === 'custom' ? prev.endpoint : undefined,
      model: getDefaultProviderModel(type),
    }));
    setTestState('idle');
    setTestResult('');
  };

  const handleTest = async () => {
    if (!config.api_key?.trim()) {
      toast.error(i18n.t('请先填写 API Key'));
      return;
    }
    setTestState('testing');
    setTestResult('');
    const result = await testProviderConnection(
      config.type,
      config.api_key,
      config.endpoint,
      config.model,
      config.proxy_url,
    );
    if (result.success) {
      setTestState('success');
      setTestResult(`${i18n.t('连接成功')} (${result.elapsedMs ?? 0}ms)`);
    } else {
      setTestState('error');
      setTestResult(result.error || i18n.t('连接失败'));
    }
  };

  const handleFetchModels = async () => {
    if (!config.api_key?.trim()) {
      toast.error(i18n.t('请先填写 API Key'));
      return;
    }
    setModelsState('loading');
    setModelsError('');
    try {
      const models = await fetchModelsFromAPI(config.type, config.api_key, config.endpoint);
      setFetchedModels(models);
      setModelsState('success');
    } catch (error) {
      setModelsState('error');
      setModelsError((error as Error).message || i18n.t('获取失败'));
    }
  };

  const clearSessions = () => {
    if (!window.confirm(i18n.t('确定清除本机所有 AI 会话？此操作不可撤销。'))) return;
    try {
      const keys = Object.keys(localStorage).filter(key =>
        key.startsWith('githubm_ai_v2_store:') || key.startsWith('githubm_ai_v2_session:'),
      );
      keys.forEach(key => localStorage.removeItem(key));
      setStorageVersion(version => version + 1);
      toast.success(i18n.t('已清除本机会话'));
    } catch {
      toast.error(i18n.t('清除失败'));
    }
  };

  const sessions = useMemo(() => {
    try {
      return Object.keys(localStorage)
        .filter(key => key.startsWith('githubm_ai_v2_store:'))
        .map(key => {
          const raw = localStorage.getItem(key) || '';
          const data = JSON.parse(raw) as { sessions?: unknown[] };
          return { key, count: Array.isArray(data.sessions) ? data.sessions.length : 0 };
        });
    } catch {
      return [];
    }
  }, [section, storageVersion]);

  const runs = useMemo(() => listRuns(user?.login, 6), [user?.login, storageVersion]);
  const artifacts = useMemo(() => listArtifacts(user?.login, 20), [user?.login, storageVersion]);
  const memories = useMemo(() => listMemories(user?.login, 50), [user?.login, storageVersion]);

  const updateV2Settings = (patch: Partial<typeof v2Settings>) => {
    const next = { ...v2Settings, ...patch };
    setV2Settings(next);
    saveV2Settings(next);
  };

  if (!activeSection) {
    return (
      <div className="mx-auto min-h-full w-full max-w-3xl px-3 py-4 sm:px-4">
        <div className="mb-4 flex items-start gap-3">
          <Button type="button" variant="ghost" size="icon" className="mt-0.5 h-8 w-8 shrink-0" onClick={() => navigate('/ai-assistant')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{i18n.t('AI 设置')}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{i18n.t('模型、工具和会话各自独立配置，避免所有选项挤在一个页面。')}</p>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
          <div className="flex items-center gap-3">
            <ModelAvatar modelDef={modelDef} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-medium">{modelDef.label}</p>
                <Badge variant={hasKey ? 'secondary' : 'destructive'} className="px-1.5 py-0 text-[9px]">
                  {hasKey ? i18n.t('已配置') : i18n.t('未配置 Key')}
                </Badge>
              </div>
              <p className="truncate text-[11px] text-muted-foreground">{config.model || modelDef.models?.[0]?.label || modelDef.type}</p>
            </div>
            <Button type="button" size="sm" className="h-8 shrink-0 px-2.5 text-xs" onClick={() => go('model')}>
              {i18n.t('配置')}
            </Button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {SECTIONS.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/35 hover:bg-primary/5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{i18n.t(item.title)}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{i18n.t(item.desc)}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>

        <p className="mt-4 px-1 text-[10px] leading-5 text-muted-foreground">
          {i18n.t('配置仅保存在本机。切换设置页不会重置当前会话。')}
        </p>
      </div>
    );
  }

  if (activeSection.id === 'model') {
    const def = modelDef;
    const modelOptions = def.models?.map(model => ({ value: model.value, label: model.label })) || [];
    return (
      <div className="mx-auto min-h-full w-full max-w-2xl px-3 py-4 sm:px-4">
        <SectionHeader
          title={i18n.t('模型与提供商')}
          desc={i18n.t('选择 Provider、填写 Key，并指定默认模型。')}
          onBack={() => go('')}
          onSave={() => saveConfig(config)}
        />
        <div className="space-y-5 rounded-xl border border-border bg-card p-4">
          <SettingRow label={i18n.t('提供商')} desc={def.desc}>
            <Select value={config.type} onValueChange={value => changeProvider(value as ModelConfig['type'])}>
              <SelectTrigger className="px-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODEL_DEFS.map(item => (
                  <SelectItem key={item.type} value={item.type}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>

          {def.needEndpoint && (
            <SettingRow label={i18n.t('接口地址')} desc={i18n.t('兼容 OpenAI Chat Completions 格式。')}>
              <Input
                className="px-3"
                placeholder="https://api.example.com/v1/chat/completions"
                value={config.endpoint || ''}
                onChange={event => setConfig(prev => ({ ...prev, endpoint: event.target.value }))}
              />
            </SettingRow>
          )}

          {def.needKey && (
            <SettingRow label="API Key" desc={i18n.t('仅保存在本机 localStorage，不会上传到服务器。')}>
              <div className="flex gap-2">
                <Input
                  className="min-w-0 flex-1 px-3"
                  type="text"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={def.keyPlaceholder}
                  value={config.api_key || ''}
                  onChange={event => setConfig(prev => ({ ...prev, api_key: event.target.value }))}
                />
                {def.docsUrl && (
                  <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 px-2.5" asChild>
                    <a href={def.docsUrl} target="_blank" rel="noopener noreferrer"><KeyRound className="h-3.5 w-3.5" />{i18n.t('获取 Key')}</a>
                  </Button>
                )}
              </div>
            </SettingRow>
          )}

          <SettingRow label={i18n.t('默认模型')} desc={i18n.t('模型列表会随 Provider 更新，也可以使用诊断页拉取可用模型。')}>
            <Select
              value={config.model || modelOptions[0]?.value || ''}
              onValueChange={value => setConfig(prev => ({ ...prev, model: value }))}
            >
              <SelectTrigger className="px-3"><SelectValue placeholder={i18n.t('请选择模型')} /></SelectTrigger>
              <SelectContent>
                {modelOptions.map(model => (
                  <SelectItem key={model.value} value={model.value}>
                    <span className="font-mono text-xs">{model.value}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(config.type === 'custom' || modelOptions.length === 0) && (
              <Input
                className="mt-2 px-3 font-mono text-xs"
                placeholder={i18n.t('手动输入模型 ID')}
                value={config.model || ''}
                onChange={event => setConfig(prev => ({ ...prev, model: event.target.value }))}
              />
            )}
          </SettingRow>
        </div>
      </div>
    );
  }

  if (activeSection.id === 'generation') {
    return (
      <div className="mx-auto min-h-full w-full max-w-2xl px-3 py-4 sm:px-4">
        <SectionHeader
          title={i18n.t('生成参数')}
          desc={i18n.t('控制单次请求等待时间、上下文预算和模型思考强度。')}
          onBack={() => go('')}
          onSave={() => {
            saveV2Settings(v2Settings);
            saveConfig(config, false);
          }}
        />
        <div className="space-y-5 rounded-xl border border-border bg-card p-4">
          <SettingRow label={i18n.t('请求超时')} desc={i18n.t('模型在规定时间内没有完成响应时会中止请求。')}>
            <Select
              value={String(config.timeoutMs || 300000)}
              onValueChange={value => setConfig(prev => ({ ...prev, timeoutMs: Number(value) }))}
            >
              <SelectTrigger className="px-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEOUT_OPTIONS.map(option => <SelectItem key={option.value} value={String(option.value)}>{i18n.t(option.label)}</SelectItem>)}
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow label={i18n.t('上下文预算')} desc={i18n.t('消息、技能和记忆合计超出预算时，会从最旧的历史消息开始省略。')}>
            <Select
              value={String(v2Settings.contextBudget)}
              onValueChange={value => updateV2Settings({ contextBudget: Number(value) })}
            >
              <SelectTrigger className="px-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONTEXT_BUDGET_OPTIONS.map(option => <SelectItem key={option.value} value={String(option.value)}>{i18n.t(option.label)}</SelectItem>)}
              </SelectContent>
            </Select>
          </SettingRow>

          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm">{i18n.t('注入长期记忆')}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{i18n.t('根据当前问题自动检索相关记忆。')}</p>
            </div>
            <Switch
              checked={v2Settings.memoryEnabled}
              onCheckedChange={checked => updateV2Settings({ memoryEnabled: checked })}
            />
          </div>

          <SettingRow label={i18n.t('思考强度')} desc={i18n.t('仅对支持 thinking / reasoning_effort 的模型生效。')}>
            <Select
              value={config.reasoning_effort || 'auto'}
              onValueChange={value => {
                setConfig(prev => {
                  if (value === 'auto') {
                    const { reasoning_effort: _ignored, ...rest } = prev;
                    return rest;
                  }
                  return { ...prev, reasoning_effort: value as ModelConfig['reasoning_effort'] };
                });
              }}
            >
              <SelectTrigger className="px-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONING_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{i18n.t(option.label)}</SelectItem>)}
              </SelectContent>
            </Select>
          </SettingRow>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-[11px] leading-5 text-muted-foreground">
            <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{i18n.t('简单聊天通常不需要开启高强度思考；代码任务可以适当提高。参数不受支持的模型会自动忽略。')}</p>
          </div>
        </div>
      </div>
    );
  }

  if (activeSection.id === 'proxy') {
    return (
      <div className="mx-auto min-h-full w-full max-w-2xl px-3 py-4 sm:px-4">
        <SectionHeader
          title={i18n.t('模型代理')}
          desc={i18n.t('用于解决 WebView CORS、网络不可达或统一转发。')}
          onBack={() => go('')}
          onSave={() => saveConfig(config, false)}
        />
        <div className="space-y-5 rounded-xl border border-border bg-card p-4">
          <SettingRow label={i18n.t('代理地址')} desc={i18n.t('留空使用内置无状态代理；OpenRouter 默认直连。')}>
            <Input
              className="px-3"
              placeholder={i18n.t('留空使用内置代理')}
              value={config.proxy_url || ''}
              onChange={event => setConfig(prev => ({ ...prev, proxy_url: event.target.value }))}
            />
          </SettingRow>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setConfig(prev => ({ ...prev, proxy_url: '' }))}>
              {i18n.t('使用内置代理')}
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setConfig(prev => ({ ...prev, proxy_url: 'https://llm.callact.xyz' }))}>
              {i18n.t('填入默认代理')}
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3 text-[11px] leading-5 text-muted-foreground">
            <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><ShieldCheck className="h-3.5 w-3.5" />{i18n.t('安全说明')}</p>
            {i18n.t('代理只转发请求和流式响应，不保存 Key，也不保存对话内容。')}
          </div>
        </div>
      </div>
    );
  }

  if (activeSection.id === 'context') {
    const totalSessions = sessions.reduce((sum, item) => sum + item.count, 0);
    const clearUserArtifacts = () => {
      if (!window.confirm(i18n.t('确定清除当前账号的 Artifact 缓存？'))) return;
      clearArtifacts(user?.login);
      setStorageVersion(version => version + 1);
      toast.success(i18n.t('已清除 Artifact'));
    };
    return (
      <div className="mx-auto min-h-full w-full max-w-2xl px-3 py-4 sm:px-4">
        <SectionHeader title={i18n.t('上下文与记忆')} desc={i18n.t('管理本机会话和 AI 上下文数据。')} onBack={() => go('')} />
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-[10px] text-muted-foreground">{i18n.t('本机会话')}</p>
              <p className="mt-1 text-xl font-semibold">{totalSessions}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-[10px] text-muted-foreground">{i18n.t('存储账号')}</p>
              <p className="mt-1 text-xl font-semibold">{sessions.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-[10px] text-muted-foreground">Artifacts</p>
              <p className="mt-1 text-xl font-semibold">{artifacts.length}</p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 text-sm font-medium">{i18n.t('本地存储')}</p>
            <p className="text-[11px] leading-5 text-muted-foreground">
              {i18n.t('每个账号、每个会话独立保存消息、仓库上下文和模型输出；不会自动上传到云端。')}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
              <HardDrive className="h-3.5 w-3.5" />
              {i18n.t('当前账号')}：{user?.login || '-'}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="destructive" size="sm" className="h-8 gap-1.5 text-xs" onClick={clearSessions}>
                <Trash2 className="h-3.5 w-3.5" />
                {i18n.t('清除所有本机会话')}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={clearUserArtifacts}>
                <Trash2 className="h-3.5 w-3.5" />
                {i18n.t('清除 Artifact')}
              </Button>
            </div>
            </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{i18n.t('长期记忆')}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{i18n.t('按当前问题自动检索并注入上下文。')}</p>
              </div>
              <Badge variant="secondary" className="text-[9px]">{memories.length} {i18n.t('条')}</Badge>
            </div>
            {memories.length === 0 ? (
              <p className="py-2 text-[11px] text-muted-foreground">{i18n.t('暂无长期记忆')}</p>
            ) : (
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {memories.slice(0, 20).map(memory => (
                  <div key={memory.id} className="flex items-start gap-2 rounded-lg bg-muted/25 px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-5">{memory.content}</p>
                      {memory.tags.length > 0 && <p className="mt-0.5 text-[9px] text-muted-foreground">{memory.tags.join(' · ')}</p>}
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => {
                        deleteMemory(user?.login, memory.id);
                        setStorageVersion(version => version + 1);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {memories.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 h-8 gap-1.5 text-xs"
                onClick={() => {
                  if (!window.confirm(i18n.t('确定清除当前账号的长期记忆？'))) return;
                  clearMemories(user?.login);
                  setStorageVersion(version => version + 1);
                  toast.success(i18n.t('已清除长期记忆'));
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {i18n.t('清除长期记忆')}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (activeSection.id === 'tools') {
    const tools = [
      { name: 'artifact_read', desc: '读取大型工具结果', icon: Database, risk: 'read', group: '核心' },
      { name: 'memory_save', desc: '保存长期记忆', icon: Database, risk: 'read', group: '核心' },
      { name: 'memory_search', desc: '搜索长期记忆', icon: Database, risk: 'read', group: '核心' },
      { name: 'github_repo_info', desc: '仓库基本信息', icon: Database, risk: 'read', group: 'GitHub 只读' },
      { name: 'github_list_files', desc: '列出目录文件', icon: HardDrive, risk: 'read', group: 'GitHub 只读' },
      { name: 'github_read_file', desc: '读取文本文件', icon: Wrench, risk: 'read', group: 'GitHub 只读' },
      { name: 'github_search_code', desc: '搜索代码与文本', icon: Cpu, risk: 'read', group: 'GitHub 只读' },
      { name: 'github_list_workflow_runs', desc: 'Actions 运行列表', icon: Activity, risk: 'read', group: 'GitHub 协作' },
      { name: 'github_list_workflow_jobs', desc: '列出 Job 与失败步骤', icon: Activity, risk: 'read', group: 'GitHub 协作' },
      { name: 'github_get_job_logs', desc: '读取完整 Job 日志', icon: FileText, risk: 'read', group: 'GitHub 协作' },
      { name: 'github_list_issues', desc: '列出 Issues', icon: Database, risk: 'read', group: 'GitHub 协作' },
      { name: 'github_list_pulls', desc: '列出 Pull Request', icon: Database, risk: 'read', group: 'GitHub 协作' },
      { name: 'github_get_pull', desc: '读取 PR 详情', icon: Database, risk: 'read', group: 'GitHub 协作' },
      { name: 'github_write_file', desc: '创建或更新单个文件', icon: Wrench, risk: 'write', group: 'GitHub 写入' },
      { name: 'github_write_files', desc: '批量提交多个文件', icon: Wrench, risk: 'write', group: 'GitHub 写入' },
      { name: 'github_create_branch', desc: '创建分支', icon: GitBranch, risk: 'write', group: 'GitHub 写入' },
      { name: 'github_create_pull_request', desc: '创建 Pull Request', icon: GitPullRequest, risk: 'write', group: 'GitHub 写入' },
      { name: 'github_merge_pull_request', desc: '合并 Pull Request', icon: GitPullRequest, risk: 'write', group: 'GitHub 写入' },
    ];
    return (
      <div className="mx-auto min-h-full w-full max-w-2xl px-3 py-4 sm:px-4">
        <SectionHeader title={i18n.t('工具与权限')} desc={i18n.t('当前 Agent 可以调用的能力和风险边界。')} onBack={() => go('')} />
        <div className="space-y-3">
          <div className={cn(
            'rounded-xl border p-4',
            v2Settings.allowAllPermissions ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card',
          )}>
            <div className="flex items-start gap-3">
              <ShieldAlert className={cn('mt-0.5 h-4 w-4 shrink-0', v2Settings.allowAllPermissions ? 'text-destructive' : 'text-muted-foreground')} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{i18n.t('全局允许全部权限')}</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {i18n.t('开启后，写操作和后续高风险工具不再逐次弹窗确认，直接执行。仅建议在你完全信任当前任务时使用。')}
                </p>
              </div>
              <Switch
                checked={v2Settings.allowAllPermissions}
                onCheckedChange={checked => {
                  updateV2Settings({ allowAllPermissions: checked });
                  if (checked) toast.warning(i18n.t('已开启全局权限，写操作将不再确认'));
                  else toast.success(i18n.t('已恢复逐次确认'));
                }}
              />
            </div>
            {v2Settings.allowAllPermissions && (
              <p className="mt-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-[10px] text-destructive">
                {i18n.t('当前处于全局放权状态：工具可以直接修改仓库。')}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{i18n.t('已注册工具')}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{i18n.t('核心工具始终可用；GitHub 工具仅在添加仓库后加载。')}</p>
              </div>
              <Badge variant="secondary" className="text-[9px]">{tools.length} {i18n.t('项')}</Badge>
            </div>
            <div className="space-y-1.5">
              {tools.map(item => {
                const Icon = item.icon;
                return (
                  <div key={item.name} className="flex items-center gap-2 rounded-lg bg-muted/30 px-2.5 py-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 font-mono text-[11px]">{item.name}</span>
                    <span className="hidden text-[10px] text-muted-foreground sm:inline">{i18n.t(item.desc)}</span>
                    <Badge variant={item.risk === 'write' ? 'destructive' : 'outline'} className="px-1.5 py-0 text-[9px]">
                      {item.risk === 'write' ? i18n.t('写操作') : i18n.t('只读')}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
            <p className="flex items-center gap-1.5 text-sm font-medium"><ShieldAlert className="h-4 w-4 text-amber-500" />{i18n.t('写操作逐次确认')}</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {i18n.t('默认逐次确认；开启全局权限后直接执行。')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (activeSection.id === 'skills') {
    return (
      <div className="mx-auto min-h-full w-full max-w-2xl px-3 py-4 sm:px-4">
        <SectionHeader title={i18n.t('技能')} desc={i18n.t('按问题关键词自动加载，不一次性占用系统提示词。')} onBack={() => go('')} />
        <div className="space-y-2">
          {SKILLS.map(skill => (
            <div key={skill.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start gap-2">
                <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{i18n.t(skill.title)}</p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{i18n.t(skill.description)}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {skill.keywords.map(keyword => (
                      <span key={keyword} className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{keyword}</span>
                    ))}
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[9px]">{i18n.t('自动加载')}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-full w-full max-w-2xl px-3 py-4 sm:px-4">
      <SectionHeader title={i18n.t('诊断与测试')} desc={i18n.t('检查 Key、端点和模型列表，不修改当前配置。')} onBack={() => go('')} onSave={() => saveConfig(config, false)} />
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-medium">{i18n.t('连接测试')}</p>
              <p className="text-[10px] text-muted-foreground">{modelDef.label} · {config.model || '-'}</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-3 h-8 gap-1.5 text-xs" onClick={handleTest} disabled={testState === 'testing'}>
            {testState === 'testing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Timer className="h-3.5 w-3.5" />}
            {testState === 'testing' ? i18n.t('测试中…') : i18n.t('测试连接')}
          </Button>
          {testState !== 'idle' && testState !== 'testing' && (
            <div className={cn('mt-2 flex items-start gap-2 rounded-lg p-2.5 text-[11px]', testState === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-destructive/10 text-destructive')}>
              {testState === 'success' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span className="break-all">{testResult}</span>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-medium">{i18n.t('获取模型列表')}</p>
              <p className="text-[10px] text-muted-foreground">{i18n.t('从当前 Provider 拉取可用模型。')}</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-3 h-8 gap-1.5 text-xs" onClick={handleFetchModels} disabled={modelsState === 'loading'}>
            {modelsState === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {modelsState === 'loading' ? i18n.t('获取中…') : i18n.t('获取模型')}
          </Button>
          {modelsState === 'error' && <p className="mt-2 break-words text-[11px] text-destructive">{modelsError}</p>}
          {modelsState === 'success' && (
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg bg-muted/25 p-2">
              {fetchedModels.map(model => (
                <div key={model.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-[10px] hover:bg-background/60">
                  <span className="min-w-0 flex-1 truncate font-mono">{model.id}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfig(prev => ({ ...prev, model: model.id }));
                      toast.success(i18n.t('已选择模型，保存后生效'));
                    }}
                    className="shrink-0 text-primary hover:underline"
                  >
                    {i18n.t('选择')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{i18n.t('最近运行')}</p>
              <p className="text-[10px] text-muted-foreground">{i18n.t('持久化保存的运行摘要，用于诊断与恢复。')}</p>
            </div>
            {runs.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] text-muted-foreground"
                onClick={() => {
                  if (!window.confirm(i18n.t('确定清除运行记录？'))) return;
                  clearRuns(user?.login);
                  setStorageVersion(version => version + 1);
                  toast.success(i18n.t('已清除运行记录'));
                }}
              >
                <Trash2 className="h-3 w-3" />
                {i18n.t('清除')}
              </Button>
            )}
          </div>
          {runs.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-muted-foreground">{i18n.t('暂无运行记录')}</p>
          ) : (
            <div className="space-y-1.5">
              {runs.map(run => (
                <div key={run.id} className="rounded-lg bg-muted/25 px-2.5 py-2 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      run.status === 'done' ? 'bg-green-500' : run.status === 'running' ? 'bg-primary' : 'bg-destructive',
                    )} />
                    <span className="min-w-0 flex-1 truncate text-xs">{run.title}</span>
                    <span className="shrink-0 text-muted-foreground">{i18n.t(RUN_STATUS_LABELS[run.status] || run.status)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                    <span>{new Date(run.startedAt).toLocaleString()}</span>
                    <span>{run.toolCalls} {i18n.t('工具')}</span>
                    <span>{run.steps} {i18n.t('轮')}</span>
                    <span>{run.events?.length || 0} {i18n.t('事件')}</span>
                    {run.capabilities.length > 0 && <span className="truncate">{run.capabilities.join(' · ')}</span>}
                  </div>
                  {run.error && <p className="mt-1 break-words text-destructive">{run.error.slice(0, 160)}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}