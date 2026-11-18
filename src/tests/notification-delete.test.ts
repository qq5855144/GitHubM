import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCacheKey, clearApiCache, deleteNotification, getCached, markNotificationRead, setCached, setToken } from '@/services/github';

describe('deleteNotification', () => {
  beforeEach(() => { localStorage.clear(); clearApiCache(); setToken('test-token'); });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearApiCache();
    setToken(null);
  });

  it('invalidates the notification list cache after marking one read', async () => {
    const listUrl = 'https://api.github.com/notifications?all=false&participating=false&per_page=50&page=1';
    const cacheKey = buildCacheKey(listUrl);
    setCached(cacheKey, [{ id: 'thread-123', unread: true }]);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 204,
      headers: new Headers(),
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    await markNotificationRead('thread-123');
    expect(getCached(cacheKey)).toBeNull();
  });
  it('deletes the GitHub notification thread', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 204,
      headers: new Headers(),
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    await deleteNotification('thread-123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/notifications/threads/thread-123');
    expect(init.method).toBe('DELETE');
  });
});