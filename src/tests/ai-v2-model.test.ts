import { describe, expect, it } from 'vitest';
import { getModelCapabilities } from '@/ai-v2/modelCapabilities';
import { buildProviderRequest, sanitizeToolCallPairing, stripReasoningContent } from '@/ai-v2/providers';
import type { ModelConfig } from '@/components/ai/aiTypes';

describe('model capabilities', () => {
  it('marks vision-capable models and context windows', () => {
    const gemini = getModelCapabilities('gemini', 'gemini-2.5-flash');
    expect(gemini.supportsVision).toBe(true);
    expect(gemini.contextWindow).toBe(1_000_000);

    const deepseek = getModelCapabilities('deepseek', 'deepseek-v4-flash');
    expect(deepseek.supportsVision).toBe(false);
    expect(deepseek.contextWindow).toBe(128_000);
    expect(deepseek.maxOutput).toBe(8192);
  });
});

describe('provider request', () => {
  const config: ModelConfig = { type: 'deepseek', api_key: 'sk-test', model: 'deepseek-v4-flash' };

  it('never sends reasoning_content back to the provider', () => {
    const body = buildProviderRequest(config, [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null, reasoning_content: '思考内容', tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ], []).body as { messages: Array<Record<string, unknown>> };

    expect(body.messages.some(message => 'reasoning_content' in message)).toBe(false);
    expect(body.messages[2].tool_calls).toBeTruthy();
  });

  it('strips reasoning without copying other fields', () => {
    const result = stripReasoningContent([
      { role: 'assistant', content: 'a', reasoning_content: 'r' },
      { role: 'user', content: 'b' },
    ]);
    expect(result[0]).toEqual({ role: 'assistant', content: 'a' });
    expect(result[1]).toEqual({ role: 'user', content: 'b' });
  });
});

describe('tool_calls pairing sanitize', () => {
  it('drops an assistant tool_calls whose replies are missing at a middle position', () => {
    // 压缩后 head 尾部残留 assistant(tool_calls)，后面接的是摘要 user 消息
    const result = sanitizeToolCallPairing([
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } }] },
      { role: 'user', content: '（历史摘要）' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 't', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c2', content: 'ok' },
    ]);
    expect(result.map(item => item.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(result[2].tool_calls?.[0].id).toBe('c2');
  });

  it('drops an assistant tool_calls whose replies are missing at a middle position', () => {
    const result = sanitizeToolCallPairing([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'mid', type: 'function', function: { name: 't', arguments: '{}' } }] },
      { role: 'user', content: '摘要：之前聊了很多' },
      { role: 'user', content: 'q2' },
    ]);
    expect(result.map(item => item.role)).toEqual(['system', 'user', 'user', 'user']);
    expect(result.some(item => item.tool_calls)).toBe(false);
  });

  it('drops orphan tool messages that lost their assistant declaration', () => {
    const result = sanitizeToolCallPairing([
      { role: 'system', content: 'sys' },
      { role: 'tool', tool_call_id: 'gone', content: 'orphan' },
      { role: 'user', content: 'hi' },
    ]);
    expect(result.map(item => item.role)).toEqual(['system', 'user']);
  });

  it('keeps parallel tool_calls replies in order and removes incomplete ones', () => {
    const result = sanitizeToolCallPairing([
      { role: 'assistant', content: null, tool_calls: [
        { id: 'a1', type: 'function', function: { name: 't', arguments: '{}' } },
        { id: 'a2', type: 'function', function: { name: 't', arguments: '{}' } },
      ] },
      { role: 'tool', tool_call_id: 'a1', content: 'one' },
      { role: 'tool', tool_call_id: 'a2', content: 'two' },
      { role: 'assistant', content: null, tool_calls: [
        { id: 'b1', type: 'function', function: { name: 't', arguments: '{}' } },
        { id: 'b2', type: 'function', function: { name: 't', arguments: '{}' } },
      ] },
      { role: 'tool', tool_call_id: 'b1', content: 'only one' },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].tool_calls).toHaveLength(2);
    expect(result.slice(1).map(item => item.tool_call_id)).toEqual(['a1', 'a2']);
  });

  it('never emits a body that starts with tool or breaks pairing', () => {
    const config: ModelConfig = { type: 'deepseek', api_key: 'sk-test', model: 'deepseek-v4-flash' };
    const body = buildProviderRequest(config, [
      { role: 'system', content: 'sys' },
      { role: 'tool', tool_call_id: 'gone', content: 'orphan' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c9', type: 'function', function: { name: 't', arguments: '{}' } }] },
      { role: 'user', content: 'next question' },
    ], []).body as { messages: Array<Record<string, unknown>> };
    expect(body.messages.some(message => message.role === 'tool')).toBe(false);
    expect(body.messages.every(message => !message.tool_calls)).toBe(true);
  });
});
