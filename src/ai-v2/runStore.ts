// AI V2 — Run Store：持久化运行摘要，用于历史、诊断和后续恢复
import type { AgentEvent } from './types';

export type RunStatus = 'running' | 'done' | 'error' | 'stopped';

export interface RunEventRecord {
  at: string;
  type: 'run_start' | 'tool_start' | 'tool_end' | 'done' | 'error';
  tool?: string;
  ok?: boolean;
  message?: string;
  artifact?: boolean;
}

export interface RunRecord {
  id: string;
  sessionId?: string;
  title: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  steps: number;
  toolCalls: number;
  failedTools: number;
  capabilities: string[];
  events: RunEventRecord[];
  error?: string;
}

const RUNS_PREFIX = 'githubm_ai_runs:';
const MAX_RUNS = 30;

function safeLogin(login?: string): string {
  return encodeURIComponent(login || 'anonymous');
}

function key(login?: string): string {
  return `${RUNS_PREFIX}${safeLogin(login)}`;
}

export function listRuns(login?: string, limit = 20): RunRecord[] {
  try {
    const raw = localStorage.getItem(key(login));
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? (parsed as RunRecord[]).slice(0, Math.max(1, limit)) : [];
  } catch {
    return [];
  }
}

function writeRuns(login: string | undefined, runs: RunRecord[]): void {
  localStorage.setItem(key(login), JSON.stringify(runs.slice(0, MAX_RUNS)));
}

export function startRun(params: {
  login?: string;
  id?: string;
  sessionId?: string;
  title: string;
}): RunRecord {
  const run: RunRecord = {
    id: params.id || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: params.sessionId,
    title: params.title.slice(0, 120),
    status: 'running',
    startedAt: new Date().toISOString(),
    steps: 0,
    toolCalls: 0,
    failedTools: 0,
    capabilities: [],
    events: [],
  };
  try {
    writeRuns(params.login, [run, ...listRuns(params.login, MAX_RUNS)]);
  } catch {
    // ignore
  }
  return run;
}

export function appendRunEvent(login: string | undefined, runId: string, event: AgentEvent): void {
  if (event.type === 'text_delta' || event.type === 'reasoning_delta' || event.type === 'usage') return;
  try {
    const runs = listRuns(login, MAX_RUNS);
    const index = runs.findIndex(run => run.id === runId);
    if (index < 0) return;
    const run = { ...runs[index] };
    run.events = Array.isArray(run.events) ? [...run.events] : [];
    const at = new Date().toISOString();
    const pushEvent = (event: RunEventRecord) => {
      run.events.push(event);
      if (run.events.length > 100) run.events = run.events.slice(-100);
    };
    switch (event.type) {
      case 'run_start':
        run.capabilities = event.capabilities || [];
        pushEvent({ at, type: 'run_start', message: run.capabilities.join(',') });
        break;
      case 'tool_start':
        run.toolCalls += 1;
        pushEvent({ at, type: 'tool_start', tool: event.call.name });
        break;
      case 'tool_end':
        if (!event.ok) run.failedTools += 1;
        pushEvent({ at, type: 'tool_end', tool: event.call.name, ok: event.ok, artifact: Boolean(event.artifact) });
        break;
      case 'done':
        run.steps = event.steps;
        run.status = 'done';
        run.finishedAt = at;
        pushEvent({ at, type: 'done', message: `steps=${event.steps}` });
        break;
      case 'error':
        run.status = 'error';
        run.error = event.message;
        run.finishedAt = at;
        pushEvent({ at, type: 'error', message: event.message.slice(0, 500) });
        break;
      default:
        break;
    }
    runs[index] = run;
    writeRuns(login, runs);
  } catch {
    // ignore
  }
}

export function resumeRun(login: string | undefined, runId: string): void {
  try {
    const runs = listRuns(login, MAX_RUNS);
    const index = runs.findIndex(run => run.id === runId);
    if (index < 0) return;
    runs[index] = {
      ...runs[index],
      status: 'running',
      finishedAt: undefined,
      error: undefined,
    };
    writeRuns(login, runs);
  } catch {
    // ignore
  }
}

export function finishRun(
  login: string | undefined,
  runId: string,
  status: RunStatus,
  error?: string,
): void {
  try {
    const runs = listRuns(login, MAX_RUNS);
    const index = runs.findIndex(run => run.id === runId);
    if (index < 0) return;
    const run = { ...runs[index] };
    if (run.status === 'running') {
      run.status = status;
      run.finishedAt = new Date().toISOString();
      if (error) run.error = error;
    }
    runs[index] = run;
    writeRuns(login, runs);
  } catch {
    // ignore
  }
}

export interface RunSnapshot {
  runId: string;
  sessionId?: string;
  assistantId?: string;
  title: string;
  messages: Array<{
    role: string;
    content: string | null;
    tool_calls?: unknown;
    tool_call_id?: string;
    name?: string;
    reasoning_content?: string;
  }>;
  steps: number;
  capabilities: string[];
  savedAt: string;
}

const SNAPSHOT_PREFIX = 'githubm_ai_run_snapshot:';
const MAX_SNAPSHOTS = 10;

function snapshotKey(login: string | undefined, runId: string): string {
  return `${SNAPSHOT_PREFIX}${safeLogin(login)}:${runId}`;
}

export function saveRunSnapshot(login: string | undefined, snapshot: RunSnapshot): void {
  try {
    const compact: RunSnapshot = {
      ...snapshot,
      messages: snapshot.messages.slice(-60).map(message => ({
        ...message,
        content: typeof message.content === 'string' ? message.content.slice(0, 30000) : message.content,
      })),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(snapshotKey(login, snapshot.runId), JSON.stringify(compact));

    const prefix = `${SNAPSHOT_PREFIX}${safeLogin(login)}:`;
    const keys = Object.keys(localStorage).filter(key => key.startsWith(prefix));
    if (keys.length > MAX_SNAPSHOTS) {
      keys.sort((a, b) => {
        const ta = Date.parse((JSON.parse(localStorage.getItem(a) || '{}') as RunSnapshot).savedAt || '') || 0;
        const tb = Date.parse((JSON.parse(localStorage.getItem(b) || '{}') as RunSnapshot).savedAt || '') || 0;
        return ta - tb;
      });
      for (const key of keys.slice(0, keys.length - MAX_SNAPSHOTS)) localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export function loadRunSnapshot(login: string | undefined, runId: string): RunSnapshot | null {
  try {
    const raw = localStorage.getItem(snapshotKey(login, runId));
    return raw ? JSON.parse(raw) as RunSnapshot : null;
  } catch {
    return null;
  }
}

export function latestRunSnapshot(login: string | undefined, sessionId?: string): RunSnapshot | null {
  try {
    const prefix = `${SNAPSHOT_PREFIX}${safeLogin(login)}:`;
    const snapshots = Object.keys(localStorage)
      .filter(key => key.startsWith(prefix))
      .map(key => {
        try {
          return JSON.parse(localStorage.getItem(key) || 'null') as RunSnapshot | null;
        } catch {
          return null;
        }
      })
      .filter((item): item is RunSnapshot => Boolean(item))
      .filter(item => !sessionId || item.sessionId === sessionId)
      .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
    return snapshots[0] || null;
  } catch {
    return null;
  }
}

export function clearRunSnapshot(login: string | undefined, runId: string): void {
  try {
    localStorage.removeItem(snapshotKey(login, runId));
  } catch {
    // ignore
  }
}

export function clearRuns(login?: string): void {
  try {
    localStorage.removeItem(key(login));
  } catch {
    // ignore
  }
}