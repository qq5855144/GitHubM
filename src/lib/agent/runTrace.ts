// Agent 运行追踪（本地可观测性）
//
// 不依赖后端，记录最近 N 次 Agent 运行：
//   - 模型调用、工具调用、上下文压缩、错误、结束状态
// 用于定位「为什么这次任务失败/卡住/重复调用」，并为后续接入
// Langfuse / OpenTelemetry 保留统一事件结构。

export type AgentTraceEventType =
  | 'run_start'
  | 'model_request'
  | 'model_response'
  | 'tool_start'
  | 'tool_end'
  | 'context_compress'
  | 'error'
  | 'run_end';

export interface AgentTraceEvent {
  at: number;
  type: AgentTraceEventType;
  /** 事件负载：工具名、耗时、token、错误摘要等，禁止写入完整 Token */
  data?: Record<string, unknown>;
}

export type AgentTraceStatus = 'running' | 'success' | 'error' | 'aborted';

export interface AgentTrace {
  id: string;
  startedAt: number;
  endedAt?: number;
  status: AgentTraceStatus;
  model?: string;
  repo?: string;
  userId?: string;
  events: AgentTraceEvent[];
}

const STORAGE_KEY = 'github_manager_agent_traces_v1';
const MAX_RUNS = 20;
const MAX_EVENTS_PER_RUN = 200;

function newId(): string {
  try {
    return `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  } catch {
    return `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

function readAll(): AgentTrace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AgentTrace[]) : [];
  } catch {
    return [];
  }
}

function writeAll(traces: AgentTrace[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(traces.slice(0, MAX_RUNS)));
  } catch {
    // 存储满或被禁用时静默失败，不影响 Agent 主流程
  }
}

export function startAgentTrace(meta: {
  model?: string;
  repo?: string;
  userId?: string;
} = {}): string {
  const id = newId();
  const trace: AgentTrace = {
    id,
    startedAt: Date.now(),
    status: 'running',
    model: meta.model,
    repo: meta.repo,
    userId: meta.userId,
    events: [{ at: Date.now(), type: 'run_start', data: { ...meta } }],
  };
  writeAll([trace, ...readAll()]);
  return id;
}

export function recordAgentTraceEvent(
  traceId: string,
  type: AgentTraceEventType,
  data?: Record<string, unknown>
): void {
  const traces = readAll();
  const trace = traces.find((t) => t.id === traceId);
  if (!trace) return;
  trace.events.push({ at: Date.now(), type, data });
  if (trace.events.length > MAX_EVENTS_PER_RUN) {
    trace.events = trace.events.slice(-MAX_EVENTS_PER_RUN);
  }
  writeAll(traces);
}

export function endAgentTrace(
  traceId: string,
  status: Exclude<AgentTraceStatus, 'running'>,
  data?: Record<string, unknown>
): void {
  const traces = readAll();
  const trace = traces.find((t) => t.id === traceId);
  if (!trace) return;
  trace.status = status;
  trace.endedAt = Date.now();
  trace.events.push({
    at: trace.endedAt,
    type: 'run_end',
    data: { status, durationMs: trace.endedAt - trace.startedAt, ...data },
  });
  writeAll(traces);
}

export function getAgentTraces(): AgentTrace[] {
  return readAll();
}

export function clearAgentTraces(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** 生成一条便于复制到 GitHub Issue 的纯文本摘要 */
export function formatAgentTrace(trace: AgentTrace): string {
  const lines = [
    `run=${trace.id} status=${trace.status} model=${trace.model ?? '-'} repo=${trace.repo ?? '-'}`,
    `started=${new Date(trace.startedAt).toISOString()} duration=${trace.endedAt ? trace.endedAt - trace.startedAt : '-'}ms`,
  ];
  for (const event of trace.events) {
    const data = event.data ? ` ${JSON.stringify(event.data)}` : '';
    lines.push(`${new Date(event.at).toISOString()} ${event.type}${data}`);
  }
  return lines.join('\n');
}