import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DOWNLOAD_PROXY_URL,
  downloadGithubFile,
  isAutoDownloadProxyEnabled,
  resolveDownloadProxyUrl,
  setAutoDownloadProxyEnabled,
  testFastestDownloadProxy,
  getDownloadProxyUrl,
  isDownloadProxyEnabled,
  setDownloadProxyEnabled,
  setDownloadProxyUrl,
  toDownloadProxyUrl,
} from '@/lib/githubDownload';

describe('global download proxy', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
  });

  afterEach(() => {
    delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defaults to disabled with wget.la as the fallback proxy', () => {
    expect(isDownloadProxyEnabled()).toBe(false);
    expect(isAutoDownloadProxyEnabled()).toBe(true);
    expect(getDownloadProxyUrl()).toBe(DEFAULT_DOWNLOAD_PROXY_URL);
  });

  it('persists the global toggle', () => {
    setDownloadProxyEnabled(true);
    expect(isDownloadProxyEnabled()).toBe(true);
    setDownloadProxyEnabled(false);
    expect(isDownloadProxyEnabled()).toBe(false);
  });

  it('supports prefix and template proxy URLs', () => {
    setDownloadProxyUrl('https://proxy.example/');
    expect(toDownloadProxyUrl('https://github.com/a/b')).toBe('https://proxy.example/https://github.com/a/b');

    setDownloadProxyUrl('https://proxy.example/?url={url_encoded}');
    expect(toDownloadProxyUrl('https://github.com/a/b')).toBe(
      'https://proxy.example/?url=https%3A%2F%2Fgithub.com%2Fa%2Fb'
    );
  });


  it('auto-tests candidates and uses the fastest cached proxy', async () => {
    setDownloadProxyEnabled(true);
    setAutoDownloadProxyEnabled(true);

    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input);
      const delay = url.includes('gh-proxy.com') ? 5 : url.includes('ghproxy.net') ? 20 : 40;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return {
        ok: true,
        status: 200,
        text: async () => 'Hello World',
      } as Response;
    }));

    const { selected, results } = await testFastestDownloadProxy({ timeoutMs: 1000 });
    expect(results).toHaveLength(3);
    expect(selected.baseUrl).toBe('https://gh-proxy.com/');

    const resolved = await resolveDownloadProxyUrl('https://github.com/a/b/releases/download/v1/app.apk');
    expect(resolved).toBe('https://gh-proxy.com/https://github.com/a/b/releases/download/v1/app.apk');
  });


  it('falls back to direct download when every candidate fails', async () => {
    setDownloadProxyEnabled(true);
    setAutoDownloadProxyEnabled(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    const { selected } = await testFastestDownloadProxy({ timeoutMs: 50 });
    expect(selected.latencyMs).toBe(-1);

    const source = 'https://github.com/a/b/releases/download/v1/app.apk';
    await expect(resolveDownloadProxyUrl(source)).resolves.toBe(source);
  });

  it('uses the global proxy for GitHub downloads without leaking token', async () => {
    const downloadFile = vi.fn();
    (window as unknown as { AndroidBridge?: { downloadFile: typeof downloadFile } }).AndroidBridge = { downloadFile };
    setDownloadProxyEnabled(true);
    setAutoDownloadProxyEnabled(false);

    await downloadGithubFile('https://github.com/a/b/releases/download/v1/app.apk', 'app.apk', 'secret-token');

    expect(downloadFile).toHaveBeenCalledWith(
      'https://wget.la/https://github.com/a/b/releases/download/v1/app.apk',
      'app.apk',
      ''
    );
  });

  it('keeps direct token downloads when the global proxy is disabled', async () => {
    const downloadFile = vi.fn();
    (window as unknown as { AndroidBridge?: { downloadFile: typeof downloadFile } }).AndroidBridge = { downloadFile };
    setDownloadProxyEnabled(false);
    setAutoDownloadProxyEnabled(false);

    await downloadGithubFile('https://github.com/a/b/releases/download/v1/app.apk', 'app.apk', 'secret-token');

    expect(downloadFile).toHaveBeenCalledWith(
      'https://github.com/a/b/releases/download/v1/app.apk',
      'app.apk',
      'secret-token'
    );
  });
});
