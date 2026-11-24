// AI Assistant V2 — 写入能力补充：局部替换与分片追加
// 背景：模型单次输出受 max_tokens 限制（一次大约只能输出 1 万字符），
// 整篇重写大文件会超限、被截断或被迫改用「生成补丁文件」的绕路。
// 这两个工具把单次写入量降到最小，使任意大小的文件都能稳定修改。
import type { AgentTool, RepoContext, ToolRunResult, ToolRuntimeContext } from '../types';
import { fetchWithResilience } from '@/services/github/http';

const API = 'https://api.github.com';
/** 单文件上限，与 github_write_files 保持一致 */
const MAX_FILE_CHARS = 200_000;

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

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function githubFetch(
  ctx: ToolRuntimeContext,
  path: string,
  init: Pick<RequestInit, 'method' | 'body'> = {},
): Promise<unknown> {
  const res = await fetchWithResilience(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: ctx.signal,
  }, init.method ?? 'GET');
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function isNotFound(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (status === 404) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 404|\b404\b|Not Found/i.test(message);
}

interface RemoteFile {
  content: string;
  sha: string;
}

async function readRemoteFile(
  ctx: ToolRuntimeContext,
  owner: string,
  name: string,
  path: string,
  branch: string,
): Promise<RemoteFile | null> {
  let data: { type?: string; encoding?: string; content?: string; sha?: string } | null = null;
  try {
    data = await githubFetch(
      ctx,
      `/repos/${owner}/${name}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
    ) as { type?: string; encoding?: string; content?: string; sha?: string } | null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  if (data?.type === 'dir') throw new Error(`该路径是目录，不能写入文件：${path}`);
  if (typeof data?.content !== 'string' || data.encoding !== 'base64' || !data.sha) {
    throw new Error(`无法读取 ${branch}/${path} 的文本内容（可能是二进制文件或超过 1 MB），请先用 github_read_file 确认`);
  }
  return { content: decodeBase64Utf8(data.content), sha: String(data.sha || '') };
}

async function commitContent(
  ctx: ToolRuntimeContext,
  params: {
    owner: string;
    name: string;
    path: string;
    branch: string;
    message: string;
    content: string;
    sha?: string;
  },
): Promise<{ sha?: string; html_url?: string }> {
  const data = await githubFetch(
    ctx,
    `/repos/${params.owner}/${params.name}/contents/${encodePath(params.path)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: params.message,
        content: base64EncodeUtf8(params.content),
        branch: params.branch,
        ...(params.sha ? { sha: params.sha } : {}),
      }),
    },
  ) as { commit?: { sha?: string; html_url?: string }; content?: { html_url?: string } } | null;
  return {
    sha: data?.commit?.sha || '',
    html_url: data?.commit?.html_url || data?.content?.html_url || '',
  };
}

interface FileEdit {
  old_string?: unknown;
  new_string?: unknown;
  replace_all?: unknown;
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

export function applyEdits(text: string, edits: FileEdit[]): string {
  let next = text;
  edits.forEach((edit, index) => {
    const label = `第 ${index + 1} 条替换`;
    const oldString = String(edit.old_string ?? '');
    const newString = String(edit.new_string ?? '');
    const replaceAll = Boolean(edit.replace_all);
    if (!oldString) throw new Error(`${label}：old_string 不能为空`);
    const occurrences = countOccurrences(next, oldString);
    if (occurrences === 0) {
      throw new Error(`${label}：未匹配到 old_string，请先用 github_read_file 确认原文（缩进与换行必须完全一致）`);
    }
    if (occurrences > 1 && !replaceAll) {
      throw new Error(`${label}：old_string 匹配到 ${occurrences} 处，请补充上下文，或传 replace_all: true`);
    }
    next = replaceAll ? next.split(oldString).join(newString) : next.replace(oldString, () => newString);
  });
  return next;
}

const editFile: AgentTool = {
  name: 'github_edit_file',
  description: '对已有文件做局部替换（old_string → new_string），一次可提交多条，无需输出整篇内容。修改大文件时优先使用本工具。这是写操作，执行前必须经过用户确认。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径，例如 src/pages/SearchPage.tsx' },
      edits: {
        type: 'array',
        description: '替换列表，按顺序应用；每条的 old_string 必须与文件现有内容完全一致（含缩进与换行）',
        items: {
          type: 'object',
          properties: {
            old_string: { type: 'string', description: '被替换的原文片段，尽量带足上下文以保证唯一' },
            new_string: { type: 'string', description: '替换后的内容；传空字符串表示删除该片段' },
            replace_all: { type: 'boolean', description: '为 true 时替换全部匹配；默认要求唯一匹配' },
          },
          required: ['old_string', 'new_string'],
        },
      },
      message: { type: 'string', description: '提交信息' },
      branch: { type: 'string', description: '目标分支；默认当前分支' },
    },
    required: ['path', 'edits', 'message'],
  },
  risk: 'write',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name, branch: defaultBranch } = repoParts(ctx.repo);
    const path = String(args.path || '').replace(/^\/+/, '').trim();
    if (!path) throw new Error('path 不能为空');
    if (path.split('/').includes('..')) throw new Error(`文件路径不合法：${path}`);
    const branch = normalizeBranch(String(args.branch || defaultBranch));
    const message = String(args.message || '').trim() || `Update ${path}`;
    const rawEdits = Array.isArray(args.edits) ? args.edits as FileEdit[] : [];
    if (!rawEdits.length) throw new Error('edits 不能为空；新建或整篇重写请使用 github_write_file');

    const remote = await readRemoteFile(ctx, owner, name, path, branch);
    if (ctx.approvedWrite && (remote?.sha ?? null) !== ctx.approvedWrite.fileSha) {
      throw new Error('远端文件已变化，请重新预览并批准');
    }
    if (!remote) {
      throw new Error(`文件不存在：${branch}/${path}。新建文件请使用 github_write_file，超大文件可用 github_append_file 分片写入`);
    }

    const nextContent = applyEdits(remote.content, rawEdits);
    if (nextContent === remote.content) throw new Error('替换后内容没有变化，请检查 old_string 与 new_string 是否相同');
    if (nextContent.length > MAX_FILE_CHARS) {
      throw new Error(`写入后文件过大（${nextContent.length} 字符，上限 ${MAX_FILE_CHARS}）`);
    }

    const commit = await commitContent(ctx, { owner, name, path, branch, message, content: nextContent, sha: remote.sha });
    const delta = nextContent.length - remote.content.length;
    return {
      ok: true,
      content: [
        `已编辑：${path}`,
        `分支：${branch}`,
        `替换条数：${rawEdits.length}`,
        `字数变化：${delta >= 0 ? '+' : ''}${delta}（${remote.content.length} → ${nextContent.length}）`,
        `行数：${remote.content.split('\n').length} → ${nextContent.split('\n').length}`,
        `提交：${commit.sha || '-'}`,
        `链接：${commit.html_url || '-'}`,
      ].join('\n'),
    };
  },
};

const appendFile: AgentTool = {
  name: 'github_append_file',
  description: '把一段内容追加到文件末尾（文件不存在时创建）。用于分片写入超大文件：每次提交一段，重复调用即可拼出任意长度文件；也可以在文件尾部续写日志/文档。这是写操作，执行前必须经过用户确认。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径，例如 docs/CHANGELOG.md' },
      content: { type: 'string', description: '本次追加的内容片段' },
      message: { type: 'string', description: '提交信息' },
      branch: { type: 'string', description: '目标分支；默认当前分支' },
      separator: { type: 'string', description: '追加前插入的分隔符，默认换行 \\n；传空字符串表示直接拼接' },
    },
    required: ['path', 'content', 'message'],
  },
  risk: 'write',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name, branch: defaultBranch } = repoParts(ctx.repo);
    const path = String(args.path || '').replace(/^\/+/, '').trim();
    if (!path) throw new Error('path 不能为空');
    if (path.split('/').includes('..')) throw new Error(`文件路径不合法：${path}`);
    const branch = normalizeBranch(String(args.branch || defaultBranch));
    const message = String(args.message || '').trim() || `Append ${path}`;
    const piece = String(args.content ?? '');
    if (!piece) throw new Error('content 不能为空');
    const separator = args.separator === undefined ? '\n' : String(args.separator);

    const remote = await readRemoteFile(ctx, owner, name, path, branch);
    if (ctx.approvedWrite && (remote?.sha ?? null) !== ctx.approvedWrite.fileSha) {
      throw new Error('远端文件已变化，请重新预览并批准');
    }
    const base = remote?.content ?? '';
    const needsSeparator = separator.length > 0 && base.length > 0 && !base.endsWith(separator);
    const nextContent = `${base}${needsSeparator ? separator : ''}${piece}`;
    if (nextContent.length > MAX_FILE_CHARS) {
      throw new Error(`写入后文件过大（${nextContent.length} 字符，上限 ${MAX_FILE_CHARS}）`);
    }

    const commit = await commitContent(ctx, {
      owner,
      name,
      path,
      branch,
      message,
      content: nextContent,
      ...(remote?.sha ? { sha: remote.sha } : {}),
    });
    return {
      ok: true,
      content: [
        `已追加：${path}`,
        `分支：${branch}`,
        `本次追加：${piece.length} 字符`,
        `文件现在：${nextContent.length} 字符 / ${nextContent.split('\n').length} 行`,
        `提交：${commit.sha || '-'}`,
        `链接：${commit.html_url || '-'}`,
        '',
        '[继续] 若内容还没写完，可再次调用 github_append_file 追加下一段。',
      ].join('\n'),
    };
  },
};

export const GITHUB_EDIT_TOOLS: AgentTool[] = [editFile, appendFile];
