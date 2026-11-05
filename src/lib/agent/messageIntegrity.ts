// Agent 消息完整性工具
//
// 背景：OpenAI / DeepSeek 等 function-calling 接口要求
//   assistant(tool_calls) 后面必须紧跟对应的 tool(result) 消息。
// 上下文滑动窗口、历史摘要、断点快照截断都可能把这一对拆开，
// 触发 HTTP 400（insufficient tool messages following tool_calls）。
//
// 这里提供纯函数：
//   - validateToolCallPairs：只诊断，不改数据
//   - repairToolCallPairs：重建合法消息链（删除不完整调用 / 孤立 tool）
//   - compressMessages：按窗口压缩，但保证 tool 调用对不被拆散

export interface ToolCallLike {
  id: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface MessageLike {
  role: 'system' | 'user' | 'assistant' | 'tool' | string;
  content?: unknown;
  tool_calls?: ToolCallLike[];
  tool_call_id?: string;
  [key: string]: unknown;
}

export interface CompressionOptions {
  /** 超过该消息数才压缩 */
  maxMessages?: number;
  /** system 后保留的头部消息数 */
  headCount?: number;
  /** 末尾保留的消息数 */
  tailCount?: number;
  /** 自定义摘要文案；不传则生成默认文案 */
  summaryText?: string;
}

export interface CompressionResult<T extends MessageLike> {
  messages: T[];
  omitted: number;
  compressed: boolean;
}

function toolCallIds(msg: MessageLike): string[] {
  return (msg.tool_calls ?? []).map((tc) => tc.id).filter(Boolean);
}

/**
 * 校验消息链中的 tool_calls 配对，返回人类可读的问题列表。
 * 空数组表示合法。
 */
export function validateToolCallPairs(messages: MessageLike[]): string[] {
  const problems: string[] = [];
  const seenCallIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const ids = toolCallIds(msg);
      if (ids.length !== msg.tool_calls.length) {
        problems.push(`assistant 消息 #${i} 存在缺少 id 的 tool_call`);
      }
      for (const id of ids) {
        if (seenCallIds.has(id)) problems.push(`tool_call id 重复：${id}`);
        seenCallIds.add(id);
      }

      let cursor = i + 1;
      for (const id of ids) {
        const reply = messages[cursor];
        if (!reply || reply.role !== 'tool' || reply.tool_call_id !== id) {
          problems.push(`assistant 消息 #${i} 的 tool_call ${id} 缺少紧邻的 tool 回复`);
          break;
        }
        cursor++;
      }
    }

    if (msg.role === 'tool') {
      if (!msg.tool_call_id) {
        problems.push(`tool 消息 #${i} 缺少 tool_call_id`);
        continue;
      }
      // 向前回溯连续的 tool 消息，找到对应的 assistant
      let j = i - 1;
      while (j >= 0 && messages[j].role === 'tool') j--;
      const owner = j >= 0 ? messages[j] : undefined;
      const ok =
        owner?.role === 'assistant' &&
        Array.isArray(owner.tool_calls) &&
        owner.tool_calls.some((tc) => tc.id === msg.tool_call_id);
      if (!ok) problems.push(`tool 消息 #${i} 是孤立回复：${msg.tool_call_id}`);
    }
  }

  return problems;
}

/**
 * 重建合法消息链：
 * - 删除 tool_calls 未被完整回复的 assistant 消息
 * - 删除没有对应 assistant 的孤立 tool 消息
 * - 保留原始顺序与其它字段
 */
export function repairToolCallPairs<T extends MessageLike>(messages: T[]): T[] {
  const result: T[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const ids = toolCallIds(msg);
      const replies: T[] = [];
      let cursor = i + 1;
      while (cursor < messages.length && messages[cursor].role === 'tool') {
        replies.push(messages[cursor]);
        cursor++;
      }

      const used = new Set<string>();
      const matched: T[] = [];
      let complete = ids.length > 0;
      for (const id of ids) {
        const reply = replies.find((r) => r.tool_call_id === id && !used.has(id));
        if (!reply) {
          complete = false;
          break;
        }
        used.add(id);
        matched.push(reply);
      }

      if (complete) {
        result.push(msg);
        result.push(...matched);
      }
      // 无论是否完整，都跳过后续连续的 tool 消息；孤立项不会被重复加入
      i = cursor - 1;
      continue;
    }

    if (msg.role === 'tool') {
      // 没有在 assistant 分支被消费的 tool 一律视为孤立消息
      continue;
    }

    result.push(msg);
  }

  return result;
}

/** 从给定位置向前回溯，避免 tail 以 tool 消息开头把调用对拆开 */
function safeTailStart(messages: MessageLike[], requestedStart: number, minStart: number): number {
  let start = Math.max(requestedStart, minStart);
  while (start > minStart && messages[start]?.role === 'tool') start--;
  // 如果回溯到 assistant(tool_calls)，需要把它一起纳入 tail
  if (start > minStart && messages[start]?.role === 'assistant' && messages[start]?.tool_calls?.length) {
    // start 已经是 assistant，保留即可
    return start;
  }
  return start;
}

/**
 * 压缩消息历史：保留 system、头部任务背景、尾部最近进展，
 * 中间插入一条摘要消息。压缩后会自动修复 tool 调用对。
 */
export function compressMessages<T extends MessageLike>(
  messages: T[],
  options: CompressionOptions = {}
): CompressionResult<T> {
  const maxMessages = options.maxMessages ?? 60;
  const headCount = options.headCount ?? 4;
  const tailCount = options.tailCount ?? 20;

  if (messages.length <= maxMessages) {
    return { messages, omitted: 0, compressed: false };
  }

  const hasSystem = messages[0]?.role === 'system';
  const system = hasSystem ? messages[0] : undefined;
  const bodyStart = hasSystem ? 1 : 0;

  const headEnd = Math.min(bodyStart + headCount, messages.length);
  const head = messages.slice(bodyStart, headEnd);

  const rawTailStart = Math.max(headEnd, messages.length - tailCount);
  const tailStart = safeTailStart(messages, rawTailStart, headEnd);
  const tail = messages.slice(tailStart);
  const middle = messages.slice(headEnd, tailStart);

  const summaryText =
    options.summaryText ??
    `[系统摘要] 上面已省略 ${middle.length} 条中间过程消息。任务仍在继续，请根据最近上下文继续执行剩余步骤。`;

  const summary = {
    role: 'user',
    content: summaryText,
  } as T;

  const rebuilt = [...(system ? [system] : []), ...head, summary, ...tail];
  return {
    messages: repairToolCallPairs(rebuilt),
    omitted: middle.length,
    compressed: true,
  };
}