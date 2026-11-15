import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt, runGeneralAgent } from '@/ai-v2/agent';
import { buildProviderRequest, streamProvider } from '@/ai-v2/providers';
import { resolveCapabilities } from '@/ai-v2/capabilities';
import { readArtifact } from '@/ai-v2/artifacts';
import { GITHUB_WRITE_TOOLS } from '@/ai-v2/tools/github';
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
  beforeEach(() => localStorage.clear());

  it('does not force planning and only exposes the core artifact tool for plain chat', async () => {
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

    expect(seenTools.map(tool => tool.function.name)).toEqual(['artifact_read', 'memory_save', 'memory_search']);
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

  it('keeps running beyond twelve tool rounds until the model finishes', async () => {
    const events: AgentEvent[] = [];
    let modelCall = 0;
    await runGeneralAgent({
      token: 'github-token',
      history: [{ role: 'user', content: '多轮工具任务' }],
      config,
      signal: new AbortController().signal,
      onEvent: event => events.push(event),
      tools: [fakeTool()],
      callModel: async (): Promise<ProviderStreamResult> => {
        modelCall++;
        if (modelCall <= 20) {
          return {
            content: '',
            reasoning: '',
            toolCalls: [{ id: `call-${modelCall}`, name: 'echo', arguments: `{"text":"${modelCall}"}` }],
            model: 'test-model',
          };
        }
        return {
          content: '长任务完成',
          reasoning: '',
          toolCalls: [],
          model: 'test-model',
        };
      },
    });

    expect(modelCall).toBe(21);
    expect(events.filter(event => event.type === 'tool_start')).toHaveLength(20);
    expect(events.some(event => event.type === 'done' && event.steps === 21)).toBe(true);
  });

  it('does not execute a write tool when approval is rejected', async () => {
    const execute = vi.fn(async () => ({ ok: true, content: 'written' }));
    const writeTool: AgentTool = {
      name: 'write_test',
      description: 'Write test',
      parameters: { type: 'object', properties: {} },
      risk: 'write',
      execute,
    };
    const events: AgentEvent[] = [];
    let call = 0;
    await runGeneralAgent({
      token: 'github-token',
      userLogin: 'approval-user',
      history: [{ role: 'user', content: '写入' }],
      config,
      signal: new AbortController().signal,
      onEvent: event => events.push(event),
      tools: [writeTool],
      requestApproval: async () => false,
      callModel: async (): Promise<ProviderStreamResult> => {
        call++;
        return call === 1
          ? { content: '', reasoning: '', toolCalls: [{ id: 'w1', name: 'write_test', arguments: '{}' }], model: 'test-model' }
          : { content: '已取消', reasoning: '', toolCalls: [], model: 'test-model' };
      },
    });

    expect(execute).not.toHaveBeenCalled();
    expect(events.some(event => event.type === 'tool_end' && !event.ok)).toBe(true);
  });

  it('stores oversized tool results as artifacts and can page them', async () => {
    const huge = 'x'.repeat(13000);
    const bigTool: AgentTool = {
      name: 'big_result',
      description: 'Big result',
      parameters: { type: 'object', properties: {} },
      risk: 'read',
      execute: async () => ({ ok: true, content: huge }),
    };
    const events: AgentEvent[] = [];
    let call = 0;
    await runGeneralAgent({
      token: 'github-token',
      userLogin: 'artifact-user',
      history: [{ role: 'user', content: '大结果' }],
      config,
      signal: new AbortController().signal,
      onEvent: event => events.push(event),
      tools: [bigTool],
      callModel: async (): Promise<ProviderStreamResult> => {
        call++;
        return call === 1
          ? { content: '', reasoning: '', toolCalls: [{ id: 'b1', name: 'big_result', arguments: '{}' }], model: 'test-model' }
          : { content: '已处理', reasoning: '', toolCalls: [], model: 'test-model' };
      },
    });

    const toolEnd = events.find(event => event.type === 'tool_end');
    expect(toolEnd && toolEnd.type === 'tool_end' ? toolEnd.artifact?.size : 0).toBe(13000);
    const artifactId = toolEnd && toolEnd.type === 'tool_end' ? toolEnd.artifact?.id : '';
    expect(artifactId).toBeTruthy();
    const slice = await readArtifact('artifact-user', artifactId!, 0, 100);
    expect(slice.total).toBe(13000);
    expect(slice.content).toHaveLength(100);
    expect(slice.hasMore).toBe(true);
  });

  it('resumes from a saved provider message snapshot', async () => {
    const resumeMessages = [
      { role: 'system' as const, content: 'saved system' },
      { role: 'user' as const, content: 'resume task' },
      { role: 'assistant' as const, content: 'partial' },
    ];
    let seen: V2ProviderMessage[] = [];
    const events: AgentEvent[] = [];
    await runGeneralAgent({
      token: 'github-token',
      userLogin: 'resume-user',
      runId: 'run-resume',
      history: [],
      resumeMessages,
      resumeSteps: 4,
      config,
      signal: new AbortController().signal,
      onEvent: event => events.push(event),
      callModel: async (_config, messages): Promise<ProviderStreamResult> => {
        seen = messages;
        return { content: '继续完成', reasoning: '', toolCalls: [], model: 'test-model' };
      },
    });

    expect(seen).toEqual(resumeMessages);
    expect(events.some(event => event.type === 'done' && event.steps === 5)).toBe(true);
  });

  it('executes an approved write tool', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PUT') {
        return new Response(JSON.stringify({
          content: { sha: 'new-sha', html_url: 'https://github.com/owner/repo/blob/main/test.txt' },
          commit: { sha: 'commit-sha', html_url: 'https://github.com/owner/repo/commit/commit-sha' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/contents/test.txt')) {
        return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const approval = vi.fn(async () => true);
    const events: AgentEvent[] = [];
    let call = 0;
    await runGeneralAgent({
      token: 'github-token',
      userLogin: 'write-user',
      repo: { fullName: 'owner/repo', defaultBranch: 'main' },
      history: [{ role: 'user', content: '写文件' }],
      config,
      signal: new AbortController().signal,
      onEvent: event => events.push(event),
      tools: GITHUB_WRITE_TOOLS,
      requestApproval: approval,
      callModel: async (): Promise<ProviderStreamResult> => {
        call++;
        return call === 1
          ? {
              content: '',
              reasoning: '',
              toolCalls: [{
                id: 'write-1',
                name: 'github_write_file',
                arguments: JSON.stringify({ path: 'test.txt', content: 'hello 世界', message: 'test' }),
              }],
              model: 'test-model',
            }
          : { content: '写入完成', reasoning: '', toolCalls: [], model: 'test-model' };
      },
    });

    expect(approval).toHaveBeenCalledTimes(1);
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeTruthy();
    const body = JSON.parse(String(putCall?.[1]?.body)) as { content: string; message: string };
    expect(body.message).toBe('test');
    expect(atob(body.content)).toContain('hello');
    expect(events.some(event => event.type === 'tool_end' && event.ok)).toBe(true);
  });

  it('loads GitHub tools only when a repo context exists', () => {
    const withoutRepo = buildSystemPrompt();
    const withRepo = buildSystemPrompt({ fullName: 'owner/repo', defaultBranch: 'main', branch: 'dev' });
    expect(withoutRepo).toContain('没有选择仓库');
    expect(withRepo).toContain('owner/repo');
    expect(withRepo).toContain('github_write_file');
    expect(withRepo).toContain('artifact_read');
    const noRepoTools = resolveCapabilities().tools.map(tool => tool.name);
    const repoTools = resolveCapabilities({ fullName: 'owner/repo', defaultBranch: 'main' }).tools.map(tool => tool.name);
    expect(noRepoTools).toEqual(['artifact_read', 'memory_save', 'memory_search']);
    expect(repoTools).toContain('github_write_file');
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

  it('builds the Cloudflare AI fallback request without a user key', () => {
    const request = buildProviderRequest({
      type: 'cloudflare',
      api_key: 'cloudflare-free',
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      proxy_url: 'https://llm.callact.xyz',
    }, [{ role: 'user', content: 'hi' }], []);
    expect(request.url).toBe('https://llm.callact.xyz/v1/chat/completions');
    expect(request.headers['x-llm-provider']).toBe('cloudflare');
    expect(request.body.model).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
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