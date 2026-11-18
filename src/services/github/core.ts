// GitHub 服务核心：token、缓存、请求、分页与 mutation 失效。
// 资源模块只依赖这里，避免彼此循环引用。
import { createHttpError, fetchWithResilience } from './http';

export const BASE_URL = 'https://api.github.com';

let authToken: string | null = null;

// ── TTL 请求缓存层 ──────────────────────────────────────────────────
// 替代原 addCacheBuster 时间戳反模式：
//   - addCacheBuster 每次 GET 追加 _t=Date.now()，完全禁用 HTTP 缓存，
//     导致相同接口被重复请求，加速 GitHub API Rate Limit（60次/小时 未认证，
//     5000次/小时 已认证）耗尽。
//   - 改为内存 TTL 缓存：GET 响应缓存 30s（用户列表/仓库详情等低频变化数据），
//     同一 URL + token 组合在 TTL 内直接返回缓存，超时后重新请求。
//   - 写操作（POST/PUT/PATCH/DELETE）始终跳过缓存，并自动失效相关前缀缓存。
interface CacheEntry<T> {
  data: T;
  expireAt: number; // ms 时间戳
  etag?: string;
  lastUsed: number;
}
const apiCache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 30_000; // 30s
const MAX_CACHE_ENTRIES = 300;

/**
 * 需要打时间戳绕过 GitHub CDN 强制缓存（60s）的 URL 前缀集合。
 * 写操作后由 invalidateCacheForMutation 填充，下次对应 GET 发出时消费并附加 _t=Date.now()。
 */
const cdnBustPrefixes = new Set<string>();

/** 生成缓存 key（URL + 当前 token，token 变化后旧缓存自动失效） */
export function buildCacheKey(url: string): string {
  return `${authToken ?? ''}|${url}`;
}

/** 读取缓存；过期但带 ETag 的条目保留，用于条件请求 */
export function getCached<T>(key: string): T | null {
  const entry = apiCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expireAt) {
    if (!entry.etag) apiCache.delete(key);
    return null;
  }
  entry.lastUsed = Date.now();
  return entry.data;
}
/** 读取原始缓存条目（用于 If-None-Match 条件请求） */
export function getCacheEntry<T>(key: string): CacheEntry<T> | undefined {
  return apiCache.get(key) as CacheEntry<T> | undefined;
}
/** 命中 304 后延长缓存寿命 */
export function touchCached(key: string, ttl = CACHE_TTL_MS): void {
  const entry = apiCache.get(key);
  if (!entry) return;
  entry.expireAt = Date.now() + ttl;
  entry.lastUsed = Date.now();
}
/** 写入缓存；超过上限时淘汰最久未使用的一条 */
export function setCached<T>(key: string, data: T, etag?: string, ttl = CACHE_TTL_MS): void {
  if (apiCache.has(key)) apiCache.delete(key);
  if (apiCache.size >= MAX_CACHE_ENTRIES) {
    let oldestKey: string | undefined;
    let oldestUsed = Number.POSITIVE_INFINITY;
    for (const [candidate, entry] of apiCache) {
      if (entry.lastUsed < oldestUsed) {
        oldestUsed = entry.lastUsed;
        oldestKey = candidate;
      }
    }
    if (oldestKey !== undefined) apiCache.delete(oldestKey);
  }
  const now = Date.now();
  apiCache.set(key, { data, expireAt: now + ttl, etag, lastUsed: now });
}
/** 按端点设置缓存 TTL，降低高频接口的配额消耗 */
function cacheTtlForUrl(url: string): number {
  const path = url.startsWith(BASE_URL) ? url.slice(BASE_URL.length) : url;
  if (/^\/user(\?|$)/.test(path)) return 5 * 60_000;
  if (path.includes('/contents/')) return 60_000;
  if (path.includes('/actions/')) return 5_000;
  if (path.startsWith('/rate_limit')) return 10_000;
  return CACHE_TTL_MS;
}
/** 主动失效包含指定前缀的所有缓存（写操作后调用） */
export function invalidateCache(urlPrefix: string): void {
  for (const key of apiCache.keys()) {
    if (key.includes(urlPrefix)) apiCache.delete(key);
  }
}

/**
 * 失效内存缓存并同时标记该前缀需要 CDN 绕过。
 * 下次对该前缀的 GET 请求会自动附加时间戳参数，迫使 GitHub CDN 返回最新数据。
 */
export function invalidateAndBust(urlPrefix: string): void {
  invalidateCache(urlPrefix);
  cdnBustPrefixes.add(urlPrefix);
}

/**
 * 检查并消费 CDN 绕过标记：若 url 命中任意已标记前缀，
 * 返回附加了 _t=Date.now() 的新 URL，并移除该前缀标记；否则返回原 URL。
 */
function consumeCacheBust(url: string): string {
  for (const prefix of cdnBustPrefixes) {
    if (url.includes(prefix)) {
      cdnBustPrefixes.delete(prefix);
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}_t=${Date.now()}`;
    }
  }
  return url;
}

/** 清空全部缓存（退出登录时调用） */
export function clearApiCache(): void {
  apiCache.clear();
  cdnBustPrefixes.clear();
}

/**
 * 写操作后的智能级联缓存失效。
 * 除了失效操作 URL 本身，还按 URL 模式推导并失效所有相关列表/父目录缓存。
 * 对于需要绕过 GitHub CDN 强制缓存（60s）的关键场景，同时调用 invalidateAndBust
 * 在下次 GET 时附加时间戳参数，确保拿到最新数据。
 *
 * 覆盖场景：
 *   - 仓库 CRUD → 失效 /user/repos、/users/:owner/repos
 *   - 文件写/删 → 失效 /repos/:owner/:repo/contents（所有层级）
 *   - 分支创建/删除 → 失效 /repos/:owner/:repo/branches + /git/refs
 *   - Issue 写操作 → 失效 /repos/:owner/:repo/issues 列表
 *   - PR 写操作   → 失效 /repos/:owner/:repo/pulls + issues 列表
 *   - 评论写操作  → 失效对应 issue/PR 的评论列表
 *   - 协作者变更  → 失效 /repos/:owner/:repo/collaborators
 *   - Gist 写操作 → 失效 /gists 列表
 *   - Star/Unstar → 失效 /user/starred + checkStarred 缓存
 */
function invalidateCacheForMutation(url: string, method: string): void {
  const path = url.startsWith(BASE_URL) ? url.slice(BASE_URL.length) : url;
  const cleanPath = path.split('?')[0];

  // 1. 始终失效操作 URL 本身
  invalidateAndBust(cleanPath);

  // 2. /repos/:owner/:repo/contents/* — 文件写/删
  const contentsMatch = cleanPath.match(/^(\/repos\/[^/]+\/[^/]+\/contents)/);
  if (contentsMatch) {
    invalidateAndBust(contentsMatch[1]);         // 失效该 repo 所有 contents 缓存
  }

  // 3. /repos/:owner/:repo（仓库本身的 PATCH/DELETE）
  const repoRootMatch = cleanPath.match(/^\/repos\/([^/]+)\/([^/]+)$/);
  if (repoRootMatch && (method === 'DELETE' || method === 'PATCH')) {
    const [, owner] = repoRootMatch;
    invalidateAndBust('/user/repos');            // 当前用户仓库列表
    invalidateAndBust(`/users/${owner}/repos`); // 该用户公开仓库列表
    invalidateAndBust(`/orgs/${owner}/repos`);  // 兼容 org 场景
  }

  // 4. /user/repos（创建新仓库）
  if (cleanPath === '/user/repos' && method === 'POST') {
    invalidateAndBust('/user/repos');
  }

  // 5. /repos/:owner/:repo/git/refs — 分支创建/删除
  const refsMatch = cleanPath.match(/^(\/repos\/[^/]+\/[^/]+)\//);
  if (cleanPath.includes('/git/refs') && refsMatch) {
    invalidateAndBust(`${refsMatch[1]}/branches`);
    invalidateAndBust(`${refsMatch[1]}/git/refs`);
  }

  // 6. /repos/:owner/:repo/issues（含 comments、labels）
  const issueMatch = cleanPath.match(/^(\/repos\/[^/]+\/[^/]+)\/issues/);
  if (issueMatch) {
    invalidateAndBust(`${issueMatch[1]}/issues`);
    invalidateAndBust(`${issueMatch[1]}/pulls`);  // PR 列表也要刷新（共享端点）
  }

  // 7. /repos/:owner/:repo/pulls/:number（含 merge、review、comments）
  const prMatch = cleanPath.match(/^(\/repos\/[^/]+\/[^/]+)\/pulls/);
  if (prMatch) {
    invalidateAndBust(`${prMatch[1]}/pulls`);
    invalidateAndBust(`${prMatch[1]}/issues`);
  }

  // 8. /repos/:owner/:repo/collaborators
  const collabMatch = cleanPath.match(/^(\/repos\/[^/]+\/[^/]+\/collaborators)/);
  if (collabMatch) {
    invalidateAndBust(collabMatch[1]);
  }

  // 9. /gists — 创建/更新/删除 Gist
  if (cleanPath.startsWith('/gists')) {
    invalidateAndBust('/gists');
  }

  // 10. /user/starred — star/unstar 操作
  if (cleanPath.startsWith('/user/starred')) {
    invalidateAndBust('/user/starred');
    invalidateAndBust(cleanPath);               // checkStarred 精确 key
  }

  // 11. /notifications — 已读/删除后失效通知列表与未读徽标
  if (cleanPath.startsWith('/notifications')) {
    invalidateAndBust('/notifications');
  }
  // 12. /repos/:owner/:repo/actions — 工作流触发/取消
  const actionsMatch = cleanPath.match(/^(\/repos\/[^/]+\/[^/]+\/actions)/);
  if (actionsMatch) {
    invalidateAndBust(actionsMatch[1]);
  }
}

// ── In-flight 请求合并层 ────────────────────────────────────────────
// 当多个组件同时调用同一 GET 接口（如仓库列表同时被侧边栏和主页面请求）时，
// 只有第一个请求会真正发出，后续相同 URL + token 的请求直接共享同一个 Promise。
// 请求完成（成功或失败）后，该 Promise 从 inFlightMap 中移除。
const inFlightMap = new Map<string, Promise<unknown>>();

/**
 * 从 in-flight Map 中获取已有的进行中请求，若不存在则创建并注册新 Promise。
 * 泛型 T 由调用方（request / requestWithPagination）保证类型安全。
 */
export function getOrCreateInFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlightMap.get(key);
  if (existing) return existing as Promise<T>;
  const promise = factory().finally(() => inFlightMap.delete(key));
  inFlightMap.set(key, promise as Promise<unknown>);
  return promise;
}

export function setToken(token: string | null) {
  // token 变更（退出登录）时清空所有缓存，防止旧用户数据泄露
  if (token !== authToken) {
    clearApiCache();
    inFlightMap.clear();
  }
  authToken = token;
}

export function getToken(): string | null {
  return authToken;
}

// 构建请求头
export function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

// 通用请求方法
export async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const method = (options.method ?? 'GET').toUpperCase();

  if (method === 'GET') {
    const cacheKey = buildCacheKey(url);
    // 1. TTL 缓存命中：直接返回，不发网络请求
    const entry = getCacheEntry<T>(cacheKey);
    const cached = getCached<T>(cacheKey);
    if (cached !== null) return cached;

    // 2. In-flight 合并：若相同请求正在进行中，共享同一 Promise
    //    fetchUrl 可能附加 _t 时间戳以绕过 GitHub CDN 强制缓存（60s），
    //    但 cacheKey 始终用干净 URL，确保时间戳不污染内存缓存键。
    const fetchUrl = consumeCacheBust(url);
    return getOrCreateInFlight<T>(cacheKey, async () => {
      const headers: Record<string, string> = {
        ...(buildHeaders() as Record<string, string>),
        ...(options.headers as Record<string, string> | undefined),
      };
      if (entry?.etag) headers['If-None-Match'] = entry.etag;
      const response = await fetchWithResilience(fetchUrl, {
        ...options,
        headers,
      }, method);
      if (response.status === 304 && entry) {
        touchCached(cacheKey, cacheTtlForUrl(url));
        return entry.data;
      }
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorBody = await response.json() as { message?: string; errors?: Array<{ message?: string }> };
          const detail = Array.isArray(errorBody.errors)
            ? errorBody.errors.map(item => item?.message).filter(Boolean)[0]
            : undefined;
          errorMessage = detail
            ? `${errorBody.message || errorMessage}: ${detail}`
            : (errorBody.message || errorMessage);
        } catch { /* 忽略 JSON 解析错误 */ }
        const error = new Error(errorMessage) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      if (response.status === 204) return undefined as T;
      const data = await response.json() as T;
      setCached(cacheKey, data, response.headers.get('etag') ?? undefined, cacheTtlForUrl(url));
      return data;
    });
  }

  // 非 GET 请求：直接发出，完成后失效相关缓存前缀
  const response = await fetchWithResilience(url, {
    ...options,
    headers: { ...buildHeaders(), ...options.headers },
  }, method);
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorBody = await response.json() as { message?: string; errors?: Array<{ message?: string }> };
      const detail = Array.isArray(errorBody.errors)
        ? errorBody.errors.map(item => item?.message).filter(Boolean)[0]
        : undefined;
      errorMessage = detail
        ? `${errorBody.message || errorMessage}: ${detail}`
        : (errorBody.message || errorMessage);
    } catch { /* 忽略 JSON 解析错误 */ }
    const error = new Error(errorMessage) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) {
    invalidateCacheForMutation(url, method);
    return undefined as T;
  }
  const data = await response.json() as T;
  invalidateCacheForMutation(url, method);
  return data;
}

// 从响应头获取分页链接
function parseLinkHeader(link: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = link.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      result[match[2]] = match[1];
    }
  }
  return result;
}

// 带分页信息的请求
export async function requestWithPagination<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T[]; hasNextPage: boolean; totalCount?: number }> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const method = (options.method ?? 'GET').toUpperCase();

  if (method === 'GET') {
    const cacheKey = buildCacheKey(url);
    // 1. TTL 缓存命中
    const entry = getCacheEntry<{ data: T[]; hasNextPage: boolean }>(cacheKey);
    const cached = getCached<{ data: T[]; hasNextPage: boolean }>(cacheKey);
    if (cached !== null) return cached;

    // 2. In-flight 合并（fetchUrl 可能附加 _t 绕过 GitHub CDN 强制缓存）
    const fetchUrl = consumeCacheBust(url);
    return getOrCreateInFlight<{ data: T[]; hasNextPage: boolean }>(cacheKey, async () => {
      const headers: Record<string, string> = {
        ...(buildHeaders() as Record<string, string>),
        ...(options.headers as Record<string, string> | undefined),
      };
      if (entry?.etag) headers['If-None-Match'] = entry.etag;
      const response = await fetchWithResilience(fetchUrl, {
        ...options,
        headers,
      }, method);
      if (response.status === 304 && entry) {
        touchCached(cacheKey, cacheTtlForUrl(url));
        return entry.data;
      }
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorBody = await response.json() as { message?: string; errors?: Array<{ message?: string }> };
          const detail = Array.isArray(errorBody.errors)
            ? errorBody.errors.map(item => item?.message).filter(Boolean)[0]
            : undefined;
          errorMessage = detail
            ? `${errorBody.message || errorMessage}: ${detail}`
            : (errorBody.message || errorMessage);
        } catch { /* 忽略 */ }
        const error = new Error(errorMessage) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      const data = await response.json() as T[];
      const linkHeader = response.headers.get('Link');
      const links = linkHeader ? parseLinkHeader(linkHeader) : {};
      const result = { data, hasNextPage: !!links.next };
      setCached(cacheKey, result, response.headers.get('etag') ?? undefined, cacheTtlForUrl(url));
      return result;
    });
  }
  // 非 GET 分页请求（极少见，直接发出）
  const response = await fetchWithResilience(url, {
    ...options,
    headers: { ...buildHeaders(), ...options.headers },
  }, method);
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorBody = await response.json() as { message?: string; errors?: Array<{ message?: string }> };
      const detail = Array.isArray(errorBody.errors)
        ? errorBody.errors.map(item => item?.message).filter(Boolean)[0]
        : undefined;
      errorMessage = detail
        ? `${errorBody.message || errorMessage}: ${detail}`
        : (errorBody.message || errorMessage);
    } catch { /* 忽略 */ }
    const error = new Error(errorMessage) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  const data = await response.json() as T[];
  const linkHeader = response.headers.get('Link');
  const links = linkHeader ? parseLinkHeader(linkHeader) : {};
  invalidateCacheForMutation(url, method);
  return { data, hasNextPage: !!links.next };
}
