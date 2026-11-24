// AI V2 — 模型能力注册表
import type { ModelType } from '@/components/ai/aiTypes';

export interface ModelCapabilities {
  supportsTools: boolean;
  supportsVision: boolean;
  contextWindow: number;
  maxOutput: number;
}

export function getModelCapabilities(type: ModelType | string, model?: string): ModelCapabilities {
  const name = `${type} ${model || ''}`.toLowerCase();
  const vision = /(gemini|gpt-4o|gpt-4\.1|claude|vision|llava|qwen.*vl|pixtral)/.test(name);
  const contextWindow = /gemini/.test(name)
    ? 1_000_000
    : /deepseek/.test(name)
      ? 128_000
      : /qwen/.test(name)
        ? 128_000
        : /openrouter|particle/.test(name)
          ? 64_000
          : 32_000;
  return {
    supportsTools: type !== 'custom',
    supportsVision: vision,
    contextWindow,
    maxOutput: 8192,
  };
}
