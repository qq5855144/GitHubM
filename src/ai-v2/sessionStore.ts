// AI V2 — 会话存储：索引与会话消息分片，内存只保留当前会话
import type { RepoContext, UiChatMessage } from './types';
import { idbDelete, idbDeletePrefixes, idbGet, idbGetGroup, idbKeys, idbSet, idbUpdate } from './idbKv';
import { clearImageCache, deleteImageBlob, IMAGE_BLOB_PREFIX } from './imageStore';
import { clearRunSnapshots, hasUnresolvedRunWrite } from './runStore';

export interface V2Session {
  id: string;
  title: string;
  messages: UiChatMessage[];
  repo: RepoContext | null;
  /** 会话级模型覆盖；不设置时使用全局模型 */
  modelType?: string;
  model?: string;
  /** 标题是否由系统自动生成；手动重命名后为 manual */
  titleSource?: 'auto' | 'manual';
  createdAt: string;
  updatedAt: string;
}

/** 侧边栏只需要元信息，不需要消息正文 */
export type V2SessionMeta = Omit<V2Session, 'messages'>;

export interface SessionIndex {
  sessions: V2SessionMeta[];
  activeId: string;
}

/** 兼容旧接口：一次性读写全部会话（仅迁移与测试使用） */
export interface SessionStore {
  sessions: V2Session[];
  activeId: string;
}

export interface SessionSaveResult {
  ok: boolean;
  fallback?: boolean;
  error?: string;
}

const LOCAL_PREFIX = 'githubm_ai_v2_store:';
const LOCAL_MESSAGES_PREFIX = 'githubm_ai_v2_msgs:';
const IDB_PREFIX = 'sessions:';
const INDEX_PREFIX = 'session_index:';
const MESSAGES_PREFIX = 'session_messages:';
const CHUNK_PREFIX = 'session_message_chunk:';
const CHUNK_SIZE = 24;
export const LEGACY_SESSION_PREFIX = 'githubm_ai_v2_session:';
const SESSION_IDB_PREFIXES = [IDB_PREFIX, INDEX_PREFIX, MESSAGES_PREFIX, CHUNK_PREFIX];
const SESSION_LOCAL_PREFIXES = [LOCAL_PREFIX, LOCAL_MESSAGES_PREFIX, LEGACY_SESSION_PREFIX];

interface MessageManifest {
  kind: 'chunks';
  chunks: number;
  revision: string;
}

const messageRevisions = new Map<string, string>();
let revisionCounter = 0;
const revisionSource = Math.random().toString(36).slice(2);

function messageChunkPrefix(login: string | undefined, sessionId: string): string {
  return `${CHUNK_PREFIX}${encodeURIComponent(safeLogin(login))}:${encodeURIComponent(sessionId)}:`;
}

function messageChunkKey(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(10, '0')}`;
}

export function sessionLocalKey(login?: string): string {
  return login ? `${LOCAL_PREFIX}${login}` : '';
}

function safeLogin(login?: string): string {
  return login || 'anonymous';
}

function indexIdbKey(login?: string): string {
  return `${INDEX_PREFIX}${safeLogin(login)}`;
}

function messagesIdbKey(login: string | undefined, sessionId: string): string {
  return `${MESSAGES_PREFIX}${safeLogin(login)}:${sessionId}`;
}

function legacyIdbKey(login?: string): string {
  return `${IDB_PREFIX}${safeLogin(login)}`;
}

function messagesLocalKey(login: string | undefined, sessionId: string): string {
  return `${LOCAL_MESSAGES_PREFIX}${safeLogin(login)}:${sessionId}`;
}

function validMeta(value: unknown): V2SessionMeta | null {
  if (!value || typeof value !== 'object') return null;
  const meta = value as Partial<V2SessionMeta>;
  if (typeof meta.id !== 'string' || !meta.id) return null;
  return {
    ...(meta as V2SessionMeta),
    id: meta.id,
    title: typeof meta.title === 'string' ? meta.title : '',
    repo: (meta.repo as RepoContext | null) ?? null,
    createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : new Date().toISOString(),
    updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : new Date().toISOString(),
  };
}

function validIndex(value: unknown): SessionIndex | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { sessions?: unknown; activeId?: unknown };
  if (!Array.isArray(raw.sessions) || !raw.sessions.length) return null;
  const sessions = raw.sessions.map(validMeta).filter((item): item is V2SessionMeta => Boolean(item));
  if (!sessions.length) return null;
  const activeId = typeof raw.activeId === 'string' && sessions.some(item => item.id === raw.activeId)
    ? raw.activeId
    : sessions[0].id;
  return { sessions, activeId };
}

function validStore(value: unknown): SessionStore | null {
  if (!value || typeof value !== 'object') return null;
  const store = value as Partial<SessionStore>;
  if (!Array.isArray(store.sessions) || !store.sessions.length) return null;
  const sessions = store.sessions.filter((session): session is V2Session => Boolean(
    session && typeof session === 'object' && typeof session.id === 'string' && Array.isArray(session.messages),
  ));
  if (!sessions.length) return null;
  return {
    sessions,
    activeId: typeof store.activeId === 'string' ? store.activeId : sessions[0].id,
  };
}

function readLegacyLocal(login?: string): SessionStore | null {
  try {
    const raw = login ? localStorage.getItem(sessionLocalKey(login)) : null;
    return raw ? validStore(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function readLocalIndex(login?: string): SessionIndex | null {
  try {
    const raw = login ? localStorage.getItem(sessionLocalKey(login)) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return validStore(parsed) ? null : validIndex(parsed);
  } catch {
    return null;
  }
}

export function toSessionMeta(session: V2Session): V2SessionMeta {
  const { messages: _messages, ...meta } = session;
  return meta;
}

/** 旧版本把全部消息塞在一个对象里；这里拆分成分片存储 */
async function migrateStore(login: string | undefined, store: SessionStore): Promise<SessionIndex> {
  const sessions = store.sessions.map(item => toSessionMeta({ ...item, messages: [] }));
  let persisted = true;
  for (const session of store.sessions) {
    const saved = await saveSessionMessages(login, session.id, session.messages || []);
    if (!saved.ok || saved.fallback) persisted = false;
  }
  const index: SessionIndex = { sessions, activeId: store.activeId };
  if (persisted && await idbSet(indexIdbKey(login), index)) {
    await idbDelete(legacyIdbKey(login));
    try {
      if (login) localStorage.removeItem(sessionLocalKey(login));
    } catch {
      // ignore
    }
  }
  return index;
}

const sessionWriteQueues = new Map<string, Promise<void>>();
const sessionClearGuards = new Set<() => boolean>();
const sessionClearListeners = new Set<() => void>();
let sessionClearVersion = 0;
let clearingSessions = false;

export function getSessionClearVersion(): number {
  return sessionClearVersion;
}

export function isClearingSessions(): boolean {
  return clearingSessions;
}

export function subscribeSessionClear(listener: () => void): () => void {
  sessionClearListeners.add(listener);
  return () => { sessionClearListeners.delete(listener); };
}

export function registerSessionClearGuard(guard: () => boolean): () => void {
  sessionClearGuards.add(guard);
  return () => { sessionClearGuards.delete(guard); };
}

async function findLocalAccounts(): Promise<string[]> {
  const accounts = new Set<string>();
  for (const key of Object.keys(localStorage)) {
    for (const prefix of [LOCAL_PREFIX, LEGACY_SESSION_PREFIX]) {
      if (key.startsWith(prefix)) accounts.add(key.slice(prefix.length));
    }
  }
  const prefixes = [INDEX_PREFIX, IDB_PREFIX];
  const keys = await Promise.all(prefixes.map(prefix => idbKeys(prefix)));
  keys.forEach((items, index) => items.forEach(key => accounts.add(key.slice(prefixes[index].length))));
  return [...accounts];
}

export async function countLocalSessions(): Promise<number[]> {
  const counts: number[] = [];
  for (const login of await findLocalAccounts()) {
    const index = readLocalIndex(login) || validIndex(await idbGet(indexIdbKey(login)));
    const legacy = index ? null : readLegacyLocal(login) || validStore(await idbGet(legacyIdbKey(login)));
    const count = index?.sessions.length ?? legacy?.sessions.length
      ?? Number(Boolean(localStorage.getItem(`${LEGACY_SESSION_PREFIX}${login}`)));
    if (count) counts.push(count);
  }
  return counts;
}

export function sessionImageIds(messages: UiChatMessage[]): Set<string> {
  return new Set(messages.flatMap(message => (message.attachments || [])
    .flatMap(attachment => attachment.imageBlobId ? [attachment.imageBlobId] : [])));
}

/** Remove only candidate images that are no longer referenced by any saved conversation. */
export async function collectSessionImages(candidates: Set<string>): Promise<void> {
  if (candidates.size === 0) return;
  for (const login of await findLocalAccounts()) {
    const index = await loadSessionIndex(login);
    if (index) {
      for (const session of index.sessions) {
        for (const id of sessionImageIds(await loadSessionMessages(login, session.id))) candidates.delete(id);
        if (candidates.size === 0) return;
      }
    }
    const legacy = localStorage.getItem(`${LEGACY_SESSION_PREFIX}${login}`);
    if (legacy) {
      const messages = (JSON.parse(legacy) as { messages?: UiChatMessage[] }).messages;
      if (Array.isArray(messages)) {
        for (const id of sessionImageIds(messages)) candidates.delete(id);
      }
    }
  }
  await Promise.all([...candidates].map(deleteImageBlob));
}

export async function clearLocalSessions(): Promise<boolean> {
  if (clearingSessions || [...sessionClearGuards].some(guard => !guard())) return false;
  clearingSessions = true;
  let changed = false;
  try {
    await Promise.allSettled([...sessionWriteQueues.values()]);
    const accounts = await findLocalAccounts();
    if ((await Promise.all(accounts.map(login => hasUnresolvedRunWrite(login)))).some(Boolean)) return false;
    changed = true;
    if (!await idbDeletePrefixes([...SESSION_IDB_PREFIXES, IMAGE_BLOB_PREFIX])) {
      throw new Error('无法清除 IndexedDB 中的本机会话');
    }
    for (const key of Object.keys(localStorage)) {
      if (SESSION_LOCAL_PREFIXES.some(prefix => key.startsWith(prefix))) localStorage.removeItem(key);
    }
    await Promise.all(accounts.map(login => clearRunSnapshots(login)));
    clearImageCache();
    messageRevisions.clear();
    return true;
  } finally {
    clearingSessions = false;
    if (changed) {
      sessionClearVersion++;
      for (const listener of sessionClearListeners) listener();
    }
  }
}

export function queueSessionWrite(login: string, work: () => Promise<void>): Promise<void> {
  const previous = sessionWriteQueues.get(login) || Promise.resolve();
  const version = sessionClearVersion;
  const next = previous.catch(() => {}).then(async () => {
    if (clearingSessions || version !== sessionClearVersion) return;
    await work();
  });
  sessionWriteQueues.set(login, next);
  const release = () => {
    if (sessionWriteQueues.get(login) === next) sessionWriteQueues.delete(login);
  };
  void next.then(release, release);
  return next;
}

export async function loadSessionIndex(login?: string): Promise<SessionIndex | null> {
  if (login) await sessionWriteQueues.get(login)?.catch(() => {});
  const fallback = readLocalIndex(login);
  if (fallback) return fallback;
  const fromDb = validIndex(await idbGet<unknown>(indexIdbKey(login)));
  if (fromDb) return fromDb;

  const legacyIdb = validStore(await idbGet<unknown>(legacyIdbKey(login)));
  if (legacyIdb) return migrateStore(login, legacyIdb);

  const legacyLocal = readLegacyLocal(login);
  if (legacyLocal) return migrateStore(login, legacyLocal);

  return null;
}

export async function loadSessionMessages(
  login: string | undefined,
  sessionId: string,
): Promise<UiChatMessage[]> {
  try {
    const raw = localStorage.getItem(messagesLocalKey(login, sessionId));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as UiChatMessage[];
    }
  } catch {
    // ignore
  }

  const { value, chunks } = await idbGetGroup<UiChatMessage[] | MessageManifest, UiChatMessage[]>(
    messagesIdbKey(login, sessionId), messageChunkPrefix(login, sessionId),
  );
  if (Array.isArray(value)) return value;
  if (value?.kind === 'chunks' && chunks.length === value.chunks) return chunks.flat();
  const legacyIdb = validStore(await idbGet<unknown>(legacyIdbKey(login)));
  const legacySession = legacyIdb?.sessions.find(session => session.id === sessionId);
  if (legacySession) return legacySession.messages || [];

  const legacyLocal = readLegacyLocal(login);
  return legacyLocal?.sessions.find(session => session.id === sessionId)?.messages || [];
}

export async function saveSessionIndex(
  login: string | undefined,
  index: SessionIndex,
): Promise<SessionSaveResult> {
  if (clearingSessions) return { ok: false, error: '正在清空本机会话' };
  const persisted = await idbSet(indexIdbKey(login), index);
  if (persisted) {
    try { if (login) localStorage.removeItem(sessionLocalKey(login)); } catch { /* ignore */ }
    return { ok: true };
  }

  try {
    if (clearingSessions || !login) return { ok: false, error: '会话索引无法保存' };
    localStorage.setItem(sessionLocalKey(login), JSON.stringify(index));
    return { ok: true, fallback: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '会话保存失败' };
  }
}

export async function saveSessionMessages(
  login: string | undefined,
  sessionId: string,
  messages: UiChatMessage[],
  firstChangedMessage = 0,
  prepareMessage: (message: UiChatMessage) => UiChatMessage = message => message,
): Promise<SessionSaveResult> {
  if (clearingSessions) return { ok: false, error: '正在清空本机会话' };
  const key = messagesIdbKey(login, sessionId);
  const prefix = messageChunkPrefix(login, sessionId);
  const previousRevision = messageRevisions.get(key);
  const revision = `${revisionSource}:${++revisionCounter}`;
  const chunks = Math.ceil(messages.length / CHUNK_SIZE);
  const persisted = await idbUpdate<MessageManifest>(key, previous => {
    const start = previous?.kind === 'chunks' && previous.revision === previousRevision
      ? Math.min(Math.floor(firstChangedMessage / CHUNK_SIZE), previous.chunks, chunks)
      : 0;
    const deletedKeys: string[] = [];
    const entries: [string, unknown][] = [[key, { kind: 'chunks', chunks, revision }]];
    for (let i = start; i < chunks; i++) {
      entries.push([messageChunkKey(prefix, i), messages.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE).map(prepareMessage)]);
    }
    for (let i = chunks; i < (previous?.chunks || 0); i++) deletedKeys.push(messageChunkKey(prefix, i));
    return { entries, deletedKeys };
  });
  if (persisted) {
    messageRevisions.set(key, revision);
    try { localStorage.removeItem(messagesLocalKey(login, sessionId)); } catch { /* ignore */ }
    return { ok: true };
  }

  messageRevisions.delete(key);
  try {
    if (clearingSessions) return { ok: false, error: '正在清空本机会话' };
    localStorage.setItem(messagesLocalKey(login, sessionId), JSON.stringify(messages.map(prepareMessage)));
    return { ok: true, fallback: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '会话消息保存失败' };
  }
}

export async function deleteSessionMessages(login: string | undefined, sessionId: string): Promise<void> {
  const key = messagesIdbKey(login, sessionId);
  messageRevisions.delete(key);
  if (!await idbDeletePrefixes([messageChunkPrefix(login, sessionId)], [key])) {
    throw new Error('无法删除 IndexedDB 中的会话消息');
  }
  localStorage.removeItem(messagesLocalKey(login, sessionId));
}

/** 兼容接口：读取全部会话（含消息），仅用于迁移与测试 */
export async function loadSessionStore(login?: string): Promise<SessionStore | null> {
  const index = await loadSessionIndex(login);
  if (!index) return null;
  const sessions: V2Session[] = [];
  for (const meta of index.sessions) {
    const messages = await loadSessionMessages(login, meta.id);
    sessions.push({ ...meta, messages });
  }
  return { sessions, activeId: index.activeId };
}

/** 兼容接口：写入全部会话（含消息），仅用于迁移与测试 */
export async function saveSessionStore(
  login: string | undefined,
  store: SessionStore,
): Promise<SessionSaveResult> {
  let fallback = false;
  for (const session of store.sessions) {
    const saved = await saveSessionMessages(login, session.id, session.messages || []);
    if (!saved.ok) return saved;
    fallback ||= Boolean(saved.fallback);
  }

  const index: SessionIndex = {
    sessions: store.sessions.map(item => toSessionMeta({ ...item, messages: [] })),
    activeId: store.activeId,
  };
  const indexSaved = await idbSet(indexIdbKey(login), index);
  if (!indexSaved) {
    try {
      if (!login) return { ok: false, error: '未登录' };
      // 回退时保留完整结构，保证旧读取路径可用
      localStorage.setItem(sessionLocalKey(login), JSON.stringify(store));
      fallback = true;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '会话保存失败' };
    }
  }
  return fallback ? { ok: true, fallback: true } : { ok: true };
}
