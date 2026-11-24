// AI V2 — 会话存储：索引与会话消息分片，内存只保留当前会话
import type { RepoContext, UiChatMessage } from './types';
import { idbDelete, idbGet, idbSet } from './idbKv';

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
    return raw ? validIndex(JSON.parse(raw)) : null;
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
    const ok = await idbSet(messagesIdbKey(login, session.id), session.messages || []);
    if (!ok) persisted = false;
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

export function queueSessionWrite(login: string, work: () => Promise<void>): Promise<void> {
  const previous = sessionWriteQueues.get(login) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
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

  const fromDb = await idbGet<UiChatMessage[]>(messagesIdbKey(login, sessionId));
  if (Array.isArray(fromDb)) return fromDb;
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
  const persisted = await idbSet(indexIdbKey(login), index);
  if (persisted) {
    try { if (login) localStorage.removeItem(sessionLocalKey(login)); } catch { /* ignore */ }
    return { ok: true };
  }

  try {
    if (!login) return { ok: false, error: '未登录' };
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
): Promise<SessionSaveResult> {
  const persisted = await idbSet(messagesIdbKey(login, sessionId), messages);
  if (persisted) {
    try { localStorage.removeItem(messagesLocalKey(login, sessionId)); } catch { /* ignore */ }
    return { ok: true };
  }

  try {
    localStorage.setItem(messagesLocalKey(login, sessionId), JSON.stringify(messages));
    return { ok: true, fallback: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '会话消息保存失败' };
  }
}

export async function deleteSessionMessages(login: string | undefined, sessionId: string): Promise<void> {
  await idbDelete(messagesIdbKey(login, sessionId));
  try {
    localStorage.removeItem(messagesLocalKey(login, sessionId));
  } catch {
    // ignore
  }
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
    const saved = await idbSet(messagesIdbKey(login, session.id), session.messages || []);
    if (!saved) {
      try {
        if (!login) return { ok: false, error: '未登录' };
        localStorage.setItem(messagesLocalKey(login, session.id), JSON.stringify(session.messages || []));
        fallback = true;
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '会话保存失败' };
      }
    }
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
