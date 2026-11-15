// AI V2 — 会话存储：优先 IndexedDB，localStorage 仅作兼容回退
import type { RepoContext, UiChatMessage } from './types';
import { idbGet, idbSet } from './idbKv';

export interface V2Session {
  id: string;
  title: string;
  messages: UiChatMessage[];
  repo: RepoContext | null;
  /** 会话级模型覆盖；不设置时使用全局模型 */
  modelType?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStore {
  sessions: V2Session[];
  activeId: string;
}

const LOCAL_PREFIX = 'githubm_ai_v2_store:';
const IDB_PREFIX = 'sessions:';

export function sessionLocalKey(login?: string): string {
  return login ? `${LOCAL_PREFIX}${login}` : '';
}

function idbKey(login?: string): string {
  return `${IDB_PREFIX}${login || 'anonymous'}`;
}

function validStore(value: unknown): SessionStore | null {
  if (!value || typeof value !== 'object') return null;
  const store = value as Partial<SessionStore>;
  if (!Array.isArray(store.sessions) || !store.sessions.length) return null;
  return {
    sessions: store.sessions.filter((session): session is V2Session => Boolean(
      session && typeof session === 'object' && typeof session.id === 'string' && Array.isArray(session.messages),
    )),
    activeId: typeof store.activeId === 'string' ? store.activeId : store.sessions[0]?.id || '',
  };
}

function readLocal(login?: string): SessionStore | null {
  try {
    const raw = login ? localStorage.getItem(sessionLocalKey(login)) : null;
    return raw ? validStore(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function loadSessionStore(login?: string): Promise<SessionStore | null> {
  const fromDb = validStore(await idbGet<unknown>(idbKey(login)));
  if (fromDb) {
    try {
      if (login) localStorage.removeItem(sessionLocalKey(login));
    } catch {
      // ignore
    }
    return fromDb;
  }

  const local = readLocal(login);
  if (local) {
    const persisted = await idbSet(idbKey(login), local);
    if (persisted) {
      try {
        if (login) localStorage.removeItem(sessionLocalKey(login));
      } catch {
        // ignore
      }
    }
    return local;
  }
  return null;
}

export async function saveSessionStore(
  login: string | undefined,
  store: SessionStore,
): Promise<{ ok: boolean; fallback?: boolean; error?: string }> {
  const persisted = await idbSet(idbKey(login), store);
  if (persisted) {
    try {
      if (login) localStorage.removeItem(sessionLocalKey(login));
    } catch {
      // ignore
    }
    return { ok: true };
  }

  try {
    if (!login) return { ok: false, error: '未登录' };
    localStorage.setItem(sessionLocalKey(login), JSON.stringify(store));
    return { ok: true, fallback: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '会话保存失败',
    };
  }
}