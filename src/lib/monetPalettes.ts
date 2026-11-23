import type { AccentConfig } from '@/contexts/ThemeContext';

/**
 * 莫奈（Material You）风格强调色板。
 *
 * 设计原则（“高级感”来自克制，不是来自鲜艳）：
 * - 每套只有一个纯色，不做渐变；
 * - 饱和度收敛到 S≈16~58：高饱和会带来塑料感/番茄酱红，低饱和才有质感；
 * - 色相拉开到 12 个不同色相（旧版 monet/violet/lavender 三紫撞色、
 *   teal/mint 两青撞色，实际只有 8 个色相）；
 * - 明度做深浅节奏（L≈36~62），而不是一排等亮的塑料色卡；
 * - 白字/深字由 `pickForeground` 按对比度自动二选一，
 *   因此黄、青、薄荷这类高明度色相会自动配深色文字。
 *
 * 所有色板在浅色与深色模式下均满足 WCAG AA（>=4.5）。
 */
export interface MonetPalette {
  /** 稳定 id，用于 i18n 与选中态判断 */
  id: string;
  /** 主色：与白字或深字之一对比度 >= 4.5 */
  color: string;
}

/** 色板列表：12 套，每套一个独立色相 */
export const MONET_PALETTES: MonetPalette[] = [
  // 雾紫（默认）H264 S38 L55
  { id: 'monet', color: '#8461B8' },
  // 靛蓝 H232 S45 L50
  { id: 'indigo', color: '#4655B9' },
  // 深青 H190 S42 L44
  { id: 'teal', color: '#41909F' },
  // 松绿 H155 S34 L36
  { id: 'green', color: '#3D7B61' },
  // 陶土橙 H26 S54 L47
  { id: 'orange', color: '#B96F37' },
  // 豆沙玫 H344 S48 L48
  { id: 'rose', color: '#B5405F' },
  // 砖红 H12 S52 L46
  { id: 'coral', color: '#B25138' },
  // 石板灰蓝 H212 S16 L45
  { id: 'graphite', color: '#607285' },
  // 雾薰衣草 H280 S34 L62
  { id: 'lavender', color: '#A97DBF' },
  // 琥珀 H44 S50 L50
  { id: 'honey', color: '#BF9D40' },
  // 灰薄荷 H168 S34 L50
  { id: 'mint', color: '#54AB9A' },
  // 藕荷 H308 S34 L58
  { id: 'violet', color: '#B86FAF' },
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
