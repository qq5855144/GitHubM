import { beforeEach, expect, it } from 'vitest';
import { runGeneralAgent } from '@/ai-v2/agent';
import { readArtifact, saveArtifact } from '@/ai-v2/artifacts';
import { compactProviderMessages, estimateProviderMessages, estimateTokens } from '@/ai-v2/context';
import { sanitizeToolCallPairing } from '@/ai-v2/providers';
import { loadRunSnapshot, saveRunSnapshot } from '@/ai-v2/runStore';
import { createTaskMemory, recordTaskActivity, renderTaskContext, taskMemoryScope, taskMemorySearch } from '@/ai-v2/taskMemory';
import type { RepoContext, UiChatMessage, V2ProviderMessage } from '@/ai-v2/types';

const repo: RepoContext = { fullName: 'owner/project', defaultBranch: 'main', branch: 'review' };
const scope = taskMemoryScope(repo);
const goal = '审查项目的登录和会话代码。只读，不要修改文件。';
const correction = '必须同时检查旧会话迁移，最终附上测试结果。';
const request = '继续按原方案推进';

function userMessage(content: string, index: number, taskScope = scope): UiChatMessage {
  return { id: `user-${index}`, role: 'user', content, taskScope, createdAt: '2026-01-01T00:00:00Z' };
}

beforeEach(() => localStorage.clear());

it('retains user constraints and isolated project progress beyond fifty messages', async () => {
  const prior = createTaskMemory([userMessage(goal, 1)], correction, repo);
  const updated = recordTaskActivity(prior,
    { id: 'read-1', name: 'github_read_file', arguments: '{"path":"src/auth.ts","token":"do-not-retain"}' },
    true, 'SHA：abcdef1234\n[内容未结束] 继续读取：{"offset":22000}',
  );
  const messages: UiChatMessage[] = [
    userMessage('你好', 0), userMessage(goal, 1), userMessage(correction, 2),
    { ...userMessage('已检查登录代码', 3), role: 'assistant', taskProgress: updated.progress },
    ...Array.from({ length: 52 }, (_, index) => userMessage(`补充说明 ${index}`, index + 4)),
  ];
  const task = createTaskMemory(messages, request, repo);
  const context = renderTaskContext(task, estimateTokens, 3500, true);

  expect(task.goal).toBe(goal);
  expect(context).toContain(correction);
  expect(context).toContain('src/auth.ts');
  expect(context).toContain('下一段 offset=22000');
  expect(context).not.toContain('do-not-retain');
  const recalled = await taskMemorySearch(() => task).execute({ query: 'src/auth.ts' }, { token: '' });
  expect(recalled.content).toContain('abcdef1234');
  const newScope = createTaskMemory(messages, '检查发布流程', { ...repo, branch: 'release' });
  expect(newScope.goal).toBe('检查发布流程');
  expect(newScope.previousActivity).toEqual([]);
});

it('saves the original goal and progress through a long interrupted run and restores both', async () => {
  const taskMemory = createTaskMemory([userMessage(goal, 1), userMessage(correction, 2)], request, repo);
  const config = { type: 'custom' as const, model: 'test', endpoint: 'https://example.test/v1', supportsTools: true };
  const paths: string[] = [];
  const options = {
    token: 'test-token', userLogin: 'alice', config, repo, history: [],
    signal: new AbortController().signal, onEvent() {},
    contextBudget: 5000,
    tools: [{
      name: 'github_read_file', description: 'read', parameters: {}, risk: 'read' as const,
      async execute(args: Record<string, unknown>) {
        paths.push(String(args.path));
        return { ok: true, content: `SHA：abcdef1234\n${'日志'.repeat(2800)}` };
      },
    }],
  };
  let calls = 0;
  await expect(runGeneralAgent({
    ...options,
    runId: 'long-run', taskMemory, currentUserText: request, currentUserContent: request,
    async onSnapshot(snapshot) {
      return saveRunSnapshot('alice', {
        ...snapshot, runId: 'long-run', title: request, capabilities: [], savedAt: new Date().toISOString(),
      });
    },
    async callModel(_config, messages, tools) {
      expect(estimateProviderMessages(messages) + estimateTokens(JSON.stringify(tools))).toBeLessThanOrEqual(5000);
      if (++calls > 18) throw new Error('模拟中断');
      return {
        content: `接下来读取 file-${calls}.ts`, reasoning: '', model: 'test',
        toolCalls: [{ id: `call-${calls}`, name: 'github_read_file', arguments: JSON.stringify({ path: `file-${calls}.ts` }) }],
      };
    },
  })).rejects.toThrow('模拟中断');

  const snapshot = await loadRunSnapshot('alice', 'long-run');
  if (!snapshot?.taskMemory) throw new Error('Task memory failed to persist');
  expect(snapshot.taskMemory.goal).toBe(goal);
  expect(snapshot.taskMemory.progress.completedCalls).toBe(18);
  expect(snapshot.taskMemory.progress.activity[0].target).toBe('path=file-1.ts');
  expect(snapshot.messages.some(message => message.role === 'user' && message.content === request)).toBe(true);

  await runGeneralAgent({
    ...options,
    taskMemory: snapshot.taskMemory, resumeMessages: snapshot.messages, resumeSteps: snapshot.steps,
    resumeToolCalls: snapshot.toolCalls, completedWrites: snapshot.completedWrites,
    async callModel(_config, messages) {
      const systems = messages.filter(message => message.role === 'system');
      expect(systems).toHaveLength(1);
      expect(systems[0].content).toContain(goal);
      expect(systems[0].content).toContain(correction);
      expect(systems[0].content).toContain('file-18.ts');
      expect(sanitizeToolCallPairing(messages)).toEqual(messages);
      return { content: '从下一项继续', reasoning: '', model: 'test', toolCalls: [] };
    },
  });
  expect(paths).toHaveLength(18);
  expect(new Set(paths).size).toBe(18);
});

it('enforces the estimated budget for large multimodal input', () => {
  const messages: V2ProviderMessage[] = [{
    role: 'user',
    content: [
      { type: 'text', text: `保留用户目标：${'日志'.repeat(9000)}最后附测试结果` },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
    ],
  }];
  const compacted = compactProviderMessages(messages, 16000);
  expect(estimateProviderMessages(compacted)).toBeLessThanOrEqual(16000);
  const parts = compacted[0].content;
  expect(parts).toEqual([
    { type: 'text', text: expect.stringMatching(/^保留用户目标：[\s\S]*最后附测试结果$/u) },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
  ]);
});

it('keeps task evidence readable after the ordinary artifact window rolls over', async () => {
  const first = await saveArtifact({ login: 'alice', runId: 'long', taskEvidence: true, title: 'First log', content: 'first evidence' });
  expect(first).not.toBeNull();
  for (let index = 0; index < 24; index++) {
    await saveArtifact({ login: 'alice', title: `Log ${index}`, content: `log ${index}` });
  }
  const saved = await readArtifact('alice', first!.id);
  expect(saved.content).toBe('first evidence');
  expect((await readArtifact('bob', first!.id)).meta).toBeNull();
});
