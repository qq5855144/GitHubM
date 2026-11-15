import { afterEach, describe, expect, it, vi } from 'vitest';
import { GITHUB_OPS_TOOLS } from '@/ai-v2/tools/githubOps';
import { resolveCapabilities } from '@/ai-v2/capabilities';

const repo = { fullName: 'owner/repo', defaultBranch: 'main' };
const ctx = { token: 'token', repo, signal: new AbortController().signal };

function tool(name: string) {
  const found = GITHUB_OPS_TOOLS.find(item => item.name === name);
  if (!found) throw new Error(`tool not found: ${name}`);
  return found;
}

function mockText(text: string, ok = true) {
  return { ok, status: ok ? 200 : 500, text: async () => text } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('GitHub ops tools', () => {
  it('lists workflow runs and jobs', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/actions/runs?')) {
        return mockText(JSON.stringify({
          total_count: 1,
          workflow_runs: [{
            id: 42,
            name: 'Deploy',
            display_title: 'fix build',
            head_branch: 'main',
            event: 'push',
            status: 'completed',
            conclusion: 'failure',
            created_at: '2026-01-01T00:00:00Z',
          }],
        }));
      }
      if (url.includes('/actions/runs/42/jobs')) {
        return mockText(JSON.stringify({
          jobs: [{
            id: 99,
            name: 'build',
            status: 'completed',
            conclusion: 'failure',
            steps: [
              { name: 'install', conclusion: 'success' },
              { name: 'test', conclusion: 'failure' },
            ],
          }],
        }));
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const runs = await tool('github_list_workflow_runs').execute({ limit: 5 }, ctx);
    expect(runs.ok).toBe(true);
    expect(runs.content).toContain('run 42');
    expect(runs.content).toContain('failure');

    const jobs = await tool('github_list_workflow_jobs').execute({ run_id: 42 }, ctx);
    expect(jobs.ok).toBe(true);
    expect(jobs.content).toContain('job 99');
    expect(jobs.content).toContain('test');
  });

  it('reads complete job logs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockText('line1\nERROR: boom\nline3')));
    const result = await tool('github_get_job_logs').execute({ job_id: 99 }, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('ERROR: boom');
  });

  it('lists issues without pull requests and reads PR details', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/issues?')) {
        return mockText(JSON.stringify([
          { number: 1, title: 'bug', state: 'open', user: { login: 'alice' }, labels: [{ name: 'bug' }] },
          { number: 2, title: 'PR', state: 'open', pull_request: { url: 'x' } },
        ]));
      }
      if (url.includes('/pulls?')) {
        return mockText(JSON.stringify([{
          number: 2,
          title: 'Improve',
          state: 'open',
          draft: true,
          head: { ref: 'feat' },
          base: { ref: 'main' },
        }]));
      }
      if (url.includes('/pulls/2')) {
        return mockText(JSON.stringify({
          number: 2,
          title: 'Improve',
          state: 'open',
          draft: true,
          additions: 10,
          deletions: 2,
          changed_files: 3,
          mergeable: true,
          body: 'body',
        }));
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const issues = await tool('github_list_issues').execute({}, ctx);
    expect(issues.content).toContain('#1 bug');
    expect(issues.content).not.toContain('#2 PR');

    const pulls = await tool('github_list_pulls').execute({}, ctx);
    expect(pulls.content).toContain('#2 Improve');
    expect(pulls.content).toContain('draft');

    const pull = await tool('github_get_pull').execute({ number: 2 }, ctx);
    expect(pull.content).toContain('+10 / -2');
  });

  it('activates the GitHub ops capability with a repo', () => {
    const withRepo = resolveCapabilities(repo);
    expect(withRepo.capabilities.map(item => item.id)).toContain('github-ops');
    expect(withRepo.tools.map(item => item.name)).toContain('github_get_job_logs');
    expect(resolveCapabilities().capabilities.map(item => item.id)).not.toContain('github-ops');
  });
});