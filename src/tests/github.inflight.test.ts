/**
 * In-flight 请求合并层测试
 *
 * 核心验证：
 * 1. 同一 key 的并发请求只执行一次 factory（合并去重）
 * 2. 请求完成后 in-flight 记录清除（允许后续独立发起新请求）
 * 3. 请求失败时同样清除 in-flight（不阻塞后续重试）
 * 4. 不同 key 互不影响（各自独立追踪）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateInFlight } from '@/services/github';

// 每个测试前重置 vi mock 计数
beforeEach(() => {
  vi.clearAllMocks();
});

describe('getOrCreateInFlight — in-flight 请求合并', () => {
  describe('基础合并行为', () => {
    it('相同 key 并发调用只执行一次 factory', async () => {
      const factory = vi.fn().mockResolvedValue('data');
      const key = 'test-key-1';

      // 同时发起 3 个相同 key 的请求
      const [r1, r2, r3] = await Promise.all([
        getOrCreateInFlight(key, factory),
        getOrCreateInFlight(key, factory),
        getOrCreateInFlight(key, factory),
      ]);

      // factory 只被调用一次
      expect(factory).toHaveBeenCalledTimes(1);
      // 所有请求返回相同结果
      expect(r1).toBe('data');
      expect(r2).toBe('data');
      expect(r3).toBe('data');
    });

    it('不同 key 各自独立调用 factory', async () => {
      const factory1 = vi.fn().mockResolvedValue('data-1');
      const factory2 = vi.fn().mockResolvedValue('data-2');

      const [r1, r2] = await Promise.all([
        getOrCreateInFlight('key-a', factory1),
        getOrCreateInFlight('key-b', factory2),
      ]);

      expect(factory1).toHaveBeenCalledTimes(1);
      expect(factory2).toHaveBeenCalledTimes(1);
      expect(r1).toBe('data-1');
      expect(r2).toBe('data-2');
    });
  });

  describe('完成后 in-flight 记录清除', () => {
    it('请求完成后相同 key 可重新发起（factory 再次被调用）', async () => {
      const factory = vi.fn()
        .mockResolvedValueOnce('first')
        .mockResolvedValueOnce('second');
      const key = 'test-key-seq';

      const r1 = await getOrCreateInFlight(key, factory);
      // 第一次完成后，in-flight 已清除，第二次可独立发起
      const r2 = await getOrCreateInFlight(key, factory);

      expect(factory).toHaveBeenCalledTimes(2);
      expect(r1).toBe('first');
      expect(r2).toBe('second');
    });

    it('第一次完成后，新的并发请求再次合并为一次 factory 调用', async () => {
      const factory = vi.fn()
        .mockResolvedValueOnce('round-1')
        .mockResolvedValueOnce('round-2');
      const key = 'test-key-rounds';

      // 第一轮
      await getOrCreateInFlight(key, factory);
      expect(factory).toHaveBeenCalledTimes(1);

      // 第二轮并发 — 应再次合并
      const [r1, r2] = await Promise.all([
        getOrCreateInFlight(key, factory),
        getOrCreateInFlight(key, factory),
      ]);
      // factory 总计调用 2 次（不是 3 次）
      expect(factory).toHaveBeenCalledTimes(2);
      expect(r1).toBe('round-2');
      expect(r2).toBe('round-2');
    });
  });

  describe('失败场景', () => {
    it('请求失败时 in-flight 记录清除，后续可重试', async () => {
      const err = new Error('网络错误');
      const factory = vi.fn()
        .mockRejectedValueOnce(err)    // 第一次失败
        .mockResolvedValueOnce('ok');  // 重试成功

      const key = 'test-key-fail';

      // 第一次失败
      await expect(getOrCreateInFlight(key, factory)).rejects.toThrow('网络错误');

      // in-flight 已清除，重试成功
      const result = await getOrCreateInFlight(key, factory);
      expect(result).toBe('ok');
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('并发请求中 factory 失败时，所有请求均收到同一错误', async () => {
      const err = new Error('统一失败');
      const factory = vi.fn().mockRejectedValue(err);
      const key = 'test-key-concurrent-fail';

      const results = await Promise.allSettled([
        getOrCreateInFlight(key, factory),
        getOrCreateInFlight(key, factory),
        getOrCreateInFlight(key, factory),
      ]);

      // factory 仅调用一次
      expect(factory).toHaveBeenCalledTimes(1);
      // 所有 3 个 Promise 均 rejected
      results.forEach(r => {
        expect(r.status).toBe('rejected');
        expect((r as PromiseRejectedResult).reason.message).toBe('统一失败');
      });
    });
  });

  describe('类型安全', () => {
    it('支持泛型，返回值类型与 factory 一致', async () => {
      interface User { id: number; name: string }
      const user: User = { id: 1, name: '测试用户' };
      const factory = vi.fn().mockResolvedValue(user);

      const result = await getOrCreateInFlight<User>('user-key', factory);
      expect(result.id).toBe(1);
      expect(result.name).toBe('测试用户');
    });
  });
});
