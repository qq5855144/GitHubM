// AI V2 — Artifact Store：大工具结果落盘到本机，模型按需分页读取
import type { ArtifactMeta } from './types';

const INDEX_PREFIX = 'githubm_ai_artifact_index:';
const DATA_PREFIX = 'githubm_ai_artifact_data:';
const MAX_ARTIFACTS = 20;
const MAX_ARTIFACT_CHARS = 200_000;

function safeLogin(login?: string): string {
  return encodeURIComponent(login || 'anonymous');
}

function indexKey(login?: string): string {
  return `${INDEX_PREFIX}${safeLogin(login)}`;
}

function dataKey(login: string | undefined, id: string): string {
  return `${DATA_PREFIX}${safeLogin(login)}:${id}`;
}

function readIndex(login?: string): ArtifactMeta[] {
  try {
    const raw = localStorage.getItem(indexKey(login));
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed as ArtifactMeta[] : [];
  } catch {
    return [];
  }
}

function writeIndex(login: string | undefined, items: ArtifactMeta[]): void {
  localStorage.setItem(indexKey(login), JSON.stringify(items));
}

export function saveArtifact(params: {
  login?: string;
  runId?: string;
  toolName?: string;
  title: string;
  mime?: string;
  content: string;
}): ArtifactMeta | null {
  const original = params.content || '';
  const content = original.length > MAX_ARTIFACT_CHARS
    ? `${original.slice(0, MAX_ARTIFACT_CHARS)}\n\n…（Artifact 已截断，原长度 ${original.length} 字符）`
    : original;
  const id = `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const meta: ArtifactMeta = {
    id,
    title: params.title.slice(0, 160),
    mime: params.mime || 'text/plain',
    size: content.length,
    createdAt: new Date().toISOString(),
    runId: params.runId,
    toolName: params.toolName,
    preview: content.slice(0, 320),
  };

  try {
    localStorage.setItem(dataKey(params.login, id), content);
    const previous = readIndex(params.login);
    const next = [meta, ...previous].slice(0, MAX_ARTIFACTS);
    writeIndex(params.login, next);

    // 清理超出上限的旧 Artifact 正文
    const kept = new Set(next.map(item => item.id));
    for (const item of previous) {
      if (!kept.has(item.id)) localStorage.removeItem(dataKey(params.login, item.id));
    }
    return meta;
  } catch {
    return null;
  }
}

export function readArtifact(
  login: string | undefined,
  id: string,
  offset = 0,
  limit = 12000,
): {
  meta: ArtifactMeta | null;
  content: string;
  total: number;
  nextOffset: number;
  hasMore: boolean;
} {
  const meta = readIndex(login).find(item => item.id === id) || null;
  if (!meta) return { meta: null, content: '', total: 0, nextOffset: 0, hasMore: false };
  const full = localStorage.getItem(dataKey(login, id)) || '';
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