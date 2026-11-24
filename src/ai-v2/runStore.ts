import type { ModelConfig } from '@/components/ai/aiTypes';
// AI V2 — Run Store：持久化运行摘要，用于历史、诊断和后续恢复
import type { AgentCheckpoint, AgentEvent, RepoContext, V2ProviderMessage } from './types';
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
  try {
    localStorage.setItem(key(login), JSON.stringify(runs.slice(0, MAX_RUNS)));
  } catch { /* 运行摘要写入失败不影响任务快照。 */ }
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

export interface RunBinding {
  repo: RepoContext | null;
  provider: ModelConfig['type'];
  model: string;
  endpoint: string;
  proxy: string;
  tools: boolean;
  stream: boolean;
  vision: boolean;
}

export function runBinding(repo: RepoContext | null, config: ModelConfig): RunBinding {
  return {
    repo: repo ? { fullName: repo.fullName, defaultBranch: repo.defaultBranch, branch: repo.branch || repo.defaultBranch } : null,
    provider: config.type,
    model: config.model || '',
    endpoint: config.endpoint?.trim() || '',
    proxy: config.proxy_url?.trim() || '',
    tools: config.supportsTools !== false,
    stream: config.stream !== false,
    vision: config.supportsVision === true,
  };
}

export interface RunSnapshot extends AgentCheckpoint {
  runId: string;
  sessionId?: string;
  assistantId?: string;
  title: string;
  binding?: RunBinding;
  capabilities: string[];
  savedAt: string;
}

const SNAPSHOT_PREFIX = 'githubm_ai_run_snapshot:';
const SNAPSHOT_IDB_PREFIX = 'run_snapshot:';
const MAX_SNAPSHOTS = 10;
const MAX_SNAPSHOT_MESSAGES = 24;
const MAX_SNAPSHOT_TOOL_ROUNDS = 10;
const MAX_SNAPSHOT_TOOL_CHARS = 1500;
const MAX_SNAPSHOT_TEXT_CHARS = 4000;
const snapshotWriteQueues = new Map<string, Promise<boolean>>();

function clampContent(
  content: V2ProviderMessage['content'],
  maxChars: number,
): V2ProviderMessage['content'] {
  if (typeof content === 'string') {
    return content.length > maxChars ? content.slice(0, maxChars) : content;
  }
  if (Array.isArray(content)) {
    return content.map(part => part.type === 'image_url' ? part : { ...part, text: part.text.slice(0, maxChars) });
  }
  return content;
}

/**
 * 快照只用于断点续跑：
 * - 只保留最近 24 条消息
 * - 只保留最近 10 轮工具调用，工具结果截断到 1500 字符
 * - 保留可见的图片和原任务系统消息
 */
export function compactSnapshotMessages(messages: V2ProviderMessage[]): V2ProviderMessage[] {
  const system = messages.filter(item => item.role === 'system');
  const windowed = messages.filter(item => item.role !== 'system').slice(-MAX_SNAPSHOT_MESSAGES);
  let start = 0;
  while (start < windowed.length && windowed[start].role === 'tool') start += 1;
  const trimmed = windowed.slice(start);

  const owners: number[] = [];
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    if (trimmed[index].tool_calls?.length) {
      owners.push(index);
      if (owners.length >= MAX_SNAPSHOT_TOOL_ROUNDS) break;
    }
  }
  const keepOwners = new Set(owners);
  const keepCallIds = new Set<string>();
  for (const index of owners) {
    for (const call of trimmed[index].tool_calls || []) keepCallIds.add(call.id);
  }

  const result: V2ProviderMessage[] = [...system];
  trimmed.forEach((message, index) => {
    if (message.role === 'tool') {
      if (message.tool_call_id && !keepCallIds.has(message.tool_call_id)) return;
      result.push({ ...message, content: clampContent(message.content, MAX_SNAPSHOT_TOOL_CHARS) });
      return;
    }
    if (message.tool_calls?.length) {
      if (!keepOwners.has(index)) {
        const { tool_calls: _dropped, ...rest } = message;
        result.push({ ...rest, content: clampContent(message.content, MAX_SNAPSHOT_TEXT_CHARS) });
        return;
      }
      result.push({
        ...message,
        content: clampContent(message.content, MAX_SNAPSHOT_TEXT_CHARS),
        tool_calls: message.tool_calls.filter(call => keepCallIds.has(call.id)),
      });
      return;
    }
    result.push({ ...message, content: clampContent(message.content, MAX_SNAPSHOT_TEXT_CHARS) });
  });

  return result;
}

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

async function writeRunSnapshot(login: string | undefined, snapshot: RunSnapshot): Promise<boolean> {
  const compact: RunSnapshot = {
    ...snapshot,
    messages: compactSnapshotMessages(snapshot.messages),
    savedAt: new Date().toISOString(),
  };
  const persisted = await idbSet(idbSnapshotKey(login, compact.runId), compact);
  if (!persisted) {
    try {
      localStorage.setItem(snapshotKey(login, compact.runId), JSON.stringify(compact));
    } catch {
      return false;
    }
  } else {
    try { localStorage.removeItem(snapshotKey(login, compact.runId)); } catch { /* ignore */ }
  }
  await pruneSnapshots(login).catch(() => {});
  return true;
}

export function saveRunSnapshot(login: string | undefined, snapshot: RunSnapshot): Promise<boolean> {
  const key = idbSnapshotKey(login, snapshot.runId);
  const previous = snapshotWriteQueues.get(key) || Promise.resolve(true);
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
  try {
    const raw = localStorage.getItem(snapshotKey(login, runId));
    const local = raw ? JSON.parse(raw) as RunSnapshot : null;
    if (local && (!fromDb || Date.parse(local.savedAt) >= Date.parse(fromDb.savedAt))) return local;
  } catch { /* ignore */ }
  return fromDb;
}

export async function latestRunSnapshot(login: string | undefined, sessionId?: string): Promise<RunSnapshot | null> {
  const finished = new Set(listRuns(login, MAX_RUNS).filter(item => item.status === 'done').map(item => item.id));
  const snapshots = (await listSnapshots(login))
    .filter(item => !finished.has(item.runId) && (!sessionId || item.sessionId === sessionId))
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  return snapshots[0] || null;
}

export async function clearRunSnapshot(login: string | undefined, runId: string): Promise<void> {
  await snapshotWriteQueues.get(idbSnapshotKey(login, runId))?.catch(() => {});
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