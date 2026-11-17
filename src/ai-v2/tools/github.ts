// AI Assistant V2 — GitHub 只读工具包（按需加载）
import type { AgentTool, RepoContext, ToolRunResult, ToolRuntimeContext } from '../types';
import { isTextFilePath } from '../attachments';

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
  init: Pick<RequestInit, 'method' | 'body'> = {},
): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
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

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
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
  description: '读取当前仓库中一个文本文件。大文件支持 offset/limit 分页；返回里会给出总长度与下一段 offset，内容未结束时应继续读取，不要基于截断内容下结论。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径，例如 src/App.tsx' },
      offset: { type: 'number', description: '起始字符位置，默认 0' },
      limit: { type: 'number', description: '本次读取字符数，1000-11500，默认 11000' },
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
    const total = text.length;
    const offset = clampNumber(args.offset, 0, total, 0);
    const limit = clampNumber(args.limit, 1000, 11500, 11000);
    const segment = text.slice(offset, offset + limit);
    const nextOffset = offset + segment.length;
    const lineCount = text.split('\n').length;
    return {
      ok: true,
      content: [
        `文件：${path}`,
        `分支：${branch}`,
        `SHA：${data.sha || ''}`,
        `大小：${data.size || 0} bytes`,
        `全文：${total} 字符 / ${lineCount} 行`,
        `本次范围：${offset}-${nextOffset}`,
        '',
        segment,
        ...(nextOffset < total
          ? ['', `[内容未结束] 继续读取：{"tool":"github_read_file","path":"${path}","offset":${nextOffset},"limit":${limit}}`]
          : ['', '[内容结束]']),
      ].join('\n'),
    };
  },
};

async function searchBranchCode(
  ctx: ToolRuntimeContext,
  owner: string,
  name: string,
  branch: string,
  query: string,
): Promise<ToolRunResult> {
  const tree = await githubFetch(
    ctx,
    `/repos/${owner}/${name}/git/trees/${encodePath(branch)}?recursive=1`,
  ) as {
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string; sha?: string; size?: number }>;
  };
  const files = (tree.tree || [])
    .filter(item => item.type === 'blob' && item.path && item.sha && isTextFilePath(item.path))
    .filter(item => !/(^|\/)(node_modules|dist|build|vendor|\.git)\//.test(String(item.path)))
    .filter(item => Number(item.size || 0) <= 100_000)
    .slice(0, 160);

  const needle = query.toLowerCase();
  const matches: string[] = [];
  let scannedChars = 0;

  for (const file of files) {
    if (matches.length >= 10 || scannedChars > 1_500_000) break;
    try {
      const blob = await githubFetch(
        ctx,
        `/repos/${owner}/${name}/git/blobs/${file.sha}`,
      ) as { content?: string; encoding?: string };
      if (!blob.content || blob.encoding !== 'base64') continue;
      const text = decodeBase64Utf8(blob.content);
      scannedChars += text.length;
      const lines = text.split('\n');
      const hitLines = lines
        .map((line, index) => line.toLowerCase().includes(needle) ? { line, index: index + 1 } : null)
        .filter((item): item is { line: string; index: number } => Boolean(item))
        .slice(0, 3);
      if (hitLines.length) {
        matches.push([
          `### ${file.path}`,
          ...hitLines.map(hit => `- 第 ${hit.index} 行：\`${hit.line.trim().slice(0, 300)}\``),
        ].join('\n'));
      }
    } catch {
      // skip unreadable blobs
    }
  }

  return {
    ok: true,
    content: matches.length
      ? [
          `分支搜索：${branch}`,
          `扫描文件：${files.length}${tree.truncated ? '（仓库树已截断）' : ''}`,
          `命中文件：${matches.length}`,
          '',
          ...matches,
        ].join('\n')
      : `分支 ${branch} 中未找到 “${query}”。扫描文件：${files.length}${tree.truncated ? '（仓库树已截断）' : ''}`,
  };
}

const searchCode: AgentTool = {
  name: 'github_search_code',
  description: '在当前仓库中搜索代码或文本。非默认分支会扫描该分支的文本文件；默认分支使用 GitHub 搜索索引。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词或代码片段' },
    },
    required: ['query'],
  },
  risk: 'read',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name, branch } = repoParts(ctx.repo);
    const query = String(args.query || '').trim();
    if (!query) throw new Error('query 不能为空');
    if (branch !== (ctx.repo?.defaultBranch || 'main')) {
      return searchBranchCode(ctx, owner, name, branch, query);
    }
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

const writeFile: AgentTool = {
  name: 'github_write_file',
  description: '创建或更新当前仓库中的一个文本文件。这是写操作，执行前必须经过用户确认。更新已有文件时会自动读取最新 SHA。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径，例如 src/App.tsx' },
      content: { type: 'string', description: '完整的新文件内容' },
      message: { type: 'string', description: '提交信息' },
      branch: { type: 'string', description: '目标分支；默认当前分支' },
      sha: { type: 'string', description: '可选：已知的文件 blob SHA' },
    },
    required: ['path', 'content', 'message'],
  },
  risk: 'write',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name, branch: defaultBranch } = repoParts(ctx.repo);
    const path = String(args.path || '').replace(/^\/+/, '');
    const content = String(args.content ?? '');
    const message = String(args.message || '').trim() || `Update ${path}`;
    const branch = String(args.branch || defaultBranch);
    if (!path) throw new Error('path 不能为空');

    let sha = String(args.sha || '').trim();
    if (!sha) {
      try {
        const existing = await githubFetch(
          ctx,
          `/repos/${owner}/${name}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
        ) as { sha?: string; type?: string };
        if (existing?.type === 'file' && existing.sha) sha = existing.sha;
      } catch {
        // 文件不存在或不可读，按新建处理；GitHub 会返回最终错误
      }
    }

    const data = await githubFetch(
      ctx,
      `/repos/${owner}/${name}/contents/${encodePath(path)}`,
      'application/vnd.github+json',
      {
        method: 'PUT',
        body: JSON.stringify({
          message,
          content: base64EncodeUtf8(content),
          branch,
          ...(sha ? { sha } : {}),
        }),
      },
    ) as { content?: { html_url?: string; sha?: string }; commit?: { sha?: string; html_url?: string } };

    return {
      ok: true,
      content: [
        `已写入：${path}`,
        `分支：${branch}`,
        `提交：${data.commit?.sha || '-'}`,
        `链接：${data.commit?.html_url || data.content?.html_url || '-'}`,
        `文件 SHA：${data.content?.sha || '-'}`,
      ].join('\n'),
    };
  },
};

const writeFiles: AgentTool = {
  name: 'github_write_files',
  description: '在一次提交中创建或更新多个文件。适合批量修改；目标分支不存在时会从 base_branch 自动创建。这是写操作，执行前必须确认。',
  parameters: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        description: '文件列表，最多 20 个',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            content: { type: 'string', description: '完整文件内容' },
          },
          required: ['path', 'content'],
        },
      },
      message: { type: 'string', description: '提交信息' },
      branch: { type: 'string', description: '目标分支；默认当前分支' },
      base_branch: { type: 'string', description: '目标分支不存在时从该分支创建' },
    },
    required: ['files', 'message'],
  },
  risk: 'write',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name, branch: defaultBranch } = repoParts(ctx.repo);
    const targetBranch = normalizeBranch(String(args.branch || defaultBranch));
    const baseBranch = normalizeBranch(String(args.base_branch || defaultBranch));
    const message = String(args.message || '').trim() || `Update files on ${targetBranch}`;
    const rawFiles = Array.isArray(args.files) ? args.files : [];
    if (rawFiles.length > 20) throw new Error('一次最多提交 20 个文件');
    const seen = new Set<string>();
    const files = rawFiles.slice(0, 20).map(item => {
      const file = item as { path?: unknown; content?: unknown };
      const path = String(file.path || '').replace(/^\/+/, '').trim();
      const content = String(file.content ?? '');
      if (!path) throw new Error('文件路径不能为空');
      if (path.split('/').includes('..')) throw new Error(`文件路径不合法：${path}`);
      if (seen.has(path)) throw new Error(`重复文件路径：${path}`);
      if (content.length > 200_000) throw new Error(`文件过大（${content.length} 字符）：${path}`);
      seen.add(path);
      return { path, content };
    });
    if (!files.length) throw new Error('files 不能为空');

    let headSha = '';
    try {
      const ref = await githubFetch(ctx, `/repos/${owner}/${name}/git/ref/heads/${encodePath(targetBranch)}`) as {
        object?: { sha?: string };
      };
      headSha = String(ref.object?.sha || '');
    } catch (error) {
      if (!String((error as Error).message || error).includes('HTTP 404')) throw error;
      const baseRef = await githubFetch(ctx, `/repos/${owner}/${name}/git/ref/heads/${encodePath(baseBranch)}`) as {
        object?: { sha?: string };
      };
      const baseSha = String(baseRef.object?.sha || '');
      if (!baseSha) throw new Error(`无法读取基础分支：${baseBranch}`);
      const created = await githubFetch(ctx, `/repos/${owner}/${name}/git/refs`, 'application/vnd.github+json', {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${targetBranch}`, sha: baseSha }),
      }) as { object?: { sha?: string } };
      headSha = String(created.object?.sha || baseSha);
    }
    if (!headSha) throw new Error(`无法读取分支：${targetBranch}`);

    const headCommit = await githubFetch(ctx, `/repos/${owner}/${name}/git/commits/${headSha}`) as {
      tree?: { sha?: string };
    };
    const baseTree = String(headCommit.tree?.sha || '');
    if (!baseTree) throw new Error('无法读取分支的最新 tree');

    const blobs: Array<{ path: string; sha: string }> = [];
    for (const file of files) {
      const blob = await githubFetch(ctx, `/repos/${owner}/${name}/git/blobs`, 'application/vnd.github+json', {
        method: 'POST',
        body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
      }) as { sha?: string };
      if (!blob.sha) throw new Error(`创建 blob 失败：${file.path}`);
      blobs.push({ path: file.path, sha: blob.sha });
    }

    const tree = await githubFetch(ctx, `/repos/${owner}/${name}/git/trees`, 'application/vnd.github+json', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTree,
        tree: blobs.map(file => ({ path: file.path, mode: '100644', type: 'blob', sha: file.sha })),
      }),
    }) as { sha?: string };
    if (!tree.sha) throw new Error('创建 tree 失败');

    const commit = await githubFetch(ctx, `/repos/${owner}/${name}/git/commits`, 'application/vnd.github+json', {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
    }) as { sha?: string; html_url?: string };
    if (!commit.sha) throw new Error('创建 commit 失败');

    await githubFetch(ctx, `/repos/${owner}/${name}/git/refs/heads/${encodePath(targetBranch)}`, 'application/vnd.github+json', {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    return {
      ok: true,
      content: [
        `已提交 ${files.length} 个文件`,
        `分支：${targetBranch}`,
        `提交：${commit.sha}`,
        `链接：${commit.html_url || '-'}`,
        '',
        ...files.map(file => `- ${file.path}`),
      ].join('\n'),
    };
  },
};

const createBranch: AgentTool = {
  name: 'github_create_branch',
  description: '从指定基础分支创建新分支。这是写操作，执行前必须确认。',
  parameters: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: '新分支名，例如 feat/ai-change' },
      base_branch: { type: 'string', description: '基础分支；默认当前分支' },
    },
    required: ['branch'],
  },
  risk: 'write',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name, branch: defaultBranch } = repoParts(ctx.repo);
    const branch = normalizeBranch(String(args.branch || ''));
    const base = normalizeBranch(String(args.base_branch || defaultBranch));
    const baseRef = await githubFetch(ctx, `/repos/${owner}/${name}/git/ref/heads/${encodePath(base)}`) as {
      object?: { sha?: string };
    };
    const sha = String(baseRef.object?.sha || '');
    if (!sha) throw new Error(`无法读取基础分支：${base}`);
    await githubFetch(ctx, `/repos/${owner}/${name}/git/refs`, 'application/vnd.github+json', {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
    return { ok: true, content: `已从 ${base} 创建分支：${branch}\n起点提交：${sha}` };
  },
};

const createPullRequest: AgentTool = {
  name: 'github_create_pull_request',
  description: '创建 Pull Request。这是写操作，执行前必须确认。',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'PR 标题' },
      head: { type: 'string', description: '来源分支' },
      base: { type: 'string', description: '目标分支；默认当前分支' },
      body: { type: 'string', description: 'PR 描述' },
      draft: { type: 'boolean', description: '是否创建草稿 PR' },
    },
    required: ['title', 'head'],
  },
  risk: 'write',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name, branch: defaultBranch } = repoParts(ctx.repo);
    const title = String(args.title || '').trim();
    const head = normalizeBranch(String(args.head || ''));
    const base = normalizeBranch(String(args.base || defaultBranch));
    if (!title) throw new Error('title 不能为空');
    const pr = await githubFetch(ctx, `/repos/${owner}/${name}/pulls`, 'application/vnd.github+json', {
      method: 'POST',
      body: JSON.stringify({
        title,
        head,
        base,
        body: String(args.body || ''),
        draft: Boolean(args.draft),
      }),
    }) as { number?: number; html_url?: string };
    return {
      ok: true,
      content: [`已创建 PR #${pr.number || '-'}`, `分支：${head} → ${base}`, `链接：${pr.html_url || '-'}`].join('\n'),
    };
  },
};

const mergePullRequest: AgentTool = {
  name: 'github_merge_pull_request',
  description: '合并 Pull Request。这是写操作，执行前必须确认。',
  parameters: {
    type: 'object',
    properties: {
      number: { type: 'number', description: 'Pull Request 编号' },
      merge_method: { type: 'string', description: 'merge / squash / rebase，默认 squash' },
      commit_title: { type: 'string', description: '可选：合并提交标题' },
      commit_message: { type: 'string', description: '可选：合并提交说明' },
    },
    required: ['number'],
  },
  risk: 'write',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name } = repoParts(ctx.repo);
    const number = Number(args.number);
    if (!Number.isFinite(number)) throw new Error('number 必须是数字');
    const method = ['merge', 'squash', 'rebase'].includes(String(args.merge_method))
      ? String(args.merge_method)
      : 'squash';
    const data = await githubFetch(ctx, `/repos/${owner}/${name}/pulls/${number}/merge`, 'application/vnd.github+json', {
      method: 'PUT',
      body: JSON.stringify({
        merge_method: method,
        ...(args.commit_title ? { commit_title: String(args.commit_title) } : {}),
        ...(args.commit_message ? { commit_message: String(args.commit_message) } : {}),
      }),
    }) as { merged?: boolean; sha?: string; message?: string };
    return {
      ok: Boolean(data.merged),
      content: data.merged
        ? `已合并 PR #${number}\n方式：${method}\n提交：${data.sha || '-'}`
        : `未合并 PR #${number}：${data.message || '未知原因'}`,
    };
  },
};

function normalizeBranch(branch: string): string {
  const value = branch.trim().replace(/^refs\/heads\//, '');
  if (!value || value.startsWith('/') || value.includes('..') || /\s/.test(value)) {
    throw new Error(`分支名不合法：${branch}`);
  }
  return value;
}

function base64EncodeUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const GITHUB_READ_TOOLS: AgentTool[] = [repoInfo, listFiles, readFile, searchCode];
export const GITHUB_WRITE_TOOLS: AgentTool[] = [
  writeFile,
  writeFiles,
  createBranch,
  createPullRequest,
  mergePullRequest,
];

/** 只有选择了仓库才暴露 GitHub 工具 */
export function getToolsForContext(repo?: RepoContext): AgentTool[] {
  return repo ? [...GITHUB_READ_TOOLS, ...GITHUB_WRITE_TOOLS] : [];
}