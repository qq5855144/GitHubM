import { zipSync } from 'fflate';
import { getBranch, getGitBlob, getGitTree } from '@/services/github';

const ACCEL_KEY = 'github_download_wget_la';
const ACCEL_URL_KEY = 'github_download_accel_url';
export const DEFAULT_ACCEL_URL = 'https://wget.la/';

export function isWgetLaEnabled(): boolean {
  try {
    return localStorage.getItem(ACCEL_KEY) === '1';
  } catch {
    return false;
  }
}

export function setWgetLaEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ACCEL_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
}

/** https://wget.la/https://github.com/... —— 只对公开 GitHub 资源有效 */
export function getAccelBaseUrl(): string {
  try {
    return localStorage.getItem(ACCEL_URL_KEY) || DEFAULT_ACCEL_URL;
  } catch {
    return DEFAULT_ACCEL_URL;
  }
}

export function setAccelBaseUrl(value: string): void {
  try {
    const clean = value.trim();
    if (!clean) localStorage.removeItem(ACCEL_URL_KEY);
    else localStorage.setItem(ACCEL_URL_KEY, clean);
  } catch { /* ignore */ }
}

/** 支持前缀或模板：https://proxy/、https://proxy/?url={url}、...?url={url_encoded} */
export function toWgetLaUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  const template = getAccelBaseUrl();
  if (template.includes('{url_encoded}')) return template.replace('{url_encoded}', encodeURIComponent(url));
  if (template.includes('{url}')) return template.replace('{url}', url);
  return `${template.replace(/\/+$/, '')}/${url}`;
}

function isGitHubDownloadUrl(url: string): boolean {
  return /^https:\/\/(github\.com|raw\.githubusercontent\.com|objects\.githubusercontent\.com)\//i.test(url);
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

/**
 * 带认证下载文件。
 * - AndroidBridge：交给原生 DownloadManager
 * - 浏览器：fetch + Bearer token → Blob → a[download]
 * - wget.la：仅用于公开 GitHub 资源，不向代理发送 token
 */
export async function downloadGithubFile(
  url: string,
  filename: string,
  token: string,
  options: { accelerate?: boolean } = {},
): Promise<void> {
  const accelerate = !!options.accelerate && isGitHubDownloadUrl(url);
  const finalUrl = accelerate ? toWgetLaUrl(url) : url;
  const bridge = (window as unknown as {
    AndroidBridge?: { downloadFile?: (u: string, f: string, t: string) => void }
  }).AndroidBridge;
  if (bridge?.downloadFile) {
    bridge.downloadFile(finalUrl, filename, accelerate ? '' : token);
    return;
  }
  const headers: Record<string, string> = {};
  if (token && !accelerate) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(finalUrl, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  triggerBlobDownload(await res.blob(), filename);
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * 下载仓库某个目录为 ZIP。
 * 通过 Git Tree API 递归列出 blob，再并发拉取 raw 内容，最后用 fflate 打包。
 */
export async function downloadRepoDirectoryZip(params: {
  owner: string;
  repo: string;
  branch: string;
  directory: string;
  token: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  const { owner, repo, branch, directory, token, onProgress } = params;
  const branchInfo = await getBranch(owner, repo, branch);
  const commitSha = branchInfo.commit.sha;
  const tree = await getGitTree(owner, repo, commitSha, true);
  if (tree.truncated) {
    throw new Error('目录过大，GitHub 返回了截断的文件树，请缩小下载范围');
  }
  const prefix = directory.replace(/^\/+|\/+$/g, '');
  const basePrefix = prefix ? `${prefix}/` : '';
  const blobs = tree.tree.filter(item => item.type === 'blob' && (!basePrefix || item.path.startsWith(basePrefix)));
  if (blobs.length === 0) throw new Error('目录为空或不存在');
  if (blobs.length > 300) throw new Error(`目录包含 ${blobs.length} 个文件，超过单次下载上限（300）`);

  const entries: Record<string, Uint8Array> = {};
  let done = 0;
  const concurrency = 6;
  let cursor = 0;
  const rootName = prefix.split('/').filter(Boolean).pop() || repo;

  async function worker() {
    while (cursor < blobs.length) {
      const blob = blobs[cursor++];
      // 走 Git Blob API，避免 raw.githubusercontent.com 对 Authorization 的 CORS 预检失败
      const data = await getGitBlob(owner, repo, blob.sha);
      const relative = basePrefix ? blob.path.slice(basePrefix.length) : blob.path;
      entries[`${rootName}/${relative}`] = base64ToBytes(data.content);
      done++;
      onProgress?.(done, blobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, blobs.length) }, () => worker()));

  const zipped = zipSync(entries, { level: 6 });
  triggerBlobDownload(new Blob([zipped], { type: 'application/zip' }), `${rootName}.zip`);
}