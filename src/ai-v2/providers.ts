// AI Assistant V2 — OpenAI 兼容 Provider 层
import { normalizeChatEndpoint } from '@/lib/ai-endpoint';
import type { ModelConfig } from '@/components/ai/aiTypes';
import { getModelCapabilities } from './modelCapabilities';
import type {
  AgentEvent,
  ProviderStreamResult,
  V2ProviderMessage,
  V2ToolCall,
  V2ToolDefinition,
} from './types';

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
      return normalizeChatEndpoint(config.endpoint);
    default:
      return '';
  }
}

function getRequestUrl(config: ModelConfig): { url: string; proxy: boolean } {
  if (config.type === 'custom' && !getProviderEndpoint(config)) {
    throw new Error('请先在模型设置中填写接口地址');
  }
  const explicitProxy = config.proxy_url?.trim().replace(/\/+$/, '');
  if (explicitProxy && (config.type !== 'custom' || config.api_key?.trim())) {
    return { url: `${explicitProxy}/v1/chat/completions`, proxy: true };
  }
  // 默认直连模型官方接口：API Key 不经过任何第三方。
  // 只有用户在设置里显式填写代理地址时才走代理。
  const endpoint = getProviderEndpoint(config);
  if (!endpoint) {
    if (config.type === 'cloudflare') {
      throw new Error('Cloudflare 免费通道需要先填写代理地址');
    }
    throw new Error('请先在模型设置中填写接口地址');
  }
  return { url: endpoint, proxy: false };
}

/** 部分供应商（DeepSeek）禁止回传 reasoning_content，发送前统一剔除 */
export function stripReasoningContent(messages: V2ProviderMessage[]): V2ProviderMessage[] {
  return messages.map(message => {
    if (!message.reasoning_content) return message;
    const { reasoning_content: _reasoning, ...rest } = message;
    return rest;
  });
}

/**
 * 发送前修复 tool_calls 与 tool 结果的配对关系。
 *
 * 供应商（OpenAI / DeepSeek 等）对消息序列有硬约束，违反会直接返回 HTTP 400：
 *   - `insufficient tool messages following tool_calls`：assistant 声明了调用，
 *     但紧随其后的不是对应的 tool 结果；
 *   - `tool message without preceding tool_calls`：tool 结果找不到来源。
 *
 * 上下文压缩（截断 / 拼接 / 丢弃旧回合）会把原本配对的 assistant 与 tool 拆散，
 * 且断点可能落在序列任意位置而非仅末尾，因此这里做位置无关的清理：
 *   1. 移除 tool_calls 没有紧邻完整回复的 assistant 消息；
 *   2. 移除孤立的 tool 消息（沿连续 tool 链回溯找来源）。
 */
export function sanitizeToolCallPairing(messages: V2ProviderMessage[]): V2ProviderMessage[] {
  if (messages.length === 0) return [];
  const result = [...messages];

  // 1. 从后往前移除缺少紧邻 tool 回复的 assistant(tool_calls)。
  for (let index = result.length - 1; index >= 0; index--) {
    const message = result[index];
    const calls = message.role === 'assistant' ? message.tool_calls : undefined;
    if (!Array.isArray(calls) || calls.length === 0) continue;
    const paired = calls.every((call, offset) => {
      const next = result[index + 1 + offset];
      return Boolean(next) && next.role === 'tool' && next.tool_call_id === call.id;
    });
    if (!paired) result.splice(index, 1);
  }

  // 2. 移除孤立的 tool 消息：沿连续 tool 链回溯，源头必须是声明的 assistant。
  for (let index = result.length - 1; index >= 0; index--) {
    const message = result[index];
    if (message.role !== 'tool' || !message.tool_call_id) continue;
    let cursor = index - 1;
    while (cursor >= 0 && result[cursor].role === 'tool') cursor -= 1;
    const source = cursor >= 0 ? result[cursor] : undefined;
    const sourced =
      source?.role === 'assistant' &&
      Array.isArray(source.tool_calls) &&
      source.tool_calls.some(call => call.id === message.tool_call_id);
    if (!sourced) result.splice(index, 1);
  }

  return result;
}

export function buildProviderRequest(
  config: ModelConfig,
  messages: V2ProviderMessage[],
  tools: V2ToolDefinition[],
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const { url, proxy } = getRequestUrl(config);
  if (!url) throw new Error('请先在模型设置中填写接口地址');
  const apiKey = config.api_key?.trim();
  if (!apiKey && config.type !== 'custom') throw new Error('请先在模型设置中填写 API Key');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  if (proxy) {
    headers['x-llm-provider'] = config.type;
    if (config.type === 'custom') headers['x-llm-upstream'] = getProviderEndpoint(config);
  }
  if (config.type === 'openrouter') {
    headers['HTTP-Referer'] = 'https://githubm-web.pages.dev';
    headers['X-Title'] = 'GitHubM';
  }

  const body: Record<string, unknown> = {
    model: config.model || defaultModelFor(config.type),
    messages: sanitizeToolCallPairing(stripReasoningContent(messages)).map(message => (
      config.supportsVision === false && Array.isArray(message.content)
        ? { ...message, content: message.content.map(part => part.type === 'text' ? part.text : '[图片附件]').join('\n') }
        : message
    )),
    stream: config.stream !== false,
    max_tokens: getModelCapabilities(config.type, config.model).maxOutput,
  };
  const effort = config.reasoning_effort;
  if (effort) {
    body.reasoning_effort = effort === 'off' ? 'minimal' : effort === 'max' ? 'high' : effort;
  }
  if (tools.length > 0 && (config.supportsTools ?? getModelCapabilities(config.type, config.model).supportsTools)) {
    body.tools = tools;
    body.tool_choice = 'auto';
    if (config.type !== 'custom') body.parallel_tool_calls = true;
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
    case 'cloudflare': return '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
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
  const timeoutMs = Math.max(100, Number(config.timeoutMs) || 300000);
  const requestController = new AbortController();
  let timedOut = false;
  const onAbort = () => requestController.abort();
  if (signal.aborted) requestController.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  // 空闲超时：每收到一块数据就重新计时。
  // 这样长时间 reasoning 的模型不会因为「总时长」被硬切，
  // 上游真正挂住不发包时仍能在 timeoutMs 内失败。
  let timer: ReturnType<typeof setTimeout> | undefined;
  const armTimeout = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, timeoutMs);
  };
  armTimeout();

  try {
    const prepared = buildProviderRequest(config, messages, tools);
    const res = await fetch(prepared.url, {
      method: 'POST',
      headers: prepared.headers,
      body: JSON.stringify(prepared.body),
      signal: requestController.signal,
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
    let doneEvent = false;
    let finishReason: string | undefined;
    const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();

    const consumeData = (data: string) => {
      if (!data) return;
      if (data.trim() === '[DONE]') {
        doneEvent = true;
        return;
      }

      interface ChoiceContent {
        content?: string | Array<{ text?: string }>;
        reasoning?: string;
        reasoning_content?: string;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      }
      let chunk: {
        usage?: ProviderStreamResult['usage'];
        error?: string | { message?: string };
        choices?: Array<{
          finish_reason?: string | null;
          delta?: ChoiceContent;
          message?: ChoiceContent;
        }>;
      };
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      if (!chunk || typeof chunk !== 'object') return;
      if (chunk.error) throw new Error(typeof chunk.error === 'string' ? chunk.error : chunk.error.message || '模型返回流式错误');
      if (chunk.usage) usage = chunk.usage;

      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      const delta = choice?.delta || choice?.message;
      if (!delta) return;

      const text = typeof delta.content === 'string'
        ? delta.content
        : typeof delta.content === 'number'
          ? String(delta.content)
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

      for (const [position, call] of (delta.tool_calls || []).entries()) {
        const index = call.index ?? (choice?.message ? position : 0);
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

    let eventData: string[] = [];
    const consumeLine = (line: string) => {
      if (line.startsWith('data:')) eventData.push(line.slice(5).trimStart());
      if (!line.trim() && eventData.length > 0) {
        const data = eventData.join('\n');
        eventData = [];
        consumeData(data);
      }
    };

    try {
      if (config.stream === false || res.headers.get('content-type')?.includes('application/json')) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          armTimeout();
          buffer += decoder.decode(value, { stream: true });
        }
        consumeData(buffer + decoder.decode());
      } else {
        while (!doneEvent) {
          const { done, value } = await reader.read();
          if (done) break;
          armTimeout();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            consumeLine(line);
            if (doneEvent) break;
          }
          if (signal.aborted) break;
        }
        if (!doneEvent) {
          consumeLine(buffer + decoder.decode());
          consumeLine('');
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }

    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (finishReason === 'length') throw new Error('模型输出达到长度上限，回答未完整生成');
    if (finishReason === 'content_filter') throw new Error('模型因内容过滤中止生成');
    if (!doneEvent && !finishReason) throw new Error('模型响应提前结束，未收到完成标记');

    const toolCalls: V2ToolCall[] = [...toolAcc.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        id: call.id || `call_${index}`,
        name: call.name,
        arguments: call.arguments,
      }))
      .filter(call => call.name);

    if (!content && !reasoning && toolCalls.length === 0) throw new Error('模型未返回有效内容');
    if (finishReason === 'tool_calls' && toolCalls.length === 0) throw new Error('模型返回的工具调用不完整');

    return {
      content,
      reasoning,
      toolCalls,
      model: config.model || '',
      usage,
    };
  } catch (error) {
    if (timedOut && !signal.aborted) {
      throw new Error(`请求超时（${Math.max(1, Math.round(timeoutMs / 1000))} 秒）`);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}