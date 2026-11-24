import { beforeEach, describe, expect, it } from 'vitest';
import { listArtifacts, readArtifact, saveArtifact } from '@/ai-v2/artifacts';
import {
  appendRunEvent,
  clearRunSnapshot,
  clearRuns,
  finishRun,
  latestRunSnapshot,
  listRuns,
  loadRunSnapshot,
  saveRunSnapshot,
  startRun,
} from '@/ai-v2/runStore';
import { listMemories, saveMemory, searchMemories } from '@/ai-v2/memory';
import { selectSkills } from '@/ai-v2/skills';
import { buildAgentContext, compactProviderMessages, estimateTokens } from '@/ai-v2/context';
import { buildUnifiedDiff } from '@/ai-v2/diff';
import { loadV2Settings, saveV2Settings } from '@/ai-v2/settings';

describe('AI V2 artifact store', () => {
  beforeEach(() => localStorage.clear());

  it('saves, lists and pages artifact content', async () => {
    const meta = saveArtifact({
      login: 'alice',
      runId: 'run-1',
      toolName: 'github_read_file',
      title: 'README',
      content: 'a'.repeat(25000),
    });
    expect(meta).not.toBeNull();
    expect(listArtifacts('alice')).toHaveLength(1);
    const first = await readArtifact('alice', meta!.id, 0, 1000);
    expect(first.total).toBe(25000);
    expect(first.content).toHaveLength(1000);
    expect(first.hasMore).toBe(true);
    const second = await readArtifact('alice', meta!.id, 24000, 1000);
    expect(second.content).toHaveLength(1000);
    expect(second.hasMore).toBe(false);
  });
});

describe('AI V2 memory and context', () => {
  beforeEach(() => localStorage.clear());

  it('stores and retrieves long-term memories', () => {
    saveMemory('alice', '这个项目使用 React + Vite', ['项目', '前端']);
    saveMemory('alice', '发布前必须运行 pnpm build', ['发布']);
    expect(listMemories('alice')).toHaveLength(2);
    const results = searchMemories('alice', 'React Vite');
    expect(results[0].content).toContain('React');
  });

  it('selects skills by task keywords', () => {
    const skills = selectSkills('Actions 构建失败，帮我查看日志');
    expect(skills.map(skill => skill.id)).toContain('actions-debug');
  });

  it('injects memory and skill while trimming old history', () => {
    saveMemory('alice', '部署使用 Cloudflare Pages', ['部署']);
    const history = Array.from({ length: 80 }, (_, index) => ({
      role: 'user' as const,
      content: `历史消息 ${index} ${'x'.repeat(500)}`,
    }));
    history.push({ role: 'user', content: 'Actions 部署失败，Cloudflare Pages 报错' });
    const built = buildAgentContext({
      systemPrompt: '系统',
      history,
      query: history[history.length - 1].content,
      userLogin: 'alice',
      capabilities: [{ id: 'core', label: '核心', description: '基础' }],
      contextBudget: 8000,
    });
    expect(built.trimmedMessages).toBeGreaterThan(0);
    expect(built.skillIds).toContain('actions-debug');
    expect(built.memoryIds.length).toBeGreaterThan(0);
    expect(String(built.messages[0].content)).toContain('相关技能');
    expect(String(built.messages[0].content)).toContain('长期记忆');
    expect(estimateTokens('你好世界')).toBe(4);
    expect(estimateTokens('hello world')).toBeLessThan(estimateTokens('你好世界'));
  });

  it('compacts old tool results during long runs', () => {
    const messages = [
      { role: 'system' as const, content: 'system' },
      { role: 'user' as const, content: 'do a long task' },
      ...Array.from({ length: 8 }, (_, index) => ([
        { role: 'assistant' as const, content: `step ${index}` },
        { role: 'tool' as const, content: `${index}`.repeat(20000), tool_call_id: `call-${index}`, name: 'github_read_file' },
      ])).flat(),
    ];
    const compacted = compactProviderMessages(messages, 6000);
    expect(compacted[0].role).toBe('system');
    expect(compacted.some(item => item.role === 'user')).toBe(true);
    expect(compacted.length).toBeLessThan(messages.length);
    const toolContents = compacted.filter(item => item.role === 'tool').map(item => String(item.content));
    expect(Math.max(...toolContents.map(item => item.length))).toBeLessThan(20000);
    expect(estimateTokens(toolContents.join('\n'))).toBeLessThan(estimateTokens(
      messages.filter(item => item.role === 'tool').map(item => String(item.content)).join('\n'),
    ));
  });

  it('does not leave an orphan tool message after the final compaction fallback', () => {
    const messages = [
      { role: 'system' as const, content: 'system' },
      ...Array.from({ length: 10 }, (_, index) => ({
        role: 'tool' as const,
        content: `${index}`.repeat(5000),
        tool_call_id: `call-${index}`,
        name: 'github_read_file',
      })),
    ];
    const compacted = compactProviderMessages(messages, 4000);
    const firstBody = compacted.find(item => item.role !== 'system');
    expect(firstBody?.role).not.toBe('tool');
  });
  it('builds a unified diff for write approval', () => {
    const diff = buildUnifiedDiff('line1\nline2\nline3', 'line1\nchanged\nline3');
    expect(diff).toContain('-line2');
    expect(diff).toContain('+changed');
  });

  it('persists runtime settings', () => {
    saveV2Settings({ contextBudget: 64000, memoryEnabled: false });
    const loaded = loadV2Settings();
    expect(loaded).not.toHaveProperty('allowAllPermissions');
    expect(loaded.contextBudget).toBe(64000);
    expect(loaded.memoryEnabled).toBe(false);
  });
});

describe('AI V2 run store', () => {
  beforeEach(() => localStorage.clear());

  it('records run lifecycle and tool stats', () => {
    const run = startRun({ login: 'alice', id: 'run-a', title: '测试运行' });
    appendRunEvent('alice', run.id, { type: 'run_start', runId: run.id, capabilities: ['core', 'github-read'] });
    appendRunEvent('alice', run.id, {
      type: 'tool_start',
      call: { id: 'c1', name: 'github_read_file', arguments: '{"path":"README.md"}' },
    });
    appendRunEvent('alice', run.id, {
      type: 'tool_end',
      call: { id: 'c1', name: 'github_read_file', arguments: '{"path":"README.md"}' },
      ok: true,
      content: 'ok',
    });
    appendRunEvent('alice', run.id, { type: 'done', text: '完成', steps: 2 });

    const [record] = listRuns('alice');
    expect(record.status).toBe('done');
    expect(record.toolCalls).toBe(1);
    expect(record.steps).toBe(2);
    expect(record.capabilities).toEqual(['core', 'github-read']);
    expect(record.events.map(event => event.type)).toEqual(['run_start', 'tool_start', 'tool_end', 'done']);
    expect(record.events[2].artifact).toBe(false);
  });

  it('can finish an interrupted run and clear history', async () => {
    const run = startRun({ login: 'bob', id: 'run-b', title: '中断任务' });
    finishRun('bob', run.id, 'stopped');
    expect(listRuns('bob')[0].status).toBe('stopped');
    await saveRunSnapshot('bob', {
      runId: run.id,
      sessionId: 'session-b',
      assistantId: 'assistant-b',
      title: '中断任务',
      messages: [{ role: 'user', content: '继续' }],
      steps: 1,
      capabilities: ['core'],
      savedAt: new Date().toISOString(),
    });
    await clearRuns('bob');
    expect(listRuns('bob')).toHaveLength(0);
    expect(await latestRunSnapshot('bob', 'session-b')).toBeNull();
  });

  it('saves and loads resumable run snapshots', async () => {
    await saveRunSnapshot('alice', {
      runId: 'run-snap',
      sessionId: 'session-1',
      assistantId: 'assistant-1',
      title: '恢复测试',
      messages: [{ role: 'user', content: '继续' }],
      steps: 3,
      capabilities: ['core'],
      savedAt: new Date().toISOString(),
    });
    const loaded = await loadRunSnapshot('alice', 'run-snap');
    expect(loaded?.steps).toBe(3);
    expect((await latestRunSnapshot('alice', 'session-1'))?.runId).toBe('run-snap');
    await clearRunSnapshot('alice', 'run-snap');
    expect(await loadRunSnapshot('alice', 'run-snap')).toBeNull();
  });
});