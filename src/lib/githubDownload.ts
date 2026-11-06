import { zipSync } from 'fflate';
import { getBranch, getGitBlob, getGitTree } from '@/services/github';

const DOWNLOAD_PROXY_ENABLED_KEY = 'github_download_wget_la';
const DOWNLOAD_PROXY_URL_KEY = 'github_download_accel_url';
const DOWNLOAD_PROXY_AUTO_KEY = 'github_download_proxy_auto';
const DOWNLOAD_PROXY_CACHE_KEY = 'github_download_proxy_fastest_v1';
const DOWNLOAD_PROXY_TEST_URL = 'https://raw.githubusercontent.com/octocat/Hello-World/master/README';
const DOWNLOAD_PROXY_CACHE_TTL = 10 * 60 * 1000;
const DEFAULT_PROXY_TEST_TIMEOUT = 6000;

export const DEFAULT_DOWNLOAD_PROXY_URL = 'https://wget.la/';

/** 自动测速的内置候选；自定义地址也会加入候选列表。 */
export const DOWNLOAD_PROXY_PRESETS = [
  { name: 'wget.la', baseUrl: 'https://wget.la/' },
  { name: 'gh-proxy.com', baseUrl: 'https://gh-proxy.com/' },
  { name: 'ghproxy.net', baseUrl: 'https://ghproxy.net/' },
] as const;

export interface DownloadProxyTestResult {
  name: string;
  baseUrl: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface FastestDownloadProxy {
  name: string;
  baseUrl: string;
  latencyMs: number;
  testedAt: number;
  candidatesKey: string;
}

export function isDownloadProxyEnabled(): boolean {
  try {
    return localStorage.getItem(DOWNLOAD_PROXY_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDownloadProxyEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DOWNLOAD_PROXY_ENABLED_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
}

/** 默认开启自动测速；显式存过 0 才使用固定代理。 */
export function isAutoDownloadProxyEnabled(): boolean {
  try {
    return localStorage.getItem(DOWNLOAD_PROXY_AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAutoDownloadProxyEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DOWNLOAD_PROXY_AUTO_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
}

/** 全局下载代理：支持前缀或模板，仅对公开 GitHub 资源有效 */
export function getDownloadProxyUrl(): string {
  try {
    return localStorage.getItem(DOWNLOAD_PROXY_URL_KEY) || DEFAULT_DOWNLOAD_PROXY_URL;
  } catch {
    return DEFAULT_DOWNLOAD_PROXY_URL;
  }
}

export function setDownloadProxyUrl(value: string): void {
  try {
    const clean = value.trim();
    if (!clean) localStorage.removeItem(DOWNLOAD_PROXY_URL_KEY);
    else localStorage.setItem(DOWNLOAD_PROXY_URL_KEY, clean);
  } catch { /* ignore */ }
}

function normalizeProxyBase(value: string): string {
  const clean = value.trim();
  if (!clean) return '';
  if (clean.includes('{url}') || clean.includes('{url_encoded}') || clean.includes('?')) return clean;
  return `${clean.replace(/\/+$/, '')}/`;
}

/** 用指定代理前缀/模板包装 URL */
export function toProxyUrl(baseUrl: string, url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  const template = normalizeProxyBase(baseUrl);
  if (!template) return url;
  if (template.includes('{url_encoded}')) return template.replace('{url_encoded}', encodeURIComponent(url));
  if (template.includes('{url}')) return template.replace('{url}', url);
  return `${template.replace(/\/+$/, '')}/${url}`;
}

/** 支持前缀或模板：https://proxy/、https://proxy/?url={url}、...?url={url_encoded} */
export function toDownloadProxyUrl(url: string): string {
  return toProxyUrl(getDownloadProxyUrl(), url);
}

/** 候选列表：内置预设 + 用户自定义代理 */
export function getDownloadProxyCandidates(): Array<{ name: string; baseUrl: string }> {
  const candidates = new Map<string, string>();
  for (const preset of DOWNLOAD_PROXY_PRESETS) {
    candidates.set(normalizeProxyBase(preset.baseUrl), preset.name);
  }
  const custom = normalizeProxyBase(getDownloadProxyUrl());
  if (custom && !candidates.has(custom)) candidates.set(custom, '自定义代理');
  return Array.from(candidates, ([baseUrl, name]) => ({ name, baseUrl }));
}

function candidatesKey(candidates: Array<{ baseUrl: string }>): string {
  return candidates.map((item) => item.baseUrl).join('|');
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

export function getCachedFastestDownloadProxy(): FastestDownloadProxy | null {
  try {
    const raw = localStorage.getItem(DOWNLOAD_PROXY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FastestDownloadProxy;
    if (!parsed?.baseUrl || !parsed?.testedAt || !parsed?.candidatesKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

let proxyTestInFlight: Promise<{ results: DownloadProxyTestResult[]; selected: FastestDownloadProxy }> | null = null;

/** 并发测试全部候选，延迟最低且响应有效的代理胜出。 */
export function testFastestDownloadProxy(options: { timeoutMs?: number } = {}): Promise<{
  results: DownloadProxyTestResult[];
  selected: FastestDownloadProxy;
}> {
  if (proxyTestInFlight) return proxyTestInFlight;

  const timeoutMs = options.timeoutMs ?? DEFAULT_PROXY_TEST_TIMEOUT;
  const candidates = getDownloadProxyCandidates();
  proxyTestInFlight = (async () => {
    const results = await Promise.all(candidates.map(async (candidate): Promise<DownloadProxyTestResult> => {
      const started = nowMs();
      try {
        const res = await fetchWithTimeout(toProxyUrl(candidate.baseUrl, DOWNLOAD_PROXY_TEST_URL), timeoutMs);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text.trim()) throw new Error('空响应');
        return {
          ...candidate,
          ok: true,
          latencyMs: Math.max(1, Math.round(nowMs() - started)),
        };
      } catch (err) {
        return {
          ...candidate,
          ok: false,
          latencyMs: Math.max(1, Math.round(nowMs() - started)),
          error: err instanceof Error ? err.message : '测试失败',
        };
      }
    }));

    const successful = results
      .filter((result) => result.ok)
      .sort((a, b) => a.latencyMs - b.latencyMs);
    const best = successful[0];
    const fallbackBase = normalizeProxyBase(getDownloadProxyUrl()) || DEFAULT_DOWNLOAD_PROXY_URL;
    const selected: FastestDownloadProxy = best
      ? {
          name: best.name,
          baseUrl: best.baseUrl,
          latencyMs: best.latencyMs,
          testedAt: Date.now(),
          candidatesKey: candidatesKey(candidates),
        }
      : {
          name: '直连回退',
          baseUrl: fallbackBase,
          latencyMs: -1,
          testedAt: Date.now(),
          candidatesKey: candidatesKey(candidates),
        };

    try {
      localStorage.setItem(DOWNLOAD_PROXY_CACHE_KEY, JSON.stringify(selected));
    } catch { /* ignore */ }

    return { results, selected };
  })().finally(() => {
    proxyTestInFlight = null;
  });

  return proxyTestInFlight;
}

/** 自动模式：优先使用10分钟内的测速缓存，到期后重新测速。 */
export async function resolveDownloadProxyUrl(
  sourceUrl: string,
  options: { force?: boolean; timeoutMs?: number } = {}
): Promise<string> {
  if (!isDownloadProxyEnabled() || !isGitHubDownloadUrl(sourceUrl)) return sourceUrl;
  if (!isAutoDownloadProxyEnabled()) return toDownloadProxyUrl(sourceUrl);

  const candidates = getDownloadProxyCandidates();
  const key = candidatesKey(candidates);
  if (!options.force) {
    const cached = getCachedFastestDownloadProxy();
    if (cached && cached.candidatesKey === key && Date.now() - cached.testedAt < DOWNLOAD_PROXY_CACHE_TTL) {
      return cached.latencyMs < 0 ? sourceUrl : toProxyUrl(cached.baseUrl, sourceUrl);
    }
  }

  const { selected } = await testFastestDownloadProxy({ timeoutMs: options.timeoutMs });
  return selected.latencyMs < 0 ? sourceUrl : toProxyUrl(selected.baseUrl, sourceUrl);
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
 * - 全局下载代理：自动模式会先测速，且不向代理发送 token
 */
export async function downloadGithubFile(
  url: string,
  filename: string,
  token: string,
): Promise<void> {
  const finalUrl = isDownloadProxyEnabled() && isGitHubDownloadUrl(url)
    ? await resolveDownloadProxyUrl(url)
    : url;
  const accelerate = finalUrl !== url;
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