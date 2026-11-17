import { afterEach, describe, expect, it, vi } from 'vitest';
import { GITHUB_READ_TOOLS } from '@/ai-v2/tools/github';
import type { ToolRuntimeContext } from '@/ai-v2/types';

const tool = GITHUB_READ_TOOLS.find(item => item.name === 'github_read_file');

const ctx = {
  token: 'test-token',
  repo: { fullName: 'owner/repo', defaultBranch: 'main', branch: 'main' },
  signal: new AbortController().signal,
} as unknown as ToolRuntimeContext;

function mockFile(text: string) {
  const base64 = Buffer.from(text, 'utf8').toString('base64');
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      type: 'file',
      encoding: 'base64',
      content: base64,
      size: Buffer.byteLength(text),
      sha: 'abc',
    }),
  })));
}

describe('github_read_file paging', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the first page with a continuation hint', async () => {
    expect(tool).toBeTruthy();
    mockFile('a'.repeat(90000));
    const result = await tool!.execute({ path: 'big.ts' }, ctx);
    const content = String(result.content);
    expect(content).toContain('全文：90000 字符');
    expect(content).toContain('本次范围：0-11000');
    expect(content).toContain('[内容未结束]');
    expect(content).toContain('"offset":11000');
    expect(content.length).toBeGreaterThan(11000);
  });

  it('reads the tail page and marks the end', async () => {
    mockFile('b'.repeat(50000));
    const result = await tool!.execute({ path: 'big.ts', offset: 40000, limit: 10000 }, ctx);
    const content = String(result.content);
    expect(content).toContain('本次范围：40000-50000');
    expect(content).toContain('[内容结束]');
    expect(content).not.toContain('[内容未结束]');
  });
});
