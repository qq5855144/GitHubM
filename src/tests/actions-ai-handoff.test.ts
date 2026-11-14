import { beforeEach, describe, expect, it } from 'vitest';
import { buildActionsFailurePrompt } from '@/lib/actionsAiPrompt';
import { consumeAiTaskHandoff, setAiTaskHandoff } from '@/lib/aiTaskHandoff';

describe('Actions to AI handoff', () => {
  beforeEach(() => sessionStorage.clear());

  it('builds a prompt with job metadata, failed step and log tail', () => {
    const prompt = buildActionsFailurePrompt({
      repoFullName: 'owner/repo',
      branch: 'main',
      jobName: 'build',
      jobId: 123456,
      runId: 7890,
      conclusion: 'failure',
      htmlUrl: 'https://github.com/owner/repo/actions/runs/1',
      failedSteps: ['Run tests'],
      logs: 'line one\nError: test failed',
    });

    expect(prompt).toContain('仓库：owner/repo');
    expect(prompt).toContain('分支：main');
    expect(prompt).toContain('Job：build');
    expect(prompt).toContain('Job ID：123456');
    expect(prompt).toContain('Run ID：7890');
    expect(prompt).toContain('{"tool":"get_job_logs","job_id":"123456"}');
    expect(prompt).toContain('失败步骤：Run tests');
    expect(prompt).toContain('Error: test failed');
  });

  it('keeps only the tail of very large logs', () => {
    const prompt = buildActionsFailurePrompt({
      repoFullName: 'owner/repo',
      jobName: 'build',
      logs: `${'old-log\n'.repeat(2000)}FINAL ERROR`,
    });

    expect(prompt).toContain('FINAL ERROR');
    expect(prompt).toContain('仅保留最后');
    expect(prompt.length).toBeLessThan(13_500);
  });

  it('consumes a handoff once', () => {
    expect(setAiTaskHandoff({
      prompt: 'analyze this',
      repoFullName: 'owner/repo',
      branch: 'main',
      source: 'actions',
    })).toBe(true);

    expect(consumeAiTaskHandoff()).toMatchObject({
      prompt: 'analyze this',
      repoFullName: 'owner/repo',
      branch: 'main',
    });
    expect(consumeAiTaskHandoff()).toBeNull();
  });
});