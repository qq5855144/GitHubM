import { describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE, formatFileSize, isImageAttachment, validateAttachment } from '@/lib/issueAttachments';
import { getAssetIcon } from '@/lib/assetIcon';

function fakeFile(name: string, size: number, type = ''): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('issue attachment validation', () => {
  it('accepts a normal file', () => {
    expect(validateAttachment(fakeFile('a.png', 1024, 'image/png'))).toBeNull();
  });

  it('rejects empty file', () => {
    expect(validateAttachment(fakeFile('empty.txt', 0, 'text/plain'))).toContain('为空');
  });

  it('rejects file larger than limit and mentions the limit', () => {
    const message = validateAttachment(fakeFile('big.zip', MAX_FILE_SIZE + 1));
    expect(message).toBeTruthy();
    expect(message).toContain(formatFileSize(MAX_FILE_SIZE));
  });

  it('keeps the 8MB allowance (GitHub verified threshold)', () => {
    expect(MAX_FILE_SIZE).toBe(8 * 1024 * 1024);
  });
});

describe('image detection fallback', () => {
  it('trusts mime type', () => {
    expect(isImageAttachment(fakeFile('noext', 10, 'image/png'))).toBe(true);
  });

  it('falls back to extension when mime is missing', () => {
    expect(isImageAttachment(fakeFile('shot.PNG', 10))).toBe(true);
    expect(isImageAttachment(fakeFile('report.pdf', 10))).toBe(false);
  });
});

describe('asset icon mapping', () => {
  it('maps distribution formats to dedicated icons', () => {
    expect(getAssetIcon('app-release.apk').label).toBe('Android 安装包');
    expect(getAssetIcon('app-release.aab').label).toBe('Android App Bundle');
    expect(getAssetIcon('GitHubM_1.0.0_x64.dmg').label).toBe('macOS 安装包');
    expect(getAssetIcon('GitHubM-setup.exe').label).toBe('Windows 安装包');
    expect(getAssetIcon('githubm.deb').label).toBe('Linux 安装包');
    expect(getAssetIcon('githubm.AppImage').label).toBe('AppImage');
  });

  it('handles compound extensions', () => {
    expect(getAssetIcon('source.tar.gz').label).toBe('压缩包');
    expect(getAssetIcon('build.zip').label).toBe('压缩包');
  });

  it('detects checksum and signature files', () => {
    expect(getAssetIcon('checksums.sha256').label).toBe('校验文件');
    expect(getAssetIcon('app.apk.asc').label).toBe('签名文件');
  });

  it('falls back gracefully for unknown files', () => {
    expect(getAssetIcon('weird.unknownext').label).toBe('文件');
  });
});
