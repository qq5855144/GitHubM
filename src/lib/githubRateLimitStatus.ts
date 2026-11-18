/**
 * GitHub 限流等待状态：网络层写入，全局横幅订阅。
 * 不做主动限流；只有真正收到 403/429 并开始等待时才进入 active。
 */
export interface GitHubRateLimitWaitState {
  active: boolean;
  until: number;
  attempt: number;
}

let activeWaits = 0;
let until = 0;
let attempt = 0;
let waitController = new AbortController();
let snapshot: GitHubRateLimitWaitState = { active: false, until: 0, attempt: 0 };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { active: activeWaits > 0, until, attempt };
  for (const listener of listeners) listener();
}

export function beginRateLimitWait(target: number, attemptNumber: number): AbortSignal {
  activeWaits += 1;
  until = Math.max(until, target);
  attempt = Math.max(attempt, attemptNumber);
  emit();
  return waitController.signal;
}

export function endRateLimitWait(): void {
  activeWaits = Math.max(0, activeWaits - 1);
  if (activeWaits === 0) {
    until = 0;
    attempt = 0;
  }
  emit();
}

/** 用户主动取消所有正在等待配额的请求。 */
export function cancelRateLimitWait(): void {
  const current = waitController;
  activeWaits = 0;
  until = 0;
  attempt = 0;
  waitController = new AbortController();
  emit();
  current.abort();
}

export function subscribeRateLimitStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRateLimitStatus(): GitHubRateLimitWaitState {
  return snapshot;
}

export function resetRateLimitStatus(): void {
  const current = waitController;
  activeWaits = 0;
  until = 0;
  attempt = 0;
  waitController = new AbortController();
  emit();
  current.abort();
}
