import { afterEach, describe, expect, it, vi } from 'vitest';
import { GITHUB_WRITE_TOOLS } from '@/ai-v2/tools/github';
import { resolveCapabilities } from '@/ai-v2/capabilities';

const repo = { fullName: 'owner/repo', defaultBranch: 'main' };
const ctx = { token: 'token', repo, signal: new AbortController().signal };

function tool(name: string) {
  const found = GITHUB_WRITE_TOOLS.find(item => item.name === name);
  if (!found) throw new Error(`tool not found: ${name}`);
  return found;
}

function response(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    text: async () => typeof data === 'string' ? data : JSON.stringify(data),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('GitHub batch write tools', () => {
  it('commits multiple files in one tree and updates the branch', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url.endsWith('/git/ref/heads/main')) return response({ object: { sha: 'head1' } });
      if (url.endsWith('/git/commits/head1')) return response({ tree: { sha: 'tree1' } });
      if (url.endsWith('/git/blobs')) {
        const sha = calls.filter(call => call.url.endsWith('/git/blobs')).length === 1 ? 'blob1' : 'blob2';
        return response({ sha });
      }
      if (url.endsWith('/git/trees')) return response({ sha: 'tree2' });
      if (url.endsWith('/git/commits')) return response({ sha: 'commit2', html_url: 'https://github.com/commit2' });
      if (url.includes('/git/refs/heads/main')) return response({});
      throw new Error(`unexpected ${method} ${url}`);
    }));

    const result = await tool('github_write_files').execute({
      message: 'batch update',
      files: [
        { path: 'a.txt', content: 'A' },
        { path: 'src/b.txt', content: 'B' },
      ],
    }, ctx);

    expect(result.ok).toBe(true);
    expect(result.content).toContain('已提交 2 个文件');
    const tree = calls.find(call => call.url.endsWith('/git/trees'));
    expect((tree?.body as { tree: unknown[] }).tree).toHaveLength(2);
    const patch = calls.find(call => call.method === 'PATCH');
    expect((patch?.body as { sha: string }).sha).toBe('commit2');
  });

  it('rejects duplicate paths and invalid branch names', async () => {
    await expect(tool('github_write_files').execute({
      message: 'dup',
      files: [
        { path: 'a.txt', content: 'A' },
        { path: 'a.txt', content: 'B' },
      ],
    }, ctx)).rejects.toThrow('重复文件路径');
    await expect(tool('github_create_branch').execute({ branch: '../main' }, ctx)).rejects.toThrow('分支名不合法');
  });

  it('creates a branch, pull request and merges it', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url.endsWith('/git/ref/heads/main')) return response({ object: { sha: 'head1' } });
      if (url.endsWith('/git/refs')) return response({ object: { sha: 'head1' } });
      if (url.endsWith('/pulls')) return response({ number: 8, html_url: 'https://github.com/pull/8' });
      if (url.endsWith('/pulls/8/merge')) return response({ merged: true, sha: 'merge8' });
      throw new Error(`unexpected ${method} ${url}`);
    }));

    const branch = await tool('github_create_branch').execute({ branch: 'feat/ai' }, ctx);
    expect(branch.content).toContain('feat/ai');
    const pr = await tool('github_create_pull_request').execute({ title: 'AI change', head: 'feat/ai' }, ctx);
    expect(pr.content).toContain('PR #8');
    const merged = await tool('github_merge_pull_request').execute({ number: 8, merge_method: 'squash' }, ctx);
    expect(merged.ok).toBe(true);
    expect(merged.content).toContain('merge8');
    expect(calls.find(call => call.url.endsWith('/pulls/8/merge'))?.method).toBe('PUT');
  });

  it('exposes all write tools only when a repo is selected', () => {
    const withRepo = resolveCapabilities(repo).tools.map(item => item.name);
    expect(withRepo).toContain('github_write_files');
    expect(withRepo).toContain('github_create_branch');
    expect(withRepo).toContain('github_create_pull_request');
    expect(withRepo).toContain('github_merge_pull_request');
    expect(resolveCapabilities().tools.map(item => item.name)).not.toContain('github_write_files');
  });
});