// SSE 流式请求工具函数（Web 平台）v2
// - 标准化事件信封：seq 去重/乱序检测、stream_id 校验、TTFT 埋点
// - idle timeout：N 秒无任何事件（含 heartbeat）自动触发 onIdle 回调
// - 使用原生 fetch，避免 ky 的 timeout 误中断长时间 SSE 流
import { createParser, type EventSourceParser } from 'eventsource-parser';
import type { StreamMetrics } from '@/components/ai/aiTypes';

export interface StreamRequestOptions {
  functionUrl: string;
  requestBody: unknown;
  supabaseAnonKey: string;
  onData: (data: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  /** 用户手动终止信号（Stop 按钮） */
  signal?: AbortSignal;
  /**
   * 请求超时毫秒数，默认 300000（5 分钟）。
   * 仅对"服务端开始响应"之前生效；SSE 流读取阶段无超时限制。
   * 0 表示不限时。
   */
  timeoutMs?: number;
  /**
   * Idle timeout（ms）：若连续该时长内未收到任何 SSE 事件（含 heartbeat），
   * 视为连接假死，触发 onIdle 回调（默认 45000ms）。
   * 0 表示禁用。
   */
  idleTimeoutMs?: number;
  /** idle timeout 触发时回调，调用方决定是否重连 */
  onIdle?: () => void;
  /** TTFT / 流指标回调：首个 content 事件触发 */
  onMetrics?: (metrics: Partial<StreamMetrics>) => void;
}

/** 将底层错误转为用户友好的中文描述 */
function friendlyError(err: unknown): Error {
  const e = err as Error;
  const msg = e?.message ?? String(err);
  if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('network'))
    return new Error('网络连接失败，请检查网络后重试');
  if (msg.includes('CORS') || msg.includes('cors'))
    return new Error('跨域请求被拒绝，请联系管理员');
  if (msg.includes('AbortError') || e?.name === 'AbortError')
    return new Error('请求被中断');
  return new Error(msg || '未知错误');
}

/**
 * 解析 HTTP 错误响应体，返回友好的错误信息。
 */
async function parseHttpError(response: Response): Promise<string> {
  const status = response.status;
  const statusText = response.statusText || '';

  if (status === 401) return `认证失败（401）：API Key 无效或已过期，请在模型设置中重新填写`;
  if (status === 403) return `无权限（403）：API Key 无权访问此接口，请检查账号权限`;
  if (status === 429) return `请求过于频繁（429）：触发限流，请稍后再试`;

  let body = '';
  try {
    body = await response.text();
  } catch {
    return `请求失败（HTTP ${status} ${statusText}）`;
  }

  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message || parsed?.error || parsed?.message;
    if (typeof msg === 'string' && msg.trim()) {
      return `请求失败（${status}）：${msg.slice(0, 300)}`;
    }
  } catch { /* ignore */ }

  if (body.trim().startsWith('<') || body.includes('<!DOCTYPE') || body.includes('<html')) {
    const titleMatch = body.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
    const h1Match = body.match(/<h1[^>]*>([^<]{1,120})<\/h1>/i);
    const hint = titleMatch?.[1]?.trim() || h1Match?.[1]?.trim() || '';
    return hint
      ? `请求失败（${status}）：${hint}`
      : `请求失败（HTTP ${status}）：服务端返回了 HTML 页面，可能是限流或防火墙拦截`;
  }

  const truncated = body.replace(/\s+/g, ' ').trim().slice(0, 300);
  return truncated
    ? `请求失败（${status}）：${truncated}`
    : `请求失败（HTTP ${status} ${statusText}）`;
}

export async function sendStreamRequest(options: StreamRequestOptions): Promise<void> {
  const {
    functionUrl, requestBody, supabaseAnonKey,
    onData, onComplete, onError,
    signal: userSignal,
    timeoutMs = 300_000,
    idleTimeoutMs = 45_000,
    onIdle,
    onMetrics,
  } = options;

  // ── 前置校验 ───────────────────────────────────────────────────────────────
  if (!functionUrl || !functionUrl.startsWith('http')) {
    onError(new Error(
      `AI 服务地址未配置（functionUrl="${functionUrl}"）。` +
      `请确认构建时 VITE_SUPABASE_URL 已正确注入，或联系管理员。`
    ));
    return;
  }
  if (!supabaseAnonKey) {
    onError(new Error('AI 服务密钥未配置（VITE_SUPABASE_ANON_KEY 为空），请联系管理员。'));
    return;
  }

  // ── 连接超时控制 ────────────────────────────────────────────────────────────
  const connectController = new AbortController();
  let connectTimerId: ReturnType<typeof setTimeout> | null = null;

  const forwardAbort = () => connectController.abort('user');
  userSignal?.addEventListener('abort', forwardAbort);

  if (timeoutMs > 0) {
    connectTimerId = setTimeout(() => connectController.abort('timeout'), timeoutMs);
  }

  const cleanupConnect = () => {
    if (connectTimerId !== null) { clearTimeout(connectTimerId); connectTimerId = null; }
    userSignal?.removeEventListener('abort', forwardAbort);
  };

  // ── TTFT 追踪 ──────────────────────────────────────────────────────────────
  const startedAt = Date.now();
  let firstTokenAt: number | undefined;
  let totalChars = 0;
  let expectedSeq = 0;
  let streamId: string | undefined;

  let response: Response;
  try {
    response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: connectController.signal,
    });
  } catch (err) {
    cleanupConnect();
    if (userSignal?.aborted) return;
    const e = err as Error;
    if (e?.name === 'AbortError') {
      const reason = (connectController.signal as AbortSignal & { reason?: string }).reason;
      if (reason === 'timeout') {
        onError(new Error('连接超时：服务器响应过慢，请稍后重试或在设置中增大超时时间'));
      }
      return;
    }
    onError(friendlyError(err));
    return;
  }

  cleanupConnect();

  if (!response.ok) {
    const msg = await parseHttpError(response);
    onError(new Error(msg));
    return;
  }

  if (!response.body) { onError(new Error('响应体为空')); return; }

  // ── Idle timeout 定时器 ────────────────────────────────────────────────────
  // 每次收到任何事件（含 heartbeat）都重置；超时则触发 onIdle
  let idleTimerId: ReturnType<typeof setTimeout> | null = null;

  const resetIdle = () => {
    if (idleTimeoutMs <= 0) return;
    if (idleTimerId !== null) clearTimeout(idleTimerId);
    idleTimerId = setTimeout(() => {
      // 触发 idle：取消 reader 并回调
      reader.cancel().catch(() => { /* ignore */ });
      onIdle?.();
    }, idleTimeoutMs);
  };

  const clearIdle = () => {
    if (idleTimerId !== null) { clearTimeout(idleTimerId); idleTimerId = null; }
  };

  // ── SSE 流读取 ─────────────────────────────────────────────────────────────
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');

  const parser: EventSourceParser = createParser({
    onEvent: (event) => {
      if (!event.data) return;
      // 重置 idle 定时器（收到任何事件即活跃）
      resetIdle();

      // seq 校验：跳过已处理的重复事件
      try {
        const parsed = JSON.parse(event.data) as Record<string, unknown>;
        const seq = parsed.seq as number | undefined;
        const sid = parsed.stream_id as string | undefined;

        // 锁定 streamId（首条事件时）
        if (!streamId && sid) streamId = sid;

        // 若已锁定 streamId 且收到不同 stream 的事件，忽略（防止串流）
        if (streamId && sid && sid !== streamId) return;

        // seq 去重：若 seq 低于预期说明是重传/乱序，跳过
        if (typeof seq === 'number') {
          if (seq < expectedSeq) return; // 重复/过期事件
          expectedSeq = seq + 1;
        }

        // TTFT 埋点：首个 content 事件
        if (parsed.type === 'content' && !firstTokenAt) {
          firstTokenAt = Date.now();
          onMetrics?.({ ttft: firstTokenAt - startedAt, startedAt, streamId });
        }
        // 字符计数（估算流速）
        if (parsed.type === 'content' && typeof parsed.content === 'string') {
          totalChars += parsed.content.length;
        }
      } catch { /* JSON 解析失败时不影响主流程 */ }

      onData(event.data);
    },
  });

  const cancelOnAbort = () => reader.cancel().catch(() => { /* ignore */ });
  userSignal?.addEventListener('abort', cancelOnAbort);

  // 启动 idle 定时器
  resetIdle();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    clearIdle();
    userSignal?.removeEventListener('abort', cancelOnAbort);
    if (!userSignal?.aborted) {
      // 上报最终指标
      const finishedAt = Date.now();
      const durationSec = (finishedAt - startedAt) / 1000;
      onMetrics?.({
        startedAt,
        firstTokenAt,
        finishedAt,
        ttft: firstTokenAt ? firstTokenAt - startedAt : undefined,
        throughput: durationSec > 0 ? Math.round(totalChars / durationSec) : undefined,
        totalSeq: expectedSeq,
        streamId,
        interruptReason: 'completed',
      });
      onComplete();
    }
  } catch (err) {
    clearIdle();
    userSignal?.removeEventListener('abort', cancelOnAbort);
    if (userSignal?.aborted) return;
    onError(friendlyError(err));
  }
}
