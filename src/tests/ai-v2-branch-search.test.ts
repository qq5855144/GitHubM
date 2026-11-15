import { afterEach, describe, expect, it, vi } from 'vitest';
import { GITHUB_READ_TOOLS } from '@/ai-v2/tools/github';

const search = GITHUB_READ_TOOLS.find(tool => tool.name === 'github_search_code');
if (!search) throw new Error('search tool missing');

function textResponse(text: string): Response {
  return { ok: true, status: 200, text: async () => text } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('branch-aware code search', () => {
  it('scans files in the selected non-default branch', async () => {
    const content = 'const value = 1;\n// NEEDLE here\n';
    const encoded = btoa(content);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/git/trees/feature?')) {
        return textResponse(JSON.stringify({
          tree: [
            { path: 'src/a.ts', type: 'blob', sha: 'sha-a', size: content.length },
            { path: 'src/b.md', type: 'blob', sha: 'sha-b', size: 20 },
            { path: 'node_modules/pkg/x.ts', type: 'blob', sha: 'sha-x', size: 20 },
            { path: 'public/logo.png', type: 'blob', sha: 'sha-img', size: 20 },
          ],
        }));
      }
      if (url.endsWith('/git/blobs/sha-a')) return textResponse(JSON.stringify({ content: encoded, encoding: 'base64' }));
      if (url.endsWith('/git/blobs/sha-b')) return textResponse(JSON.stringify({ content: btoa('nothing'), encoding: 'base64' }));
      throw new Error(`unexpected ${url}`);
    }));

    const result = await search.execute({ query: 'needle' }, {
      token: 'token',
      repo: { fullName: 'owner/repo', defaultBranch: 'main', branch: 'feature' },
      signal: new AbortController().signal,
    });

    expect(result.content).toContain('分支搜索：feature');
    expect(result.content).toContain('src/a.ts');
    expect(result.content).toContain('第 2 行');
    expect(calls.some(url => url.includes('/search/code'))).toBe(false);
  });
});