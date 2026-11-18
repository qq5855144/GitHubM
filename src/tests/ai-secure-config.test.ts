import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadModelConfig, saveModelConfig, loadProviderKey, saveProviderKey } from '@/components/ai/aiUtils';

interface Bridge {
  secureGet?: (key: string) => string | null;
  secureSet?: (key: string, value: string) => boolean;
  secureRemove?: (key: string) => void;
}

function installBridge() {
  const store = new Map<string, string>();
  const bridge: Bridge = {
    secureGet: key => store.get(key) ?? null,
    secureSet: (key, value) => { store.set(key, value); return true; },
    secureRemove: key => store.delete(key),
  };
  Object.defineProperty(window, 'AndroidBridge', { value: bridge, configurable: true, writable: true });
  return store;
}

describe('AI model config secure storage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    Object.defineProperty(window, 'AndroidBridge', { value: undefined, configurable: true, writable: true });
    localStorage.clear();
  });

  it('migrates the model config and per-provider key out of localStorage', () => {
    const store = installBridge();
    localStorage.setItem('ai_assistant_model_config', JSON.stringify({
      type: 'deepseek', model: 'deepseek-chat', api_key: 'legacy-key',
    }));
    localStorage.setItem('ai_api_key_deepseek', 'legacy-key');

    const config = loadModelConfig();
    expect(config.api_key).toBe('legacy-key');
    expect(localStorage.getItem('ai_assistant_model_config')).toBeNull();
    expect(store.get('ai_assistant_model_config')).toContain('legacy-key');
    expect(loadProviderKey('deepseek')).toBe('legacy-key');
    expect(localStorage.getItem('ai_api_key_deepseek')).toBeNull();
  });

  it('writes new keys and config through secure storage', () => {
    const store = installBridge();
    saveProviderKey('openai', 'sk-openai');
    expect(loadProviderKey('openai')).toBe('sk-openai');
    expect(localStorage.getItem('ai_api_key_openai')).toBeNull();

    saveModelConfig({ type: 'openai', model: 'gpt-4o-mini', api_key: 'sk-openai' });
    expect(loadModelConfig().api_key).toBe('sk-openai');
    expect(localStorage.getItem('ai_assistant_model_config')).toBeNull();
    expect(store.get('ai_assistant_model_config')).toContain('sk-openai');
  });
});
