// GitHub 请求网络层：重试、限流等待与错误解析。
// 不依赖缓存/token 模块，便于后续把 github.ts 按资源拆分。

// ── 网络重试与 GitHub 限流处理 ─────────────────────────────────────
// 原则：不做客户端主动限流，不在“还剩多少额度”时提前拒绝请求。
// 只有 GitHub 真正返回 403（primary/secondary rate limit）或 429 时，
// 才按服务端给出的 reset / retry-after 等待后继续，保证 Agent 任务不中断。
// 5xx 只对 GET 做有限退避重试，写操作不自动重试，避免重复副作用。
type GitHubRequestError = Error & {
  status?: number;
  rateLimited?: boolean;
  retryAt?: number;
};
const MAX_RATE_LIMIT_WAIT_MS = 65 * 60 * 1000;
const MAX_RATE_LIMIT_RETRIES = 8;

function sleepWithSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Date.now() + Math.max(0, seconds) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : date;
}

export async function createHttpError(response: Response): Promise<GitHubRequestError> {
  let message = `HTTP ${response.status}`;
  try {
    const errorBody = await response.json() as { message?: string; errors?: Array<{ message?: string }> };
    const detail = Array.isArray(errorBody.errors)
      ? errorBody.errors.map(item => item?.message).filter(Boolean)[0]
      : undefined;
    message = detail
      ? `${errorBody.message || message}: ${detail}`
      : (errorBody.message || message);
  } catch { /* 忽略非 JSON 错误体 */ }
  const error = new Error(message) as GitHubRequestError;
  error.status = response.status;
  const remainingRaw = response.headers.get('x-ratelimit-remaining');
  const remaining = remainingRaw === null ? Number.NaN : Number(remainingRaw);
  const resetRaw = Number(response.headers.get('x-ratelimit-reset') || 0);
  const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
  const secondary = response.status === 429
    || (response.status === 403 && (
      remaining === 0
      || retryAfter !== undefined
      || /rate limit|secondary rate limit|abuse detection/i.test(message)
    ));
  if (secondary) {
    error.rateLimited = true;
    error.retryAt = retryAfter
      ?? (resetRaw > 0 ? resetRaw * 1000 : Date.now() + 60_000);
  }
  return error;
}

export async function fetchWithResilience(
  url: string,
  init: RequestInit,
  method: string,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      // 弱网下的短暂失败只对幂等 GET 重试；AbortError 不重试。
      if (method === 'GET' && !init.signal?.aborted && attempt < 2) {
        await sleepWithSignal(300 * 3 ** attempt, init.signal);
        attempt += 1;
        continue;
      }
      throw error;
    }
    // 条件请求命中：没有响应体，但缓存仍有效。
    if (response.status === 304) return response;
    if (response.ok) return response;
    const error = await createHttpError(response);
    if (error.rateLimited && attempt < MAX_RATE_LIMIT_RETRIES) {
      const waitMs = Math.min(
        MAX_RATE_LIMIT_WAIT_MS,
        Math.max(1_000, (error.retryAt ?? Date.now() + 60_000) - Date.now()),
      );
      await sleepWithSignal(waitMs, init.signal);
      attempt += 1;
      continue;
    }
    if (method === 'GET' && response.status >= 500 && attempt < 3) {
      await sleepWithSignal([300, 900, 2_700][attempt] ?? 2_700, init.signal);
      attempt += 1;
      continue;
    }
    throw error;
  }
}
