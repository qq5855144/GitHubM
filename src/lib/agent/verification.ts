// 代码验证辅助逻辑：把 GitHub Checks 结果转成 Agent 可读的结论，
// 并判断一次修改是否属于“需要验证”的代码变更。

export interface CheckRunLike {
  name?: string;
  status?: string | null;
  conclusion?: string | null;
  html_url?: string;
  output?: {
    title?: string | null;
    summary?: string | null;
    annotations_count?: number;
  };
}

export type VerificationState = 'passed' | 'failed' | 'pending' | 'none';

export interface CheckSummary {
  state: VerificationState;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  failedNames: string[];
  pendingNames: string[];
}

const FAILED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
]);

/** 汇总 check-runs 列表 */
export function summarizeCheckRuns(runs: CheckRunLike[]): CheckSummary {
  const total = runs.length;
  let passed = 0;
  let failed = 0;
  let pending = 0;
  const failedNames: string[] = [];
  const pendingNames: string[] = [];

  for (const run of runs) {
    const name = run.name ?? 'unnamed-check';
    if (run.status !== 'completed') {
      pending++;
      pendingNames.push(name);
      continue;
    }
    if (run.conclusion && FAILED_CONCLUSIONS.has(run.conclusion)) {
      failed++;
      failedNames.push(name);
      continue;
    }
    // success / neutral / skipped 都视为未阻塞
    passed++;
  }

  let state: VerificationState = 'passed';
  if (total === 0) state = 'none';
  else if (failed > 0) state = 'failed';
  else if (pending > 0) state = 'pending';

  return { state, total, passed, failed, pending, failedNames, pendingNames };
}

/** 汇总旧版 commit status API */
export function summarizeCommitStatus(status: {
  state?: string;
  statuses?: Array<{ context?: string; state?: string; description?: string }>;
}): CheckSummary {
  const list = status.statuses ?? [];
  const failedNames = list
    .filter((s) => s.state === 'failure' || s.state === 'error')
    .map((s) => s.context ?? 'status');
  const pendingNames = list
    .filter((s) => s.state === 'pending')
    .map((s) => s.context ?? 'status');
  const total = list.length;
  const failed = failedNames.length;
  const pending = pendingNames.length;
  const passed = Math.max(0, total - failed - pending);

  let state: VerificationState = 'passed';
  if (total === 0) state = 'none';
  else if (status.state === 'failure' || failed > 0) state = 'failed';
  else if (status.state === 'pending' || pending > 0) state = 'pending';

  return { state, total, passed, failed, pending, failedNames, pendingNames };
}

/** 生成给模型看的检查报告 */
export function formatCheckSummary(
  summary: CheckSummary,
  meta: { ref: string; sha: string; elapsedMs: number }
): string {
  const head = [
    `分支：${meta.ref}`,
    `提交：${meta.sha.slice(0, 7)}`,
    `检查：${summary.total} 项（通过 ${summary.passed} / 失败 ${summary.failed} / 进行中 ${summary.pending}）`,
    `耗时：${Math.round(meta.elapsedMs / 1000)}s`,
  ].join('\n');

  if (summary.state === 'passed') {
    return `✅ VERIFY_PASSED\n${head}`;
  }
  if (summary.state === 'failed') {
    return `❌ VERIFY_FAILED\n${head}\n失败项：${summary.failedNames.join('、') || '未知'}`;
  }
  if (summary.state === 'pending') {
    return `⏳ VERIFY_PENDING\n${head}\n进行中：${summary.pendingNames.join('、') || '未知'}`;
  }
  return `⚠️ VERIFY_NO_CHECKS\n${head}\n该提交没有配置 GitHub Checks / Status。`;
}

const DOC_EXTENSIONS = new Set(['md', 'mdx', 'txt', 'rst', 'adoc']);

/**
 * 判断修改文件是否需要代码验证。
 * 文档类变更不强制；无扩展名（如 Makefile、Dockerfile）和代码文件都要求。
 */
export function requiresVerification(paths: string[]): boolean {
  if (paths.length === 0) return false;
  return paths.some((path) => {
    const clean = path.split('?')[0].split('#')[0];
    const name = clean.split('/').pop() ?? clean;
    const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : '';
    if (!ext) return true;
    return !DOC_EXTENSIONS.has(ext);
  });
}

/** 从工具参数中提取被修改的文件路径（兼容本地工具与 MCP 工具） */
export function extractChangedPaths(toolName: string, args: Record<string, unknown>): string[] {
  const paths = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) paths.add(value.trim());
  };

  add(args.path);
  add(args.file_path);

  const patches = args.patches;
  if (Array.isArray(patches)) {
    for (const patch of patches) {
      if (patch && typeof patch === 'object') add((patch as Record<string, unknown>).path);
    }
  } else if (typeof patches === 'string') {
    try {
      const parsed = JSON.parse(patches);
      if (Array.isArray(parsed)) {
        for (const patch of parsed) {
          if (patch && typeof patch === 'object') add((patch as Record<string, unknown>).path);
        }
      }
    } catch {
      // 忽略非 JSON 字符串
    }
  }

  const files = args.files;
  if (Array.isArray(files)) {
    for (const file of files) {
      if (file && typeof file === 'object') add((file as Record<string, unknown>).path);
    }
  }

  if (paths.size === 0 && /write|patch|replace|push_files|create_or_update_file/i.test(toolName)) {
    paths.add('<batch>');
  }
  return [...paths];
}

export function buildVerificationNudge(files: string[], branch: string, attempt: number): string {
  return [
    `⚠️ 代码验证未完成（第 ${attempt} 次提醒）。`,
    `你刚刚修改了：${files.slice(0, 8).join('、')}${files.length > 8 ? ' 等' : ''}`,
    `目标分支：${branch}`,
    `在输出 TASK_DONE 之前，必须调用 verify_changes 检查该分支最新提交的 GitHub Checks / Actions 结果。`,
    `如果验证失败，请读取失败日志并修复，然后再次验证。`,
    `工具调用示例：{"tool":"verify_changes","branch":"${branch}","wait_seconds":"90"}`,
  ].join('\n');
}