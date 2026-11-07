type AgentBridge = {
  startAgentTask?: (title: string) => void;
  stopAgentTask?: () => void;
};

function getBridge(): AgentBridge | undefined {
  return (window as unknown as { AndroidBridge?: AgentBridge }).AndroidBridge;
}

/** 启动原生前台保活服务，让 AI 任务在应用切到后台后继续执行。 */
export function startAgentBackgroundTask(title = 'AI 助手正在执行任务'): void {
  try {
    getBridge()?.startAgentTask?.(title);
  } catch { /* 浏览器环境或桥接异常时忽略 */ }
}

/** 任务完成、失败或取消时关闭保活服务。 */
export function stopAgentBackgroundTask(): void {
  try {
    getBridge()?.stopAgentTask?.();
  } catch { /* ignore */ }
}
