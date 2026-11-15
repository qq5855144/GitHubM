import { describe, expect, it } from 'vitest';
import { getModelCapabilities } from '@/ai-v2/modelCapabilities';
import { buildProviderRequest, stripReasoningContent } from '@/ai-v2/providers';
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
