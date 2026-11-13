const MAX_LOG_CHARS = 12_000;

export function buildActionsFailurePrompt(params: {
  repoFullName: string;
  jobName: string;
  conclusion?: string | null;
  htmlUrl?: string;
  branch?: string;
  failedSteps?: string[];
  logs: string;
}): string {
  const logs = params.logs.trim();
  const clippedLogs = logs.length > MAX_LOG_CHARS
    ? `…（仅保留最后 ${MAX_LOG_CHARS} 个字符）\n${logs.slice(-MAX_LOG_CHARS)}`
    : logs;

  return [
    '请帮我分析这次 GitHub Actions 失败。',
    '',
    `仓库：${params.repoFullName}`,
    `分支：${params.branch || '未知'}`,
    `Job：${params.jobName}`,
    `状态：${params.conclusion || 'failure'}`,
    ...(params.failedSteps && params.failedSteps.length > 0
      ? [`失败步骤：${params.failedSteps.join('、')}`]
      : []),
    ...(params.htmlUrl ? [`运行链接：${params.htmlUrl}`] : []),
    '',
    '请给出：',
    '1. 最可能的失败原因',
    '2. 日志中的关键证据',
    '3. 具体修复步骤',
    '4. 建议修改的文件或命令',
    '',
    '--- Actions 日志 ---',
    clippedLogs || '（没有获取到日志）',
  ].join('\n');
}