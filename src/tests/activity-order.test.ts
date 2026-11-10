import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserEvents } from '@/services/github';
import type { GitHubEvent } from '@/types/types';

function event(id: string, createdAt: string): GitHubEvent {
  return {
    id,
    type: 'PushEvent',
    actor: { login: 'tester', avatar_url: '' },
    repo: { name: 'tester/repo', url: '' },
    payload: {},
    created_at: createdAt,
  };
}

describe('getUserEvents', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sorts events newest first even when GitHub returns an unsorted page', async () => {
    const unsorted = [
      event('old', '2026-11-08T08:00:00Z'),
      event('newest', '2026-11-09T15:00:00Z'),
      event('middle', '2026-11-09T09:00:00Z'),
    ];

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => unsorted,
    }) as Response));

    const result = await getUserEvents('event-order-owner', 1);

    expect(result.map((item) => item.id)).toEqual(['newest', 'middle', 'old']);
  });
});