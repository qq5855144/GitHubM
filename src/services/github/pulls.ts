// GitHub Pull Request 接口。
import type { GitHubComment, GitHubPullRequest, PrState, SortDirection } from '@/types/types';
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

/** 创建 Pull Request（同仓库分支）。 */
export async function createPullRequest(
  owner: string,
  repo: string,
  params: { title: string; head: string; base: string; body?: string; draft?: boolean }
): Promise<GitHubPullRequest> {
  return request<GitHubPullRequest>(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: params.title,
      head: params.head,
      base: params.base,
      body: params.body ?? '',
      draft: params.draft ?? false,
    }),
  });
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
