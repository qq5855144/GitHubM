// GitHub REST API 服务层

import type {
  GitHubUser,
  GitHubRepo,
  GitHubIssue,
  GitHubComment,
  GitHubPullRequest,
  GitHubCommit,
  GitHubFile,
  GitHubBranch,
  GitHubCollaborator,
  GitHubNotification,
  GitHubContent,
  GitHubRateLimit,
  GitHubSearchResult,
  GitHubEvent,
  GitHubLabel,
  GitHubMilestone,
  GitHubEmail,
  GitHubSshKey,
  GitHubGpgKey,
  IssueState,
  IssueSortField,
  PrState,
  RepoSortField,
  SortDirection,
} from '@/types/types';
import i18n from "@/i18n";
import { createHttpError, fetchWithResilience } from '@/services/github/http';
import { BASE_URL, buildCacheKey, buildHeaders, getCached, getToken, invalidateAndBust, request, requestWithPagination, setCached } from '@/services/github/core';
export {
  buildCacheKey,
  getCached,
  getCacheEntry,
  touchCached,
  setCached,
  invalidateCache,
  clearApiCache,
  getOrCreateInFlight,
  setToken,
  getToken,
} from '@/services/github/core';
export { formatRelativeTime, formatNumber, getLanguageColor } from '@/services/github/format';
export * from '@/services/github/gists';
export * from '@/services/github/actions';
export * from '@/services/github/issues';
export * from '@/services/github/pulls';
import type { GitHubArtifact } from '@/services/github/actions';

// ===== 用户 API =====

export async function getCurrentUser(tokenOverride?: string): Promise<GitHubUser> {
  return request<GitHubUser>('/user', tokenOverride === undefined
    ? undefined
    : { cache: 'no-store', headers: { Authorization: `Bearer ${tokenOverride}` } });
}

export async function getUserByLogin(login: string): Promise<GitHubUser> {
  return request<GitHubUser>(`/users/${login}`);
}

/** 获取指定用户的公开仓库（用户主页用；按更新时间倒序） */
export async function getUserPublicRepos(
  login: string,
  params: { per_page?: number; page?: number; sort?: 'created' | 'updated' | 'pushed' | 'full_name' } = {}
): Promise<{ data: GitHubRepo[]; hasNextPage: boolean }> {
  const { per_page = 30, page = 1, sort = 'updated' } = params;
  return requestWithPagination<GitHubRepo>(
    `/users/${encodeURIComponent(login)}/repos?sort=${sort}&direction=desc&type=owner&per_page=${per_page}&page=${page}`
  );
}

export type GithubTokenType = 'classic' | 'fine-grained' | 'oauth' | 'unknown';

export interface TokenMetadata {
  login: string | null;
  tokenType: GithubTokenType;
  /** 当前 Token 实际拥有的 scope（classic PAT / OAuth 有效） */
  scopes: string[];
  /** 该接口可接受的 scope（GitHub 返回的 x-accepted-oauth-scopes） */
  acceptedScopes: string[];
  /** Token 过期时间（fine-grained / 部分 OAuth 会返回） */
  expiresAt: string | null;
  /** 距离过期天数；已过期或未知为 null */
  daysUntilExpiry: number | null;
  rateLimit: {
    limit: number;
    remaining: number;
    reset: number;
  } | null;
}

function parseScopeHeader(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function detectTokenType(token: string): GithubTokenType {
  if (token.startsWith('github_pat_')) return 'fine-grained';
  if (token.startsWith('ghp_')) return 'classic';
  if (token.startsWith('gho_') || token.startsWith('ghu_') || token.startsWith('ghs_')) return 'oauth';
  return 'unknown';
}

/**
 * 读取 Token 元信息：账号、类型、作用域、过期时间、速率限制。
 *
 * 注意：GitHub 没有「列出/创建 PAT」的公开 API（这是平台限制，不是本应用缺失）。
 * 能做的只有：验证当前 Token、读取它自身的作用域/过期时间/额度，并管理本机保存的 Token。
 */
export async function getTokenMetadata(tokenOverride?: string): Promise<TokenMetadata> {
  const token = tokenOverride ?? getToken() ?? '';
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}/user`, { headers });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  const user = (await response.json()) as GitHubUser;
  const expiresAt = response.headers.get('github-authentication-token-expiration');
  const expiresMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;

  return {
    login: user.login,
    tokenType: detectTokenType(token),
    scopes: parseScopeHeader(response.headers.get('x-oauth-scopes')),
    acceptedScopes: parseScopeHeader(response.headers.get('x-accepted-oauth-scopes')),
    expiresAt: expiresAt || null,
    daysUntilExpiry: Number.isNaN(expiresMs)
      ? null
      : Math.ceil((expiresMs - Date.now()) / (24 * 60 * 60 * 1000)),
    rateLimit: {
      limit: Number(response.headers.get('x-ratelimit-limit') || 0),
      remaining: Number(response.headers.get('x-ratelimit-remaining') || 0),
      reset: Number(response.headers.get('x-ratelimit-reset') || 0),
    },
  };
}

export async function getRateLimit(): Promise<{ rate: GitHubRateLimit }> {
  return request<{ rate: GitHubRateLimit }>('/rate_limit');
}

export async function getUserEvents(
  login: string,
  page = 1
): Promise<GitHubEvent[]> {
  const events = await request<GitHubEvent[]>(
    `/users/${login}/events?per_page=30&page=${page}`
  );
  // GitHub Events API 偶尔不按时间排序；统一按时间倒序，确保最新活动在最前。
  return [...events].sort(
    (a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)
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

export interface MergeUpstreamResult {
  message: string;
  merge_type: 'merge' | 'fast-forward' | 'none';
  base_branch: string;
}

/**
 * 同步 Fork 上游（Sync Fork）
 * 对应 GitHub「Fetch upstream」：把上游默认分支合并到当前 Fork 的指定分支。
 * 409 表示存在合并冲突，需要到 GitHub 网页端处理。
 */
export async function syncFork(
  owner: string,
  repo: string,
  branch: string
): Promise<MergeUpstreamResult> {
  return request<MergeUpstreamResult>(`/repos/${owner}/${repo}/merge-upstream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  });
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

export async function getCommits(
  owner: string,
  repo: string,
  params: {
    sha?: string;
    per_page?: number;
    page?: number;
    author?: string;
    path?: string;
  } = {}
): Promise<{ data: GitHubCommit[]; hasNextPage: boolean }> {
  const { sha, per_page = 30, page = 1, author, path } = params;
  const queryParams = new URLSearchParams({
    per_page: String(per_page),
    page: String(page),
  });
  if (sha) queryParams.set('sha', sha);
  if (author) queryParams.set('author', author);
  if (path) queryParams.set('path', path);

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
  page = 1,
  perPage = 30
): Promise<{ data: GitHubBranch[]; hasNextPage: boolean }> {
  return requestWithPagination<GitHubBranch>(
    `/repos/${owner}/${repo}/branches?per_page=${perPage}&page=${page}`
  );
}

/**
 * 拉取仓库全部分支。
 * branches API 默认每页 30 个，仓库分支较多时 main 可能不在第一页。
 */
export async function getAllBranches(
  owner: string,
  repo: string
): Promise<GitHubBranch[]> {
  const all: GitHubBranch[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 20; page += 1) {
    const result = await getBranches(owner, repo, page, 100);
    for (const branch of result.data) {
      if (seen.has(branch.name)) continue;
      seen.add(branch.name);
      all.push(branch);
    }
    if (!result.hasNextPage || result.data.length === 0) break;
  }
  return all;
}

// ===== Actions Secrets / Variables API =====

export interface GitHubActionsSecretInfo {
  name: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubActionsVariableInfo {
  name: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubActionsPublicKey {
  key_id: string;
  key: string;
}

export async function getRepoActionsSecrets(
  owner: string,
  repo: string
): Promise<GitHubActionsSecretInfo[]> {
  const all: GitHubActionsSecretInfo[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 20; page += 1) {
    const result = await request<{
      total_count: number;
      secrets: GitHubActionsSecretInfo[];
    }>(`/repos/${owner}/${repo}/actions/secrets?per_page=100&page=${page}`);
    for (const secret of result.secrets ?? []) {
      if (seen.has(secret.name)) continue;
      seen.add(secret.name);
      all.push(secret);
    }
    if ((result.secrets?.length ?? 0) < 100) break;
  }
  return all;
}

export async function getRepoActionsPublicKey(
  owner: string,
  repo: string
): Promise<GitHubActionsPublicKey> {
  return request<GitHubActionsPublicKey>(`/repos/${owner}/${repo}/actions/secrets/public-key`);
}

export async function putRepoActionsSecret(
  owner: string,
  repo: string,
  name: string,
  encryptedValue: string,
  keyId: string
): Promise<void> {
  await request<void>(`/repos/${owner}/${repo}/actions/secrets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function deleteRepoActionsSecret(
  owner: string,
  repo: string,
  name: string
): Promise<void> {
  await request<void>(`/repos/${owner}/${repo}/actions/secrets/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

export async function getRepoActionsVariables(
  owner: string,
  repo: string
): Promise<GitHubActionsVariableInfo[]> {
  const all: GitHubActionsVariableInfo[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 20; page += 1) {
    const result = await request<{
      total_count: number;
      variables: GitHubActionsVariableInfo[];
    }>(`/repos/${owner}/${repo}/actions/variables?per_page=100&page=${page}`);
    for (const variable of result.variables ?? []) {
      if (seen.has(variable.name)) continue;
      seen.add(variable.name);
      all.push(variable);
    }
    if ((result.variables?.length ?? 0) < 100) break;
  }
  return all;
}

export async function createRepoActionsVariable(
  owner: string,
  repo: string,
  name: string,
  value: string
): Promise<void> {
  await request<void>(`/repos/${owner}/${repo}/actions/variables`, {
    method: 'POST',
    body: JSON.stringify({ name, value }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function updateRepoActionsVariable(
  owner: string,
  repo: string,
  name: string,
  value: string
): Promise<void> {
  await request<void>(`/repos/${owner}/${repo}/actions/variables/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, value }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function deleteRepoActionsVariable(
  owner: string,
  repo: string,
  name: string
): Promise<void> {
  await request<void>(`/repos/${owner}/${repo}/actions/variables/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

export interface GitHubTagRef {
  name: string;
  commit: { sha: string; url: string };
  zipball_url?: string;
  tarball_url?: string;
}

export async function getTags(
  owner: string,
  repo: string,
  perPage = 100
): Promise<GitHubTagRef[]> {
  return request<GitHubTagRef[]>(`/repos/${owner}/${repo}/tags?per_page=${perPage}`);
}

export async function getBranch(
  owner: string,
  repo: string,
  branch: string,
  signal?: AbortSignal,
): Promise<GitHubBranch> {
  return request<GitHubBranch>(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, { signal });
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
  head: string,
  options?: { fresh?: boolean }
): Promise<{
  ahead_by: number;
  behind_by: number;
  status: string;
  commits: GitHubCommit[];
  files?: GitHubFile[];
}> {
  return request<{
    ahead_by: number;
    behind_by: number;
    status: string;
    commits: GitHubCommit[];
    files?: GitHubFile[];
  }>(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    options?.fresh ? { cache: 'no-store' } : undefined);
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
  done?: boolean;
  participating?: boolean;
  per_page?: number;
  page?: number;
  before?: string;
} = {}, options: { fresh?: boolean; signal?: AbortSignal } = {}): Promise<{ data: GitHubNotification[]; hasNextPage: boolean }> {
  const { all = false, done = false, participating = false, per_page = 50, page = 1, before } = params;
  const query = new URLSearchParams({ all: String(all || done), is_done: String(done),
    participating: String(participating), per_page: String(per_page), page: String(page) });
  if (before) query.set('before', before);
  return requestWithPagination<GitHubNotification>(
    `/notifications?${query}`, { cache: options.fresh ? 'no-store' : undefined, signal: options.signal },
  );
}

// 通知写接口可能返回空响应，直接检查状态码，避免把 205/304 误报为 JSON 解析失败。
async function updateNotifications(path: string, method: 'PATCH' | 'PUT' | 'DELETE', body?: { last_read_at: string; read: true }): Promise<number> {
  const response = await fetchWithResilience(`${BASE_URL}${path}`, {
    method,
    headers: { ...buildHeaders(), ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  }, method);
  if (!response.ok && response.status !== 304) throw await createHttpError(response);
  invalidateAndBust('/notifications');
  return response.status;
}

export async function markNotificationRead(threadId: string): Promise<void> {
  await updateNotifications(`/notifications/threads/${encodeURIComponent(threadId)}`, 'PATCH');
}

export async function deleteNotification(threadId: string): Promise<void> {
  await updateNotifications(`/notifications/threads/${encodeURIComponent(threadId)}`, 'DELETE');
}

export async function markAllNotificationsRead(lastReadAt?: string): Promise<'completed' | 'pending'> {
  const status = await updateNotifications('/notifications', 'PUT',
    lastReadAt ? { last_read_at: lastReadAt, read: true } : undefined);
  return status === 202 ? 'pending' : 'completed';
}

// ===== 内容/代码浏览 API =====

export async function getRepoContents(
  owner: string,
  repo: string,
  path = '',
  ref?: string,
  options: { fresh?: boolean } = {},
): Promise<GitHubContent | GitHubContent[]> {
  const queryParams = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const encodedPath = path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : '';
  return request<GitHubContent | GitHubContent[]>(
    `/repos/${owner}/${repo}/contents${encodedPath}${queryParams}`,
    options.fresh ? { cache: 'no-store' } : undefined,
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
  params: {
    sort?: 'stars' | 'forks' | 'updated' | 'help-wanted-issues';
    order?: SortDirection;
    per_page?: number;
    page?: number;
  } = {}
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
  params: {
    sort?: 'created' | 'updated' | 'comments' | 'reactions' | 'interactions';
    order?: SortDirection;
    per_page?: number;
    page?: number;
  } = {},
  signal?: AbortSignal,
): Promise<GitHubSearchResult<GitHubIssue>> {
  const { sort, order = 'desc', per_page = 20, page = 1 } = params;
  const q = encodeURIComponent(query);
  const sortQS = sort ? `&sort=${sort}&order=${order}` : '';
  return request<GitHubSearchResult<GitHubIssue>>(
    `/search/issues?q=${q}${sortQS}&per_page=${per_page}&page=${page}`, { signal }
  );
}

export async function searchUsers(
  query: string,
  params: {
    sort?: 'followers' | 'repositories' | 'joined';
    order?: SortDirection;
    per_page?: number;
    page?: number;
  } = {}
): Promise<GitHubSearchResult<GitHubUser>> {
  const { sort, order = 'desc', per_page = 20, page = 1 } = params;
  const q = encodeURIComponent(query);
  const sortQS = sort ? `&sort=${sort}&order=${order}` : '';
  return request<GitHubSearchResult<GitHubUser>>(
    `/search/users?q=${q}${sortQS}&per_page=${per_page}&page=${page}`
  );
}

export async function searchCode(
  query: string,
  params: {
    sort?: 'indexed';
    order?: SortDirection;
    per_page?: number;
    page?: number;
  } = {}
): Promise<GitHubSearchResult<{
  name: string;
  path: string;
  sha: string;
  html_url: string;
  repository: GitHubRepo;
  score: number;
}>> {
  const { sort, order = 'desc', per_page = 20, page = 1 } = params;
  const q = encodeURIComponent(query);
  const sortQS = sort ? `&sort=${sort}&order=${order}` : '';
  return request<GitHubSearchResult<{
    name: string;
    path: string;
    sha: string;
    html_url: string;
    repository: GitHubRepo;
    score: number;
  }>>(`/search/code?q=${q}${sortQS}&per_page=${per_page}&page=${page}`);
}

// ===== 文件写入 =====
export async function updateFileContent(
  owner: string,
  repo: string,
  path: string,
  data: { message: string; content: string; sha: string; branch?: string }
): Promise<{ content: GitHubContent }> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return request<{ content: GitHubContent }>(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
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
  url: string;
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

export async function createRelease(
  owner: string,
  repo: string,
  data: {
    tag_name: string;
    name?: string;
    body?: string;
    draft?: boolean;
    prerelease?: boolean;
    target_commitish?: string;
  }
): Promise<GitHubRelease> {
  return request<GitHubRelease>(`/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
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
  recursive = false,
  signal?: AbortSignal,
): Promise<{ sha: string; truncated: boolean; tree: GitTreeItem[] }> {
  const q = recursive ? '?recursive=1' : '';
  return request<{ sha: string; truncated: boolean; tree: GitTreeItem[] }>(
    `/repos/${owner}/${repo}/git/trees/${treeSha}${q}`, { signal }
  );
}

/** 读取 Git blob（base64）；走 api.github.com，避免 raw.githubusercontent.com 的 CORS 预检限制 */
export async function getGitBlob(
  owner: string,
  repo: string,
  sha: string
): Promise<{ sha: string; size: number; encoding: string; content: string }> {
  return request(`/repos/${owner}/${repo}/git/blobs/${sha}`);
}

/** Stream bytes without caching or decoding a JSON/Base64 blob. */
export async function getGitBlobRaw(
  owner: string,
  repo: string,
  sha: string,
  token: string,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetchWithResilience(
    `${BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(sha)}`,
    {
      signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
    'GET',
  );
  if (!response.ok) throw await createHttpError(response);
  return response;
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

type StarredResponse = GitHubRepo | { repo: GitHubRepo; starred_at?: string };

export async function getAllStarredRepos(
  sort: 'created' | 'updated' = 'created',
  direction: 'asc' | 'desc' = 'desc',
  onFirstPage?: (repos: GitHubRepo[]) => void,
  signal?: AbortSignal,
): Promise<GitHubRepo[]> {
  const repos = new Map<number, GitHubRepo>();
  let page = 1;
  let more = true;
  while (more) {
    const result = await requestWithPagination<StarredResponse>(
      `/user/starred?per_page=100&page=${page}&sort=${sort}&direction=${direction}`,
      { signal, cache: 'no-store', headers: { Accept: 'application/vnd.github.star+json' } },
    );
    for (const item of result.data) {
      const repo = 'repo' in item ? { ...item.repo, starred_at: item.starred_at } : item;
      repos.set(repo.id, repo);
    }
    if (page === 1) onFirstPage?.([...repos.values()]);
    more = result.hasNextPage && result.data.length > 0;
    page++;
  }
  return [...repos.values()];
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
  commit_id?: string;
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
        commit_id: params.commit_id,
      }),
    }
  );
}

// ===== 账号级操作（Account）=====
// 说明：GitHub 官方 API 不提供「列出 / 创建 Personal Access Token」的接口。
// 因此本应用的 Token 管理 = 本机保存的 Token 管理（验证 / 标签 / 作用域 / 过期 / 删除）
// + 真正可用的账号级操作（资料、邮箱、SSH/GPG 密钥）。

/** 当前登录用户的邮箱列表（需要 user:email scope） */
export async function getEmails(): Promise<GitHubEmail[]> {
  return request<GitHubEmail[]>('/user/emails');
}

/** 添加邮箱（需要 user:email scope） */
export async function addEmail(email: string): Promise<GitHubEmail> {
  return request<GitHubEmail>('/user/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails: [email] }),
  });
}

/** 设置主邮箱 / 可见性（需要 user:email scope） */
export async function updateEmail(
  email: string,
  patch: { primary?: boolean; visibility?: 'public' | 'private' }
): Promise<GitHubEmail> {
  return request<GitHubEmail>('/user/emails', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, ...patch }),
  });
}

/** 删除邮箱（需要 user:email scope） */
export async function deleteEmail(email: string): Promise<void> {
  await request<void>('/user/emails', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails: [email] }),
  });
}

/** SSH 公钥列表（需要 read:public_key scope） */
export async function getSshKeys(): Promise<GitHubSshKey[]> {
  return request<GitHubSshKey[]>('/user/keys');
}

/** 添加 SSH 公钥（需要 write:public_key scope） */
export async function addSshKey(title: string, key: string): Promise<GitHubSshKey> {
  return request<GitHubSshKey>('/user/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, key }),
  });
}

/** 删除 SSH 公钥（需要 write:public_key scope） */
export async function deleteSshKey(id: number): Promise<void> {
  await request<void>(`/user/keys/${id}`, { method: 'DELETE' });
}

/** GPG 公钥列表（需要 read:gpg_key scope） */
export async function getGpgKeys(): Promise<GitHubGpgKey[]> {
  return request<GitHubGpgKey[]>('/user/gpg_keys');
}

/** 添加 GPG 公钥（需要 write:gpg_key scope） */
export async function addGpgKey(armoredPublicKey: string): Promise<GitHubGpgKey> {
  return request<GitHubGpgKey>('/user/gpg_keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ armored_public_key: armoredPublicKey }),
  });
}

/** 删除 GPG 公钥（需要 write:gpg_key scope） */
export async function deleteGpgKey(id: number): Promise<void> {
  await request<void>(`/user/gpg_keys/${id}`, { method: 'DELETE' });
}

/** 当前用户已屏蔽的用户列表（需要 user scope） */
export async function getBlockedUsers(): Promise<GitHubUser[]> {
  return request<GitHubUser[]>('/user/blocks');
}

/** 屏蔽用户（需要 user scope） */
export async function blockUser(login: string): Promise<void> {
  await request<void>(`/user/blocks/${encodeURIComponent(login)}`, { method: 'PUT' });
}

/** 取消屏蔽用户（需要 user scope） */
export async function unblockUser(login: string): Promise<void> {
  await request<void>(`/user/blocks/${encodeURIComponent(login)}`, { method: 'DELETE' });
}

// ===== 提交撤销 / 分支回滚 =====

interface GitCommitDetail {
  sha: string;
  commit: {
    message: string;
    tree: { sha: string };
    parents: Array<{ sha: string }>;
  };
  files?: Array<{
    filename: string;
    previous_filename?: string;
    status: string;
  }>;
}

interface GitTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string | null;
}

async function getCommitDetail(owner: string, repo: string, sha: string): Promise<GitCommitDetail> {
  return request<GitCommitDetail>(`/repos/${owner}/${repo}/commits/${sha}`);
}

/**
 * 撤销某个提交：用 Git Data API 生成一个反向提交。
 * 将该提交涉及的文件恢复到其父提交的状态，不重写历史。
 */
export async function revertCommit(
  owner: string,
  repo: string,
  branch: string,
  sha: string,
): Promise<{ sha: string }> {
  const target = await getCommitDetail(owner, repo, sha);
  const parentSha = target.commit.parents[0]?.sha;
  if (!parentSha) throw new Error('根提交没有父提交，无法撤销');
  if (!target.files?.length) throw new Error('该提交没有可撤销的文件变更');

  const current = await getCommitDetail(owner, repo, (await getBranch(owner, repo, branch)).commit.sha);
  const parent = await getCommitDetail(owner, repo, parentSha);
  const parentTree = await getGitTree(owner, repo, parent.commit.tree.sha, true);
  if (parentTree.truncated) throw new Error('仓库文件树过大，GitHub 返回了截断结果，暂无法安全撤销');
  const parentMap = new Map(parentTree.tree.map(item => [item.path, item]));
  const changes = new Map<string, GitTreeEntry>();

  const restore = (path: string) => {
    const entry = parentMap.get(path);
    if (!entry) throw new Error(`父提交中找不到文件：${path}`);
    changes.set(path, { path, mode: entry.mode, type: entry.type, sha: entry.sha });
  };
  const remove = (path: string) => {
    changes.set(path, { path, mode: '100644', type: 'blob', sha: null });
  };

  for (const file of target.files) {
    const oldPath = file.previous_filename || file.filename;
    if (file.status !== 'added') restore(oldPath);
    if (file.status === 'added' || oldPath !== file.filename) remove(file.filename);
  }

  const treeEntries = [...changes.values()];
  if (!treeEntries.length) throw new Error('该提交没有可撤销的文件变更');
  const newTree = await request<{ sha: string }>(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: current.commit.tree.sha, tree: treeEntries }),
  });
  const message = `Revert "${target.commit.message.split('\n')[0]}"`;
  const newCommit = await request<{ sha: string }>(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, tree: newTree.sha, parents: [current.sha] }),
  });
  await request(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: newCommit.sha, force: false }),
  });
  return { sha: newCommit.sha };
}

/** 回滚分支到指定提交（force update，历史会被移动） */
export async function rollbackBranchToCommit(
  owner: string,
  repo: string,
  branch: string,
  sha: string,
): Promise<void> {
  await request(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha, force: true }),
  });
}
