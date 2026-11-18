// GitHub Gist 相关接口
import { request } from './core';

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
