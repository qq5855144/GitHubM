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

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class PageCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  /** 读缓存，过期返回 null */
  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  /** 写缓存 */
  set<T>(key: string, data: T, ttl = DEFAULT_TTL): void {
    this.store.set(key, { data, timestamp: Date.now(), ttl });
  }

  /** 删除指定 key（精确匹配） */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * 按前缀批量失效，适合写操作后清除相关页面缓存。
   * 例：invalidate('repos:') 会清除所有仓库相关缓存
   */
  invalidate(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /** 清空全部缓存（登出时调用） */
  clear(): void {
    this.store.clear();
  }

  /** 调试用：查看所有缓存 key */
  keys(): string[] {
    return [...this.store.keys()];
  }
}

export const pageCache = new PageCache();
