// GitHub Pull Request 接口。
import type { GitHubComment, GitHubFile, GitHubPullRequest, PrState, SortDirection } from '@/types/types';
import { request, requestWithPagination } from './core';

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
    fresh?: boolean;
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
    `/repos/${owner}/${repo}/pulls?${queryParams.toString()}`,
    params.fresh ? { cache: 'no-store' } : undefined
  );
}

/** 创建 Pull Request。 */
export async function createPullRequest(
  owner: string,
  repo: string,
  params: { title: string; head: string; head_repo?: string; base: string; body?: string; draft?: boolean }
): Promise<GitHubPullRequest> {
  return request<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: params.title,
      head: params.head,
      head_repo: params.head_repo,
      base: params.base,
      body: params.body ?? '',
      draft: params.draft ?? false,
    }),
  });
}

export async function getPullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  options?: { fresh?: boolean }
): Promise<GitHubPullRequest> {
  return request<GitHubPullRequest>(
    `/repos/${owner}/${repo}/pulls/${prNumber}`,
    options?.fresh ? { cache: 'no-store' } : undefined
  );
}

export function samePullRevision(left: GitHubPullRequest, right: GitHubPullRequest): boolean {
  return left.head.sha === right.head.sha && left.base.ref === right.base.ref && left.base.sha === right.base.sha;
}

export async function getPullRequestFiles(
  owner: string,
  repo: string,
  prNumber: number,
  page = 1
): Promise<{ data: GitHubFile[]; hasNextPage: boolean }> {
  return requestWithPagination<GitHubFile>(
    `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`,
    { cache: 'no-store' }
  );
}

export type PullMergeMethod = 'merge' | 'squash' | 'rebase';

export async function mergePullRequest(
  owner: string,
  repo: string,
  prNumber: number,
  params?: {
    commit_title?: string;
    commit_message?: string;
    merge_method?: PullMergeMethod;
    sha?: string;
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

export async function getPullRequestCommentsPage(
  owner: string,
  repo: string,
  prNumber: number,
  page = 1,
  signal?: AbortSignal,
): Promise<{ data: GitHubComment[]; hasNextPage: boolean }> {
  return requestWithPagination<GitHubComment>(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=50&page=${page}`,
    { signal },
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
