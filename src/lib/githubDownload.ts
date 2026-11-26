import { openDownloadSink, triggerBlobDownload } from '@/lib/blobDownload';
import { checkDownloadSignal, openDirectoryArchive } from '@/lib/directoryArchiveClient';
import type { ArchiveCommand } from '@/lib/directoryArchive';
import { getBranch, getGitBlobRaw, getGitTree, getToken, type GitTreeItem } from '@/services/github';

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
  // Operit 代理池
  { name: 'gh-proxy.com', baseUrl: 'https://gh-proxy.com/' },
  { name: 'gh-proxy.net', baseUrl: 'https://gh-proxy.net/' },
  { name: 'ghfast.top', baseUrl: 'https://ghfast.top/' },
  { name: 'ghproxy.1888866.xyz', baseUrl: 'https://ghproxy.1888866.xyz/' },
  { name: 'ghproxy.cfd', baseUrl: 'https://ghproxy.cfd/' },
  { name: 'ghproxy.com', baseUrl: 'https://ghproxy.com/' },
  { name: 'ghproxy.cxkpro.top', baseUrl: 'https://ghproxy.cxkpro.top/' },
  { name: 'ghproxy.monkeyray.net', baseUrl: 'https://ghproxy.monkeyray.net/' },
  { name: 'ghproxy.net', baseUrl: 'https://ghproxy.net/' },
  { name: 'gitproxy.mrhjx.cn', baseUrl: 'https://gitproxy.mrhjx.cn/' },
  { name: 'hub.gitmirror.com', baseUrl: 'https://hub.gitmirror.com/' },
  { name: 'mirror.ghproxy.com', baseUrl: 'https://mirror.ghproxy.com/' },
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
        if (!text.includes('Hello World')) throw new Error('代理返回内容异常');
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
  await triggerBlobDownload(await res.blob(), filename);
}

const ZIP_MAX_BYTES = 0xffffffff;
const ZIP_MAX_ENTRIES = 0xffff;
const ZIP_CHUNK_SIZE = 256 * 1024;
const EMPTY_ZIP_CHUNK = new Uint8Array(0);

async function collectDirectoryFiles(
  owner: string,
  repo: string,
  branch: string,
  directory: string,
  signal: AbortSignal,
): Promise<GitTreeItem[]> {
  const initialToken = getToken();
  function assertAccount() {
    checkDownloadSignal(signal);
    if (initialToken !== getToken()) throw new DOMException('Account changed', 'AbortError');
  }
  assertAccount();
  const { commit } = await getBranch(owner, repo, branch, signal);
  const readTree = (sha: string, recursive = false) => {
    assertAccount();
    return getGitTree(owner, repo, sha, recursive, signal);
  };
  const root = await readTree(commit.sha, true);
  if (!root.truncated) return root.tree
    .filter(item => item.type === 'blob' && item.path.startsWith(`${directory}/`))
    .map(item => ({ ...item, path: item.path.slice(directory.length + 1) }));

  // GitHub limits recursive tree responses. Resolve this directory first and walk its subtrees.
  let sha = commit.sha;
  for (const segment of directory.split('/')) {
    const children = await readTree(sha);
    if (children.truncated) throw new Error('GitHub 返回了截断的目录，无法获取完整文件列表');
    const child = children.tree.find(item => item.path === segment && item.type === 'tree');
    if (!child) return [];
    sha = child.sha;
  }
  const files: GitTreeItem[] = [];
  const stack = [{ path: '', sha }];
  while (stack.length) {
    const next = stack.pop()!;
    const children = await readTree(next.sha);
    if (children.truncated) throw new Error('GitHub 返回了截断的目录，无法获取完整文件列表');
    for (const child of children.tree) {
      const path = `${next.path}${child.path}`;
      if (child.type === 'tree') stack.push({ path: `${path}/`, sha: child.sha });
      else if (child.type === 'blob') files.push({ ...child, path });
    }
  }
  return files;
}

function safeArchivePath(path: string): boolean {
  return !path.includes('\\') && path.split('/').every(part => part && part !== '.' && part !== '..');
}

export async function downloadRepoDirectoryZip(params: {
  owner: string;
  repo: string;
  branch: string;
  directory: string;
  token: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  const { owner, repo, branch, directory, token, onProgress } = params;
  const callerSignal = params.signal;
  if (callerSignal) checkDownloadSignal(callerSignal);
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = () => controller.abort();
  const prefix = directory.replace(/^\/+|\/+$/g, '');
  if (!prefix) {
    const zipballUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`;
    await downloadGithubFile(zipballUrl, `${repo}.zip`, token);
    return;
  }
  const rootName = prefix.split('/').pop() || repo;
  const output = await openDownloadSink(`${rootName}.zip`, 'application/zip');
  if (callerSignal?.aborted) abort();
  callerSignal?.addEventListener('abort', abort, { once: true });
  const prefetched = new Map<number, Promise<Response>>();
  let archive: Awaited<ReturnType<typeof openDirectoryArchive>> | undefined;
  try {
    const files = await collectDirectoryFiles(owner, repo, branch, prefix, signal);
    if (!files.length) throw new Error('目录为空或不存在');
    if (files.length > ZIP_MAX_ENTRIES) throw new Error('该目录超过标准 ZIP 格式的文件数上限，请分目录下载');
    archive = await openDirectoryArchive(signal);
    let archiveSize = 0;
    const write = async (command: ArchiveCommand) => {
      for (const chunk of await archive!.send(command)) {
        checkDownloadSignal(signal);
        archiveSize += chunk.byteLength;
        if (archiveSize > ZIP_MAX_BYTES) throw new Error('压缩包超过标准 ZIP 格式的 4 GiB 上限，请分目录下载');
        if (chunk.byteLength) await output.write(chunk);
      }
    };
    const writeBytes = async (bytes: Uint8Array) => {
      for (let offset = 0; offset < bytes.length; offset += ZIP_CHUNK_SIZE) {
        const part = Uint8Array.from(bytes.subarray(offset, offset + ZIP_CHUNK_SIZE));
        await write({ type: 'data', bytes: part, final: false });
      }
    };
    const fetchBlob = (file: GitTreeItem) => getGitBlobRaw(owner, repo, file.sha, token, signal);
    onProgress?.(0, files.length);
    for (const [index, file] of files.entries()) {
      checkDownloadSignal(signal);
      const filename = `${rootName}/${file.path}`;
      if (!safeArchivePath(filename)) throw new Error(`无法安全打包路径：${file.path}`);
      await write({ type: 'start', filename });
      const request = prefetched.get(index) || fetchBlob(file);
      for (let ahead = index + 1; ahead <= index + 3; ahead++) {
        const upcoming = files[ahead];
        if (!upcoming || upcoming.size === undefined || upcoming.size > 512 * 1024 || prefetched.has(ahead)) continue;
        const loading = fetchBlob(upcoming);
        void loading.catch(() => {});
        prefetched.set(ahead, loading);
      }
      const response = await request;
      prefetched.delete(index);
      const reader = response.body?.getReader();
      if (!reader) {
        await writeBytes(new Uint8Array(await response.arrayBuffer()));
      } else {
        const cancelRead = () => { void reader.cancel().catch(() => {}); };
        signal.addEventListener('abort', cancelRead, { once: true });
        try {
          while (!signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            await writeBytes(value);
          }
        } finally {
          signal.removeEventListener('abort', cancelRead);
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
      await write({ type: 'data', bytes: EMPTY_ZIP_CHUNK.slice(), final: true });
      onProgress?.(index + 1, files.length);
    }
    await write({ type: 'finish' });
    checkDownloadSignal(signal);
    await output.finish();
  } catch (error) {
    abort();
    for (const pending of prefetched.values()) void pending.then(response => response.body?.cancel()).catch(() => {});
    await output.abort().catch(() => {});
    throw error;
  } finally {
    callerSignal?.removeEventListener('abort', abort);
    archive?.close();
  }
}
