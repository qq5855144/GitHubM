import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DOWNLOAD_PROXY_URL,
  downloadGithubFile,
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
    vi.restoreAllMocks();
  });

  it('defaults to disabled with wget.la as the fallback proxy', () => {
    expect(isDownloadProxyEnabled()).toBe(false);
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

  it('uses the global proxy for GitHub downloads without leaking token', async () => {
    const downloadFile = vi.fn();
    (window as unknown as { AndroidBridge?: { downloadFile: typeof downloadFile } }).AndroidBridge = { downloadFile };
    setDownloadProxyEnabled(true);

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

    await downloadGithubFile('https://github.com/a/b/releases/download/v1/app.apk', 'app.apk', 'secret-token');

    expect(downloadFile).toHaveBeenCalledWith(
      'https://github.com/a/b/releases/download/v1/app.apk',
      'app.apk',
      'secret-token'
    );
  });
});
