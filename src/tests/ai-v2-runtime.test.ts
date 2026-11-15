import { beforeEach, describe, expect, it } from 'vitest';
import { listArtifacts, readArtifact, saveArtifact } from '@/ai-v2/artifacts';
import { appendRunEvent, clearRuns, finishRun, listRuns, startRun } from '@/ai-v2/runStore';

describe('AI V2 artifact store', () => {
  beforeEach(() => localStorage.clear());

  it('saves, lists and pages artifact content', () => {
    const meta = saveArtifact({
      login: 'alice',
      runId: 'run-1',
      toolName: 'github_read_file',
      title: 'README',
      content: 'a'.repeat(25000),
    });
    expect(meta).not.toBeNull();
    expect(listArtifacts('alice')).toHaveLength(1);
    const first = readArtifact('alice', meta!.id, 0, 1000);
    expect(first.total).toBe(25000);
    expect(first.content).toHaveLength(1000);
    expect(first.hasMore).toBe(true);
    const second = readArtifact('alice', meta!.id, 24000, 1000);
    expect(second.content).toHaveLength(1000);
    expect(second.hasMore).toBe(false);
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

  it('can finish an interrupted run and clear history', () => {
    const run = startRun({ login: 'bob', id: 'run-b', title: '中断任务' });
    finishRun('bob', run.id, 'stopped');
    expect(listRuns('bob')[0].status).toBe('stopped');
    clearRuns('bob');
    expect(listRuns('bob')).toHaveLength(0);
  });
});