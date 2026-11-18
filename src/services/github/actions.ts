// GitHub Actions 工作流、运行与产物接口。
import { request } from './core';

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

export async function getWorkflows(
  owner: string,
  repo: string
): Promise<{ total_count: number; workflows: import('@/types/types').GitHubWorkflow[] }> {
  const workflows: import('@/types/types').GitHubWorkflow[] = [];
  let page = 1;
  let total = 0;
  // GitHub 默认每页 30 条；必须分页拉取，否则工作流较多时会漏项。
  while (page <= 10) {
    const res = await request<{ total_count: number; workflows: import('@/types/types').GitHubWorkflow[] }>(
      `/repos/${owner}/${repo}/actions/workflows?per_page=100&page=${page}`
    );
    total = Number(res.total_count ?? 0);
    workflows.push(...(res.workflows ?? []));
    if ((res.workflows?.length ?? 0) < 100 || workflows.length >= total) break;
    page++;
  }
  return { total_count: total, workflows };
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

export async function enableWorkflow(
  owner: string,
  repo: string,
  workflowId: number | string
): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/enable`, {
    method: 'PUT',
  });
}

export async function disableWorkflow(
  owner: string,
  repo: string,
  workflowId: number | string
): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/disable`, {
    method: 'PUT',
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

export async function rerunFailedWorkflowRun(
  owner: string,
  repo: string,
  runId: number
): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs`, {
    method: 'POST',
  });
}

export async function rerunWorkflowJob(
  owner: string,
  repo: string,
  jobId: number
): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/actions/jobs/${jobId}/rerun`, {
    method: 'POST',
  });
}

export async function getWorkflowRunJobs(
  owner: string,
  repo: string,
  runId: number
): Promise<{ total_count: number; jobs: import('@/types/types').GitHubWorkflowJob[] }> {
  return request(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`);
}

export async function getRunArtifacts(
  owner: string,
  repo: string,
  runId: number
): Promise<{ total_count: number; artifacts: GitHubArtifact[] }> {
  return request<{ total_count: number; artifacts: GitHubArtifact[] }>(
    `/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`
  );
}

export interface GitHubPendingDeployment {
  environment: { id: number; name: string; url?: string };
  wait_timer?: number;
  current_user_can_approve: boolean;
  reviewers?: Array<{ type: string; reviewer: { login?: string; name?: string } }>;
}

export async function getPendingDeployments(
  owner: string,
  repo: string,
  runId: number
): Promise<GitHubPendingDeployment[]> {
  return request<GitHubPendingDeployment[]>(
    `/repos/${owner}/${repo}/actions/runs/${runId}/pending_deployments`
  );
}

export async function reviewPendingDeployments(
  owner: string,
  repo: string,
  runId: number,
  environmentIds: number[],
  state: 'approved' | 'rejected',
  comment = ''
): Promise<void> {
  await request<unknown>(`/repos/${owner}/${repo}/actions/runs/${runId}/pending_deployments`, {
    method: 'POST',
    body: JSON.stringify({ environment_ids: environmentIds, state, comment }),
  });
}

// ===== GitHub Packages =====
