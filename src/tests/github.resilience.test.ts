import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCacheKey, clearApiCache, getCurrentUser, getUserByLogin, setCached, setToken } from '@/services/github';
import { cancelRateLimitWait, getRateLimitStatus } from '@/lib/githubRateLimitStatus';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('GitHub request resilience', () => {
  beforeEach(() => {
    clearApiCache();
    setToken('test-token');
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    clearApiCache();
    setToken(null);
  });

  it('waits for the primary rate-limit reset instead of failing the task', async () => {
    vi.useFakeTimers();
    const reset = Math.floor(Date.now() / 1000) + 1;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(
        { message: 'API rate limit exceeded' },
        403,
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
      ))
      .mockResolvedValueOnce(jsonResponse({ login: 'octocat' }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = getCurrentUser();
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(pending).resolves.toMatchObject({ login: 'octocat' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('revalidates with If-None-Match and serves the cached body on 304', async () => {
    vi.useFakeTimers();
    const url = 'https://api.github.com/users/octocat';
    setCached(buildCacheKey(url), { login: 'cached-user' }, 'etag-1');
    vi.advanceTimersByTime(31_000);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 304,
      headers: { etag: 'etag-1' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getUserByLogin('octocat')).resolves.toMatchObject({ login: 'cached-user' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('etag-1');
  });
  it('aborts a hanging request after 30 seconds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = getCurrentUser();
    const assertion = expect(pending).rejects.toThrow('请求超时');
    await vi.advanceTimersByTimeAsync(30_500);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('cancels a rate-limit wait on user request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { message: 'API rate limit exceeded' },
      403,
      { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const pending = getCurrentUser();
    const assertion = expect(pending).rejects.toThrow('已取消 GitHub 配额等待');
    await vi.advanceTimersByTimeAsync(10);
    expect(getRateLimitStatus().active).toBe(true);
    cancelRateLimitWait();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getRateLimitStatus().active).toBe(false);
  });
  it('does not retry a plain permission 403', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { message: 'Resource not accessible by integration' },
      403,
      { 'x-ratelimit-remaining': '4999' },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCurrentUser()).rejects.toThrow('Resource not accessible by integration');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
