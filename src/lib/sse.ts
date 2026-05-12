// SSE 流式请求工具函数（Web 平台）
import ky, { type AfterResponseHook, type KyResponse, type NormalizedOptions } from 'ky';
import { createParser, type EventSourceParser } from 'eventsource-parser';

export interface SSEOptions {
  onData: (data: string) => void;
  onCompleted?: (error?: Error) => void;
  onAborted?: () => void;
}

export function createSSEHook(options: SSEOptions): AfterResponseHook {
  const hook: AfterResponseHook = async (
    request: Request,
    _options: NormalizedOptions,
    response: KyResponse
  ) => {
    if (!response.ok || !response.body) return;

    let completed = false;
    const finish = (error?: Error) => {
      if (completed) return;
      completed = true;
      options.onCompleted?.(error);
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf8');
    const parser: EventSourceParser = createParser({
      onEvent: (event) => {
        if (!event.data) return;
        options.onData(event.data);
      },
    });

    const read = () => {
      reader.read().then((result) => {
        if (result.done) { finish(); return; }
        parser.feed(decoder.decode(result.value, { stream: true }));
        read();
      }).catch((error) => {
        if (request.signal.aborted) { options.onAborted?.(); return; }
        finish(error as Error);
      });
    };
    read();
    return response;
  };
  return hook;
}

export interface StreamRequestOptions {
  functionUrl: string;
  requestBody: unknown;
  supabaseAnonKey: string;
  onData: (data: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

export async function sendStreamRequest(options: StreamRequestOptions): Promise<void> {
  const { functionUrl, requestBody, supabaseAnonKey, onData, onComplete, onError, signal } = options;

  const sseHook = createSSEHook({
    onData,
    onCompleted: (error?: Error) => { if (error) onError(error); else onComplete(); },
    onAborted: () => { /* 已中断，静默处理 */ },
  });

  try {
    await ky.post(functionUrl, {
      json: requestBody,
      headers: {
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      signal,
      // 多步自主任务可能需要 5-10 分钟，设为 false 关闭超时限制；
      // 用户可随时点"停止"按钮手动中断（AbortController signal）
      timeout: false,
      hooks: { afterResponse: [sseHook] },
    });
  } catch (error) {
    if (!signal?.aborted) onError(error as Error);
  }
}
