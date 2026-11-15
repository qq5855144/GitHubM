// AI V2 — GitHub Actions / Issues / Pull Requests 只读工具
import type { AgentTool, RepoContext, ToolRunResult, ToolRuntimeContext } from '../types';

const API = 'https://api.github.com';

function repoParts(repo?: RepoContext): { owner: string; name: string } {
  if (!repo?.fullName?.includes('/')) throw new Error('当前没有选择仓库');
  const [owner, name] = repo.fullName.split('/');
  return { owner, name };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

async function request(
  ctx: ToolRuntimeContext,
  path: string,
  accept = 'application/vnd.github+json',
): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: ctx.signal,
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = (JSON.parse(text) as { message?: string }).message || text;
    } catch {
      // ignore
    }
    throw new Error(`GitHub HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function requestText(ctx: ToolRuntimeContext, path: string): Promise<string> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: ctx.signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.text();
}

const listRuns: AgentTool = {
  name: 'github_list_workflow_runs',
  description: '列出当前仓库最近的 GitHub Actions 运行，包含 run ID、分支、状态和结论。排查构建失败时先用它定位 run。',
  parameters: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: '可选，只看某个分支' },
      status: {
        type: 'string',
        description: '可选：queued / in_progress / completed / success / failure / cancelled',
      },
      limit: { type: 'number', description: '返回数量，1-20，默认 10' },
    },
  },
  risk: 'read',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name } = repoParts(ctx.repo);
    const limit = clamp(args.limit, 1, 20, 10);
    const params = new URLSearchParams({ per_page: String(limit) });
    if (args.branch) params.set('branch', String(args.branch));
    if (args.status) params.set('status', String(args.status));
    const data = await request(ctx, `/repos/${owner}/${name}/actions/runs?${params}`) as {
      total_count?: number;
      workflow_runs?: Array<{
        id: number;
        name?: string;
        display_title?: string;
        head_branch?: string;
        event?: string;
        status?: string;
        conclusion?: string | null;
        created_at?: string;
        html_url?: string;
      }>;
    };
    const runs = data.workflow_runs || [];
    if (!runs.length) return { ok: true, content: '没有找到符合条件的 Actions 运行。' };
    return {
      ok: true,
      content: [
        `仓库：${ctx.repo?.fullName}`,
        `共 ${data.total_count ?? runs.length} 次运行，显示最近 ${runs.length} 次：`,
        '',
        ...runs.map(run => [
          `- run ${run.id} · ${run.name || 'workflow'} · ${run.display_title || ''}`.trim(),
          `  分支：${run.head_branch || '-'} · 事件：${run.event || '-'} · 状态：${run.status || '-'} / ${run.conclusion || '进行中'}`,
          `  时间：${run.created_at || '-'}`,
          run.html_url ? `  ${run.html_url}` : '',
        ].filter(Boolean).join('\n')),
      ].join('\n'),
    };
  },
};

const listJobs: AgentTool = {
  name: 'github_list_workflow_jobs',
  description: '列出一个 Actions run 下的所有 Job，包含 job ID、结论和失败步骤。获取 job ID 后可用 github_get_job_logs 读取完整日志。',
  parameters: {
    type: 'object',
    properties: {
      run_id: { type: 'number', description: 'Actions run ID' },
    },
    required: ['run_id'],
  },
  risk: 'read',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name } = repoParts(ctx.repo);
    const runId = Number(args.run_id);
    if (!Number.isFinite(runId)) throw new Error('run_id 必须是数字');
    const data = await request(ctx, `/repos/${owner}/${name}/actions/runs/${runId}/jobs?per_page=30`) as {
      total_count?: number;
      jobs?: Array<{
        id: number;
        name?: string;
        status?: string;
        conclusion?: string | null;
        started_at?: string;
        completed_at?: string;
        steps?: Array<{ name?: string; status?: string; conclusion?: string | null }>;
      }>;
    };
    const jobs = data.jobs || [];
    if (!jobs.length) return { ok: true, content: `run ${runId} 没有 Job。` };
    return {
      ok: true,
      content: [
        `run ${runId} · 共 ${jobs.length} 个 Job：`,
        '',
        ...jobs.map(job => {
          const failedSteps = (job.steps || []).filter(step => step.conclusion === 'failure');
          return [
            `- job ${job.id} · ${job.name || 'job'}`,
            `  状态：${job.status || '-'} / ${job.conclusion || '进行中'} · ${job.started_at || '-'} → ${job.completed_at || '-'}`,
            failedSteps.length ? `  失败步骤：${failedSteps.map(step => step.name).join('、')}` : '',
          ].filter(Boolean).join('\n');
        }),
      ].join('\n'),
    };
  },
};

const getJobLogs: AgentTool = {
  name: 'github_get_job_logs',
  description: '读取指定 Actions Job 的完整日志。日志较长时会由 Artifact Store 自动保存，可继续分页读取。',
  parameters: {
    type: 'object',
    properties: {
      job_id: { type: 'number', description: 'Actions job ID，可从 github_list_workflow_jobs 获取' },
    },
    required: ['job_id'],
  },
  risk: 'read',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name } = repoParts(ctx.repo);
    const jobId = Number(args.job_id);
    if (!Number.isFinite(jobId)) throw new Error('job_id 必须是数字');
    const text = await requestText(ctx, `/repos/${owner}/${name}/actions/jobs/${jobId}/logs`);
    if (!text.trim()) return { ok: true, content: `job ${jobId} 没有日志。` };
    return {
      ok: true,
      content: `job ${jobId} 日志（${text.length} 字符）：\n\n${text.slice(0, 30000)}`,
    };
  },
};

const listIssues: AgentTool = {
  name: 'github_list_issues',
  description: '列出当前仓库的 Issues，可按状态和标签筛选。会排除 Pull Request。',
  parameters: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'open / closed / all，默认 open' },
      labels: { type: 'string', description: '可选，逗号分隔标签' },
      limit: { type: 'number', description: '1-30，默认 10' },
    },
  },
  risk: 'read',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name } = repoParts(ctx.repo);
    const limit = clamp(args.limit, 1, 30, 10);
    const params = new URLSearchParams({
      state: String(args.state || 'open'),
      per_page: String(Math.min(30, limit * 2)),
    });
    if (args.labels) params.set('labels', String(args.labels));
    const data = await request(ctx, `/repos/${owner}/${name}/issues?${params}`) as Array<{
      number: number;
      title: string;
      state: string;
      user?: { login?: string };
      labels?: Array<{ name?: string } | string>;
      comments?: number;
      updated_at?: string;
      pull_request?: unknown;
    }>;
    const issues = data.filter(item => !item.pull_request).slice(0, limit);
    if (!issues.length) return { ok: true, content: '没有找到符合条件的 Issue。' };
    return {
      ok: true,
      content: [
        `仓库：${ctx.repo?.fullName}`,
        ...issues.map(issue => [
          `- #${issue.number} ${issue.title} [${issue.state}]`,
          `  作者：${issue.user?.login || '-'} · 评论：${issue.comments || 0} · 更新：${issue.updated_at || '-'}`,
          (issue.labels || []).length
            ? `  标签：${(issue.labels || []).map(label => typeof label === 'string' ? label : label.name).filter(Boolean).join('、')}`
            : '',
        ].filter(Boolean).join('\n')),
      ].join('\n'),
    };
  },
};

const listPulls: AgentTool = {
  name: 'github_list_pulls',
  description: '列出当前仓库的 Pull Request，包含编号、状态、草稿、来源分支和目标分支。',
  parameters: {
    type: 'object',
    properties: {
      state: { type: 'string', description: 'open / closed / all，默认 open' },
      limit: { type: 'number', description: '1-30，默认 10' },
    },
  },
  risk: 'read',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name } = repoParts(ctx.repo);
    const limit = clamp(args.limit, 1, 30, 10);
    const params = new URLSearchParams({
      state: String(args.state || 'open'),
      per_page: String(limit),
    });
    const data = await request(ctx, `/repos/${owner}/${name}/pulls?${params}`) as Array<{
      number: number;
      title: string;
      state: string;
      draft?: boolean;
      user?: { login?: string };
      head?: { ref?: string };
      base?: { ref?: string };
      updated_at?: string;
      mergeable_state?: string;
    }>;
    if (!data.length) return { ok: true, content: '没有找到符合条件的 Pull Request。' };
    return {
      ok: true,
      content: [
        `仓库：${ctx.repo?.fullName}`,
        ...data.map(pr => [
          `- #${pr.number} ${pr.title} [${pr.state}${pr.draft ? ' · draft' : ''}]`,
          `  作者：${pr.user?.login || '-'} · ${pr.head?.ref || '?'} → ${pr.base?.ref || '?'} · 更新：${pr.updated_at || '-'}`,
        ].join('\n')),
      ].join('\n'),
    };
  },
};

const getPull: AgentTool = {
  name: 'github_get_pull',
  description: '读取一个 Pull Request 的详细信息，包括描述、改动规模、合并状态和分支。',
  parameters: {
    type: 'object',
    properties: {
      number: { type: 'number', description: 'Pull Request 编号' },
    },
    required: ['number'],
  },
  risk: 'read',
  async execute(args, ctx): Promise<ToolRunResult> {
    const { owner, name } = repoParts(ctx.repo);
    const number = Number(args.number);
    if (!Number.isFinite(number)) throw new Error('number 必须是数字');
    const pr = await request(ctx, `/repos/${owner}/${name}/pulls/${number}`) as {
      number: number;
      title: string;
      state: string;
      draft?: boolean;
      body?: string;
      user?: { login?: string };
      head?: { ref?: string };
      base?: { ref?: string };
      additions?: number;
      deletions?: number;
      changed_files?: number;
      mergeable?: boolean | null;
      merged?: boolean;
      html_url?: string;
    };
    return {
      ok: true,
      content: [
        `#${pr.number} ${pr.title}`,
        `状态：${pr.state}${pr.draft ? ' · draft' : ''}${pr.merged ? ' · merged' : ''} · 作者：${pr.user?.login || '-'}`,
        `分支：${pr.head?.ref || '?'} → ${pr.base?.ref || '?'}`,
        `改动：+${pr.additions || 0} / -${pr.deletions || 0} · ${pr.changed_files || 0} 个文件`,
        `可合并：${pr.mergeable === null ? '计算中' : pr.mergeable ? '是' : '否'}`,
        pr.html_url ? `链接：${pr.html_url}` : '',
        '',
        pr.body ? pr.body.slice(0, 4000) : '（没有描述）',
      ].filter(Boolean).join('\n'),
    };
  },
};

export const GITHUB_OPS_TOOLS: AgentTool[] = [
  listRuns,
  listJobs,
  getJobLogs,
  listIssues,
  listPulls,
  getPull,
];