// AI Assistant V2 — GitHub 只读工具包（按需加载）
import type { AgentTool, RepoContext, ToolRunResult, ToolRuntimeContext } from '../types';

const API = 'https://api.github.com';

function repoParts(repo?: RepoContext): { owner: string; name: string; branch: string } {
  if (!repo?.fullName?.includes('/')) throw new Error('当前没有选择仓库');
  const [owner, name] = repo.fullName.split('/');
  return { owner, name, branch: repo.branch || repo.defaultBranch || 'main' };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

async function githubFetch(
  ctx: ToolRuntimeContext,
  path: string,
  accept = 'application/vnd.github+json',
): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: ctx.signal,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const json = JSON.parse(text) as { message?: string };
      detail = json.message || text;
    } catch {
      // ignore
    }
    throw new Error(`GitHub HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function truncate(text: string, limit = 30000): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n…（已截断，原长度 ${text.length} 字符）`;
}

const listFiles: AgentTool = {
  name: 'github_list_files',
  description: '列出当前仓库某个目录下的文件和子目录。path 为空表示仓库根目录。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径，例如 src/components；根目录留空' },
    },
  },
  risk: 'read',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name, branch } = repoParts(ctx.repo);
    const path = String(args.path || '').replace(/^\/+|\/+$/g, '');
    const data = await githubFetch(
      ctx,
      `/repos/${owner}/${name}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
    ) as Array<{ name: string; path: string; type: string; size: number; sha: string }>;
    if (!Array.isArray(data)) return { ok: true, content: '该路径不是目录。' };
    const rows = data
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
      .map(item => `- ${item.type === 'dir' ? '目录' : '文件'} ${item.path}${item.type === 'file' ? ` (${item.size} bytes)` : ''}`);
    return {
      ok: true,
      content: [`仓库：${ctx.repo?.fullName}`, `分支：${branch}`, `目录：/${path}`, '', ...rows].join('\n'),
    };
  },
};

const readFile: AgentTool = {
  name: 'github_read_file',
  description: '读取当前仓库中一个文本文件的内容。需要提供完整文件路径。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径，例如 src/App.tsx' },
    },
    required: ['path'],
  },
  risk: 'read',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name, branch } = repoParts(ctx.repo);
    const path = String(args.path || '').replace(/^\/+/, '');
    if (!path) throw new Error('path 不能为空');
    const data = await githubFetch(
      ctx,
      `/repos/${owner}/${name}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
    ) as {
      type?: string;
      encoding?: string;
      content?: string;
      size?: number;
      sha?: string;
      download_url?: string;
    };
    if (data.type === 'dir') return { ok: true, content: '该路径是目录，请使用 github_list_files。' };
    if (!data.content || data.encoding !== 'base64') {
      return {
        ok: true,
        content: `文件：${path}\n大小：${data.size || 0} bytes\nGitHub 未返回可解码文本（可能是二进制文件或文件过大）。`,
      };
    }
    const text = decodeBase64Utf8(data.content);
    return {
      ok: true,
      content: [
        `文件：${path}`,
        `分支：${branch}`,
        `SHA：${data.sha || ''}`,
        `大小：${data.size || 0} bytes`,
        '',
        truncate(text),
      ].join('\n'),
    };
  },
};

const searchCode: AgentTool = {
  name: 'github_search_code',
  description: '在当前仓库中搜索代码或文本。返回匹配文件、路径和文本片段。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词或代码片段' },
    },
    required: ['query'],
  },
  risk: 'read',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name } = repoParts(ctx.repo);
    const query = String(args.query || '').trim();
    if (!query) throw new Error('query 不能为空');
    const data = await githubFetch(
      ctx,
      `/search/code?q=${encodeURIComponent(`${query} repo:${owner}/${name}`)}&per_page=10`,
      'application/vnd.github.text-match+json',
    ) as {
      total_count?: number;
      items?: Array<{
        path?: string;
        html_url?: string;
        text_matches?: Array<{ fragment?: string }>;
      }>;
    };
    const items = data.items || [];
    if (items.length === 0) return { ok: true, content: `没有找到匹配 “${query}” 的代码。` };
    const rows = items.map(item => [
      `### ${item.path || '(unknown)'}`,
      ...(item.text_matches || []).slice(0, 3).map(match => `\`\`\`\n${(match.fragment || '').slice(0, 600)}\n\`\`\``),
    ].join('\n'));
    return {
      ok: true,
      content: [`搜索：${query}`, `命中：${data.total_count ?? items.length}`, '', ...rows].join('\n'),
    };
  },
};

const repoInfo: AgentTool = {
  name: 'github_repo_info',
  description: '读取当前仓库的基本信息：默认分支、描述、语言、Star、私有状态。',
  parameters: { type: 'object', properties: {} },
  risk: 'read',
  async execute(_args, ctx): Promise<ToolRunResult> {
    const { owner, name } = repoParts(ctx.repo);
    const data = await githubFetch(ctx, `/repos/${owner}/${name}`) as {
      full_name?: string;
      description?: string | null;
      default_branch?: string;
      language?: string | null;
      stargazers_count?: number;
      forks_count?: number;
      private?: boolean;
      updated_at?: string;
    };
    return {
      ok: true,
      content: [
        `仓库：${data.full_name || ctx.repo?.fullName}`,
        `默认分支：${data.default_branch || '-'}`,
        `描述：${data.description || '无'}`,
        `语言：${data.language || '未知'}`,
        `Star：${data.stargazers_count ?? 0}`,
        `Fork：${data.forks_count ?? 0}`,
        `私有：${data.private ? '是' : '否'}`,
        `最近更新：${data.updated_at || '-'}`,
      ].join('\n'),
    };
  },
};

export const GITHUB_READ_TOOLS: AgentTool[] = [repoInfo, listFiles, readFile, searchCode];

/** 只有选择了仓库才暴露 GitHub 工具 */
export function getToolsForContext(repo?: RepoContext): AgentTool[] {
  return repo ? GITHUB_READ_TOOLS : [];
}