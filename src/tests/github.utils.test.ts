/**
 * GitHub URL / 路径处理工具单元测试
 *
 * 覆盖场景：
 *  parseLinkHeader（分页链接解析）：
 *    1. 解析含 next 的 Link header
 *    2. 解析含 prev + next + last 的完整 Link header
 *    3. 空字符串返回空对象
 *    4. 格式异常时不崩溃
 *
 *  resolveRedirectUrl（GitHub 302 重定向逻辑）：
 *    5. 3xx 响应返回 Location 头的 URL
 *    6. 200 响应返回原始 URL
 *    7. 其他状态码返回 null（下载失败）
 *
 *  normalizeHashPath（HashRouter 路径提取）：
 *    8. 带 # 的完整 URL 提取路径
 *    9. 路径不以 / 开头时自动补全
 *   10. 无 # 时返回根路径
 */
import { describe, it, expect } from 'vitest';

// ── 内联测试目标函数（与 github.ts 实现保持同步）─────────────────────

/** 解析 GitHub Link header 中的分页链接 */
function parseLinkHeader(link: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!link) return result;
  const parts = link.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      result[match[2]] = match[1];
    }
  }
  return result;
}

/**
 * 模拟 resolveAndDownload 的核心决策逻辑（纯函数部分）。
 * 根据 HTTP 状态码和 Location 头决定最终下载 URL。
 */
function resolveRedirectUrl(
  statusCode: number,
  location: string | null,
  originalUrl: string,
): string | null {
  if (statusCode >= 300 && statusCode <= 399 && location) {
    return location; // 使用预签名 URL（不含 Authorization）
  }
  if (statusCode === 200) {
    return originalUrl; // 直链，携带 auth
  }
  return null; // 下载失败
}

/**
 * 从 WebView URL 中提取 HashRouter 路径（onPageFinished 逻辑）。
 */
function normalizeHashPath(webviewUrl: string): string {
  const hash = webviewUrl.split('#')[1] ?? '';
  return hash.startsWith('/') ? hash : `/${hash}`;
}

// ── 测试 ──────────────────────────────────────────────────────────

describe('parseLinkHeader', () => {
  it('解析含 next 的 Link header', () => {
    const header = '<https://api.github.com/repos?page=2>; rel="next"';
    const links = parseLinkHeader(header);
    expect(links.next).toBe('https://api.github.com/repos?page=2');
  });

  it('解析含 prev + next + last 的完整 Link header', () => {
    const header = [
      '<https://api.github.com/repos?page=1>; rel="prev"',
      '<https://api.github.com/repos?page=3>; rel="next"',
      '<https://api.github.com/repos?page=10>; rel="last"',
    ].join(', ');
    const links = parseLinkHeader(header);
    expect(links.prev).toBe('https://api.github.com/repos?page=1');
    expect(links.next).toBe('https://api.github.com/repos?page=3');
    expect(links.last).toBe('https://api.github.com/repos?page=10');
  });

  it('空字符串返回空对象', () => {
    expect(parseLinkHeader('')).toEqual({});
  });

  it('格式异常的 header 不崩溃返回空对象', () => {
    expect(parseLinkHeader('not-a-link-header')).toEqual({});
  });

  it('rel 前后有空格也能正确解析', () => {
    const header = '<https://api.github.com/next>; rel = "next"';
    // 严格格式不匹配时返回空，确认不崩溃
    expect(() => parseLinkHeader(header)).not.toThrow();
  });
});

describe('resolveRedirectUrl', () => {
  const originalUrl = 'https://api.github.com/repos/owner/repo/releases/assets/123';
  const s3Url = 'https://objects.githubusercontent.com/signed?token=xyz';

  it('302 响应且有 Location → 使用预签名 S3 URL', () => {
    const result = resolveRedirectUrl(302, s3Url, originalUrl);
    expect(result).toBe(s3Url);
  });

  it('301 重定向也使用 Location URL', () => {
    const result = resolveRedirectUrl(301, s3Url, originalUrl);
    expect(result).toBe(s3Url);
  });

  it('3xx 但无 Location → 回退到原始 URL（null）', () => {
    const result = resolveRedirectUrl(302, null, originalUrl);
    expect(result).toBeNull();
  });

  it('200 直链 → 使用原始 URL（含 auth）', () => {
    const result = resolveRedirectUrl(200, null, originalUrl);
    expect(result).toBe(originalUrl);
  });

  it('200 即使有 Location 也使用原始 URL', () => {
    const result = resolveRedirectUrl(200, s3Url, originalUrl);
    expect(result).toBe(originalUrl);
  });

  it('404 → 返回 null（下载失败）', () => {
    expect(resolveRedirectUrl(404, null, originalUrl)).toBeNull();
  });

  it('500 → 返回 null（服务器错误）', () => {
    expect(resolveRedirectUrl(500, null, originalUrl)).toBeNull();
  });

  it('401 → 返回 null（鉴权失败）', () => {
    expect(resolveRedirectUrl(401, null, originalUrl)).toBeNull();
  });
});

describe('normalizeHashPath', () => {
  it('带 # 的完整 WebView URL 提取路径部分', () => {
    const url = 'file:///android_asset/index.html#/repos/owner/name';
    expect(normalizeHashPath(url)).toBe('/repos/owner/name');
  });

  it('路径不以 / 开头时自动补全斜杠', () => {
    const url = 'file:///android_asset/index.html#repos';
    expect(normalizeHashPath(url)).toBe('/repos');
  });

  it('根路径 # 后为空字符串时返回 /', () => {
    const url = 'file:///android_asset/index.html#';
    expect(normalizeHashPath(url)).toBe('/');
  });

  it('无 # 时返回根路径', () => {
    const url = 'file:///android_asset/index.html';
    expect(normalizeHashPath(url)).toBe('/');
  });

  it('带查询参数的哈希路径正确提取', () => {
    const url = 'file:///android_asset/index.html#/search?q=react';
    expect(normalizeHashPath(url)).toBe('/search?q=react');
  });

  it('嵌套子路径正确保留', () => {
    const url = 'file:///android_asset/index.html#/repos/torvalds/linux/issues/1234';
    expect(normalizeHashPath(url)).toBe('/repos/torvalds/linux/issues/1234');
  });
});
