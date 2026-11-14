const MAX_LOG_CHARS = 12_000;

export function buildActionsFailurePrompt(params: {
  repoFullName: string;
  jobName: string;
  jobId?: string | number;
  runId?: string | number;
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
  const jobId = params.jobId !== undefined ? String(params.jobId) : '';

  return [
    '请帮我分析这次 GitHub Actions 失败。',
    '',
    `仓库：${params.repoFullName}`,
    `分支：${params.branch || '未知'}`,
    `Job：${params.jobName}`,
    ...(jobId ? [`Job ID：${jobId}`] : []),
    ...(params.runId !== undefined ? [`Run ID：${String(params.runId)}`] : []),
    `状态：${params.conclusion || 'failure'}`,
    ...(params.failedSteps && params.failedSteps.length > 0
      ? [`失败步骤：${params.failedSteps.join('、')}`]
      : []),
    ...(params.htmlUrl ? [`运行链接：${params.htmlUrl}`] : []),
    '',
    '重要：下面的日志只是尾部片段，可能缺少真正的首个错误。',
    ...(jobId
      ? [
          `请优先调用 get_job_logs 工具读取完整日志（先不传范围获取智能错误摘要），必要时按 800 行分页读取：`,
          `{"tool":"get_job_logs","job_id":"${jobId}"}`,
          '不要仅根据尾部日志下结论。',
        ]
      : ['如果上下文允许，请通过 Actions 日志工具读取完整 Job 日志。']),
    '',
    '请给出：',
    '1. 最可能的失败原因',
    '2. 日志中的关键证据（引用原始错误行）',
    '3. 具体修复步骤',
    '4. 建议修改的文件或命令',
    '',
    '--- 日志尾部片段（仅作线索） ---',
    clippedLogs || '（没有获取到日志）',
  ].join('\n');
}