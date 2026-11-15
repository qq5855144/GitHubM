// AI V2 — Run Store：持久化运行摘要，用于历史、诊断和后续恢复
import type { AgentEvent, V2ProviderMessage } from './types';
import { idbDelete, idbGet, idbKeys, idbSet } from './idbKv';

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
  messages: V2ProviderMessage[];
  steps: number;
  capabilities: string[];
  savedAt: string;
}

const SNAPSHOT_PREFIX = 'githubm_ai_run_snapshot:';
const SNAPSHOT_IDB_PREFIX = 'run_snapshot:';
const MAX_SNAPSHOTS = 10;
const snapshotWriteQueues = new Map<string, Promise<void>>();

function idbSnapshotKey(login: string | undefined, runId: string): string {
  return `${SNAPSHOT_IDB_PREFIX}${safeLogin(login)}:${runId}`;
}

function snapshotKey(login: string | undefined, runId: string): string {
  return `${SNAPSHOT_PREFIX}${safeLogin(login)}:${runId}`;
}

async function listSnapshots(login: string | undefined): Promise<RunSnapshot[]> {
  const idbPrefix = `${SNAPSHOT_IDB_PREFIX}${safeLogin(login)}:`;
  const localPrefix = `${SNAPSHOT_PREFIX}${safeLogin(login)}:`;
  const fromDb = (await Promise.all(
    (await idbKeys(idbPrefix)).map(key => idbGet<RunSnapshot>(key)),
  )).filter((item): item is RunSnapshot => Boolean(item?.runId));
  const byRun = new Map(fromDb.map(item => [item.runId, item]));
  try {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith(localPrefix))) {
      try {
        const item = JSON.parse(localStorage.getItem(key) || 'null') as RunSnapshot | null;
        if (item?.runId) {
          const existing = byRun.get(item.runId);
          if (!existing || Date.parse(item.savedAt) > Date.parse(existing.savedAt)) byRun.set(item.runId, item);
        }
      } catch {
        // ignore malformed
      }
    }
  } catch {
    // ignore
  }
  return [...byRun.values()];
}

async function pruneSnapshots(login: string | undefined): Promise<void> {
  const snapshots = await listSnapshots(login);
  if (snapshots.length <= MAX_SNAPSHOTS) return;
  snapshots.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  for (const snapshot of snapshots.slice(MAX_SNAPSHOTS)) {
    await idbDelete(idbSnapshotKey(login, snapshot.runId));
    try {
      localStorage.removeItem(snapshotKey(login, snapshot.runId));
    } catch {
      // ignore
    }
  }
}

async function writeRunSnapshot(login: string | undefined, snapshot: RunSnapshot): Promise<void> {
  const compact: RunSnapshot = {
    ...snapshot,
    messages: snapshot.messages.slice(-60).map(message => ({
      ...message,
      content: typeof message.content === 'string'
        ? message.content.slice(0, 30000)
        : Array.isArray(message.content)
          ? message.content.map(part => part.type === 'image_url'
            ? { type: 'text' as const, text: '[图片附件已省略]' }
            : { ...part, text: part.text.slice(0, 30000) })
          : null,
    })),
    savedAt: new Date().toISOString(),
  };
  const persisted = await idbSet(idbSnapshotKey(login, compact.runId), compact);
  if (!persisted) {
    try {
      localStorage.setItem(snapshotKey(login, compact.runId), JSON.stringify(compact));
    } catch {
      return;
    }
  }
  await pruneSnapshots(login);
}

export function saveRunSnapshot(login: string | undefined, snapshot: RunSnapshot): Promise<void> {
  const key = idbSnapshotKey(login, snapshot.runId);
  const previous = snapshotWriteQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(() => writeRunSnapshot(login, snapshot));
  snapshotWriteQueues.set(key, next);
  void next.then(
    () => { if (snapshotWriteQueues.get(key) === next) snapshotWriteQueues.delete(key); },
    () => { if (snapshotWriteQueues.get(key) === next) snapshotWriteQueues.delete(key); },
  );
  return next;
}

export async function loadRunSnapshot(login: string | undefined, runId: string): Promise<RunSnapshot | null> {
  const fromDb = await idbGet<RunSnapshot>(idbSnapshotKey(login, runId));
  if (fromDb) return fromDb;
  try {
    const raw = localStorage.getItem(snapshotKey(login, runId));
    return raw ? JSON.parse(raw) as RunSnapshot : null;
  } catch {
    return null;
  }
}

export async function latestRunSnapshot(login: string | undefined, sessionId?: string): Promise<RunSnapshot | null> {
  const snapshots = (await listSnapshots(login))
    .filter(item => !sessionId || item.sessionId === sessionId)
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  return snapshots[0] || null;
}

export async function clearRunSnapshot(login: string | undefined, runId: string): Promise<void> {
  await idbDelete(idbSnapshotKey(login, runId));
  try {
    localStorage.removeItem(snapshotKey(login, runId));
  } catch {
    // ignore
  }
}

export async function clearRunSnapshots(login: string | undefined, sessionId?: string): Promise<void> {
  const snapshots = await listSnapshots(login);
  for (const snapshot of snapshots) {
    if (sessionId && snapshot.sessionId !== sessionId) continue;
    await clearRunSnapshot(login, snapshot.runId);
  }
}

export async function clearRuns(login?: string): Promise<void> {
  try {
    localStorage.removeItem(key(login));
  } catch {
    // ignore
  }
  await clearRunSnapshots(login);
}