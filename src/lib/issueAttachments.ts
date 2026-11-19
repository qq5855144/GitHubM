// Issue 附件上传：把图片 / 文件写进仓库，返回可直接插入正文的 Markdown。
// GitHub 没有对 PAT 开放的 issue 附件接口（网页上传走的是带 session 的 assets 端点，PAT 调用返回 404），
// 所以这里用仓库 contents API 落盘，再引用 raw 地址。
import { createFileContent, getRepo } from '@/services/github';
import i18n from '@/i18n';

/**
 * 单文件上限。
 * contents API 会对内容做 base64 编码，请求体约为原文件的 1.34 倍；
 * 实测同一 PAT 上传 1/3/5/6/8MB 均返回 201，10MB 起开始 401 / 连接被重置。
 * 因此这里留出余量取 8MB，而不是原来的 5MB。
 */
export const MAX_FILE_SIZE = 8 * 1024 * 1024;
const ASSET_DIR = 'githubm-assets/issues';

/** 浏览器未给出 file.type 时，用扩展名兜底判断是否图片 */
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif']);
const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  pdf: 'application/pdf',
  zip: 'application/zip',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
};

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function resolveMime(file: File): string {
  if (file.type) return file.type;
  return EXT_MIME[getExtension(file.name)] || 'application/octet-stream';
}

export function isImageAttachment(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return IMAGE_EXT.has(getExtension(file.name));
}

/** 读取文件为纯 base64（不使用 readAsDataURL，避免 text/* 被按字符集改写导致内容损坏） */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(buffer);
      let binary = '';
      // 分块拼接，避免大文件时 apply/spread 造成栈溢出
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      resolve(btoa(binary));
    };
    reader.onerror = () => reject(new Error(i18n.t('读取文件失败')));
    reader.readAsArrayBuffer(file);
  });
}

function sanitizeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const base = dot > 0 ? name.slice(0, dot) : name;
  const safeBase = base.replace(/[^\w.-]+/g, '-').slice(0, 40) || 'file';
  const safeExt = ext.replace(/[^\w.]+/g, '').slice(0, 10);
  return `${safeBase}${safeExt}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 上传前的本地校验，返回错误文案；通过校验返回 null。
 * 这里把可能失败的原因尽量前置，避免用户等上传完才看到错误。
 */
export function validateAttachment(file: File): string | null {
  if (!file.name || file.name.trim().length === 0) return i18n.t('文件名无效，请重命名后再上传');
  if (file.size === 0) return i18n.t('文件内容为空，无法上传');
  if (file.size > MAX_FILE_SIZE) {
    return i18n.t('文件超过 {{size}}，请压缩后再上传', { size: formatFileSize(MAX_FILE_SIZE) });
  }
  return null;
}

export interface UploadAttachmentParams {
  owner: string;
  repo: string;
  file: File;
  /** 默认用仓库默认分支 */
  branch?: string;
}

/** 上传单个附件，返回 Markdown 片段（图片为 ![]()，其余为 []()） */
export async function uploadIssueAttachment({ owner, repo, file, branch }: UploadAttachmentParams): Promise<string> {
  if (!owner || !repo) throw new Error(i18n.t('缺少仓库信息'));
  const invalid = validateAttachment(file);
  if (invalid) throw new Error(invalid);

  let targetBranch = branch;
  if (!targetBranch) {
    const repoData = await getRepo(owner, repo);
    targetBranch = repoData?.default_branch || 'main';
  }

  const suffix = Math.random().toString(36).slice(2, 7);
  const path = `${ASSET_DIR}/${timestamp()}-${suffix}-${sanitizeName(file.name)}`;
  const content = await fileToBase64(file);
  await createFileContent(owner, repo, path, {
    message: `chore(assets): 上传 Issue 附件 ${file.name}`,
    content,
    branch: targetBranch,
  });

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(targetBranch)}/${encodePath(path)}`;
  const label = file.name.replace(/\]/g, '\\]');
  return isImageAttachment(file) ? `![${label}](${rawUrl})` : `[${label}](${rawUrl})`;
}

/** 供 UI 展示的提示文案 */
export const ATTACHMENT_HINT = `附件会上传到仓库 ${ASSET_DIR}/ 并插入 Markdown`;
