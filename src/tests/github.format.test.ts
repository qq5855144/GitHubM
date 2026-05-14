/**
 * github.ts 格式化工具函数单元测试
 *
 * 覆盖函数：
 *   formatRelativeTime — 相对时间格式化
 *   formatNumber       — 数字简化展示（k 单位）
 *   getLanguageColor   — 编程语言颜色映射
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatRelativeTime, formatNumber, getLanguageColor } from '@/services/github';

// ── formatRelativeTime ──────────────────────────────────────────────
describe('formatRelativeTime', () => {
  // 固定当前时间为 2026-05-13T10:00:00Z，避免测试受系统时间影响
  const NOW = new Date('2026-05-13T10:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('30 秒前 → 刚刚', () => {
    const d = new Date(NOW - 30 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('刚刚');
  });

  it('59 秒前 → 刚刚', () => {
    const d = new Date(NOW - 59 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('刚刚');
  });

  it('1 分钟前 → 1 分钟前', () => {
    const d = new Date(NOW - 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('1 分钟前');
  });

  it('45 分钟前 → 45 分钟前', () => {
    const d = new Date(NOW - 45 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('45 分钟前');
  });

  it('1 小时前 → 1 小时前', () => {
    const d = new Date(NOW - 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('1 小时前');
  });

  it('23 小时前 → 23 小时前', () => {
    const d = new Date(NOW - 23 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('23 小时前');
  });

  it('1 天前 → 1 天前', () => {
    const d = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('1 天前');
  });

  it('29 天前 → 29 天前', () => {
    const d = new Date(NOW - 29 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('29 天前');
  });

  it('1 个月前 → 1 个月前', () => {
    const d = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('1 个月前');
  });

  it('11 个月前 → 11 个月前', () => {
    const d = new Date(NOW - 335 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('11 个月前');
  });

  it('1 年前 → 1 年前', () => {
    const d = new Date(NOW - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('1 年前');
  });

  it('3 年前 → 3 年前', () => {
    const d = new Date(NOW - 3 * 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(d)).toBe('3 年前');
  });
});

// ── formatNumber ────────────────────────────────────────────────────
describe('formatNumber', () => {
  it('0 → "0"', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('999 → "999"（不转换）', () => {
    expect(formatNumber(999)).toBe('999');
  });

  it('1000 → "1.0k"', () => {
    expect(formatNumber(1000)).toBe('1.0k');
  });

  it('1500 → "1.5k"', () => {
    expect(formatNumber(1500)).toBe('1.5k');
  });

  it('9999 → "10.0k"（四舍五入）', () => {
    expect(formatNumber(9999)).toBe('10.0k');
  });

  it('10000 → "10.0k"', () => {
    expect(formatNumber(10000)).toBe('10.0k');
  });

  it('100000 → "100.0k"', () => {
    expect(formatNumber(100000)).toBe('100.0k');
  });
});

// ── getLanguageColor ────────────────────────────────────────────────
describe('getLanguageColor', () => {
  it('TypeScript → #3178c6', () => {
    expect(getLanguageColor('TypeScript')).toBe('#3178c6');
  });

  it('JavaScript → #f1e05a', () => {
    expect(getLanguageColor('JavaScript')).toBe('#f1e05a');
  });

  it('Python → #3572A5', () => {
    expect(getLanguageColor('Python')).toBe('#3572A5');
  });

  it('Go → #00ADD8', () => {
    expect(getLanguageColor('Go')).toBe('#00ADD8');
  });

  it('Rust → #dea584', () => {
    expect(getLanguageColor('Rust')).toBe('#dea584');
  });

  it('Kotlin → #A97BFF', () => {
    expect(getLanguageColor('Kotlin')).toBe('#A97BFF');
  });

  it('Swift → #F05138', () => {
    expect(getLanguageColor('Swift')).toBe('#F05138');
  });

  it('未知语言 → 灰色 fallback #6b7280', () => {
    expect(getLanguageColor('COBOL')).toBe('#6b7280');
  });

  it('空字符串 → 灰色 fallback #6b7280', () => {
    expect(getLanguageColor('')).toBe('#6b7280');
  });

  it('大小写敏感：typescript（小写）→ fallback', () => {
    // 颜色表 key 为 PascalCase，小写不匹配应返回 fallback
    expect(getLanguageColor('typescript')).toBe('#6b7280');
  });

  it('C++ → #f34b7d', () => {
    expect(getLanguageColor('C++')).toBe('#f34b7d');
  });

  it('C# → #178600', () => {
    expect(getLanguageColor('C#')).toBe('#178600');
  });
});
