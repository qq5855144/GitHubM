import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginRateLimitWait,
  endRateLimitWait,
  getRateLimitStatus,
  resetRateLimitStatus,
  subscribeRateLimitStatus,
} from '@/lib/githubRateLimitStatus';

describe('GitHub rate-limit status', () => {
  beforeEach(() => resetRateLimitStatus());

  it('keeps the banner active while any request is waiting', () => {
    beginRateLimitWait(2_000, 1);
    beginRateLimitWait(3_000, 2);
    expect(getRateLimitStatus()).toMatchObject({ active: true, until: 3_000, attempt: 2 });
    endRateLimitWait();
    expect(getRateLimitStatus().active).toBe(true);
    endRateLimitWait();
    expect(getRateLimitStatus()).toMatchObject({ active: false, until: 0, attempt: 0 });
  });

  it('notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRateLimitStatus(listener);
    beginRateLimitWait(1_000, 1);
    endRateLimitWait();
    unsubscribe();
    beginRateLimitWait(1_000, 1);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
