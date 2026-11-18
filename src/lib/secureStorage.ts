/**
 * Token 存储适配层：
 * - Android：优先走 MainActivity 暴露的 AndroidBridge.secureGet/secureSet，
 *   Token 由 Android Keystore 加密后保存在私有 SharedPreferences；
 * - Web：回退 localStorage（浏览器无法安全保存长期 Token，需在文档中说明）。
 *
 * 读取时如果发现旧版本留在 localStorage 的明文值，会迁移到安全存储并删除明文。
 */
interface AndroidSecureBridge {
  secureGet?: (key: string) => string | null;
  secureSet?: (key: string, value: string) => boolean;
  secureRemove?: (key: string) => void;
}

function getBridge(): AndroidSecureBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { AndroidBridge?: AndroidSecureBridge }).AndroidBridge;
}

export function getSecureItem(key: string): string | null {
  const bridge = getBridge();
  if (bridge?.secureGet) {
    try {
      const value = bridge.secureGet(key);
      if (typeof value === 'string' && value.length > 0) return value;
      // 迁移旧版本明文：迁移成功才删除 localStorage，失败则保留可用的旧值。
      const legacy = localStorage.getItem(key);
      if (legacy) {
        try {
          if (bridge.secureSet?.(key, legacy)) localStorage.removeItem(key);
        } catch {
          // 保留 legacy，交由调用方继续使用
        }
        return legacy;
      }
      return null;
    } catch (error) {
      // Android 端读取失败时不能回退明文，否则会破坏安全存储承诺。
      console.error('[secureStorage] 原生安全存储读取失败', error);
      return null;
    }
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setSecureItem(key: string, value: string): void {
  const bridge = getBridge();
  if (bridge?.secureSet) {
    let saved = false;
    try {
      saved = bridge.secureSet(key, value);
    } catch (error) {
      console.error('[secureStorage] 原生安全存储写入失败', error);
    }
    if (!saved) {
      throw new Error('安全存储不可用，已拒绝将敏感信息写入明文存储');
    }
    localStorage.removeItem(key);
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}

export function removeSecureItem(key: string): void {
  const bridge = getBridge();
  try {
    bridge?.secureRemove?.(key);
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
