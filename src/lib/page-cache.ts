/**
 * 模块级页面数据缓存
 *
 * 原理：SPA 中模块变量在整个会话周期内保持不变。即使组件 unmount（路由切换），
 * 缓存的数据仍然存在，下次组件 mount 时可立即恢复，无需等待网络请求。
 *
 * 使用场景：
 *   - 用户按返回键回到已访问的列表页：立即显示上次数据
 *   - 快速 Tab 切换：不重复发起请求
 *
 * 注意：
 *   - TTL 默认 5 分钟，过期后下次进入会重新加载
 *   - 执行写操作（创建/删除/更新）后应主动调用 pageCache.invalidate() 清除相关缓存
 */

const DEFAULT_TTL = 5 * 60 * 1000; // 5 分钟

const MAX_ENTRIES = 64;
const MAX_ESTIMATED_BYTES = 24 * 1024 * 1024;
const BACK_NAVIGATION_GRACE = 30 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  weight: number;
}

// Sample list rows so a large page snapshot doesn't need synchronous JSON serialization.
function estimateWeight(value: unknown, depth = 0): number {
  if (typeof value === 'string') return 24 + value.length * 2;
  if (!value || typeof value !== 'object' || depth >= 4) return 16;
  if (Array.isArray(value)) {
    const samples = Math.min(value.length, 8);
    if (!samples) return 32;
    let bytes = 0;
    for (let i = 0; i < samples; i++) {
      bytes += estimateWeight(value[Math.floor(i * value.length / samples)], depth + 1);
    }
    return 32 + (bytes / samples + 8) * value.length;
  }
  return 32 + Object.entries(value).reduce((bytes, [key, item]) =>
    bytes + 16 + key.length * 2 + estimateWeight(item, depth + 1), 0);
}

class PageCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private weight = 0;

  /** 返回已访问的页面时，可以恢复超过 TTL 的列表快照。 */
  get<T>(key: string, { allowExpired = false } = {}): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    const age = Date.now() - entry.timestamp;
    if (age > Math.max(entry.ttl, BACK_NAVIGATION_GRACE)) {
      this.delete(key);
      return null;
    }
    if (!allowExpired && age > entry.ttl) return null;
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.data;
  }

  /** 写缓存 */
  set<T>(key: string, data: T, ttl = DEFAULT_TTL): void {
    const now = Date.now();
    for (const [cachedKey, entry] of this.store) {
      if (now - entry.timestamp > Math.max(entry.ttl, BACK_NAVIGATION_GRACE)) this.delete(cachedKey);
    }
    this.delete(key);
    const weight = estimateWeight(data);
    this.store.set(key, { data, timestamp: now, ttl, weight });
    this.weight += weight;
    while (this.store.size > 1 && (this.store.size > MAX_ENTRIES || this.weight > MAX_ESTIMATED_BYTES)) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }

  /** 删除指定 key（精确匹配） */
  delete(key: string): void {
    const entry = this.store.get(key);
    if (entry && this.store.delete(key)) this.weight -= entry.weight;
  }

  /**
   * 按前缀批量失效，适合写操作后清除相关页面缓存。
   * 例：invalidate('repos:') 会清除所有仓库相关缓存
   */
  invalidate(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.delete(key);
    }
  }

  /** 清空全部缓存（登出时调用） */
  clear(): void {
    this.store.clear();
    this.weight = 0;
  }

  /** 调试用：查看所有缓存 key */
  keys(): string[] {
    return [...this.store.keys()];
  }
}

export const pageCache = new PageCache();

// Store small navigation preferences separately from evictable repository data.
const LIST_VIEW_PREFIX = 'githubm_list_view:';

export function readListView<T>(key: string, fallback: T): T {
  try {
    const saved = sessionStorage.getItem(LIST_VIEW_PREFIX + key);
    return saved ? JSON.parse(saved) as T : fallback;
  } catch {
    return fallback;
  }
}

export function saveListView<T>(key: string, view: T): void {
  try {
    sessionStorage.setItem(LIST_VIEW_PREFIX + key, JSON.stringify(view));
  } catch {
    // Do not block loading when browser storage is unavailable.
  }
}
