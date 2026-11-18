// GitHub Issue 接口。
import type { GitHubComment, GitHubIssue, GitHubLabel, GitHubMilestone, GitHubUser, IssueSortField, IssueState, SortDirection } from '@/types/types';
import { request, requestWithPagination } from './core';

export async function getIssues(
  owner: string,
  repo: string,
  params: {
    state?: IssueState | 'all';
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

export async function getIssueCommentsPage(
  owner: string,
  repo: string,
  issueNumber: number,
  page = 1,
  perPage = 50
): Promise<{ data: GitHubComment[]; hasNextPage: boolean }> {
  return requestWithPagination<GitHubComment>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=${perPage}&page=${page}`
  );
}
export async function updateIssueComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string
): Promise<GitHubComment> {
  return request<GitHubComment>(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
    headers: { 'Content-Type': 'application/json' },
  });
}
export async function deleteIssueComment(
  owner: string,
  repo: string,
  commentId: number
): Promise<void> {
  await request<void>(`/repos/${owner}/${repo}/issues/comments/${commentId}`, {
    method: 'DELETE',
  });
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

export async function getRepoAssignees(
  owner: string,
  repo: string
): Promise<GitHubUser[]> {
  return request<GitHubUser[]>(`/repos/${owner}/${repo}/assignees?per_page=100`);
}
export async function getRepoMilestones(
  owner: string,
  repo: string
): Promise<GitHubMilestone[]> {
  return request<GitHubMilestone[]>(`/repos/${owner}/${repo}/milestones?per_page=100`);
}

// ===== Pull Request API =====
