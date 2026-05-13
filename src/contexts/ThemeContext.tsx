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
  /** 用于预览的 hex 色 */
  previewColor: string;
}

export const ACCENT_SCHEMES: AccentScheme[] = [
  {
    id: 'purple',
    label: '紫罗兰',
    lightPrimary: '263 70% 58%',
    lightAccent:  '258 88% 66%',
    lightRing:    '263 70% 58%',
    darkPrimary:  '263 72% 62%',
    darkAccent:   '258 88% 70%',
    darkRing:     '263 72% 62%',
    previewColor: '#7c3aed',
  },
  {
    id: 'blue',
    label: '海洋蓝',
    lightPrimary: '217 91% 50%',
    lightAccent:  '210 100% 56%',
    lightRing:    '217 91% 50%',
    darkPrimary:  '217 91% 60%',
    darkAccent:   '210 100% 65%',
    darkRing:     '217 91% 60%',
    previewColor: '#1d6be3',
  },
  {
    id: 'green',
    label: '翠绿',
    lightPrimary: '142 71% 40%',
    lightAccent:  '152 80% 42%',
    lightRing:    '142 71% 40%',
    darkPrimary:  '142 65% 48%',
    darkAccent:   '152 72% 50%',
    darkRing:     '142 65% 48%',
    previewColor: '#16a34a',
  },
  {
    id: 'orange',
    label: '暖橙',
    lightPrimary: '24 95% 50%',
    lightAccent:  '32 95% 52%',
    lightRing:    '24 95% 50%',
    darkPrimary:  '24 95% 58%',
    darkAccent:   '32 95% 60%',
    darkRing:     '24 95% 58%',
    previewColor: '#f97316',
  },
  {
    id: 'rose',
    label: '玫瑰红',
    lightPrimary: '346 77% 50%',
    lightAccent:  '354 83% 57%',
    lightRing:    '346 77% 50%',
    darkPrimary:  '346 77% 60%',
    darkAccent:   '354 83% 65%',
    darkRing:     '346 77% 60%',
    previewColor: '#e11d48',
  },
  {
    id: 'cyan',
    label: '青碧',
    lightPrimary: '192 90% 40%',
    lightAccent:  '186 88% 44%',
    lightRing:    '192 90% 40%',
    darkPrimary:  '192 88% 50%',
    darkAccent:   '186 84% 54%',
    darkRing:     '192 88% 50%',
    previewColor: '#0891b2',
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
const DARK_COLOR  = '#1e1b4b';
const LIGHT_COLOR = '#f5f3ff';

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 同步更新 <meta name="theme-color"> 让安卓 WebView 状态栏颜色与页面一致 */
function updateThemeColorMeta(isDark: boolean) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', isDark ? DARK_COLOR : LIGHT_COLOR);
}

/** 将主题色方案注入 CSS 变量，并同步通知 Android 底部导航栏选中色 */
function applyAccentScheme(scheme: AccentScheme, resolved: 'dark' | 'light') {
  const root = document.documentElement;
  const isDark = resolved === 'dark';
  root.style.setProperty('--primary', isDark ? scheme.darkPrimary : scheme.lightPrimary);
  root.style.setProperty('--accent',  isDark ? scheme.darkAccent  : scheme.lightAccent);
  root.style.setProperty('--ring',    isDark ? scheme.darkRing    : scheme.lightRing);
  // sidebar-primary / sidebar-ring 同步
  root.style.setProperty('--sidebar-primary', isDark ? scheme.darkPrimary : scheme.lightPrimary);
  root.style.setProperty('--sidebar-ring',    isDark ? scheme.darkRing    : scheme.lightRing);
  // 通知 Android 原生底部导航栏选中色跟随方案
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
  updateThemeColorMeta(resolved === 'dark');
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
 * 向 Android 原生层推送强调色变化，使底部导航栏选中色同步跟随。
 * @param primaryHex 当前方案的预览 hex 色值，如 "#7c3aed"
 */
function notifyAndroidAccent(primaryHex: string) {
  try {
    (window as unknown as { AndroidBridge?: { notifyAccent?: (hex: string) => void } })
      .AndroidBridge?.notifyAccent?.(primaryHex);
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
