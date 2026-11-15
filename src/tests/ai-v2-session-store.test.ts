import { beforeEach, describe, expect, it } from 'vitest';
import { loadSessionStore, saveSessionStore, sessionLocalKey } from '@/ai-v2/sessionStore';
import type { SessionStore } from '@/ai-v2/sessionStore';

const store: SessionStore = {
  activeId: 's1',
  sessions: [{
    id: 's1',
    title: '测试会话',
    repo: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [{ id: 'm1', role: 'user', content: '你好', createdAt: '2026-01-01T00:00:00.000Z' }],
  }],
};

describe('AI session store', () => {
  beforeEach(() => localStorage.clear());

  it('falls back to localStorage when IndexedDB is unavailable', async () => {
    const saved = await saveSessionStore('alice', store);
    expect(saved.ok).toBe(true);
    expect(saved.fallback).toBe(true);
    expect(localStorage.getItem(sessionLocalKey('alice'))).toBeTruthy();

    const loaded = await loadSessionStore('alice');
    expect(loaded?.activeId).toBe('s1');
    expect(loaded?.sessions[0].messages[0].content).toBe('你好');
  });

  it('returns null for an empty account', async () => {
    expect(await loadSessionStore('nobody')).toBeNull();
  });
});