// 主题上下文 - 支持深色/浅色/跟随系统 + 强调色完全自定义（单色）
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';

// ── 强调色配置 ──────────────────────────────────────────────────────────────
/**
 * 用户自定义强调色。
 * 只有一个色值：{ color: '#7b5dc0' }
 * 旧存储中遗留的 color2 / angle 字段在读取时会被自动丢弃。
 */
export interface AccentConfig {
  color: string;
}

/** 由 AccentConfig 派生出的、可直接使用的色值集合 */
export interface AccentDerived {
  /** 主色 hex */
  primaryHex: string;
  /** 主色上应使用的文字色（按对比度自动选白或近黑） */
  primaryForeground: string;
  /** 强调色 hex（用于链接、图标等单色消费点） */
  accentHex: string;
}

// ── 色值工具链 ──────────────────────────────────────────────────────────────
interface RGB { r: number; g: number; b: number }
interface HSL { h: number; s: number; l: number }

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 解析用户输入：支持 #rgb / #rrggbb / rgb() / hsl()，无 # 也接受 */
export function parseColor(input: string): RGB | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();

  const hex = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
      };
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  const rgb = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (rgb) {
    return {
      r: clamp(parseInt(rgb[1], 10), 0, 255),
      g: clamp(parseInt(rgb[2], 10), 0, 255),
      b: clamp(parseInt(rgb[3], 10), 0, 255),
    };
  }

  const hsl = s.match(/^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  if (hsl) {
    return hslToRgb({
      h: parseFloat(hsl[1]),
      s: parseFloat(hsl[2]),
      l: parseFloat(hsl[3]),
    });
  }

  return null;
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      default: h = (rn - gn) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const hn = ((h % 360) + 360) % 360 / 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hue = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue(hn + 1 / 3) * 255),
    g: Math.round(hue(hn) * 255),
    b: Math.round(hue(hn - 1 / 3) * 255),
  };
}

function relativeLuminance({ r, g, b }: RGB): number {
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatio(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}


/** 以三元组字符串写入 CSS 变量（项目里全部按 hsl(var(--x)) 消费） */
const toHslTriplet = (c: RGB): string => {
  const { h, s, l } = rgbToHsl(c);
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
};

export const DEFAULT_ACCENT: AccentConfig = {
  color: '#7b5dc0',
};  // 莫奈紫：H258 S44% L56%，白底对比度 5.04（WCAG AA 通过）

const ACCENT_STORAGE_KEY_V2 = 'github_manager_accent_v2';
const LEGACY_ACCENT_STORAGE_KEY = 'github_manager_accent';

/** 旧版预设方案 id → hex（一次性迁移） */
const LEGACY_SCHEME_MAP: Record<string, string> = {
  purple: '#7c3aed',
  blue: '#1677ff',
  green: '#22c55e',
  orange: '#f97316',
  rose: '#f43f5e',
  cyan: '#06b6d4',
  indigo: '#6366f1',
  sky: '#0ea5e9',
  emerald: '#10b981',
  teal: '#14b8a6',
  amber: '#f59e0b',
  pink: '#ec4899',
  violet: '#8b5cf6',
  gold: '#eab308',
  coral: '#ff6b6b',
  lime: '#84cc16',
};

/** 规范化并夹取用户输入的配置 */
function normalizeAccent(config: AccentConfig | null | undefined): AccentConfig {
  if (!config) return { ...DEFAULT_ACCENT };
  const base = parseColor(config.color) ?? parseColor(DEFAULT_ACCENT.color)!;
  return { color: rgbToHex(base) };
}

/** 读取已保存的强调色配置，兼容旧版预设 id */
export function loadAccentConfig(): AccentConfig {
  try {
    const rawV2 = localStorage.getItem(ACCENT_STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as AccentConfig;
      if (parsed && typeof parsed.color === 'string') return normalizeAccent(parsed);
    }
    // 迁移旧版预设 id
    const legacy = localStorage.getItem(LEGACY_ACCENT_STORAGE_KEY);
    if (legacy) {
      const migrated = normalizeAccent({
        color: LEGACY_SCHEME_MAP[legacy] ?? (parseColor(legacy) ? legacy : DEFAULT_ACCENT.color),
      });
      localStorage.setItem(ACCENT_STORAGE_KEY_V2, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_ACCENT_STORAGE_KEY);
      return migrated;
    }
  } catch {
    // 存储损坏时退回默认色
  }
  return { ...DEFAULT_ACCENT };
}

/** 由配置派生全部可用色值 */
export function deriveAccent(config: AccentConfig): AccentDerived {
  const cfg = normalizeAccent(config);
  const c1 = parseColor(cfg.color)!;
  const primaryHex = rgbToHex(c1);
  const white: RGB = { r: 255, g: 255, b: 255 };
  const nearBlack: RGB = { r: 17, g: 24, b: 39 };
  const primaryForeground =
    contrastRatio(c1, white) >= contrastRatio(c1, nearBlack) ? '#ffffff' : '#111827';
  return {
    primaryHex,
    primaryForeground,
    accentHex: primaryHex,
  };
}

// ── Context 定义 ────────────────────────────────────────────────────────────
interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  resolvedTheme: 'dark' | 'light';
  /** 当前强调色配置（用户输入值） */
  accent: AccentConfig;
  /** 派生色值，供组件内联使用（图标、纯色背景等） */
  derived: AccentDerived;
  /** 更新强调色，传 null 恢复默认 */
  setAccent: (config: AccentConfig | null) => void;
  /** 恢复默认强调色 */
  resetAccent: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'github_manager_theme';

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 同步更新 <meta name="theme-color">，让安卓 WebView 工具栏跟随强调色 */
function updateThemeColorMeta(_isDark: boolean, config: AccentConfig) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (!meta) return;
  meta.setAttribute('content', deriveAccent(config).primaryHex);
}

/** 将强调色注入 CSS 变量（三元组格式），更新 meta、favicon，并通知 Android 原生层 */
function applyAccent(config: AccentConfig, resolved: 'dark' | 'light') {
  const root = document.documentElement;
  const isDark = resolved === 'dark';
  const cfg = normalizeAccent(config);
  const d = deriveAccent(cfg);

  // 深色模式把颜色提亮，避免在深底上偏暗
  const lighten = (c: RGB): RGB => {
    const hsl = rgbToHsl(c);
    return hslToRgb({ ...hsl, l: Math.min(96, hsl.l + (hsl.l < 60 ? 12 : 6)) });
  };
  const p = isDark ? lighten(parseColor(d.primaryHex)!) : parseColor(d.primaryHex)!;
  // --accent 在本项目里是「与主色一致的强调色」（非 shadcn 的 hover 底色），
  // 所以直接跟随 --primary，避免链接色与按钮色分裂。

  const primaryTriplet = toHslTriplet(p);
  const accentTriplet = primaryTriplet;

  root.style.setProperty('--primary', primaryTriplet);
  root.style.setProperty('--accent', accentTriplet);
  root.style.setProperty('--ring', primaryTriplet);
  root.style.setProperty('--sidebar-primary', primaryTriplet);
  root.style.setProperty('--sidebar-ring', primaryTriplet);
  root.style.setProperty('--primary-foreground', toHslTriplet(parseColor(d.primaryForeground)!));

  // 纯色 hex，给需要直接色值的场景（登录页 Logo / CTA、内联 SVG fill 等）用
  root.style.setProperty('--accent-solid', rgbToHex(p));

  updateThemeColorMeta(isDark, cfg);
  updateFaviconAccent(cfg);
  notifyAndroidAccent(d.primaryHex);
}

function applyTheme(mode: ThemeMode) {
  const resolved = mode === 'system' ? getSystemTheme() : mode;
  const html = document.documentElement;
  if (resolved === 'dark') {
    html.classList.add('dark');
    html.classList.remove('light');
  } else {
    html.classList.add('light');
    html.classList.remove('dark');
  }
  // 通知 APK 壳同步更新状态栏与底部导航栏颜色
  notifyAndroidTheme(resolved === 'dark');
  return resolved;
}

/**
 * 向 Android 原生层推送主题变化。
 * AndroidBridge 由 MainActivity 的 addJavascriptInterface 注入，
 * 纯浏览器环境中不存在，通过可选链安全调用。
 */
function notifyAndroidTheme(isDark: boolean) {
  try {
    (window as unknown as { AndroidBridge?: { notifyTheme?: (d: boolean) => void } })
      .AndroidBridge?.notifyTheme?.(isDark);
  } catch {
    // 非 APK 环境或旧版本壳，静默忽略
  }
}

/**
 * 向 Android 原生层推送强调色变化。
 * 原生壳可通过以下方式响应：
 *   1. notifyAccent(hex)  → 底部导航栏选中色
 *   2. notifyAccentIcon(hex) → 调用 setTaskDescription() 更新最近任务图标色
 * @param primaryHex 当前强调色的 hex 值
 */
function notifyAndroidAccent(primaryHex: string) {
  try {
    const bridge = (window as unknown as {
      AndroidBridge?: {
        notifyAccent?: (hex: string) => void;
        notifyAccentIcon?: (hex: string) => void;
      }
    }).AndroidBridge;
    bridge?.notifyAccent?.(primaryHex);
    bridge?.notifyAccentIcon?.(primaryHex);
  } catch {
    // 非 APK 环境或旧版本壳，静默忽略
  }
}

/** base64 编码（先做 UTF-8 转义，避免特殊字符报错） */
function svgToDataUri(svg: string): string {
  try {
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  } catch {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
}

/**
 * 动态更新 favicon / apple-touch-icon。
 * 直接用主题强调色填充。
 */
function updateFaviconAccent(config: AccentConfig) {
  const cfg = normalizeAccent(config);
  const c1 = parseColor(cfg.color)!;
  // GitHub Octocat path (与 public/logo.svg 保持一致)
  const path = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59c.4.07.55-.17.55-.38c0-.19-.01-.82-.01-1.49c-2.01.37-2.53-.49-2.69-.94c-.09-.23-.48-.94-.82-1.13c-.28-.15-.68-.52-.01-.53c.63-.01 1.08.58 1.23.82c.72 1.21 1.87.87 2.33.66c.07-.52.28-.87.51-1.07c-1.78-.2-3.64-.89-3.64-3.95c0-.87.31-1.59.82-2.15c-.08-.2-.36-1.02.08-2.12c0 0 .67-.21 2.2.82c.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82c.44 1.1.16 1.92.08 2.12c.51.56.82 1.27.82 2.15c0 3.07-1.87 3.75-3.65 3.95c.29.25.54.73.54 1.48c0 1.07-.01 1.93-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 16 16">
    <path fill="${rgbToHex(c1)}" d="${path}"/>
  </svg>`;

  const dataUri = svgToDataUri(svg);

  let link: HTMLLinkElement | null =
    document.querySelector('link[rel*="icon"]') ||
    document.querySelector('link[rel="shortcut icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = dataUri;

  const appleLink: HTMLLinkElement | null = document.querySelector('link[rel="apple-touch-icon"]');
  if (appleLink) appleLink.href = dataUri;
}

/**
 * 触发主题切换过渡动画：
 * 向 <html> 添加 theme-transitioning class，CSS 中借助它激活全局 transition，
 * 动画结束后移除，避免页面初始加载时也触发不必要的过渡。
 */
function triggerThemeTransition(callback: () => void) {
  const html = document.documentElement;
  html.classList.add('theme-transitioning');
  callback();
  setTimeout(() => html.classList.remove('theme-transitioning'), 350);
}

const currentResolved = (): 'dark' | 'light' =>
  document.documentElement.classList.contains('dark') ? 'dark' : 'light';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    return saved || 'system';
  });

  const [accent, setAccentState] = useState<AccentConfig>(() => loadAccentConfig());

  // 同步初始化：applyTheme + applyAccent 在同一个 useState 初始化器里执行，
  // 确保原生桥在 React mount 之前就收到首次颜色信号。
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() => {
    const mode = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) || 'system';
    const resolved = applyTheme(mode);
    applyAccent(loadAccentConfig(), resolved);
    return resolved;
  });

  const setTheme = useCallback((t: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
    triggerThemeTransition(() => {
      const resolved = applyTheme(t);
      setResolvedTheme(resolved);
      // 切换明暗时重新应用强调色，确保用正确的明暗变体
      applyAccent(loadAccentConfig(), resolved);
    });
  }, []);

  const setAccent = useCallback((config: AccentConfig | null) => {
    const next = normalizeAccent(config ?? DEFAULT_ACCENT);
    localStorage.setItem(ACCENT_STORAGE_KEY_V2, JSON.stringify(next));
    setAccentState(next);
    applyAccent(next, currentResolved());
  }, []);

  const resetAccent = useCallback(() => setAccent(null), [setAccent]);

  // 跟随系统明暗变化
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      triggerThemeTransition(() => {
        const resolved = applyTheme('system');
        setResolvedTheme(resolved);
        applyAccent(loadAccentConfig(), resolved);
      });
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // 其他标签页修改强调色时同步
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== ACCENT_STORAGE_KEY_V2) return;
      const next = loadAccentConfig();
      setAccentState(next);
      applyAccent(next, currentResolved());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const derived = deriveAccent(accent);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, accent, derived, setAccent, resetAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}