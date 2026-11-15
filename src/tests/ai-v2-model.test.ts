import { describe, expect, it } from 'vitest';
import { getModelCapabilities } from '@/ai-v2/modelCapabilities';

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