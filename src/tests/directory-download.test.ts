import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/github', () => ({
  getBranch: vi.fn(async () => ({ commit: { sha: 'commit-sha' } })),
  getGitTree: vi.fn(async () => ({
    truncated: false,
    tree: [
      { type: 'blob', path: 'src/a.txt', sha: 'blob-a' },
      { type: 'blob', path: 'src/sub/b.txt', sha: 'blob-b' },
    ],
  })),
  getGitBlob: vi.fn(async (_owner: string, _repo: string, sha: string) => ({
    content: btoa(sha === 'blob-a' ? 'hello' : 'world'),
  })),
}));

import { downloadRepoDirectoryZip } from '@/lib/githubDownload';

describe('directory ZIP download', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
    vi.restoreAllMocks();
  });

  it('passes non-empty ZIP data to the Android bridge instead of revoking a blob URL', async () => {
    const saveBlobData = vi.fn();
    (window as unknown as { AndroidBridge?: { saveBlobData: typeof saveBlobData } }).AndroidBridge = {
      saveBlobData,
    };

    await downloadRepoDirectoryZip({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      directory: 'src',
      token: 'token',
    });

    expect(saveBlobData).toHaveBeenCalledTimes(1);
    const [filename, mimeType, base64] = saveBlobData.mock.calls[0];
    expect(filename).toBe('src.zip');
    expect(mimeType).toBe('application/zip');
    expect(base64.length).toBeGreaterThan(10);
    expect(atob(base64).slice(0, 2)).toBe('PK');
  });
});