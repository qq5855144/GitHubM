import { describe, expect, it } from 'vitest';
import { compoundExt, getAssetIcon } from '../lib/assetIcon';

describe('compoundExt', () => {
  it('识别组合扩展名', () => {
    expect(compoundExt('source.tar.gz')).toBe('tar.gz');
    expect(compoundExt('pkg.tar.zst')).toBe('tar.zst');
    expect(compoundExt('app.AppImage')).toBe('appimage');
  });

  it('识别普通扩展名并转小写', () => {
    expect(compoundExt('GitHubM.APK')).toBe('apk');
    expect(compoundExt('x.WEBP')).toBe('webp');
  });

  it('无扩展名返回空串', () => {
    expect(compoundExt('web-dist')).toBe('');
    expect(compoundExt('apk')).toBe('');
    expect(compoundExt('app-release')).toBe('');
  });
});

describe('getAssetIcon 按扩展名识别', () => {
  it('.apk 识别为 Android 安装包', () => {
    expect(getAssetIcon('GitHubM-v1.0.632.apk').label).toBe('Android 安装包');
  });

  it('大小写不敏感', () => {
    expect(getAssetIcon('app.APK').label).toBe('Android 安装包');
  });

  it('.aab / .aab 后缀', () => {
    expect(getAssetIcon('app-release.aab').label).toBe('Android App Bundle');
  });

  it('压缩包与组合扩展名', () => {
    expect(getAssetIcon('source.tar.gz').label).toBe('压缩包');
    expect(getAssetIcon('bundle.zip').label).toBe('压缩包');
  });

  it('桌面安装包', () => {
    expect(getAssetIcon('setup.exe').label).toBe('Windows 安装包');
    expect(getAssetIcon('app.dmg').label).toBe('macOS 安装包');
    expect(getAssetIcon('app.deb').label).toBe('Linux 安装包');
  });
});

describe('getAssetIcon 校验文件优先', () => {
  it('扩展名优先于语义：app.apk.sha256 是校验文件', () => {
    expect(getAssetIcon('app.apk.sha256').label).toBe('校验文件');
  });
});

describe('getAssetIcon 无后缀 artifact 语义识别', () => {
  it('真实 artifact：github-manager-test-apk', () => {
    expect(getAssetIcon('github-manager-test-apk').label).toBe('Android 安装包');
  });

  it('真实 artifact：web-dist', () => {
    expect(getAssetIcon('web-dist').label).toBe('网页构建产物');
  });

  it('真实 artifact：github-pages', () => {
    expect(getAssetIcon('github-pages').label).toBe('网页构建产物');
  });

  it('bundle 识别为 AAB', () => {
    expect(getAssetIcon('bundle').label).toBe('Android App Bundle');
  });

  it('android-bundle 优先识别为 AAB 而非 APK', () => {
    expect(getAssetIcon('android-bundle').label).toBe('Android App Bundle');
  });

  it('含平台信息的变体', () => {
    expect(getAssetIcon('android64').label).toBe('Android 安装包');
    expect(getAssetIcon('android-arm64-apk').label).toBe('Android 安装包');
    expect(getAssetIcon('win64-portable').label).toBe('Windows 安装包');
    expect(getAssetIcon('macos-arm64').label).toBe('macOS 安装包');
  });

  it('校验 / 签名 / 源码语义', () => {
    expect(getAssetIcon('checksums').label).toBe('校验文件');
    expect(getAssetIcon('sha256sums').label).toBe('校验文件');
    expect(getAssetIcon('signature').label).toBe('签名文件');
    expect(getAssetIcon('source').label).toBe('压缩包');
  });
});

describe('getAssetIcon 兜底与边界', () => {
  it('无关名称回落为通用文件', () => {
    expect(getAssetIcon('random-thing').label).toBe('文件');
    expect(getAssetIcon('api-docs').label).toBe('文件');
    expect(getAssetIcon('app-release').label).toBe('文件');
  });

  it('空名与空白名回落为通用文件', () => {
    expect(getAssetIcon('').label).toBe('文件');
    expect(getAssetIcon('   ').label).toBe('文件');
    expect(getAssetIcon(undefined as unknown as string).label).toBe('文件');
  });

  it('每个结果都有图标与颜色', () => {
    for (const name of ['a.apk', 'web-dist', 'x.sha256', 'random-thing']) {
      const info = getAssetIcon(name);
      expect(info.Icon).toBeTruthy();
      expect(info.color).toMatch(/^text-/);
      expect(info.label.length).toBeGreaterThan(0);
    }
  });
});
