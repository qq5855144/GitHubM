// 模型设置弹窗：memo 优化，config/open 不变则不重渲染
import { memo, useState, useEffect } from 'react';
import {
  RefreshCw, RotateCw,
  CheckCircle2, XCircle, Sparkles, Timer, Wifi,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ModelConfig } from './aiTypes';
import { MODEL_DEFS, getModelDef, loadProviderKey, saveProviderKey } from './aiUtils';
import type { ModelType } from './aiUtils';
import { fetchModelsFromAPI } from './aiSupabase';
import i18n from "@/i18n";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

type FetchState = 'idle' | 'loading' | 'success' | 'error';
type TestState = 'idle' | 'testing' | 'success' | 'error';

interface ModelSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  config: ModelConfig;
  onSave: (cfg: ModelConfig) => void;
}

const ModelSettingsDialog = memo(function ModelSettingsDialog({
  open,
  onClose,
  config,
  onSave,
}: ModelSettingsDialogProps) {
  const [draft, setDraft] = useState<ModelConfig>(config);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [fetchError, setFetchError] = useState('');
  // 测试连接状态
  const [testState, setTestState] = useState<TestState>('idle');
  const [testResult, setTestResult] = useState<{ elapsedMs?: number; error?: string }>({});
  // 动态获取的模型列表（每个 type 独立缓存）
  const [fetchedModels, setFetchedModels] = useState<Record<string, Array<{ id: string; name: string }>>>({});
  const def = getModelDef(draft.type);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setFetchState('idle');
      setFetchError('');
      setTestState('idle');
      setTestResult({});
    }
  }, [open, config]);

  const handleTypeChange = (type: ModelType) => {
    // 切换平台时自动预填该平台已存储的 API Key
    const savedKey = loadProviderKey(type);
    setDraft({ type, api_key: savedKey || undefined });
    setFetchState('idle');
    setFetchError('');
    setTestState('idle');
    setTestResult({});
  };

  const handleTestConnection = async () => {
    if (!draft.api_key?.trim()) { toast.error(i18n.t('请先填写 API Key')); return; }
    setTestState('testing');
    setTestResult({});
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-test-connection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          type: draft.type,
          api_key: draft.api_key,
          model: draft.model,
          endpoint: draft.endpoint,
        }),
      });
      const data = await res.json() as { success: boolean; elapsedMs?: number; error?: string };
      if (data.success) {
        setTestState('success');
        setTestResult({ elapsedMs: data.elapsedMs });
      } else {
        setTestState('error');
        setTestResult({ error: data.error || i18n.t('连接失败') });
      }
    } catch (e) {
      setTestState('error');
      setTestResult({ error: (e as Error).message || i18n.t('网络请求失败') });
    }
  };

  const handleFetchModels = async () => {
    if (!draft.api_key?.trim()) { toast.error(i18n.t('请先填写 API Key')); return; }
    if (draft.type === 'custom' && !draft.endpoint?.trim()) { toast.error(i18n.t('请先填写接口地址')); return; }
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
      if (!models.length) throw new Error(i18n.t('未返回任何模型，请检查 API Key 或接口地址'));
      setFetchedModels(prev => ({ ...prev, [draft.type]: models }));
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
    if (def.needKey && !draft.api_key?.trim()) { toast.error(i18n.t('请填写 API Key')); return; }
    if (def.needEndpoint && !draft.endpoint?.trim()) { toast.error(i18n.t('请填写接口地址')); return; }
    // 同步保存到独立 key 仓库
    if (draft.api_key && draft.type !== 'wenxin') {
      saveProviderKey(draft.type, draft.api_key);
    }
    onSave(draft);
    onClose();
    toast.success(i18n.t('模型配置已保存'));
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{i18n.t('AI 模型配置')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-1">
          {/* 平台选择 */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-normal">{i18n.t('选择平台')}</Label>
            <Select value={draft.type} onValueChange={v => handleTypeChange(v as ModelType)}>
              <SelectTrigger className="px-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MODEL_DEFS.map(m => (
                  <SelectItem key={m.type} value={m.type}>
                    <div className="flex items-center gap-2">
                      <span>{m.label}</span>
                      {m.badge && (
                        <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{m.badge}</Badge>
                      )}
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
              <Label className="text-sm font-normal">{i18n.t('接口地址')}</Label>
              <Input
                className="px-3"
                placeholder="https://your-api.com/v1/chat/completions"
                value={draft.endpoint || ''}
                onChange={e => setDraft(prev => ({ ...prev, endpoint: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                {i18n.t('兼容 OpenAI Chat Completions 格式（/v1/chat/completions）')}</p>
            </div>
          )}

          {/* API Key + 获取模型按钮 */}
          {def.needKey && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-normal">API Key</Label>
                {def.docsUrl && (
                  <a
                    href={def.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    {i18n.t('获取 Key →')}</a>
                )}
              </div>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <Input
                    className="px-3"
                    type="text"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    inputMode="text"
                    placeholder={def.keyPlaceholder}
                    value={draft.api_key || ''}
                    onChange={e => {
                      setDraft(prev => ({ ...prev, api_key: e.target.value }));
                      setFetchState('idle');
                    }}
                  />
                </div>
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
                  {fetchState === 'loading' ? i18n.t('获取中…') : i18n.t('获取模型')}
                </Button>
              </div>

              {fetchState === 'error' && fetchError && (
                <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  <XCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive break-words">{fetchError}</p>
                </div>
              )}
              {fetchState === 'success' && fetchedModels[draft.type]?.length > 0 && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  {i18n.t('✓ 已获取')}{fetchedModels[draft.type].length} {i18n.t('个可用模型')}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {i18n.t('Key 仅保存在本地，通过服务端安全转发，不会上传至第三方')}</p>
              {/* 测试连接按钮（文心无需测试） */}
              {draft.type !== 'wenxin' && (
                <div className="flex flex-col gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full h-9 gap-2"
                    onClick={handleTestConnection}
                    disabled={testState === 'testing' || !draft.api_key?.trim()}
                  >
                    {testState === 'testing' ? (
                      <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    ) : testState === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                    ) : testState === 'error' ? (
                      <XCircle className="w-3.5 h-3.5 text-destructive" />
                    ) : (
                      <Wifi className="w-3.5 h-3.5" />
                    )}
                    {testState === 'testing' ? i18n.t('测试中…') : testState === 'success' ? `连接成功 (${testResult.elapsedMs}ms)` : testState === 'error' ? i18n.t('连接失败') : i18n.t('测试连接')}
                  </Button>
                  {testState === 'error' && testResult.error && (
                    <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                      <XCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                      <p className="text-xs text-destructive break-words">{testResult.error}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 模型选择 */}
          {availableModels.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-normal">{i18n.t('选择模型')}</Label>
                {fetchedModels[draft.type]?.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {i18n.t('共')}{fetchedModels[draft.type].length} {i18n.t('个模型')}</span>
                )}
              </div>
              <Select
                value={draft.model || availableModels[0]?.id || ''}
                onValueChange={v => setDraft(prev => ({ ...prev, model: v }))}
              >
                <SelectTrigger className="px-3">
                  <SelectValue placeholder={i18n.t('请选择模型')} />
                </SelectTrigger>
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

          {/* custom 手动输入模型名 */}
          {draft.type === 'custom' && availableModels.length === 0 && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-sm font-normal">{i18n.t('模型名称（可选）')}</Label>
              <Input
                className="px-3"
                placeholder={i18n.t('如：llama3, qwen-turbo, claude-3-5-sonnet')}
                value={draft.model || ''}
                onChange={e => setDraft(prev => ({ ...prev, model: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{i18n.t('填入 API Key 后点击「获取模型」可自动拉取')}</p>
            </div>
          )}

          {/* 文心免费说明 */}
          {draft.type === 'wenxin' && (
            <div className="flex items-start gap-2 bg-primary/5 border border-primary/20 rounded-lg p-3">
              <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                {i18n.t('文心 ERNIE 4.5 由平台提供，无需配置密钥，直接免费使用。')}</p>
            </div>
          )}

          {/* Gemini 免费说明 */}
          {draft.type === 'gemini' && (
            <div className="flex items-start gap-2 bg-primary/5 border border-primary/20 rounded-lg p-3">
              <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>{i18n.t('Google AI Studio 提供免费额度，注册即用。')}</p>
                <p>{i18n.t('Gemini 2.5 Flash 速度快且免费；2.5 Pro 代码能力最强，每日免费请求数有限制。')}</p>
              </div>
            </div>
          )}

          {/* Qwen 说明 */}
          {draft.type === 'qwen' && (
            <div className="flex items-start gap-2 bg-primary/5 border border-primary/20 rounded-lg p-3">
              <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>{i18n.t('阿里云 DashScope 平台，新用户可获免费额度。')}</p>
                <p>{i18n.t('Qwen2.5 Coder 32B 是目前最强开源代码模型之一，中英双语表现出色。')}</p>
              </div>
            </div>
          )}

          {/* 超时时间设置 */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5 text-muted-foreground" />
              <Label className="text-sm font-normal">{i18n.t('请求超时时间')}</Label>
            </div>
            <Select
              value={String(draft.timeoutMs ?? 300000)}
              onValueChange={v => setDraft(prev => ({ ...prev, timeoutMs: Number(v) }))}
            >
              <SelectTrigger className="px-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="60000">{i18n.t('1 分钟（简单对话）')}</SelectItem>
                <SelectItem value="180000">{i18n.t('3 分钟（普通任务）')}</SelectItem>
                <SelectItem value="300000">{i18n.t('5 分钟（推荐，复杂任务）')}</SelectItem>
                <SelectItem value="600000">{i18n.t('10 分钟（超长任务）')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {i18n.t('AI 在此时间内未响应则报超时。复杂多步任务建议选 5~10 分钟。')}</p>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose}>{i18n.t('取消')}</Button>
            <Button onClick={handleSave}>{i18n.t('保存配置')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export default ModelSettingsDialog;
