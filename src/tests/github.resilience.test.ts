import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApiCache, getCurrentUser, setToken } from '@/services/github';

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
