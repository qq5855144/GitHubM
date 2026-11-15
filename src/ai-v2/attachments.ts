// AI V2 — 会话附件与 @ 仓库文件引用
export interface UiAttachment {
  id: string;
  name: string;
  path?: string;
  source: 'local' | 'repo';
  size: number;
  content: string;
}

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 200_000;
export const MAX_MODEL_ATTACHMENT_CHARS = 80_000;

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function buildModelUserContent(
  text: string,
  attachments: UiAttachment[],
  maxChars = MAX_MODEL_ATTACHMENT_CHARS,
): string {
  if (!attachments.length) return text;
  let remaining = Math.max(0, maxChars);
  const blocks: string[] = [];
  for (let index = 0; index < attachments.length; index++) {
    const attachment = attachments[index];
    const label = attachment.path || attachment.name;
    const header = `\n\n[附件 ${index + 1}] ${label}（${formatFileSize(attachment.size)}${attachment.source === 'repo' ? '，来自当前仓库' : ''}）`;
    if (remaining <= 0) {
      blocks.push(`${header}\n…（附件总长度超出限制，未包含正文）`);
      continue;
    }
    const content = attachment.content.slice(0, remaining);
    blocks.push(`${header}\n~~~\n${content}${content.length < attachment.content.length ? '\n…（附件已截断）' : ''}\n~~~`);
    remaining -= content.length;
  }
  return `${text}${blocks.join('')}`;
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'env',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'css', 'scss', 'sass', 'less', 'html', 'htm',
  'xml', 'svg', 'vue', 'svelte', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'gradle',
  'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'sh', 'bash', 'zsh', 'sql', 'csv', 'log',
]);

export function isTextFilePath(path: string): boolean {
  const name = path.split('/').pop() || path;
  if (/^\.env/.test(name) || name === 'Dockerfile' || name === 'Makefile') return true;
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  return TEXT_EXTENSIONS.has(extension);
}

export function filterRepoFiles(paths: string[], query: string, limit = 80): string[] {
  const keyword = query.trim().toLowerCase();
  const filtered = keyword
    ? paths.filter(path => path.toLowerCase().includes(keyword))
    : paths;
  return filtered.slice(0, Math.max(1, limit));
}

export function makeAttachmentId(prefix = 'att'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}