import { afterEach, describe, expect, it, vi } from 'vitest';
import { GITHUB_EDIT_TOOLS } from '@/ai-v2/tools/githubEdit';
import { resolveCapabilities } from '@/ai-v2/capabilities';

const repo = { fullName: 'owner/repo', defaultBranch: 'main' };
const ctx = { token: 'token', repo, signal: new AbortController().signal };

function tool(name: string) {
  const found = GITHUB_EDIT_TOOLS.find(item => item.name === name);
  if (!found) throw new Error(`tool not found: ${name}`);
  return found;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
    json: async () => data,
    headers: { get: () => null },
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('github_edit_file', () => {
  it('applies local replacements without rewriting the whole file', async () => {
    const original = 'export const a = 1;\nexport const b = 2;\n';
    const puts: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      if (method === 'GET' && url.includes('/contents/src/a.ts')) {
        return jsonResponse({ type: 'file', encoding: 'base64', content: toBase64(original), sha: 'sha1' });
      }
      if (method === 'PUT' && url.includes('/contents/src/a.ts')) {
        puts.push(JSON.parse(String(init?.body)));
        return jsonResponse({ commit: { sha: 'commit1', html_url: 'https://github.com/c1' } });
      }
      throw new Error(`unexpected ${method} ${url}`);
    }));

    const result = await tool('github_edit_file').execute({
      path: 'src/a.ts',
      message: 'update a',
      edits: [{ old_string: 'export const a = 1;', new_string: 'export const a = 10;' }],
    }, ctx);

    expect(result.ok).toBe(true);
    expect(result.content).toContain('替换条数：1');
    expect(result.content).toContain('提交：commit1');
    expect(puts).toHaveLength(1);
    expect(puts[0].sha).toBe('sha1');
    expect(fromBase64(String(puts[0].content))).toBe('export const a = 10;\nexport const b = 2;\n');
  });

  it('supports replace_all for repeated snippets', async () => {
    const original = 'foo();\nbar();\nfoo();\n';
    const puts: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const method = init?.method || 'GET';
      if (method === 'GET') {
        return jsonResponse({ type: 'file', encoding: 'base64', content: toBase64(original), sha: 'sha1' });
      }
      puts.push(JSON.parse(String(init?.body)));
      return jsonResponse({ commit: { sha: 'commit2' } });
    }));

    await tool('github_edit_file').execute({
      path: 'a.ts',
      message: 'replace all',
      edits: [{ old_string: 'foo();', new_string: 'baz();', replace_all: true }],
    }, ctx);

    expect(fromBase64(String(puts[0].content))).toBe('baz();\nbar();\nbaz();\n');
  });

  it('rejects unmatched, ambiguous and no-op replacements', async () => {
    const original = 'line\nfoo\nfoo\n';
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      if ((init?.method || 'GET') === 'GET') {
        return jsonResponse({ type: 'file', encoding: 'base64', content: toBase64(original), sha: 'sha1' });
      }
      throw new Error('should not write');
    }));

    await expect(tool('github_edit_file').execute({
      path: 'a.txt', message: 'm', edits: [{ old_string: 'nope', new_string: 'x' }],
    }, ctx)).rejects.toThrow('未匹配到 old_string');
    await expect(tool('github_edit_file').execute({
      path: 'a.txt', message: 'm', edits: [{ old_string: 'foo', new_string: 'x' }],
    }, ctx)).rejects.toThrow('匹配到 2 处');
    await expect(tool('github_edit_file').execute({
      path: 'a.txt', message: 'm', edits: [{ old_string: 'line', new_string: 'line' }],
    }, ctx)).rejects.toThrow('内容没有变化');
  });

  it('reports a clear error when the file does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'Not Found' }, 404)));
    await expect(tool('github_edit_file').execute({
      path: 'missing.ts', message: 'm', edits: [{ old_string: 'a', new_string: 'b' }],
    }, ctx)).rejects.toThrow('文件不存在');
  });
});

describe('github_append_file', () => {
  it('creates a new file when it does not exist yet', async () => {
    const puts: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const method = init?.method || 'GET';
      if (method === 'GET') return jsonResponse({ message: 'Not Found' }, 404);
      puts.push(JSON.parse(String(init?.body)));
      return jsonResponse({ commit: { sha: 'commit3' } });
    }));

    const result = await tool('github_append_file').execute({
      path: 'docs/new.md', message: 'create', content: '# title',
    }, ctx);

    expect(result.ok).toBe(true);
    expect(puts[0].sha).toBeUndefined();
    expect(fromBase64(String(puts[0].content))).toBe('# title');
  });

  it('appends a chunk and keeps a trailing newline between chunks', async () => {
    const puts: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const method = init?.method || 'GET';
      if (method === 'GET') {
        return jsonResponse({ type: 'file', encoding: 'base64', content: toBase64('第一段'), sha: 'sha9' });
      }
      puts.push(JSON.parse(String(init?.body)));
      return jsonResponse({ commit: { sha: 'commit4' } });
    }));

    const result = await tool('github_append_file').execute({
      path: 'docs/new.md', message: 'append', content: '第二段',
    }, ctx);

    expect(result.content).toContain('文件现在：7 字符');
    expect(puts[0].sha).toBe('sha9');
    expect(fromBase64(String(puts[0].content))).toBe('第一段\n第二段');
  });
});

describe('edit capability registration', () => {
  it('exposes the edit tools only when a repo is selected', () => {
    const withRepo = resolveCapabilities(repo).tools.map(item => item.name);
    expect(withRepo).toContain('github_edit_file');
    expect(withRepo).toContain('github_append_file');
    expect(resolveCapabilities().tools.map(item => item.name)).not.toContain('github_edit_file');
  });
});
