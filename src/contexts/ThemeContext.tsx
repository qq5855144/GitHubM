// 主题上下文 - 支持深色/浅色/跟随系统 + 主题色自定义

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';

// ── 预设主题色方案 ──────────────────────────────────────────────────────────
export interface AccentScheme {
  id: string;
  label: string;
  /** HSL 字符串（不含 hsl()），浅色模式 */
  lightPrimary: string;
  lightAccent: string;
  lightRing: string;
  /** HSL 字符串，深色模式（稍亮） */
  darkPrimary: string;
  darkAccent: string;
  darkRing: string;
  /** 用于预览的 hex 色（同时作为 Android theme-color 基准） */
  previewColor: string;
  /** Android 状态栏浅色背景下的深色变体（可选，默认用 previewColor） */
  lightThemeColor?: string;
}

export const ACCENT_SCHEMES: AccentScheme[] = [
  // ── 原有色 ──────────────────────────────────────────────────────────────
  {
    id: 'purple',
    label: '紫罗兰',
    lightPrimary: '263 70% 58%',
    lightAccent:  '258 88% 66%',
    lightRing:    '263 70% 58%',
    darkPrimary:  '263 72% 68%',
    darkAccent:   '258 88% 74%',
    darkRing:     '263 72% 68%',
    previewColor: '#7c3aed',
    lightThemeColor: '#6d28d9',
  },
  {
    id: 'blue',
    label: '海洋蓝',
    lightPrimary: '217 91% 50%',
    lightAccent:  '210 100% 56%',
    lightRing:    '217 91% 50%',
    darkPrimary:  '217 91% 65%',
    darkAccent:   '210 100% 70%',
    darkRing:     '217 91% 65%',
    previewColor: '#1d6be3',
    lightThemeColor: '#1d4ed8',
  },
  {
    id: 'green',
    label: '翠绿',
    lightPrimary: '142 71% 40%',
    lightAccent:  '152 80% 42%',
    lightRing:    '142 71% 40%',
    darkPrimary:  '142 65% 52%',
    darkAccent:   '152 72% 54%',
    darkRing:     '142 65% 52%',
    previewColor: '#16a34a',
    lightThemeColor: '#15803d',
  },
  {
    id: 'orange',
    label: '暖橙',
    lightPrimary: '24 95% 50%',
    lightAccent:  '32 95% 52%',
    lightRing:    '24 95% 50%',
    darkPrimary:  '24 95% 62%',
    darkAccent:   '32 95% 64%',
    darkRing:     '24 95% 62%',
    previewColor: '#f97316',
    lightThemeColor: '#ea580c',
  },
  {
    id: 'rose',
    label: '玫瑰红',
    lightPrimary: '346 77% 50%',
    lightAccent:  '354 83% 57%',
    lightRing:    '346 77% 50%',
    darkPrimary:  '346 77% 64%',
    darkAccent:   '354 83% 70%',
    darkRing:     '346 77% 64%',
    previewColor: '#e11d48',
    lightThemeColor: '#be123c',
  },
  {
    id: 'cyan',
    label: '青碧',
    lightPrimary: '192 90% 40%',
    lightAccent:  '186 88% 44%',
    lightRing:    '192 90% 40%',
    darkPrimary:  '192 88% 54%',
    darkAccent:   '186 84% 58%',
    darkRing:     '192 88% 54%',
    previewColor: '#0891b2',
    lightThemeColor: '#0e7490',
  },
  // ── 新增色 ──────────────────────────────────────────────────────────────
  {
    id: 'indigo',
    label: '靛蓝',
    lightPrimary: '239 84% 58%',
    lightAccent:  '245 88% 64%',
    lightRing:    '239 84% 58%',
    darkPrimary:  '239 84% 70%',
    darkAccent:   '245 88% 76%',
    darkRing:     '239 84% 70%',
    previewColor: '#4f46e5',
    lightThemeColor: '#4338ca',
  },
  {
    id: 'sky',
    label: '天空蓝',
    lightPrimary: '199 89% 46%',
    lightAccent:  '204 94% 50%',
    lightRing:    '199 89% 46%',
    darkPrimary:  '199 89% 60%',
    darkAccent:   '204 94% 64%',
    darkRing:     '199 89% 60%',
    previewColor: '#0ea5e9',
    lightThemeColor: '#0284c7',
  },
  {
    id: 'emerald',
    label: '祖母绿',
    lightPrimary: '160 84% 36%',
    lightAccent:  '166 90% 38%',
    lightRing:    '160 84% 36%',
    darkPrimary:  '160 80% 50%',
    darkAccent:   '166 86% 54%',
    darkRing:     '160 80% 50%',
    previewColor: '#059669',
    lightThemeColor: '#047857',
  },
  {
    id: 'teal',
    label: '青绿',
    lightPrimary: '174 72% 38%',
    lightAccent:  '178 76% 40%',
    lightRing:    '174 72% 38%',
    darkPrimary:  '174 68% 52%',
    darkAccent:   '178 72% 56%',
    darkRing:     '174 68% 52%',
    previewColor: '#0d9488',
    lightThemeColor: '#0f766e',
  },
  {
    id: 'amber',
    label: '琥珀',
    lightPrimary: '38 92% 48%',
    lightAccent:  '45 96% 50%',
    lightRing:    '38 92% 48%',
    darkPrimary:  '38 92% 60%',
    darkAccent:   '45 96% 64%',
    darkRing:     '38 92% 60%',
    previewColor: '#d97706',
    lightThemeColor: '#b45309',
  },
  {
    id: 'pink',
    label: '樱花粉',
    lightPrimary: '330 81% 54%',
    lightAccent:  '336 84% 58%',
    lightRing:    '330 81% 54%',
    darkPrimary:  '330 81% 68%',
    darkAccent:   '336 84% 72%',
    darkRing:     '330 81% 68%',
    previewColor: '#ec4899',
    lightThemeColor: '#db2777',
  },
  {
    id: 'violet',
    label: '薰衣草',
    lightPrimary: '280 68% 56%',
    lightAccent:  '275 72% 62%',
    lightRing:    '280 68% 56%',
    darkPrimary:  '280 68% 68%',
    darkAccent:   '275 72% 74%',
    darkRing:     '280 68% 68%',
    previewColor: '#8b5cf6',
    lightThemeColor: '#7c3aed',
  },
  {
    id: 'gold',
    label: '金色',
    lightPrimary: '43 96% 42%',
    lightAccent:  '48 98% 46%',
    lightRing:    '43 96% 42%',
    darkPrimary:  '43 96% 58%',
    darkAccent:   '48 98% 62%',
    darkRing:     '43 96% 58%',
    previewColor: '#ca8a04',
    lightThemeColor: '#a16207',
  },
];

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  resolvedTheme: 'dark' | 'light';
  accentSchemeId: string;
  setAccentScheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY        = 'github_manager_theme';
const ACCENT_STORAGE_KEY = 'github_manager_accent';

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * 同步更新 <meta name="theme-color">：
 * - 有 scheme 时：用强调色作为状态栏颜色，让安卓 WebView 工具栏跟随主题色
 * - 无 scheme 时：退回默认深/浅背景色
 */
function updateThemeColorMeta(isDark: boolean, scheme?: AccentScheme) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (!meta) return;
  if (scheme) {
    // 深色：直接用预览色；浅色：用可选的浅色变体（对比度更好）
    meta.setAttribute('content', isDark ? scheme.previewColor : (scheme.lightThemeColor ?? scheme.previewColor));
  } else {
    meta.setAttribute('content', isDark ? '#1e1b4b' : '#f5f3ff');
  }
}

/** 将主题色方案注入 CSS 变量，更新 theme-color meta，并通知 Android 原生层 */
function applyAccentScheme(scheme: AccentScheme, resolved: 'dark' | 'light') {
  const root = document.documentElement;
  const isDark = resolved === 'dark';
  root.style.setProperty('--primary', isDark ? scheme.darkPrimary : scheme.lightPrimary);
  root.style.setProperty('--accent',  isDark ? scheme.darkAccent  : scheme.lightAccent);
  root.style.setProperty('--ring',    isDark ? scheme.darkRing    : scheme.lightRing);
  // sidebar-primary / sidebar-ring 同步
  root.style.setProperty('--sidebar-primary', isDark ? scheme.darkPrimary : scheme.lightPrimary);
  root.style.setProperty('--sidebar-ring',    isDark ? scheme.darkRing    : scheme.lightRing);
  // 更新 theme-color meta（影响 Android WebView 状态栏/工具栏颜色）
  updateThemeColorMeta(isDark, scheme);
  // 通知 Android 原生层同步强调色（底部导航选中色 + 最近任务图标色）
  notifyAndroidAccent(scheme.previewColor);
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
 *      示例 Kotlin：
 *        setTaskDescription(ActivityManager.TaskDescription(null, null, Color.parseColor(hex)))
 * @param primaryHex 当前方案的 hex 色值，如 "#7c3aed"
 */
function notifyAndroidAccent(primaryHex: string) {
  try {
    const bridge = (window as unknown as {
      AndroidBridge?: {
        notifyAccent?:     (hex: string) => void;
        notifyAccentIcon?: (hex: string) => void;
      }
    }).AndroidBridge;
    bridge?.notifyAccent?.(primaryHex);
    // notifyAccentIcon 用于原生层更新最近任务栏图标色
    bridge?.notifyAccentIcon?.(primaryHex);
  } catch {
    // 非 APK 环境或旧版本壳，静默忽略
  }
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
  // 等待最长过渡时长后移除（300ms 与 CSS 对齐）
  setTimeout(() => html.classList.remove('theme-transitioning'), 350);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    return saved || 'system';
  });
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() =>
    applyTheme((localStorage.getItem(STORAGE_KEY) as ThemeMode | null) || 'system')
  );

  // ── 主题色方案 ──────────────────────────────────────────────────────────
  const [accentSchemeId, setAccentSchemeIdState] = useState<string>(() => {
    return localStorage.getItem(ACCENT_STORAGE_KEY) || 'purple';
  });

  // 初始化时立即应用已保存的色方案
  useEffect(() => {
    const scheme = ACCENT_SCHEMES.find(s => s.id === accentSchemeId) ?? ACCENT_SCHEMES[0];
    applyAccentScheme(scheme, resolvedTheme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAccentScheme = useCallback((id: string) => {
    const scheme = ACCENT_SCHEMES.find(s => s.id === id) ?? ACCENT_SCHEMES[0];
    localStorage.setItem(ACCENT_STORAGE_KEY, scheme.id);
    setAccentSchemeIdState(scheme.id);
    applyAccentScheme(scheme, resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((t: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
    triggerThemeTransition(() => {
      const resolved = applyTheme(t);
      setResolvedTheme(resolved);
      // 切换明暗时重新应用当前色方案，确保色值对应正确的明暗变体
      const savedId = localStorage.getItem(ACCENT_STORAGE_KEY) || 'purple';
      const scheme = ACCENT_SCHEMES.find(s => s.id === savedId) ?? ACCENT_SCHEMES[0];
      applyAccentScheme(scheme, resolved);
    });
  }, []);

  // 跟随系统变化
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      triggerThemeTransition(() => {
        const resolved = applyTheme('system');
        setResolvedTheme(resolved);
        const savedId = localStorage.getItem(ACCENT_STORAGE_KEY) || 'purple';
        const scheme = ACCENT_SCHEMES.find(s => s.id === savedId) ?? ACCENT_SCHEMES[0];
        applyAccentScheme(scheme, resolved);
      });
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, accentSchemeId, setAccentScheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
