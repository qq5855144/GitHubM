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
const MAX_SNAPSHOT_MESSAGES = 24;
const MAX_SNAPSHOT_TOOL_ROUNDS = 10;
const MAX_SNAPSHOT_TOOL_CHARS = 1500;
const MAX_SNAPSHOT_TEXT_CHARS = 4000;
type SnapshotMeta = Pick<RunSnapshot, 'runId' | 'sessionId' | 'savedAt' | 'writeInFlight'>;
const snapshotIndexes = new Map<string, Promise<Map<string, SnapshotMeta>>>();
const snapshotWriteQueues = new Map<string, Promise<unknown>>();

function snapshotMeta({ runId, sessionId, savedAt, writeInFlight }: RunSnapshot): SnapshotMeta {
  return { runId, sessionId, savedAt, writeInFlight };
}

function snapshotIndex(login?: string): Promise<Map<string, SnapshotMeta>> {
  const account = safeLogin(login);
  const cached = snapshotIndexes.get(account);
  if (cached) return cached;
  const result = readSnapshotIndex(login);
  snapshotIndexes.set(account, result);
  return result;
}

function queueSnapshotWrite<T>(login: string | undefined, work: () => Promise<T>): Promise<T> {
  const account = safeLogin(login);
  const previous = snapshotWriteQueues.get(account) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  snapshotWriteQueues.set(account, next);
  const release = () => {
    if (snapshotWriteQueues.get(account) === next) snapshotWriteQueues.delete(account);
  };
  void next.then(release, release);
  return next;
}

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
 * - 原始目标在 taskMemory 中单独保存，消息保留当前用户与最近的回合
 * - 只保留最近 10 轮工具调用，工具结果截断到 1500 字符
 * - 保留可见的图片和原任务系统消息
 */
export function compactSnapshotMessages(messages: V2ProviderMessage[]): V2ProviderMessage[] {
  const system = messages.filter(item => item.role === 'system');
  const conversation = messages.filter(item => item.role !== 'system');
  let lastUser = conversation.length - 1;
  while (lastUser >= 0 && conversation[lastUser].role !== 'user') lastUser--;
  const keepUser = lastUser >= 0 && lastUser < conversation.length - MAX_SNAPSHOT_MESSAGES;
  const windowed = conversation.slice(-(keepUser ? MAX_SNAPSHOT_MESSAGES - 1 : MAX_SNAPSHOT_MESSAGES));
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
  if (keepUser) {
    const request = conversation[lastUser];
    result.push({ ...request, content: clampContent(request.content, MAX_SNAPSHOT_TEXT_CHARS) });
  }
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

async function readSnapshotIndex(login: string | undefined): Promise<Map<string, SnapshotMeta>> {
  const idbPrefix = `${SNAPSHOT_IDB_PREFIX}${safeLogin(login)}:`;
  const localPrefix = `${SNAPSHOT_PREFIX}${safeLogin(login)}:`;
  const byRun = new Map<string, SnapshotMeta>();
  // Initialize only the metadata index. Large recovery payloads are read one at a time.
  for (const key of await idbKeys(idbPrefix)) {
    const item = await idbGet<RunSnapshot>(key);
    if (item?.runId) byRun.set(item.runId, snapshotMeta(item));
  }
  try {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith(localPrefix))) {
      try {
        const item = JSON.parse(localStorage.getItem(key) || 'null') as RunSnapshot | null;
        if (item?.runId) {
          const existing = byRun.get(item.runId);
          if (!existing || Date.parse(item.savedAt) > Date.parse(existing.savedAt)) byRun.set(item.runId, snapshotMeta(item));
        }
      } catch {
        // ignore malformed
      }
    }
  } catch {
    // ignore
  }
  return byRun;
}

async function removeSnapshot(login: string | undefined, runId: string): Promise<void> {
  await idbDelete(idbSnapshotKey(login, runId));
  try { localStorage.removeItem(snapshotKey(login, runId)); } catch { /* ignore */ }
  (await snapshotIndex(login)).delete(runId);
}

async function writeRunSnapshot(login: string | undefined, snapshot: RunSnapshot): Promise<boolean> {
  const index = await snapshotIndex(login);
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
  index.set(compact.runId, snapshotMeta(compact));
  return true;
}

export function saveRunSnapshot(login: string | undefined, snapshot: RunSnapshot): Promise<boolean> {
  return queueSnapshotWrite(login, () => writeRunSnapshot(login, snapshot));
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
  await snapshotWriteQueues.get(safeLogin(login))?.catch(() => {});
  const finished = new Set(listRuns(login, MAX_RUNS).filter(item => item.status === 'done').map(item => item.id));
  const snapshots = [...(await snapshotIndex(login)).values()]
    .filter(item => (item.writeInFlight || !finished.has(item.runId)) && (!sessionId || item.sessionId === sessionId))
    .sort((a, b) => Number(Boolean(b.writeInFlight)) - Number(Boolean(a.writeInFlight))
      || Date.parse(b.savedAt) - Date.parse(a.savedAt));
  return snapshots[0] ? loadRunSnapshot(login, snapshots[0].runId) : null;
}

export function clearRunSnapshot(login: string | undefined, runId: string): Promise<void> {
  return queueSnapshotWrite(login, () => removeSnapshot(login, runId));
}

export function clearRunSnapshots(login: string | undefined, sessionId?: string): Promise<void> {
  return queueSnapshotWrite(login, async () => {
    const index = await snapshotIndex(login);
    for (const snapshot of index.values()) {
      if (!sessionId || snapshot.sessionId === sessionId) await removeSnapshot(login, snapshot.runId);
    }
  });
}

export async function hasUnresolvedRunWrite(login?: string, sessionId?: string): Promise<boolean> {
  await snapshotWriteQueues.get(safeLogin(login))?.catch(() => {});
  return [...(await snapshotIndex(login)).values()].some(snapshot =>
    snapshot.writeInFlight && (!sessionId || snapshot.sessionId === sessionId));
}

export async function clearRuns(login?: string): Promise<void> {
  try {
    localStorage.removeItem(key(login));
  } catch {
    // ignore
  }
  await queueSnapshotWrite(login, async () => {
    for (const snapshot of (await snapshotIndex(login)).values()) {
      if (!snapshot.writeInFlight) await removeSnapshot(login, snapshot.runId);
    }
  });
}