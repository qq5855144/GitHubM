// Agent 工具策略：风险分级、参数校验、结果裁剪
//
// 目标：把「工具能不能调、参数对不对、结果会不会撑爆上下文」
// 从 Agent 主循环里抽出来，便于 UI 审批、测试和后续替换执行器。

export type ToolRisk = 'read' | 'write' | 'dangerous';

const READ_TOOLS = new Set([
  'read_file',
  'read_function',
  'get_code_outline',
  'get_file_info',
  'list_files',
  'file_tree',
  'batch_read',
  'grep_in_file',
  'grep_in_repo',
  'search_code',
  'search_npm_packages',
  'list_branches',
  'list_commits',
  'list_pull_requests',
  'list_issues',
  'get_issue_details',
  'get_pr_files',
  'get_commit_diff',
  'compare_commits',
  'list_workflows',
  'get_workflow_runs',
  'get_run_jobs',
  'get_job_logs',
  'check_run_status',
  'list_actions_secrets',
  'list_actions_variables',
  'list_releases',
  'get_latest_release',
  'get_merged_prs_since',
  'get_run_artifacts',
  'get_repo_info',
  'preview_diff',
  'run_lint',
  'check_security',
  'auto_review',
]);

const DANGEROUS_TOOLS = new Set([
  'delete_file',
  'delete_folder_contents',
  'delete_repo',
  'delete_release',
  'delete_release_asset',
  'delete_package_version',
  'delete_artifact',
  'merge_pull_request',
  'close_pr',
  'close_issue',
  'submit_pr_review',
  'create_release',
  'trigger_workflow',
  'cancel_workflow_run',
  'set_actions_variable',
  'search_and_replace',
  'undo_last_commit',
]);

export function getToolRisk(toolName: string): ToolRisk {
  if (DANGEROUS_TOOLS.has(toolName)) return 'dangerous';
  if (READ_TOOLS.has(toolName)) return 'read';
  return 'write';
}

/**
 * 是否需要人工确认。
 * - read 永不确认；
 * - write 在自动模式下放行，否则确认；
 * - dangerous 永远确认（自动模式也不放行）。
 */
export function shouldRequireApproval(toolName: string, autoMode: boolean): boolean {
  const risk = getToolRisk(toolName);
  if (risk === 'read') return false;
  if (risk === 'dangerous') return true;
  return !autoMode;
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeOf(value) === expected;
}

export function validateRequiredArguments(
  schema: Record<string, unknown> | undefined,
  args: Record<string, unknown>
): string[] {
  if (!schema || schema.type !== 'object') return [];
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  // path 允许空字符串：GitHubM 用 "" 表示仓库根目录（file_tree / list_files）。
  const allowEmpty = new Set(['path']);
  return required
    .filter((key) => {
      if (args[key] === undefined || args[key] === null) return true;
      if (args[key] === '' && !allowEmpty.has(key)) return true;
      return false;
    })
    .map((key) => `缺少必填参数：${key}`);
}

/**
 * 轻量 JSON Schema 校验：required / type / enum / items.type。
 * 不追求完整 JSON Schema 实现，只覆盖工具参数最常见的错误。
 */
export function validateToolArguments(
  schema: Record<string, unknown> | undefined,
  args: Record<string, unknown>
): string[] {
  if (!schema || schema.type !== 'object') return [];
  const errors: string[] = [];
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];

  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === '') {
      errors.push(`缺少必填参数：${key}`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key];
    if (!prop) continue;
    if (typeof prop.type === 'string' && !matchesType(value, prop.type)) {
      errors.push(`参数 ${key} 类型应为 ${prop.type}，实际为 ${typeOf(value)}`);
      continue;
    }
    if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      errors.push(`参数 ${key} 必须是：${prop.enum.join(' / ')}`);
    }
    if (prop.type === 'array' && Array.isArray(value)) {
      const itemSchema = prop.items as Record<string, unknown> | undefined;
      if (itemSchema?.type) {
        for (let i = 0; i < value.length; i++) {
          if (!matchesType(value[i], String(itemSchema.type))) {
            errors.push(`参数 ${key}[${i}] 类型应为 ${itemSchema.type}`);
          }
        }
      }
    }
  }

  return errors;
}

export interface ClampedResult {
  text: string;
  truncated: boolean;
  originalLength: number;
}

/** 工具结果裁剪：避免单个工具结果撑爆上下文窗口 */
export function clampToolResult(text: string, maxChars = 4000): ClampedResult {
  if (text.length <= maxChars) {
    return { text, truncated: false, originalLength: text.length };
  }
  return {
    text:
      text.slice(0, maxChars) +
      `\n…（内容已截断，原始长度 ${text.length} 字符。请缩小查询范围后重试）`,
    truncated: true,
    originalLength: text.length,
  };
}