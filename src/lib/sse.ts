// SSE 流式请求工具函数（Web 平台）
// 使用原生 fetch 代替 ky，避免 ky 的 timeout 误中断长时间 SSE 流
import { createParser, type EventSourceParser } from 'eventsource-parser';

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
   * 仅对"服务端开始响应"之前生效；SSE 流读取阶段无超时限制，
   * 确保复杂长任务不会被强制中断。
   * 0 表示不限时。
   */
  timeoutMs?: number;
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
 * 若响应体是 HTML（如 Cloudflare 拦截页、429 限流页），只提取关键文字；
 * 若是 JSON，提取 error 字段。
 */
async function parseHttpError(response: Response): Promise<string> {
  const status = response.status;
  const statusText = response.statusText || '';

  // 401/403 直接给出配置类提示，无需解析 body
  if (status === 401) return `认证失败（401）：API Key 无效或已过期，请在模型设置中重新填写`;
  if (status === 403) return `无权限（403）：API Key 无权访问此接口，请检查账号权限`;
  if (status === 429) return `请求过于频繁（429）：触发限流，请稍后再试`;

  let body = '';
  try {
    body = await response.text();
  } catch {
    return `请求失败（HTTP ${status} ${statusText}）`;
  }

  // 尝试 JSON 解析
  try {
    const parsed = JSON.parse(body);
    const msg = parsed?.error?.message || parsed?.error || parsed?.message;
    if (typeof msg === 'string' && msg.trim()) {
      return `请求失败（${status}）：${msg.slice(0, 300)}`;
    }
  } catch { /* ignore */ }

  // 是 HTML 页面：提取 <title> 或 <h1>，或截取纯文本
  if (body.trim().startsWith('<') || body.includes('<!DOCTYPE') || body.includes('<html')) {
    const titleMatch = body.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
    const h1Match = body.match(/<h1[^>]*>([^<]{1,120})<\/h1>/i);
    const hint = titleMatch?.[1]?.trim() || h1Match?.[1]?.trim() || '';
    return hint
      ? `请求失败（${status}）：${hint}`
      : `请求失败（HTTP ${status}）：服务端返回了 HTML 页面，可能是限流或防火墙拦截`;
  }

  // 纯文本，截断到 300 字符
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
  } = options;

  // ── 前置校验：确保 functionUrl 有效，防止 GitHub Pages 构建时 env 未注入 ────
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

  // ── 超时控制：仅对"建立连接 + 收到首字节"阶段设超时 ─────────────────────────
  // SSE body 读取阶段使用独立 reader，不受此 controller 影响
  const connectController = new AbortController();
  let timerId: ReturnType<typeof setTimeout> | null = null;

  // 将用户 abort 信号转发给 connectController
  const forwardAbort = () => connectController.abort('user');
  userSignal?.addEventListener('abort', forwardAbort);

  if (timeoutMs > 0) {
    timerId = setTimeout(() => connectController.abort('timeout'), timeoutMs);
  }

  const cleanup = () => {
    if (timerId !== null) { clearTimeout(timerId); timerId = null; }
    userSignal?.removeEventListener('abort', forwardAbort);
  };

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
    cleanup();
    if (userSignal?.aborted) return; // 用户主动终止，静默
    const e = err as Error;
    if (e?.name === 'AbortError') {
      // 区分"超时"与"用户取消"
      const reason = (connectController.signal as AbortSignal & { reason?: string }).reason;
      if (reason === 'timeout') {
        onError(new Error('连接超时：服务器响应过慢，请稍后重试或在设置中增大超时时间'));
      }
      // 其余 abort（用户信号）已在上面 return 处理
      return;
    }
    onError(friendlyError(err));
    return;
  }

  // ── 连接建立后立即取消超时计时，SSE 读取阶段无时长限制 ──────────────────────
  cleanup();

  // ── HTTP 错误：解析响应体，分类输出清晰错误 ─────────────────────────────────
  if (!response.ok) {
    const msg = await parseHttpError(response);
    onError(new Error(msg));
    return;
  }

  if (!response.body) { onError(new Error('响应体为空')); return; }

  // ── SSE 流读取：用户 signal 直接监听 reader cancel ───────────────────────────
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser: EventSourceParser = createParser({
    onEvent: (event) => { if (event.data) onData(event.data); },
  });

  // 若用户中途点 Stop，cancel reader 终止读取
  const cancelOnAbort = () => reader.cancel().catch(() => { /* ignore */ });
  userSignal?.addEventListener('abort', cancelOnAbort);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    userSignal?.removeEventListener('abort', cancelOnAbort);
    if (!userSignal?.aborted) onComplete();
  } catch (err) {
    userSignal?.removeEventListener('abort', cancelOnAbort);
    if (userSignal?.aborted) return; // 用户主动终止
    onError(friendlyError(err));
  }
}
