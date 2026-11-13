import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteNotification } from '@/services/github';

describe('deleteNotification', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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