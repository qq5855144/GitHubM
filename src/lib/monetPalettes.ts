import type { AccentConfig } from '@/contexts/ThemeContext';

/**
 * 莫奈（Material You）风格强调色板。
 *
 * 设计原则对齐 M3 的 tonal palette：
 * - 每个色板内的两个色**同色相或相邻色相**，靠明度/饱和度拉开层次，
 *   而不是拼两个互不相干的色相——这正是 Material You 的视觉特征。
 * - `color` 取 M3 的 primary tone（约 40~50 亮度），保证作为按钮底色时的对比度；
 * - `color2` 取同色相更亮/更深的 tone，形成 M3 典型的「同族渐变」；
 * - `angle` 固定 135deg，与 M3 组件的对角渐变一致。
 *
 * 点击色板后会整组写入 `setAccent`，因此 `deriveAccent` 会自动派生出
 * `--primary` / `--accent` / `--accent-gradient` / `--primary-foreground`，
 * 无需在此重复计算。
 */
export interface MonetPalette {
  /** 稳定 id，用于 i18n 与选中态判断 */
  id: string;
  /** 主色（M3 primary tone） */
  color: string;
  /** 第二色（同色相的另一 tone） */
  color2: string;
  /** 渐变角度 */
  angle: number;
}

/** 色板列表：8 套，覆盖 M3 参考色相的主要分支 */
export const MONET_PALETTES: MonetPalette[] = [
  // M3 默认紫（Purple，比 #7c3aed 更近原生 Material You）
  { id: 'monet', color: '#6750A4', color2: '#9A82DB', angle: 135 },
  // 靛蓝（Indigo）
  { id: 'indigo', color: '#4355B9', color2: '#7583DE', angle: 135 },
  // 青蓝（Teal，M3 的 cyan/sky 分支）
  { id: 'teal', color: '#006A6A', color2: '#4E9E9E', angle: 135 },
  // 森林绿（Green）
  { id: 'green', color: '#3F6653', color2: '#73A088', angle: 135 },
  // 暖橙（Orange，M3 的 sunrise 分支）
  { id: 'orange', color: '#A4460A', color2: '#DB7C42', angle: 135 },
  // 玫瑰红（Rose）
  { id: 'rose', color: '#984061', color2: '#D17E9C', angle: 135 },
  // 珊瑚（Coral）
  { id: 'coral', color: '#B3261E', color2: '#E4736B', angle: 135 },
  // 石墨蓝（Neutral，M3 的低饱和分支，适合长时间阅读）
  { id: 'graphite', color: '#4A5B6B', color2: '#7E8F9E', angle: 135 },
  // 薰衣草（Lavender，比 monet 更低饱和、偏灰蓝紫，柔和不刺眼）
  { id: 'lavender', color: '#6B5B9E', color2: '#A79AD4', angle: 135 },
  // 蜂蜜黄（Honey，M3 的 yellow 分支，主色压暗保证对比度）
  { id: 'honey', color: '#7A5900', color2: '#D9B44A', angle: 135 },
  // 薄荷（Mint，介于 teal 与 green 之间的清透青绿）
  { id: 'mint', color: '#00696E', color2: '#3FB3A5', angle: 135 },
  // 幽紫（Violet Mist）：用户指定的 #E4DFFF 作为浅端，
  // 深端取同色相（约 246°）压暗到 L≈50，保证渐变中点仍有足够对比度。
  { id: 'violet', color: '#5B4BAD', color2: '#E4DFFF', angle: 135 },
];

/** 把色板转换成可直接传给 `setAccent` 的配置 */
export function toAccentConfig(p: MonetPalette): AccentConfig {
  return { color: p.color, color2: p.color2, angle: p.angle };
}

/**
 * 判断当前强调色是否正好等于某个色板（用于渲染选中态）。
 * 大小写不敏感，允许 `#RRGGBB` 与 `#rrggbb` 互通。
 */
export function isPaletteActive(
  palette: MonetPalette,
  current: { color: string; color2?: string },
): boolean {
  const norm = (v?: string) => (v ? v.trim().toLowerCase() : '');
  return (
    norm(palette.color) === norm(current.color) &&
    norm(palette.color2) === norm(current.color2)
  );
}
