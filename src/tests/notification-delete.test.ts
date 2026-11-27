import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCacheKey, clearApiCache, deleteNotification, getCached, getNotifications, markAllNotificationsRead, markNotificationRead, setCached, setToken } from '@/services/github';
import { notificationDestination } from '@/lib/notificationLink';
import type { GitHubNotification } from '@/types/types';

describe('notification service', () => {
  beforeEach(() => { localStorage.clear(); clearApiCache(); setToken('test-token'); });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearApiCache();
    setToken(null);
  });

  it.each([205, 304])('invalidates the inbox after an empty HTTP %i read response', async status => {
    const listUrl = 'https://api.github.com/notifications?all=false&is_done=false&participating=false&per_page=50&page=1';
    const cacheKey = buildCacheKey(listUrl);
    setCached(cacheKey, [{ id: 'thread-123', unread: true }]);
    const fetchMock = vi.fn(async () => new Response(null, { status }));
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

  it.each([
    [205, 'completed'],
    [304, 'completed'],
    [202, 'pending'],
  ])('handles bulk HTTP %i without parsing an empty response', async (status, outcome) => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status }));
    vi.stubGlobal('fetch', fetchMock);
    const cutoff = '2026-11-27T01:00:00Z';
    await expect(markAllNotificationsRead(cutoff)).resolves.toBe(outcome);
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/notifications', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ last_read_at: cutoff, read: true }),
    }));
  });

  it('preserves GitHub permission errors for the UI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ message: 'Resource not accessible' }, { status: 403 })));
    await expect(markAllNotificationsRead()).rejects.toMatchObject({ status: 403, message: 'Resource not accessible' });
  });

  it('refreshes completed notifications without reusing a stale response, and returns the next-page flag', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json([{ id: '12' }], {
      headers: { Link: '<https://api.github.com/notifications?all=true&is_done=true&page=3>; rel="next"' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const staleUrl = 'https://api.github.com/notifications?all=true&is_done=true&participating=false&per_page=50&page=2';
    setCached(buildCacheKey(staleUrl), { data: [], hasNextPage: false }, 'stale');
    await expect(getNotifications({ done: true, page: 2 }, { fresh: true })).resolves.toEqual({
      data: [{ id: '12' }], hasNextPage: true,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).searchParams.get('is_done')).toBe('true');
    expect(new Headers(init.headers).get('If-None-Match')).toBeNull();
  });
});

describe('notification destination', () => {
  const destination = (type: string, url: string | null) => notificationDestination({
    repository: { full_name: 'alice/demo' },
    subject: { type, url },
  } as GitHubNotification);

  it('opens issue, pull request and commit details', () => {
    expect(destination('Issue', 'https://api.github.com/repos/alice/demo/issues/12')).toBe('/repos/alice/demo/issues/12');
    expect(destination('PullRequest', 'https://api.github.com/repos/alice/demo/pulls/5')).toBe('/repos/alice/demo/pulls/5');
    expect(destination('Commit', 'https://api.github.com/repos/alice/demo/commits/abc12345')).toBe('/repos/alice/demo/commits/abc12345');
  });

  it('opens appropriate GitHub sections for releases and discussions', () => {
    expect(destination('Release', null)).toBe('https://github.com/alice/demo/releases');
    expect(destination('Discussion', 'https://api.github.com/repos/alice/demo/discussions/6')).toBe('https://github.com/alice/demo/discussions/6');
    expect(destination('Issue', 'https://example.test/repos/alice/demo/issues/12')).toBe('/repos/alice/demo/issues');
  });
});
