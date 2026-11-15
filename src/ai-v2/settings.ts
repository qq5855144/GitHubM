// AI V2 — 运行时偏好（与模型配置分开）
export interface V2Settings {
  /** 全局允许所有工具权限；开启后写操作不再逐次弹窗 */
  allowAllPermissions: boolean;
  /** 上下文预算（估算 token） */
  contextBudget: number;
  /** 是否把长期记忆注入上下文 */
  memoryEnabled: boolean;
}

const SETTINGS_KEY = 'githubm_ai_v2_settings';

const DEFAULTS: V2Settings = {
  allowAllPermissions: false,
  contextBudget: 32000,
  memoryEnabled: true,
};

export function loadV2Settings(): V2Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<V2Settings>;
    return {
      allowAllPermissions: Boolean(parsed.allowAllPermissions),
      contextBudget: Number(parsed.contextBudget) > 4000 ? Number(parsed.contextBudget) : DEFAULTS.contextBudget,
      memoryEnabled: parsed.memoryEnabled !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveV2Settings(settings: V2Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export const V2_SETTINGS_DEFAULTS = DEFAULTS;