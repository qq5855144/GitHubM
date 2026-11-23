import type { AccentConfig } from '@/contexts/ThemeContext';

/**
 * 莫奈（Material You）风格强调色板。
 *
 * 设计原则：
 * - 每套只有一个纯色，不做渐变；
 * - 亮度统一落在 L≈42~62 区间（旧版多为 L≈21~49，视觉上偏脏偏暗）；
 * - 白字/深字由 `deriveAccent` 根据对比度自动二选一，
 *   因此黄、青、薄荷这类高明度色相会自动配深色文字，全部色板均满足 WCAG AA；
 * - 色相拉开但保持低~中饱和，避免像纯 RGB 原色那样刺眼。
 *
 * 点击色板后会整组写入 `setAccent`，因此 `deriveAccent` 会自动派生出
 * `--primary` / `--accent` / `--accent-solid` / `--primary-foreground`，
 * 无需在此重复计算。
 */
export interface MonetPalette {
  /** 稳定 id，用于 i18n 与选中态判断 */
  id: string;
  /** 主色：白底对比度 >= 4.5（或深字对比度 >= 4.5） */
  color: string;
}

/** 色板列表：12 套，覆盖 M3 参考色相的主要分支 */
export const MONET_PALETTES: MonetPalette[] = [
  // 默认紫（M3 Purple）
  { id: 'monet', color: '#7B5DC0' },
  // 靛蓝（Indigo）
  { id: 'indigo', color: '#4A5ECF' },
  // 青蓝（Teal）
  { id: 'teal', color: '#2DADB4' },
  // 森林绿（Green）
  { id: 'green', color: '#3E986E' },
  // 暖橙（Orange）
  { id: 'orange', color: '#E36C1C' },
  // 玫瑰红（Rose）
  { id: 'rose', color: '#CF3060' },
  // 珊瑚（Coral）
  { id: 'coral', color: '#C33D28' },
  // 石墨蓝（Neutral，低饱和）
  { id: 'graphite', color: '#6585A4' },
  // 薰衣草（Lavender，柔和紫）
  { id: 'lavender', color: '#9B75C7' },
  // 蜂蜜黄（Honey，深字）
  { id: 'honey', color: '#D39E22' },
  // 薄荷（Mint）
  { id: 'mint', color: '#36A18F' },
  // 幽紫（Violet）
  { id: 'violet', color: '#8258CA' },
];

/** 把色板转换成可直接传给 `setAccent` 的配置 */
export function toAccentConfig(p: MonetPalette): AccentConfig {
  return { color: p.color };
}

/**
 * 判断当前强调色是否正好等于某个色板（用于渲染选中态）。
 * 大小写不敏感，允许 `#RRGGBB` 与 `#rrggbb` 互通。
 */
export function isPaletteActive(palette: MonetPalette, current: { color: string }): boolean {
  const norm = (v?: string) => (v ? v.trim().toLowerCase() : '');
  return norm(palette.color) === norm(current.color);
}
