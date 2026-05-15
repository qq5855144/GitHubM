// GitHub REST API 服务层

import type {
  GitHubUser,
  GitHubRepo,
  GitHubIssue,
  GitHubComment,
  GitHubPullRequest,
  GitHubCommit,
  GitHubBranch,
  GitHubCollaborator,
  GitHubNotification,
  GitHubContent,
  GitHubRateLimit,
  GitHubSearchResult,
  GitHubEvent,
  GitHubLabel,
  GitHubMilestone,
  IssueState,
  IssueSortField,
  PrState,
  RepoSortField,
  SortDirection,
} from '@/types/types';

const BASE_URL = 'https://api.github.com';

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
}
const apiCache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 30_000; // 30s

/**
 * 需要打时间戳绕过 GitHub CDN 强制缓存（60s）的 URL 前缀集合。
 * 写操作后由 invalidateCacheForMutation 填充，下次对应 GET 发出时消费并附加 _t=Date.now()。
 */
const cdnBustPrefixes = new Set<string>();

/** 生成缓存 key（URL + 当前 token，token 变化后旧缓存自动失效） */
export function buildCacheKey(url: string): string {
  return `${authToken ?? ''}|${url}`;
}

/** 读取缓存，过期自动删除并返回 null */
export function getCached<T>(key: string): T | null {
  const entry = apiCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expireAt) {
    apiCache.delete(key);
    return null;
  }
  return entry.data;
}

/** 写入缓存 */
export function setCached<T>(key: string, data: T): void {
  apiCache.set(key, { data, expireAt: Date.now() + CACHE_TTL_MS });
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
function invalidateAndBust(urlPrefix: string): void {
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

  // 11. /repos/:owner/:repo/actions — 工作流触发/取消
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
  if (token !== authToken) clearApiCache();
  authToken = token;
}

export function getToken(): string | null {
  return authToken;
}

// 构建请求头
function buildHeaders(): HeadersInit {
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
async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const method = (options.method ?? 'GET').toUpperCase();

  if (method === 'GET') {
    const cacheKey = buildCacheKey(url);

    // 1. TTL 缓存命中：直接返回，不发网络请求
    const cached = getCached<T>(cacheKey);
    if (cached !== null) return cached;

    // 2. In-flight 合并：若相同请求正在进行中，共享同一 Promise
    //    fetchUrl 可能附加 _t 时间戳以绕过 GitHub CDN 强制缓存（60s），
    //    但 cacheKey 始终用干净 URL，确保时间戳不污染内存缓存键。
    const fetchUrl = consumeCacheBust(url);
    return getOrCreateInFlight<T>(cacheKey, async () => {
      const response = await fetch(fetchUrl, {
        ...options,
        headers: { ...buildHeaders(), ...options.headers },
      });
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorBody = await response.json() as { message?: string };
          errorMessage = errorBody.message || errorMessage;
        } catch { /* 忽略 JSON 解析错误 */ }
        const error = new Error(errorMessage) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      if (response.status === 204) return undefined as T;
      const data = await response.json() as T;
      setCached(cacheKey, data);
      return data;
    });
  }

  // 非 GET 请求：直接发出，完成后失效相关缓存前缀
  const response = await fetch(url, {
    ...options,
    headers: { ...buildHeaders(), ...options.headers },
  });
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorBody = await response.json() as { message?: string };
      errorMessage = errorBody.message || errorMessage;
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
async function requestWithPagination<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T[]; hasNextPage: boolean; totalCount?: number }> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const method = (options.method ?? 'GET').toUpperCase();

  if (method === 'GET') {
    const cacheKey = buildCacheKey(url);

    // 1. TTL 缓存命中
    const cached = getCached<{ data: T[]; hasNextPage: boolean }>(cacheKey);
    if (cached !== null) return cached;

    // 2. In-flight 合并（fetchUrl 可能附加 _t 绕过 GitHub CDN 强制缓存）
    const fetchUrl = consumeCacheBust(url);
    return getOrCreateInFlight<{ data: T[]; hasNextPage: boolean }>(cacheKey, async () => {
      const response = await fetch(fetchUrl, {
        ...options,
        headers: { ...buildHeaders(), ...options.headers },
      });
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorBody = await response.json() as { message?: string };
          errorMessage = errorBody.message || errorMessage;
        } catch { /* 忽略 */ }
        const error = new Error(errorMessage) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      const data = await response.json() as T[];
      const linkHeader = response.headers.get('Link');
      const links = linkHeader ? parseLinkHeader(linkHeader) : {};
      const result = { data, hasNextPage: !!links.next };
      setCached(cacheKey, result);
      return result;
    });
  }

  // 非 GET 分页请求（极少见，直接发出）
  const response = await fetch(url, {
    ...options,
    headers: { ...buildHeaders(), ...options.headers },
  });
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorBody = await response.json() as { message?: string };
      errorMessage = errorBody.message || errorMessage;
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

// ===== 用户 API =====

export async function getCurrentUser(): Promise<GitHubUser> {
  return request<GitHubUser>('/user');
}

export async function getUserByLogin(login: string): Promise<GitHubUser> {
  return request<GitHubUser>(`/users/${login}`);
}

export async function getRateLimit(): Promise<{ rate: GitHubRateLimit }> {
  return request<{ rate: GitHubRateLimit }>('/rate_limit');
}

export async function getUserEvents(
  login: string,
  page = 1
): Promise<GitHubEvent[]> {
  return request<GitHubEvent[]>(
    `/users/${login}/events?per_page=30&page=${page}`
  );
}

// ===== 仓库 API =====

export async function getUserRepos(params: {
  sort?: RepoSortField;
  direction?: SortDirection;
  per_page?: number;
  page?: number;
  type?: 'all' | 'owner' | 'member' | 'public' | 'private';
} = {}): Promise<{ data: GitHubRepo[]; hasNextPage: boolean }> {
  const {
    sort = 'updated',
    direction = 'desc',
    per_page = 30,
    page = 1,
    type = 'all',
  } = params;
  return requestWithPagination<GitHubRepo>(
    `/user/repos?sort=${sort}&direction=${direction}&per_page=${per_page}&page=${page}&type=${type}`
  );
}

export async function getRepo(
  owner: string,
  repo: string
): Promise<GitHubRepo> {
  return request<GitHubRepo>(`/repos/${owner}/${repo}`);
}

export async function createRepo(params: {
  name: string;
  description?: string;
  private?: boolean;
  auto_init?: boolean;
  gitignore_template?: string;
  license_template?: string;
}): Promise<GitHubRepo> {
  return request<GitHubRepo>('/user/repos', {
    method: 'POST',
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function starRepo(owner: string, repo: string): Promise<void> {
  await request<void>(`/user/starred/${owner}/${repo}`, { method: 'PUT', headers: { 'Content-Length': '0' } });
}

export async function unstarRepo(owner: string, repo: string): Promise<void> {
  await request<void>(`/user/starred/${owner}/${repo}`, { method: 'DELETE' });
}

export async function checkStarred(owner: string, repo: string): Promise<boolean> {
  try {
    const url = `${BASE_URL}/user/starred/${owner}/${repo}`;
    const cacheKey = buildCacheKey(url);
    const cached = getCached<boolean>(cacheKey);
    if (cached !== null) return cached;
    const response = await fetch(url, { headers: buildHeaders() });
    const result = response.status === 204;
    setCached(cacheKey, result);
    return result;
  } catch {
    return false;
  }
}

export async function forkRepo(owner: string, repo: string): Promise<GitHubRepo> {
  return request<GitHubRepo>(`/repos/${owner}/${repo}/forks`, { method: 'POST' });
}

export async function getRepoLanguages(
  owner: string,
  repo: string
): Promise<Record<string, number>> {
  return request<Record<string, number>>(`/repos/${owner}/${repo}/languages`);
}

export async function getRepoTopics(
  owner: string,
  repo: string
): Promise<{ names: string[] }> {
  return request<{ names: string[] }>(`/repos/${owner}/${repo}/topics`);
}

// ===== Issue API =====

export async function getIssues(
  owner: string,
  repo: string,
  params: {
    state?: IssueState;
    sort?: IssueSortField;
    direction?: SortDirection;
    per_page?: number;
    page?: number;
    labels?: string;
    milestone?: string;
    assignee?: string;
  } = {}
): Promise<{ data: GitHubIssue[]; hasNextPage: boolean }> {
  const {
    state = 'open',
    sort = 'created',
    direction = 'desc',
    per_page = 30,
    page = 1,
  } = params;
  const queryParams = new URLSearchParams({
    state,
    sort,
    direction,
    per_page: String(per_page),
    page: String(page),
  });
  if (params.labels) queryParams.set('labels', params.labels);
  if (params.milestone) queryParams.set('milestone', params.milestone);
  if (params.assignee) queryParams.set('assignee', params.assignee);

  return requestWithPagination<GitHubIssue>(
    `/repos/${owner}/${repo}/issues?${queryParams.toString()}`
  );
}

export async function getIssue(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<GitHubIssue> {
  return request<GitHubIssue>(`/repos/${owner}/${repo}/issues/${issueNumber}`);
}

export async function createIssue(
  owner: string,
  repo: string,
  params: {
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
    milestone?: number;
  }
): Promise<GitHubIssue> {
  return request<GitHubIssue>(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function updateIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  params: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
    labels?: string[];
    assignees?: string[];
    milestone?: number | null;
  }
): Promise<GitHubIssue> {
  return request<GitHubIssue>(
    `/repos/${owner}/${repo}/issues/${issueNumber}`,
    {
      method: 'PATCH',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function getIssueComments(
  owner: string,
  repo: string,
  issueNumber: number,
  page = 1
): Promise<GitHubComment[]> {
  return request<GitHubComment[]>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=50&page=${page}`
  );
}

export async function createIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<GitHubComment> {
  return request<GitHubComment>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function getRepoLabels(
  owner: string,
  repo: string
): Promise<GitHubLabel[]> {
  return request<GitHubLabel[]>(`/repos/${owner}/${repo}/labels?per_page=100`);
}

export async function getRepoMilestones(
  owner: string,
  repo: string
): Promise<GitHubMilestone[]> {
  return request<GitHubMilestone[]>(`/repos/${owner}/${repo}/milestones?per_page=100`);
}

// ===== Pull Request API =====

export async function getPullRequests(
  owner: string,
  repo: string,
  params: {
    state?: PrState;
    sort?: 'created' | 'updated' | 'popularity' | 'long-running';
    direction?: SortDirection;
    per_page?: number;
    page?: number;
    base?: string;
    head?: string;
  } = {}
): Promise<{ data: GitHubPullRequest[]; hasNextPage: boolean }> {
  const {
    state = 'open',
    sort = 'created',
    direction = 'desc',
    per_page = 30,
    page = 1,
  } = params;
  const queryParams = new URLSearchParams({
    state,
    sort,
    direction,
    per_page: String(per_page),
    page: String(page),
  });
  if (params.base) queryParams.set('base', params.base);
  if (params.head) queryParams.set('head', params.head);

  return requestWithPagination<GitHubPullRequest>(
    `/repos/${owner}/${repo}/pulls?${queryParams.toString()}`
  );
}

export async function getPullRequest(
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubPullRequest> {
  return request<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls/${prNumber}`);
}

export async function getPullRequestFiles(
  owner: string,
  repo: string,
  prNumber: number
): Promise<import('@/types/types').GitHubFile[]> {
  return request<import('@/types/types').GitHubFile[]>(
    `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`
  );
}

export async function mergePullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  params?: {
    commit_title?: string;
    commit_message?: string;
    merge_method?: 'merge' | 'squash' | 'rebase';
  }
): Promise<{ sha: string; merged: boolean; message: string }> {
  return request<{ sha: string; merged: boolean; message: string }>(
    `/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
    {
      method: 'PUT',
      body: JSON.stringify(params || {}),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function updatePullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  params: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
  }
): Promise<GitHubPullRequest> {
  return request<GitHubPullRequest>(
    `/repos/${owner}/${repo}/pulls/${prNumber}`,
    {
      method: 'PATCH',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function getPullRequestComments(
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubComment[]> {
  return request<GitHubComment[]>(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=50`
  );
}

export async function createPullRequestComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<GitHubComment> {
  return request<GitHubComment>(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

// ===== 提交 API =====

export async function getCommits(
  owner: string,
  repo: string,
  params: {
    sha?: string;
    per_page?: number;
    page?: number;
    author?: string;
  } = {}
): Promise<{ data: GitHubCommit[]; hasNextPage: boolean }> {
  const { sha, per_page = 30, page = 1, author } = params;
  const queryParams = new URLSearchParams({
    per_page: String(per_page),
    page: String(page),
  });
  if (sha) queryParams.set('sha', sha);
  if (author) queryParams.set('author', author);

  return requestWithPagination<GitHubCommit>(
    `/repos/${owner}/${repo}/commits?${queryParams.toString()}`
  );
}

export async function getCommit(
  owner: string,
  repo: string,
  sha: string
): Promise<GitHubCommit> {
  return request<GitHubCommit>(`/repos/${owner}/${repo}/commits/${sha}`);
}

// ===== 分支 API =====

export async function getBranches(
  owner: string,
  repo: string,
  page = 1
): Promise<{ data: GitHubBranch[]; hasNextPage: boolean }> {
  return requestWithPagination<GitHubBranch>(
    `/repos/${owner}/${repo}/branches?per_page=30&page=${page}`
  );
}

export async function getBranch(
  owner: string,
  repo: string,
  branch: string
): Promise<GitHubBranch> {
  return request<GitHubBranch>(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
}

export async function createBranch(
  owner: string,
  repo: string,
  params: { ref: string; sha: string }
): Promise<{ ref: string; object: { sha: string } }> {
  return request<{ ref: string; object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/refs`,
    {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${params.ref}`, sha: params.sha }),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function deleteBranch(
  owner: string,
  repo: string,
  branch: string
): Promise<void> {
  await request<void>(
    `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    { method: 'DELETE' }
  );
}

export async function compareBranches(
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<{
  ahead_by: number;
  behind_by: number;
  status: string;
  commits: GitHubCommit[];
}> {
  return request<{
    ahead_by: number;
    behind_by: number;
    status: string;
    commits: GitHubCommit[];
  }>(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
}

// ===== 协作者 API =====

export async function getCollaborators(
  owner: string,
  repo: string,
  page = 1
): Promise<{ data: GitHubCollaborator[]; hasNextPage: boolean }> {
  return requestWithPagination<GitHubCollaborator>(
    `/repos/${owner}/${repo}/collaborators?per_page=30&page=${page}`
  );
}

export async function addCollaborator(
  owner: string,
  repo: string,
  username: string,
  permission: 'pull' | 'triage' | 'push' | 'maintain' | 'admin' = 'push'
): Promise<void> {
  await request<void>(
    `/repos/${owner}/${repo}/collaborators/${username}`,
    {
      method: 'PUT',
      body: JSON.stringify({ permission }),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function removeCollaborator(
  owner: string,
  repo: string,
  username: string
): Promise<void> {
  await request<void>(`/repos/${owner}/${repo}/collaborators/${username}`, {
    method: 'DELETE',
  });
}

export async function updateCollaboratorPermission(
  owner: string,
  repo: string,
  username: string,
  permission: 'pull' | 'triage' | 'push' | 'maintain' | 'admin'
): Promise<void> {
  await request<void>(
    `/repos/${owner}/${repo}/collaborators/${username}`,
    {
      method: 'PUT',
      body: JSON.stringify({ permission }),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

// ===== 通知 API =====

export async function getNotifications(params: {
  all?: boolean;
  participating?: boolean;
  per_page?: number;
  page?: number;
} = {}): Promise<{ data: GitHubNotification[]; hasNextPage: boolean }> {
  const { all = false, participating = false, per_page = 50, page = 1 } = params;
  return requestWithPagination<GitHubNotification>(
    `/notifications?all=${all}&participating=${participating}&per_page=${per_page}&page=${page}`
  );
}

export async function markNotificationRead(threadId: string): Promise<void> {
  await request<void>(`/notifications/threads/${threadId}`, { method: 'PATCH' });
}

export async function markAllNotificationsRead(): Promise<void> {
  await request<void>('/notifications', {
    method: 'PUT',
    body: JSON.stringify({ read: true }),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ===== 内容/代码浏览 API =====

export async function getRepoContents(
  owner: string,
  repo: string,
  path = '',
  ref?: string
): Promise<GitHubContent | GitHubContent[]> {
  const queryParams = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const encodedPath = path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : '';
  return request<GitHubContent | GitHubContent[]>(
    `/repos/${owner}/${repo}/contents${encodedPath}${queryParams}`
  );
}

export async function getReadme(
  owner: string,
  repo: string,
  ref?: string
): Promise<GitHubContent> {
  const queryParams = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return request<GitHubContent>(`/repos/${owner}/${repo}/readme${queryParams}`);
}

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<{ content: string; encoding: string }> {
  const queryParams = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return request<{ content: string; encoding: string }>(
    `/repos/${owner}/${repo}/contents/${encodedPath}${queryParams}`
  );
}

// ===== 搜索 API =====

export async function searchRepositories(
  query: string,
  params: { sort?: 'stars' | 'forks' | 'updated'; order?: SortDirection; per_page?: number; page?: number } = {}
): Promise<GitHubSearchResult<GitHubRepo>> {
  const { sort, order = 'desc', per_page = 20, page = 1 } = params;
  const q = encodeURIComponent(query);
  const sortQS = sort ? `&sort=${sort}&order=${order}` : '';
  return request<GitHubSearchResult<GitHubRepo>>(
    `/search/repositories?q=${q}${sortQS}&per_page=${per_page}&page=${page}`
  );
}

export async function searchIssues(
  query: string,
  params: { sort?: 'created' | 'updated' | 'comments'; order?: SortDirection; per_page?: number; page?: number } = {}
): Promise<GitHubSearchResult<GitHubIssue>> {
  const { sort = 'created', order = 'desc', per_page = 20, page = 1 } = params;
  const q = encodeURIComponent(query);
  return request<GitHubSearchResult<GitHubIssue>>(
    `/search/issues?q=${q}&sort=${sort}&order=${order}&per_page=${per_page}&page=${page}`
  );
}

export async function searchUsers(
  query: string,
  params: { sort?: 'followers' | 'repositories' | 'joined'; order?: SortDirection; per_page?: number; page?: number } = {}
): Promise<GitHubSearchResult<GitHubUser>> {
  const { sort = 'followers', order = 'desc', per_page = 20, page = 1 } = params;
  const q = encodeURIComponent(query);
  return request<GitHubSearchResult<GitHubUser>>(
    `/search/users?q=${q}&sort=${sort}&order=${order}&per_page=${per_page}&page=${page}`
  );
}

export async function searchCode(
  query: string,
  params: { per_page?: number; page?: number } = {}
): Promise<GitHubSearchResult<{
  name: string;
  path: string;
  sha: string;
  html_url: string;
  repository: GitHubRepo;
  score: number;
}>> {
  const { per_page = 20, page = 1 } = params;
  const q = encodeURIComponent(query);
  return request<GitHubSearchResult<{
    name: string;
    path: string;
    sha: string;
    html_url: string;
    repository: GitHubRepo;
    score: number;
  }>>(`/search/code?q=${q}&per_page=${per_page}&page=${page}`);
}

// ===== 文件写入 =====
export async function updateFileContent(
  owner: string,
  repo: string,
  path: string,
  data: { message: string; content: string; sha: string; branch?: string }
): Promise<void> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  await request<unknown>(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function createFileContent(
  owner: string,
  repo: string,
  path: string,
  data: { message: string; content: string; branch?: string }
): Promise<void> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  await request<unknown>(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteFileContent(
  owner: string,
  repo: string,
  path: string,
  data: { message: string; sha: string; branch?: string }
): Promise<void> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  await request<unknown>(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: 'DELETE',
    body: JSON.stringify(data),
  });
}

// ===== GitHub Actions =====
export async function getWorkflows(
  owner: string,
  repo: string
): Promise<{ total_count: number; workflows: import('@/types/types').GitHubWorkflow[] }> {
  return request(`/repos/${owner}/${repo}/actions/workflows`);
}

export async function getWorkflowRuns(
  owner: string,
  repo: string,
  params: { workflow_id?: number | string; status?: string; per_page?: number; page?: number } = {}
): Promise<{ total_count: number; workflow_runs: import('@/types/types').GitHubWorkflowRun[] }> {
  const { workflow_id, status, per_page = 20, page = 1 } = params;
  const base = workflow_id
    ? `/repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs`
    : `/repos/${owner}/${repo}/actions/runs`;
  const qs = new URLSearchParams({ per_page: String(per_page), page: String(page) });
  if (status) qs.set('status', status);
  return request(`${base}?${qs}`);
}

export async function getWorkflowRun(
  owner: string,
  repo: string,
  runId: number
): Promise<import('@/types/types').GitHubWorkflowRun> {
  return request(`/repos/${owner}/${repo}/actions/runs/${runId}`);
}

export async function triggerWorkflow(
  owner: string,
  repo: string,
  workflowId: number | string,
  ref: string,
  inputs: Record<string, string> = {}
): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref, inputs }),
  });
}

export async function cancelWorkflowRun(
  owner: string,
  repo: string,
  runId: number
): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/actions/runs/${runId}/cancel`, {
    method: 'POST',
  });
}

export async function rerunWorkflowRun(
  owner: string,
  repo: string,
  runId: number
): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun`, {
    method: 'POST',
  });
}

export async function getWorkflowRunJobs(
  owner: string,
  repo: string,
  runId: number
): Promise<{ total_count: number; jobs: import('@/types/types').GitHubWorkflowJob[] }> {
  return request(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs`);
}

// ===== GitHub Packages =====
export async function getUserPackages(
  username: string,
  packageType: string = 'container'
): Promise<import('@/types/types').GitHubPackage[]> {
  return request(`/users/${username}/packages?package_type=${packageType}`);
}

export async function getRepoPackages(
  owner: string,
  repo: string
): Promise<import('@/types/types').GitHubPackage[]> {
  // Packages are org/user-level; filter by repo name
  return request<import('@/types/types').GitHubPackage[]>(`/repos/${owner}/${repo}/packages`).catch(() => [] as import('@/types/types').GitHubPackage[]);
}

export async function getPackageVersions(
  packageType: string,
  packageName: string,
  username: string
): Promise<import('@/types/types').GitHubPackageVersion[]> {
  return request(
    `/users/${username}/packages/${packageType}/${encodeURIComponent(packageName)}/versions`
  );
}

export async function deletePackageVersion(
  packageType: string,
  packageName: string,
  username: string,
  versionId: number
): Promise<void> {
  await request<unknown>(
    `/users/${username}/packages/${packageType}/${encodeURIComponent(packageName)}/versions/${versionId}`,
    { method: 'DELETE' }
  );
}

// ===== GitHub Projects (Classic) =====
export async function getRepoProjects(
  owner: string,
  repo: string
): Promise<import('@/types/types').GitHubProject[]> {
  return request(`/repos/${owner}/${repo}/projects`, {
    headers: { Accept: 'application/vnd.github.inertia-preview+json' },
  });
}

export async function getProjectColumns(
  projectId: number
): Promise<import('@/types/types').GitHubProjectColumn[]> {
  return request(`/projects/${projectId}/columns`, {
    headers: { Accept: 'application/vnd.github.inertia-preview+json' },
  });
}

export async function getColumnCards(
  columnId: number
): Promise<import('@/types/types').GitHubProjectCard[]> {
  return request(`/projects/columns/${columnId}/cards`, {
    headers: { Accept: 'application/vnd.github.inertia-preview+json' },
  });
}

export async function createProject(
  owner: string,
  repo: string,
  name: string,
  body?: string
): Promise<import('@/types/types').GitHubProject> {
  return request(`/repos/${owner}/${repo}/projects`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github.inertia-preview+json' },
    body: JSON.stringify({ name, body }),
  });
}

export async function deleteProject(projectId: number): Promise<void> {
  await request<unknown>(`/projects/${projectId}`, {
    method: 'DELETE',
    headers: { Accept: 'application/vnd.github.inertia-preview+json' },
  });
}

export async function createProjectColumn(
  projectId: number,
  name: string
): Promise<import('@/types/types').GitHubProjectColumn> {
  return request(`/projects/${projectId}/columns`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github.inertia-preview+json' },
    body: JSON.stringify({ name }),
  });
}

export async function createProjectCard(
  columnId: number,
  note: string
): Promise<import('@/types/types').GitHubProjectCard> {
  return request(`/projects/columns/${columnId}/cards`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github.inertia-preview+json' },
    body: JSON.stringify({ note }),
  });
}

export async function moveProjectCard(
  cardId: number,
  position: string,
  columnId: number
): Promise<void> {
  await request<unknown>(`/projects/columns/cards/${cardId}/moves`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github.inertia-preview+json' },
    body: JSON.stringify({ position, column_id: columnId }),
  });
}

// ===== GitHub Gists =====
export async function getGists(
  params: { per_page?: number; page?: number } = {}
): Promise<import('@/types/types').GitHubGist[]> {
  const { per_page = 30, page = 1 } = params;
  return request(`/gists?per_page=${per_page}&page=${page}`);
}

export async function getGist(gistId: string): Promise<import('@/types/types').GitHubGistDetail> {
  return request(`/gists/${gistId}`);
}

export async function createGist(data: {
  description: string;
  public: boolean;
  files: Record<string, { content: string }>;
}): Promise<import('@/types/types').GitHubGistDetail> {
  return request('/gists', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateGist(
  gistId: string,
  data: {
    description?: string;
    files?: Record<string, { content: string } | null>;
  }
): Promise<import('@/types/types').GitHubGistDetail> {
  return request(`/gists/${gistId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function deleteGist(gistId: string): Promise<void> {
  await request<unknown>(`/gists/${gistId}`, { method: 'DELETE' });
}

export async function forkGist(gistId: string): Promise<import('@/types/types').GitHubGistDetail> {
  return request(`/gists/${gistId}/forks`, { method: 'POST' });
}

export async function starGist(gistId: string): Promise<void> {
  await request<unknown>(`/gists/${gistId}/star`, { method: 'PUT' });
}

export async function unstarGist(gistId: string): Promise<void> {
  await request<unknown>(`/gists/${gistId}/star`, { method: 'DELETE' });
}

export async function getGistComments(
  gistId: string
): Promise<import('@/types/types').GitHubComment[]> {
  return request(`/gists/${gistId}/comments`);
}

export async function createGistComment(
  gistId: string,
  body: string
): Promise<import('@/types/types').GitHubComment> {
  return request(`/gists/${gistId}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
}

// ===== GitHub Discussions (REST, limited) =====
export async function getDiscussions(
  owner: string,
  repo: string,
  params: { per_page?: number; page?: number } = {}
): Promise<import('@/types/types').GitHubDiscussion[]> {
  const { per_page = 20, page = 1 } = params;
  // REST API 对 Discussions 支持有限，错误由调用方处理
  return request<import('@/types/types').GitHubDiscussion[]>(
    `/repos/${owner}/${repo}/discussions?per_page=${per_page}&page=${page}`
  );
}

// ===== gitignore 模板 =====
export async function getGitignoreTemplates(): Promise<string[]> {
  return request<string[]>('/gitignore/templates');
}

// ===== 许可证列表 =====
export async function getLicenses(): Promise<Array<{ key: string; name: string; spdx_id: string }>> {
  return request<Array<{ key: string; name: string; spdx_id: string }>>('/licenses');
}

// ===== 格式化工具 =====

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 30) return `${days} 天前`;
  if (months < 12) return `${months} 个月前`;
  return `${years} 年前`;
}

export function formatNumber(num: number): string {
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return String(num);
}

export function getLanguageColor(language: string): string {
  const colors: Record<string, string> = {
    TypeScript: '#3178c6',
    JavaScript: '#f1e05a',
    Python: '#3572A5',
    Java: '#b07219',
    Go: '#00ADD8',
    Rust: '#dea584',
    C: '#555555',
    'C++': '#f34b7d',
    'C#': '#178600',
    Ruby: '#701516',
    PHP: '#4F5D95',
    Swift: '#F05138',
    Kotlin: '#A97BFF',
    Dart: '#00B4AB',
    Shell: '#89e051',
    HTML: '#e34c26',
    CSS: '#563d7c',
    Vue: '#41b883',
    Svelte: '#ff3e00',
    Scala: '#c22d40',
    Elixir: '#6e4a7e',
    Haskell: '#5e5086',
    Lua: '#000080',
    MATLAB: '#e16737',
    R: '#198CE7',
  };
  return colors[language] || '#6b7280';
}

// ===== GitHub Pages API =====

export interface GitHubPages {
  url: string;
  status: 'built' | 'building' | 'errored' | 'null' | null;
  cname: string | null;
  custom_404: boolean;
  html_url: string;
  source: { branch: string; directory: string } | null;
  public: boolean;
  https_enforced?: boolean;
}

export interface GitHubPagesBuild {
  url: string;
  status: 'built' | 'building' | 'errored';
  error: { message: string | null };
  pusher: { login: string; avatar_url: string } | null;
  commit: string;
  duration: number;
  created_at: string;
  updated_at: string;
}

export async function getPages(owner: string, repo: string): Promise<GitHubPages> {
  return request<GitHubPages>(`/repos/${owner}/${repo}/pages`);
}

export async function enablePages(
  owner: string,
  repo: string,
  source: { branch: string; path?: '/' | '/docs' }
): Promise<GitHubPages> {
  return request<GitHubPages>(`/repos/${owner}/${repo}/pages`, {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
}

export async function updatePages(
  owner: string,
  repo: string,
  data: { source?: { branch: string; path?: '/' | '/docs' }; cname?: string | null; https_enforced?: boolean }
): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/pages`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function disablePages(owner: string, repo: string): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/pages`, { method: 'DELETE' });
}

export async function triggerPagesBuild(owner: string, repo: string): Promise<{ url: string; status: string }> {
  return request<{ url: string; status: string }>(`/repos/${owner}/${repo}/pages/builds`, { method: 'POST' });
}

export async function getLatestPagesBuild(owner: string, repo: string): Promise<GitHubPagesBuild> {
  return request<GitHubPagesBuild>(`/repos/${owner}/${repo}/pages/builds/latest`);
}

export async function listPagesBuilds(
  owner: string,
  repo: string,
  params: { per_page?: number; page?: number } = {}
): Promise<GitHubPagesBuild[]> {
  const { per_page = 10, page = 1 } = params;
  return request<GitHubPagesBuild[]>(`/repos/${owner}/${repo}/pages/builds?per_page=${per_page}&page=${page}`);
}

export async function getRepoDeployments(
  owner: string,
  repo: string,
  params: { per_page?: number; page?: number; environment?: string } = {}
): Promise<import('@/types/types').GitHubDeployment[]> {
  const { per_page = 20, page = 1, environment } = params;
  const env = environment ? `&environment=${encodeURIComponent(environment)}` : '';
  return request<import('@/types/types').GitHubDeployment[]>(
    `/repos/${owner}/${repo}/deployments?per_page=${per_page}&page=${page}${env}`
  );
}

export async function getDeploymentStatuses(
  owner: string,
  repo: string,
  deploymentId: number
): Promise<import('@/types/types').GitHubDeploymentStatus[]> {
  return request<import('@/types/types').GitHubDeploymentStatus[]>(
    `/repos/${owner}/${repo}/deployments/${deploymentId}/statuses`
  );
}

// ===== Releases & Artifacts API =====

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  author: { login: string; avatar_url: string };
  html_url: string;
  tarball_url: string | null;
  zipball_url: string | null;
  assets: GitHubReleaseAsset[];
}

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  label: string | null;
  content_type: string;
  size: number;
  download_count: number;
  browser_download_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  archive_download_url: string;
  workflow_run: { id: number; head_branch: string; head_sha: string; event: string } | null;
}

export async function getReleases(
  owner: string,
  repo: string,
  params: { per_page?: number; page?: number } = {}
): Promise<GitHubRelease[]> {
  const { per_page = 20, page = 1 } = params;
  return request<GitHubRelease[]>(`/repos/${owner}/${repo}/releases?per_page=${per_page}&page=${page}`);
}

export async function getRelease(owner: string, repo: string, releaseId: number): Promise<GitHubRelease> {
  return request<GitHubRelease>(`/repos/${owner}/${repo}/releases/${releaseId}`);
}

export async function deleteRelease(owner: string, repo: string, releaseId: number): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/releases/${releaseId}`, { method: 'DELETE' });
}

export async function deleteReleaseAsset(owner: string, repo: string, assetId: number): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/releases/assets/${assetId}`, { method: 'DELETE' });
}

// ===== 仓库管理 API =====

export interface GitHubRepoUpdate {
  name?: string;
  description?: string;
  private?: boolean;
  default_branch?: string;
  has_issues?: boolean;
  has_wiki?: boolean;
  has_projects?: boolean;
}

export async function updateRepo(
  owner: string,
  repo: string,
  data: GitHubRepoUpdate
): Promise<GitHubRepo> {
  return request<GitHubRepo>(`/repos/${owner}/${repo}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteRepo(owner: string, repo: string): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}`, { method: 'DELETE' });
}

/** 获取仓库 Git 树（用于递归列出目录下所有文件） */
export interface GitTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

export async function getGitTree(
  owner: string,
  repo: string,
  treeSha: string,
  recursive = false
): Promise<{ sha: string; truncated: boolean; tree: GitTreeItem[] }> {
  const q = recursive ? '?recursive=1' : '';
  return request<{ sha: string; truncated: boolean; tree: GitTreeItem[] }>(
    `/repos/${owner}/${repo}/git/trees/${treeSha}${q}`
  );
}

/** 批量删除指定目录下的所有文件（先列出再逐个删除） */
export async function deleteFolderContents(
  owner: string,
  repo: string,
  folderPath: string,
  branch: string,
  commitMessagePrefix: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ success: number; failed: number }> {
  // 获取目录内容（递归）
  const branchInfo = await request<{ commit: { sha: string } }>(
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
  );
  const tree = await getGitTree(owner, repo, branchInfo.commit.sha, true);
  const files = tree.tree.filter(
    (item) => item.type === 'blob' && item.path.startsWith(folderPath + '/')
  );

  let success = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      await request<unknown>(`/repos/${owner}/${repo}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'DELETE',
        body: JSON.stringify({
          message: `${commitMessagePrefix}: delete ${file.path}`,
          sha: file.sha,
          branch,
        }),
      });
      success++;
    } catch {
      failed++;
    }
    onProgress?.(i + 1, files.length);
  }
  return { success, failed };
}

export async function getRepoArtifacts(
  owner: string,
  repo: string,
  params: { per_page?: number; page?: number } = {}
): Promise<{ total_count: number; artifacts: GitHubArtifact[] }> {
  const { per_page = 30, page = 1 } = params;
  return request<{ total_count: number; artifacts: GitHubArtifact[] }>(
    `/repos/${owner}/${repo}/actions/artifacts?per_page=${per_page}&page=${page}`
  );
}

export async function deleteArtifact(owner: string, repo: string, artifactId: number): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/actions/artifacts/${artifactId}`, { method: 'DELETE' });
}

// ===== 检查文件是否存在（用于上传前判断 create 还是 update）=====

export interface GitHubFileInfo {
  sha: string;
  size: number;
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  encoding?: string;
  content?: string;
}

export async function getFileInfo(
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<GitHubFileInfo | null> {
  try {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    return await request<GitHubFileInfo>(`/repos/${owner}/${repo}/contents/${encodedPath}${query}`);
  } catch {
    return null;
  }
}

export async function getRepoBranches(owner: string, repo: string): Promise<Array<{ name: string; commit: { sha: string } }>> {
  return request<Array<{ name: string; commit: { sha: string } }>>(`/repos/${owner}/${repo}/branches?per_page=100`);
}

/** 获取用户的粉丝列表（分页） */
export async function getFollowers(
  login: string,
  page = 1,
  per_page = 30
): Promise<GitHubUser[]> {
  return request<GitHubUser[]>(
    `/users/${encodeURIComponent(login)}/followers?per_page=${per_page}&page=${page}`
  );
}

/** 获取用户正在关注的列表（分页） */
export async function getFollowing(
  login: string,
  page = 1,
  per_page = 30
): Promise<GitHubUser[]> {
  return request<GitHubUser[]>(
    `/users/${encodeURIComponent(login)}/following?per_page=${per_page}&page=${page}`
  );
}

/** 更新当前登录用户的 Profile（PATCH /user） */
export async function updateUserProfile(params: {
  name?: string;
  email?: string;
  bio?: string;
  company?: string;
  location?: string;
  blog?: string;
  twitter_username?: string;
}): Promise<GitHubUser> {
  return request<GitHubUser>('/user', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/** 获取当前用户 Star 的仓库列表 */
export async function getStarredRepos(params: {
  per_page?: number;
  page?: number;
  sort?: 'created' | 'updated';
  direction?: 'asc' | 'desc';
} = {}): Promise<GitHubRepo[]> {
  const { per_page = 30, page = 1, sort = 'updated', direction = 'desc' } = params;
  return request<GitHubRepo[]>(
    `/user/starred?per_page=${per_page}&page=${page}&sort=${sort}&direction=${direction}`
  );
}

/**
 * 获取当前用户 Star 的仓库总数。
 * 通过 per_page=1 请求并解析 Link header 中的 last page 编号得到总数。
 * 若无 Link header（总数 ≤ 1），则直接返回响应数组长度。
 */
export async function getStarredCount(): Promise<number> {
  const result = await requestWithPagination<GitHubRepo>('/user/starred?per_page=1');
  if (!result.hasNextPage) return result.data.length;
  // 从原始 headers 取 last page 编号（requestWithPagination 未暴露 links，改用 fetch 直接请求）
  const url = `${BASE_URL}/user/starred?per_page=1`;
  const response = await fetch(url, { headers: buildHeaders() });
  const linkHeader = response.headers.get('Link') || '';
  const match = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return match ? parseInt(match[1], 10) : result.data.length;
}

/** 关注某用户 */
export async function followUser(username: string): Promise<void> {
  await request<void>(`/user/following/${encodeURIComponent(username)}`, { method: 'PUT' });
}

/** 取消关注某用户 */
export async function unfollowUser(username: string): Promise<void> {
  await request<void>(`/user/following/${encodeURIComponent(username)}`, { method: 'DELETE' });
}

/** 检查当前用户是否关注了某用户（204=关注，404=未关注） */
export async function checkFollowing(username: string): Promise<boolean> {
  try {
    await request<void>(`/user/following/${encodeURIComponent(username)}`);
    return true;
  } catch {
    return false;
  }
}

/** 获取仓库的 Fork 列表 */
export async function getRepoForks(
  owner: string,
  repo: string,
  params: { per_page?: number; page?: number; sort?: 'newest' | 'oldest' | 'stargazers' | 'watchers' } = {}
): Promise<GitHubRepo[]> {
  const { per_page = 30, page = 1, sort = 'newest' } = params;
  return request<GitHubRepo[]>(
    `/repos/${owner}/${repo}/forks?per_page=${per_page}&page=${page}&sort=${sort}`
  );
}

/** 获取仓库的 watch（watchers）用户列表 */
export async function getRepoWatchers(
  owner: string,
  repo: string,
  params: { per_page?: number; page?: number } = {}
): Promise<GitHubUser[]> {
  const { per_page = 30, page = 1 } = params;
  return request<GitHubUser[]>(
    `/repos/${owner}/${repo}/subscribers?per_page=${per_page}&page=${page}`
  );
}

/** 获取仓库的 Stargazers（收藏者）列表 */
export async function getRepoStargazers(
  owner: string,
  repo: string,
  params: { per_page?: number; page?: number } = {}
): Promise<GitHubUser[]> {
  const { per_page = 30, page = 1 } = params;
  return request<GitHubUser[]>(
    `/repos/${owner}/${repo}/stargazers?per_page=${per_page}&page=${page}`
  );
}

// ===== Actions Job 日志 =====

/**
 * 获取指定 Job 的日志文本。
 * GitHub 返回 302 重定向到真实日志 URL，此函数跟随重定向后返回纯文本。
 */
export async function getJobLogs(
  owner: string,
  repo: string,
  jobId: number
): Promise<string> {
  const url = `${BASE_URL}/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`;
  const headers = buildHeaders() as Record<string, string>;
  // GitHub 会重定向到实际日志地址
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`获取日志失败: ${res.status}`);
  return res.text();
}

// ===== PR Review Comment（行内评审评论）=====

export interface CreateReviewCommentParams {
  body: string;
  commit_id: string;
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
}

/** 创建 PR 行内 Review Comment */
export async function createPullRequestReviewComment(
  owner: string,
  repo: string,
  pullNumber: number,
  params: CreateReviewCommentParams
): Promise<GitHubComment> {
  return request<GitHubComment>(
    `/repos/${owner}/${repo}/pulls/${pullNumber}/comments`,
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}

/** 获取 PR 所有行内 Review Comments */
export async function getPullRequestReviewComments(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<GitHubComment[]> {
  return request<GitHubComment[]>(
    `/repos/${owner}/${repo}/pulls/${pullNumber}/comments?per_page=100`
  );
}

// ===== PR Submit Review（快速评审）=====

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface SubmitReviewParams {
  event: ReviewEvent;
  body?: string;
}

/** 提交 PR 评审（Approve / Request Changes / Comment） */
export async function submitPullRequestReview(
  owner: string,
  repo: string,
  pullNumber: number,
  params: SubmitReviewParams
): Promise<void> {
  await request(
    `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`,
    {
      method: 'POST',
      body: JSON.stringify({
        event: params.event,
        body: params.body ?? '',
      }),
    }
  );
}
