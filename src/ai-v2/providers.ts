// AI Assistant V2 — OpenAI 兼容 Provider 层
import type { ModelConfig } from '@/components/ai/aiTypes';
import type {
  AgentEvent,
  ProviderStreamResult,
  V2ProviderMessage,
  V2ToolCall,
  V2ToolDefinition,
} from './types';

const DEFAULT_PROXY = 'https://llm.callact.xyz';

export function getProviderEndpoint(config: ModelConfig): string {
  switch (config.type) {
    case 'deepseek':
      return 'https://api.deepseek.com/v1/chat/completions';
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    case 'qwen':
      return 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    case 'openai':
      return 'https://api.openai.com/v1/chat/completions';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1/chat/completions';
    case 'custom':
      return config.endpoint?.trim() || '';
    default:
      return '';
  }
}

function getRequestUrl(config: ModelConfig): { url: string; proxy: boolean } {
  const explicitProxy = config.proxy_url?.trim().replace(/\/+$/, '');
  if (explicitProxy) return { url: `${explicitProxy}/v1/chat/completions`, proxy: true };
  // OpenRouter / 自定义接口支持浏览器 CORS，默认直连；其余走项目内置无状态代理。
  if (config.type === 'openrouter' || config.type === 'custom') {
    return { url: getProviderEndpoint(config), proxy: false };
  }
  return { url: `${DEFAULT_PROXY}/v1/chat/completions`, proxy: true };
}

export function buildProviderRequest(
  config: ModelConfig,
  messages: V2ProviderMessage[],
  tools: V2ToolDefinition[],
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const { url, proxy } = getRequestUrl(config);
  if (!url) throw new Error('请先在模型设置中填写接口地址');
  if (!config.api_key?.trim()) throw new Error('请先在模型设置中填写 API Key');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.api_key.trim()}`,
  };
  if (proxy) {
    headers['x-llm-provider'] = config.type;
    if (config.type === 'custom' && config.endpoint) headers['x-llm-upstream'] = config.endpoint;
  }
  if (config.type === 'openrouter') {
    headers['HTTP-Referer'] = 'https://githubm-web.pages.dev';
    headers['X-Title'] = 'GitHubM';
  }

  const body: Record<string, unknown> = {
    model: config.model || defaultModelFor(config.type),
    messages,
    stream: true,
    max_tokens: 8192,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
    body.parallel_tool_calls = true;
  }
  return { url, headers, body };
}

function defaultModelFor(type: string): string {
  switch (type) {
    case 'deepseek': return 'deepseek-v4-flash';
    case 'gemini': return 'gemini-2.5-flash-preview-05-20';
    case 'qwen': return 'qwen2.5-coder-32b-instruct';
    case 'openai': return 'gpt-4o-mini';
    case 'openrouter': return 'particle-ai/particle-1:free';
    default: return 'default';
  }
}

function parseErrorBody(text: string): string {
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof json.error === 'string') return json.error;
    return json.error?.message || json.message || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

/**
 * 统一流式调用。支持 OpenAI 兼容的 content / reasoning_content / tool_calls 增量。
 */
export async function streamProvider(
  config: ModelConfig,
  messages: V2ProviderMessage[],
  tools: V2ToolDefinition[],
  signal: AbortSignal,
  onEvent: (event: AgentEvent) => void,
): Promise<ProviderStreamResult> {
  const prepared = buildProviderRequest(config, messages, tools);
  const res = await fetch(prepared.url, {
    method: 'POST',
    headers: prepared.headers,
    body: JSON.stringify(prepared.body),
    signal,
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${raw ? `: ${parseErrorBody(raw)}` : ''}`);
  }
  if (!res.body) throw new Error('模型没有返回流式响应体');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let usage: ProviderStreamResult['usage'];
  const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;

    let chunk: {
      model?: string;
      usage?: ProviderStreamResult['usage'];
      choices?: Array<{
        delta?: {
          content?: string | Array<{ text?: string }>;
          reasoning?: string;
          reasoning_content?: string;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.usage) usage = chunk.usage;

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;

    const text = typeof delta.content === 'string'
      ? delta.content
      : Array.isArray(delta.content)
        ? delta.content.map(p => p.text || '').join('')
        : '';
    if (text) {
      content += text;
      onEvent({ type: 'text_delta', text });
    }

    const think = delta.reasoning_content || delta.reasoning || '';
    if (think) {
      reasoning += think;
      onEvent({ type: 'reasoning_delta', text: think });
    }

    for (const call of delta.tool_calls || []) {
      const index = call.index ?? 0;
      const prev = toolAcc.get(index) || {
        id: call.id || `call_${index}`,
        name: '',
        arguments: '',
      };
      if (call.id) prev.id = call.id;
      if (call.function?.name) prev.name += call.function.name;
      if (call.function?.arguments) prev.arguments += call.function.arguments;
      toolAcc.set(index, prev);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) consumeLine(line);
      if (signal.aborted) break;
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const toolCalls: V2ToolCall[] = [...toolAcc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({
      id: call.id || `call_${index}`,
      name: call.name,
      arguments: call.arguments,
    }))
    .filter(call => call.name);

  return {
    content,
    reasoning,
    toolCalls,
    model: config.model || '',
    usage,
  };
}