// AI V2 — 长期记忆（本机、按账号隔离）
export interface MemoryRecord {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const PREFIX = 'githubm_ai_memory:';
const MAX_MEMORIES = 80;

function key(login?: string): string {
  return `${PREFIX}${encodeURIComponent(login || 'anonymous')}`;
}

function readAll(login?: string): MemoryRecord[] {
  try {
    const raw = localStorage.getItem(key(login));
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed as MemoryRecord[] : [];
  } catch {
    return [];
  }
}

function writeAll(login: string | undefined, items: MemoryRecord[]): void {
  localStorage.setItem(key(login), JSON.stringify(items.slice(0, MAX_MEMORIES)));
}

export function listMemories(login?: string, limit = 50): MemoryRecord[] {
  return readAll(login).slice(0, Math.max(1, limit));
}

export function saveMemory(login: string | undefined, content: string, tags: string[] = []): MemoryRecord | null {
  const text = content.trim().slice(0, 4000);
  if (!text) return null;
  const now = new Date().toISOString();
  const existing = readAll(login);
  const duplicate = existing.find(item => item.content === text);
  if (duplicate) {
    duplicate.updatedAt = now;
    writeAll(login, existing);
    return duplicate;
  }
  const record: MemoryRecord = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    content: text,
    tags: tags.map(tag => tag.trim()).filter(Boolean).slice(0, 8),
    createdAt: now,
    updatedAt: now,
  };
  writeAll(login, [record, ...existing]);
  return record;
}

export function searchMemories(login: string | undefined, query: string, limit = 5): MemoryRecord[] {
  const items = readAll(login);
  const terms = query
    .toLowerCase()
    .split(/[\s,，。.;；:：/\\|]+/)
    .map(term => term.trim())
    .filter(term => term.length > 1)
    .slice(0, 12);
  if (!terms.length) return items.slice(0, limit);
  const scored = items.map(item => {
    const haystack = `${item.content}\n${item.tags.join(' ')}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) score += term.length;
    }
    return { item, score };
  }).filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.item.updatedAt) - Date.parse(a.item.updatedAt));
  return scored.slice(0, limit).map(entry => entry.item);
}

export function deleteMemory(login: string | undefined, id: string): void {
  writeAll(login, readAll(login).filter(item => item.id !== id));
}

export function clearMemories(login?: string): void {
  localStorage.removeItem(key(login));
}