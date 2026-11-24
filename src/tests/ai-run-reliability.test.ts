import { afterEach, describe, expect, it, vi } from 'vitest';
import { runGeneralAgent, toAgentHistory } from '@/ai-v2/agent';
import { buildProviderRequest, streamProvider } from '@/ai-v2/providers';
import { runBinding } from '@/ai-v2/runStore';
import { GITHUB_WRITE_TOOLS, verifyGitHubWrite } from '@/ai-v2/tools/github';
import type { AgentCheckpoint, AgentTool, RunAgentOptions } from '@/ai-v2/types';
import type { ModelConfig } from '@/components/ai/aiTypes';

const config: ModelConfig = { type: 'openai', model: 'gpt-4o-mini', api_key: 'mock-key' };
const repo = { fullName: 'owner/project', branch: 'work', defaultBranch: 'main' };
const signal = () => new AbortController().signal;
const answer = { content: 'done', reasoning: '', model: 'mock', toolCalls: [] };

afterEach(() => vi.unstubAllGlobals());

describe('AI provider completion', () => {
  it.each([
    ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', '提前结束'],
    ['data: {"error":{"message":"upstream failed"}}\n\n', 'upstream failed'],
    ['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n', '长度上限'],
  ])('rejects incomplete or failed streams', async (body, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    await expect(streamProvider(config, [], [], signal(), () => {})).rejects.toThrow(message);
  });

  it('completes on DONE even if the response does not close', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',
        ));
      },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const result = await streamProvider(config, [], [], signal(), () => {});
    expect(result.content).toBe('hello');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('works with JSON responses and custom text-only profiles without an API key', async () => {
    const custom = { type: 'custom', endpoint: 'https://model.example/v1', supportsTools: false } as const;
    const fetch = vi.fn(async () => Response.json({
      choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
    }));
    vi.stubGlobal('fetch', fetch);
    const tools = [{ type: 'function' as const, function: { name: 'read', description: '', parameters: {} } }];
    expect(buildProviderRequest(custom, [], tools).headers).not.toHaveProperty('Authorization');
    expect(buildProviderRequest(custom, [], tools).body).not.toHaveProperty('tools');
    expect(buildProviderRequest({ ...custom, supportsTools: true }, [], tools).body.tools).toEqual(tools);
    const response = await streamProvider(custom, [], tools, signal(), () => {});
    expect(response.content).toBe('hello');
  });

  it('preserves previous image parts for a later visual question', async () => {
    const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,AAAA' } };
    const history = toAgentHistory([
      { role: 'user', content: 'What is this?', modelContent: [{ type: 'text', text: 'What is this?' }, image] },
      { role: 'assistant', content: 'A screenshot.' },
    ]);
    const callModel = vi.fn<NonNullable<RunAgentOptions['callModel']>>(async () => answer);
    await runGeneralAgent({
      config: { ...config, supportsVision: true },
      token: 'mock-token', history, currentUserContent: 'Read the text in it.',
      signal: signal(), callModel, onEvent: () => {},
    });
    const messages = callModel.mock.calls[0][1];
    expect(messages[1].content).toContainEqual(image);
  });
});

function runOptions(partial: Partial<RunAgentOptions>): RunAgentOptions {
  return { config, token: 'mock-token', repo, history: [], signal: signal(), onEvent: () => {}, ...partial };
}

describe('AI repository approvals and recovery', () => {
  it('submits the approved file SHA even if the server has a newer file', async () => {
    const calls: Array<{ method: string; body?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method || 'GET', body: init?.body as string | undefined });
      if (init?.method === 'PUT') return Response.json({ message: 'changed remotely' }, { status: 409 });
      return Response.json({ type: 'file', sha: 'approved-sha', encoding: 'base64', content: btoa('original') });
    }));
    const snapshots: AgentCheckpoint[] = [];
    const requestApproval = vi.fn<NonNullable<RunAgentOptions['requestApproval']>>(async () => true);
    await expect(runGeneralAgent(runOptions({
      tools: GITHUB_WRITE_TOOLS, requestApproval,
      onSnapshot: checkpoint => { snapshots.push(checkpoint); },
      callModel: async () => ({
        ...answer,
        toolCalls: [{ name: 'github_write_file', id: 'one', arguments: '{"path":"file.txt","content":"replacement","message":"Update"}' }],
      }),
    }))).rejects.toThrow('写入未确认完成');
    expect(requestApproval.mock.calls[0][0].target).toMatchObject({
      repository: repo.fullName, branch: 'work', fileSha: 'approved-sha',
    });
    expect(calls.map(call => call.method)).toEqual(['GET', 'PUT']);
    expect(JSON.parse(calls[1].body!).sha).toBe('approved-sha');
    expect(snapshots.at(-1)).toMatchObject({ writeInFlight: true, pendingWrite: { callId: 'one' } });
  });

  it('pins the exact approved branch head for an atomic batch commit', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/graphql')) {
        return Response.json({ data: { createCommitOnBranch: { commit: { oid: 'new-commit' } } } });
      }
      if (url.includes('/git/ref/heads/')) return Response.json({ object: { sha: 'approved-head' } });
      if (url.includes('/contents/')) return Response.json({ message: 'Not Found' }, { status: 404 });
      throw new Error(`Unexpected: ${url} ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetch);
    await runGeneralAgent(runOptions({
      tools: GITHUB_WRITE_TOOLS, requestApproval: async () => true,
      callModel: vi.fn().mockResolvedValueOnce({
        ...answer, toolCalls: [{ id: 'batch', name: 'github_write_files', arguments: JSON.stringify({
          branch: 'work', files: [{ path: 'new.txt', content: 'hello' }], message: 'Add file',
        }) }],
      }).mockResolvedValueOnce(answer),
    }));
    const graphql = fetch.mock.calls.find(([url]) => url.endsWith('/graphql'));
    expect(JSON.parse(String(graphql?.[1]?.body)).variables.input).toMatchObject({
      branch: { repositoryNameWithOwner: repo.fullName, refName: 'work' },
      expectedHeadOid: 'approved-head',
    });
  });

  it('refuses to merge if the pull request targets a different branch after approval', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
      head: { sha: 'approved-head', ref: 'work' },
      base: { ref: fetch.mock.calls.length === 1 ? 'main' : 'other' },
    }));
    vi.stubGlobal('fetch', fetch);
    await expect(runGeneralAgent(runOptions({
      tools: GITHUB_WRITE_TOOLS, requestApproval: async () => true,
      callModel: async () => ({
        ...answer, toolCalls: [{ id: 'merge', name: 'github_merge_pull_request', arguments: '{"number":7}' }],
      }),
    }))).rejects.toThrow('远端版本已变化');
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('remembers completed writes even if later calls do not run, and skips replay', async () => {
    const abort = new AbortController();
    const execute = vi.fn(async () => {
      abort.abort();
      return { ok: true, content: 'recorded remotely' };
    });
    const tool: AgentTool = { name: 'test_write', description: 'mock', risk: 'write', parameters: {}, execute };
    const calls = [
      { name: tool.name, id: 'first', arguments: '{"path":"file.txt"}' },
      { name: tool.name, id: 'second', arguments: '{"path":"other.txt"}' },
    ];
    const snapshots: AgentCheckpoint[] = [];
    await expect(runGeneralAgent(runOptions({
      tools: [tool], signal: abort.signal, requestApproval: async () => true,
      onSnapshot: checkpoint => { snapshots.push(checkpoint); },
      callModel: async () => ({ ...answer, toolCalls: calls }),
    }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(execute).toHaveBeenCalledOnce();
    const last = snapshots.at(-1)!;
    expect(last.writeInFlight).toBe(false);
    expect(last.completedWrites).toHaveLength(1);
    expect(last.messages.find(message => message.tool_call_id === 'first')?.content).toBe('recorded remotely');

    const approveReplay = vi.fn(async () => true);
    await runGeneralAgent(runOptions({
      tools: [tool], requestApproval: approveReplay,
      resumeMessages: last.messages, completedWrites: last.completedWrites,
      callModel: vi.fn().mockResolvedValueOnce({ ...answer, toolCalls: [calls[0]] }).mockResolvedValueOnce(answer),
    }));
    expect(execute).toHaveBeenCalledOnce();
    expect(approveReplay).not.toHaveBeenCalled();
  });

  it('does not perform a write whenever its pre-write checkpoint cannot be saved', async () => {
    const execute = vi.fn();
    const tool: AgentTool = { name: 'test_write', description: 'mock', risk: 'write', parameters: {}, execute };
    await expect(runGeneralAgent(runOptions({
      tools: [tool],
      requestApproval: async () => true,
      onSnapshot: checkpoint => !checkpoint.writeInFlight,
      callModel: vi.fn().mockResolvedValueOnce({
        ...answer, toolCalls: [{ id: 'first', name: tool.name, arguments: '{}' }],
      }).mockResolvedValueOnce(answer),
    }))).rejects.toThrow('无法保存安全恢复点');
    expect(execute).not.toHaveBeenCalled();
  });

  it('checks an uncertain result with just a remote GET', async () => {
    const fetch = vi.fn(async () => Response.json({ merged: true, head: { sha: 'expected' } }));
    vi.stubGlobal('fetch', fetch);
    await expect(verifyGitHubWrite(
      { kind: 'merge', repository: repo.fullName, number: 7, sha: 'expected' },
      'mock-token', signal(),
    )).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/project/pulls/7',
      expect.not.objectContaining({ method: 'PUT' }),
    );
  });

  it('binds restoration to the repository, branch, model and endpoint without recording keys', () => {
    const first = runBinding(repo, { type: 'custom', endpoint: 'https://a.example/v1', model: 'x', api_key: 'secret' });
    expect(first.repo?.branch).toBe('work');
    expect(JSON.stringify(first)).not.toContain('secret');
    expect(runBinding({ ...repo, branch: 'other' }, config)).not.toEqual(runBinding(repo, config));
  });

  it('stops when tool rounds keep changing arguments without finishing', async () => {
    let rounds = 0;
    const tool: AgentTool = {
      name: 'test_read', description: 'mock', risk: 'read', parameters: {},
      execute: async () => ({ ok: true, content: 'mock' }),
    };
    await expect(runGeneralAgent(runOptions({
      tools: [tool],
      callModel: async () => ({
        ...answer, toolCalls: [{ id: String(++rounds), name: tool.name, arguments: JSON.stringify({ rounds }) }],
      }),
    }))).rejects.toThrow('任务上限');
    expect(rounds).toBe(32);
  });
});
