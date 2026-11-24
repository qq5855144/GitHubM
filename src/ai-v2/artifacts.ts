// AI V2 — Artifact Store：大工具结果落盘到本机，模型按需分页读取
import type { ArtifactMeta } from './types';
import {
  clearArtifactContents,
  deleteArtifactContent,
  getArtifactContent,
  putArtifactContent,
} from './artifactDb';

const INDEX_PREFIX = 'githubm_ai_artifact_index:';
const DATA_PREFIX = 'githubm_ai_artifact_data:';
const MAX_ARTIFACTS = 20;
const MAX_ARTIFACT_CHARS = 200_000;
const MAX_TASK_ARTIFACTS = 96;
const TASK_EVIDENCE_TTL = 7 * 24 * 60 * 60 * 1000;

type StoredArtifact = ArtifactMeta & { retainUntil?: number };

function safeLogin(login?: string): string {
  return encodeURIComponent(login || 'anonymous');
}

function indexKey(login?: string): string {
  return `${INDEX_PREFIX}${safeLogin(login)}`;
}

function dataKey(login: string | undefined, id: string): string {
  return `${DATA_PREFIX}${safeLogin(login)}:${id}`;
}

function readIndex(login?: string): StoredArtifact[] {
  try {
    const raw = localStorage.getItem(indexKey(login));
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed as StoredArtifact[] : [];
  } catch {
    return [];
  }
}

function writeIndex(login: string | undefined, items: StoredArtifact[]): void {
  localStorage.setItem(indexKey(login), JSON.stringify(items));
}

export async function saveArtifact(params: {
  login?: string;
  runId?: string;
  taskEvidence?: boolean;
  toolName?: string;
  title: string;
  mime?: string;
  content: string;
}): Promise<ArtifactMeta | null> {
  const original = params.content || '';
  const content = original.length > MAX_ARTIFACT_CHARS
    ? `${original.slice(0, MAX_ARTIFACT_CHARS)}\n\n…（Artifact 已截断，原长度 ${original.length} 字符）`
    : original;
  const id = `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const meta: StoredArtifact = {
    id,
    title: params.title.slice(0, 160),
    mime: params.mime || 'text/plain',
    size: content.length,
    createdAt: new Date().toISOString(),
    runId: params.runId,
    toolName: params.toolName,
    preview: content.slice(0, 320),
    retainUntil: params.taskEvidence ? Date.now() + TASK_EVIDENCE_TTL : undefined,
  };

  try {
    const persisted = await putArtifactContent(params.login, id, content);
    if (!persisted) localStorage.setItem(dataKey(params.login, id), content);

    const previous = readIndex(params.login);
    const all = [meta, ...previous];
    const retained = new Set(all.slice(0, MAX_ARTIFACTS).map(item => item.id));
    const now = Date.now();
    for (const item of all.filter(item => (item.retainUntil ?? 0) > now).slice(0, MAX_TASK_ARTIFACTS)) {
      retained.add(item.id);
    }
    writeIndex(params.login, all.filter(item => retained.has(item.id)));

    for (const item of previous) {
      if (!retained.has(item.id)) {
        try { localStorage.removeItem(dataKey(params.login, item.id)); } catch { /* optional fallback */ }
        void deleteArtifactContent(params.login, item.id);
      }
    }
    return meta;
  } catch {
    try { localStorage.removeItem(dataKey(params.login, id)); } catch { /* optional fallback */ }
    void deleteArtifactContent(params.login, id);
    return null;
  }
}

export async function readArtifact(
  login: string | undefined,
  id: string,
  offset = 0,
  limit = 12000,
): Promise<{
  meta: ArtifactMeta | null;
  content: string;
  total: number;
  nextOffset: number;
  hasMore: boolean;
}> {
  const meta = readIndex(login).find(item => item.id === id) || null;
  if (!meta) return { meta: null, content: '', total: 0, nextOffset: 0, hasMore: false };
  let full = await getArtifactContent(login, id) ?? undefined;
  if (full === undefined) {
    try {
      full = localStorage.getItem(dataKey(login, id)) || '';
    } catch {
      full = '';
    }
  }
  const safeOffset = Math.max(0, Math.min(offset, full.length));
  const safeLimit = Math.max(1, Math.min(limit, 20000));
  const content = full.slice(safeOffset, safeOffset + safeLimit);
  const nextOffset = safeOffset + content.length;
  return {
    meta,
    content,
    total: full.length,
    nextOffset,
    hasMore: nextOffset < full.length,
  };
}

export function listArtifacts(login?: string, limit = 20): ArtifactMeta[] {
  return readIndex(login).slice(0, Math.max(1, limit));
}

export function clearArtifacts(login?: string): void {
  const items = readIndex(login);
  for (const item of items) {
    try {
      localStorage.removeItem(dataKey(login, item.id));
    } catch {
      // ignore
    }
  }
  void clearArtifactContents(login);
  try {
    localStorage.removeItem(indexKey(login));
  } catch {
    // ignore
  }
}

export const ARTIFACT_LIMITS = {
  maxArtifacts: MAX_ARTIFACTS,
  maxChars: MAX_ARTIFACT_CHARS,
};