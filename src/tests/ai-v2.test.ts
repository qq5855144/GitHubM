import { describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt, runGeneralAgent } from '@/ai-v2/agent';
import { buildProviderRequest, streamProvider } from '@/ai-v2/providers';
import type {
  AgentEvent,
  AgentTool,
  ProviderStreamResult,
  V2ProviderMessage,
  V2ToolDefinition,
} from '@/ai-v2/types';

const config = { type: 'openrouter', api_key: 'test-key', model: 'test-model' };

function fakeTool(): AgentTool {
  return {
    name: 'echo',
    description: 'Echo input',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    risk: 'read',
    async execute(args) {
      return { ok: true, content: `echo:${String(args.text)}` };
    },
  };
}

describe('AI Assistant V2 agent loop', () => {
  it('does not force planning or tools for a plain chat', async () => {
    let seenTools: V2ToolDefinition[] = [];
    const events: AgentEvent[] = [];
    await runGeneralAgent({
      token: 'github-token',
      history: [{ role: 'user', content: '你好' }],
      config,
      signal: new AbortController().signal,
      onEvent: event => events.push(event),
      callModel: async (_config, messages, tools) => {
        seenTools = tools;
        expect(messages[0].role).toBe('system');
        expect(String(messages[0].content)).toContain('通用 AI 助手');
        return {
          content: '你好，有什么可以帮你？',
          reasoning: '',
          toolCalls: [],
          model: 'test-model',
        };
      },
    });

    expect(seenTools).toHaveLength(0);
    expect(events.some(event => event.type === 'done')).toBe(true);
  });

  it('executes a tool call and then returns the final answer', async () => {
    const events: AgentEvent[] = [];
    const calls: V2ProviderMessage[][] = [];
    let modelCall = 0;

    const callModel = async (
      _config: unknown,
      messages: V2ProviderMessage[],
    ): Promise<ProviderStreamResult> => {
      calls.push(messages);
      modelCall++;
      if (modelCall === 1) {
        return {
          content: '',
          reasoning: '需要读取输入',
          toolCalls: [{ id: 'call-1', name: 'echo', arguments: '{"text":"hi"}' }],
          model: 'test-model',
        };
      }
      return {
        content: '工具返回 hi',
        reasoning: '',
        toolCalls: [],
        model: 'test-model',
      };
    };

    await runGeneralAgent({
      token: 'github-token',
      history: [{ role: 'user', content: '调用工具' }],
      config,
      signal: new AbortController().signal,
      onEvent: event => events.push(event),
      callModel,
      tools: [fakeTool()],
    });

    expect(calls).toHaveLength(2);
    expect(calls[1].some(message => message.role === 'tool' && message.content === 'echo:hi')).toBe(true);
    expect(events.filter(event => event.type === 'tool_start')).toHaveLength(1);
    expect(events.some(event => event.type === 'tool_end' && event.ok)).toBe(true);
    expect(events.some(event => event.type === 'done')).toBe(true);
  });

  it('loads GitHub tools only when a repo context exists', () => {
    const withoutRepo = buildSystemPrompt();
    const withRepo = buildSystemPrompt({ fullName: 'owner/repo', defaultBranch: 'main', branch: 'dev' });
    expect(withoutRepo).toContain('没有选择仓库');
    expect(withRepo).toContain('owner/repo');
    expect(withRepo).toContain('只读工具');
  });
});

describe('AI Assistant V2 provider', () => {
  it('uses the official OpenRouter endpoint and passes tools', () => {
    const request = buildProviderRequest(config, [{ role: 'user', content: 'hi' }], [{
      type: 'function',
      function: { name: 'echo', description: 'Echo', parameters: { type: 'object' } },
    }]);
    expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(request.headers['x-llm-provider']).toBeUndefined();
    expect(request.body.tools).toBeTruthy();
    expect(request.body.model).toBe('test-model');
  });

  it('parses streaming text, reasoning and tool call fragments', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"reasoning":"思考"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"echo","arguments":"{\\"text\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"hi\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));

    const events: AgentEvent[] = [];
    const result = await streamProvider(
      config,
      [{ role: 'user', content: 'hi' }],
      [],
      new AbortController().signal,
      event => events.push(event),
    );

    expect(result.content).toBe('你好');
    expect(result.reasoning).toBe('思考');
    expect(result.toolCalls).toEqual([{ id: 'call-1', name: 'echo', arguments: '{"text":"hi"}' }]);
    expect(events.some(event => event.type === 'text_delta' && event.text === '你好')).toBe(true);
  });
});