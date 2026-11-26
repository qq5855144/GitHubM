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
  getToken: vi.fn(() => 'token'),
  getGitBlobRaw: vi.fn(async (_owner: string, _repo: string, sha: string) =>
    new Response(sha === 'blob-a' ? 'hello' : 'world')),

}));

import { downloadRepoDirectoryZip } from '@/lib/githubDownload';
import { strFromU8, unzipSync } from 'fflate';
import { getGitBlobRaw } from '@/services/github';

describe('directory ZIP download', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
    vi.restoreAllMocks();
  });

  it('streams a whole-repository zipball through the native downloader', async () => {
    const downloadFile = vi.fn();
    (window as unknown as { AndroidBridge?: { downloadFile: typeof downloadFile } }).AndroidBridge = {
      downloadFile,
    };
    await downloadRepoDirectoryZip({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      directory: '',
      token: 'token',
    });
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [url, filename, token] = downloadFile.mock.calls[0];
    expect(url).toContain('/repos/owner/repo/zipball/main');
    expect(filename).toBe('repo.zip');
    expect(token).toBe('token');
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
    const files = unzipSync(Uint8Array.from(atob(base64), character => character.charCodeAt(0)));
    expect(strFromU8(files['src/a.txt'])).toBe('hello');
    expect(strFromU8(files['src/sub/b.txt'])).toBe('world');
  });
  it('streams larger ZIPs to the new Android bridge in bounded chunks', async () => {
    const file = new Uint8Array(600 * 1024).fill(97);
    vi.mocked(getGitBlobRaw).mockResolvedValueOnce(new Response(file));
    const parts: Uint8Array[] = [];
    const finishBlobDownload = vi.fn(() => '');
    const cancelBlobDownload = vi.fn();
    const appendBlobDownload = vi.fn((_id: string, base64: string) => {
      parts.push(Uint8Array.from(atob(base64), character => character.charCodeAt(0)));
      return '';
    });
    const bridge = {
      startBlobDownload: vi.fn(() => 'stream-id'),
      appendBlobDownload, finishBlobDownload, cancelBlobDownload,
      saveBlobData: vi.fn(),
    };
    (window as Window & { AndroidBridge?: unknown }).AndroidBridge = bridge;

    await downloadRepoDirectoryZip({ owner: 'owner', repo: 'repo', branch: 'main', directory: 'src', token: 'token' });

    expect(bridge.startBlobDownload).toHaveBeenCalledWith('src.zip', 'application/zip');
    expect(bridge.saveBlobData).not.toHaveBeenCalled();
    expect(finishBlobDownload).toHaveBeenCalledWith('stream-id');
    expect(cancelBlobDownload).not.toHaveBeenCalled();
    expect(parts.length).toBeGreaterThan(3);
    expect(Math.max(...parts.map(part => part.length))).toBeLessThanOrEqual(256 * 1024);
    const archive = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      archive.set(part, offset);
      offset += part.length;
    }
    const files = unzipSync(archive);
    expect(files['src/a.txt']).toEqual(file);
    expect(strFromU8(files['src/sub/b.txt'])).toBe('world');
  });

  it('discards the native partial archive when cancelled', async () => {
    const controller = new AbortController();
    const bridge = {
      startBlobDownload: vi.fn(() => 'partial-id'),
      appendBlobDownload: vi.fn(() => ''),
      finishBlobDownload: vi.fn(() => ''),
      cancelBlobDownload: vi.fn(),
    };
    (window as Window & { AndroidBridge?: unknown }).AndroidBridge = bridge;
    await expect(downloadRepoDirectoryZip({
      owner: 'owner', repo: 'repo', branch: 'main', directory: 'src', token: 'token',
      signal: controller.signal,
      onProgress: () => controller.abort(),
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(bridge.cancelBlobDownload).toHaveBeenCalledWith('partial-id');
    expect(bridge.finishBlobDownload).not.toHaveBeenCalled();
  });
});