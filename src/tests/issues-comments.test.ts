import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteIssueComment, updateIssueComment } from '@/services/github';

function commentResponse(body = 'updated') {
  return new Response(JSON.stringify({
    id: 99,
    body,
    user: { login: 'alice' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    html_url: 'https://github.com/o/r/issues/1#issuecomment-99',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('issue comment mutations', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('updates an issue comment through the repository endpoint', async () => {
    const fetchMock = vi.fn(async () => commentResponse());
    vi.stubGlobal('fetch', fetchMock);
    const updated = await updateIssueComment('o', 'r', 99, 'updated');
    expect(updated.body).toBe('updated');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/repos/o/r/issues/comments/99');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ body: 'updated' });
  });

  it('deletes an issue comment', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await deleteIssueComment('o', 'r', 99);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/repos/o/r/issues/comments/99');
    expect(init.method).toBe('DELETE');
  });
});
