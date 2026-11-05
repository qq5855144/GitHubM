// Agent 可靠性基础模块测试
import { beforeEach, describe, expect, it } from 'vitest';
import {
  compressMessages,
  repairToolCallPairs,
  validateToolCallPairs,
  type MessageLike,
} from '@/lib/agent/messageIntegrity';
import {
  clampToolResult,
  getToolRisk,
  shouldRequireApproval,
  validateRequiredArguments,
  validateToolArguments,
} from '@/lib/agent/toolPolicy';
import {
  clearAgentTraces,
  endAgentTrace,
  formatAgentTrace,
  getAgentTraces,
  recordAgentTraceEvent,
  startAgentTrace,
} from '@/lib/agent/runTrace';

function assistantWithCalls(...ids: string[]): MessageLike {
  return {
    role: 'assistant',
    content: '',
    tool_calls: ids.map((id) => ({
      id,
      type: 'function',
      function: { name: 'read_file', arguments: '{}' },
    })),
  };
}

describe('messageIntegrity', () => {
  it('保留完整 tool_calls 对', () => {
    const messages: MessageLike[] = [
      { role: 'user', content: 'hi' },
      assistantWithCalls('call_1'),
      { role: 'tool', content: 'ok', tool_call_id: 'call_1' },
    ];
    expect(validateToolCallPairs(messages)).toEqual([]);
    expect(repairToolCallPairs(messages)).toHaveLength(3);
  });

  it('删除缺少 tool 回复的 assistant 调用', () => {
    const messages: MessageLike[] = [
      { role: 'user', content: 'hi' },
      assistantWithCalls('call_1'),
      { role: 'user', content: '继续' },
    ];
    expect(validateToolCallPairs(messages).length).toBeGreaterThan(0);
    expect(repairToolCallPairs(messages)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: '继续' },
    ]);
  });

  it('删除孤立 tool 消息', () => {
    const messages: MessageLike[] = [
      { role: 'user', content: 'hi' },
      { role: 'tool', content: 'orphan', tool_call_id: 'call_x' },
    ];
    expect(repairToolCallPairs(messages)).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('保留多工具调用与多项回复', () => {
    const messages: MessageLike[] = [
      assistantWithCalls('a', 'b'),
      { role: 'tool', content: 'A', tool_call_id: 'a' },
      { role: 'tool', content: 'B', tool_call_id: 'b' },
    ];
    expect(validateToolCallPairs(messages)).toEqual([]);
    expect(repairToolCallPairs(messages)).toHaveLength(3);
  });

  it('压缩后 system / 摘要 / 尾部保留，且调用对合法', () => {
    const messages: MessageLike[] = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < 80; i++) {
      messages.push({ role: 'user', content: `u${i}` });
      messages.push({ role: 'assistant', content: `a${i}` });
    }
    // 让尾部跨越一个工具调用
    messages.push(assistantWithCalls('tail_call'));
    messages.push({ role: 'tool', content: 'tail result', tool_call_id: 'tail_call' });

    const result = compressMessages(messages, { maxMessages: 60, headCount: 4, tailCount: 20 });
    expect(result.compressed).toBe(true);
    expect(result.omitted).toBeGreaterThan(0);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages.some((m) => String(m.content).includes('[系统摘要]'))).toBe(true);
    expect(validateToolCallPairs(result.messages)).toEqual([]);
  });

  it('未超阈值时不压缩', () => {
    const messages: MessageLike[] = [{ role: 'user', content: 'hi' }];
    const result = compressMessages(messages, { maxMessages: 10 });
    expect(result.compressed).toBe(false);
    expect(result.messages).toBe(messages);
  });
});

describe('toolPolicy', () => {
  it('风险分级', () => {
    expect(getToolRisk('read_file')).toBe('read');
    expect(getToolRisk('patch_file')).toBe('write');
    expect(getToolRisk('delete_repo')).toBe('dangerous');
  });

  it('审批策略：只读不拦，危险永远拦', () => {
    expect(shouldRequireApproval('read_file', true)).toBe(false);
    expect(shouldRequireApproval('delete_repo', true)).toBe(true);
    expect(shouldRequireApproval('patch_file', true)).toBe(false);
    expect(shouldRequireApproval('patch_file', false)).toBe(true);
  });

  it('必填参数校验', () => {
    const schema = {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string' } },
    };
    expect(validateRequiredArguments(schema, {})).toEqual(['缺少必填参数：path']);
    expect(validateRequiredArguments(schema, { path: 'a.md' })).toEqual([]);
  });

  it('类型与枚举校验', () => {
    const schema = {
      type: 'object',
      properties: {
        count: { type: 'integer' },
        mode: { type: 'string', enum: ['a', 'b'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    const errors = validateToolArguments(schema, {
      count: 1.5,
      mode: 'c',
      tags: ['x', 2],
    });
    expect(errors.length).toBe(3);
  });

  it('超长工具结果裁剪', () => {
    const result = clampToolResult('x'.repeat(100), 40);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(160);
    expect(result.originalLength).toBe(100);
  });
});

describe('runTrace', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAgentTraces();
  });

  it('记录、结束并格式化一次运行', () => {
    const id = startAgentTrace({ model: 'deepseek-v4-flash', repo: 'o/r', userId: 'u1' });
    recordAgentTraceEvent(id, 'tool_start', { name: 'read_file' });
    recordAgentTraceEvent(id, 'tool_end', { name: 'read_file', status: 'success' });
    endAgentTrace(id, 'success', { chars: 123 });

    const traces = getAgentTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0].status).toBe('success');
    expect(traces[0].events.map((e) => e.type)).toContain('tool_end');
    expect(formatAgentTrace(traces[0])).toContain('read_file');
  });

  it('最多保留 20 次运行', () => {
    for (let i = 0; i < 25; i++) startAgentTrace({ model: 'm' });
    expect(getAgentTraces()).toHaveLength(20);
  });
});