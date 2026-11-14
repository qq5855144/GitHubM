import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultProviderModel,
  getProviderChatUrl,
  getProviderModelsUrl,
  testProviderConnection,
} from '../components/ai/aiProviders';

describe('OpenRouter free model provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the official OpenRouter endpoints', () => {
    expect(getProviderChatUrl('openrouter')).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(getProviderModelsUrl('openrouter')).toBe('https://openrouter.ai/api/v1/models');
  });

  it('tests the connection directly instead of the default proxy', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await testProviderConnection(
      'openrouter',
      'sk-or-v1-test',
      undefined,
      'openrouter/free',
    );

    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-v1-test');
    expect((init.headers as Record<string, string>)['x-llm-provider']).toBeUndefined();
  });

  it('uses a provider-specific model when testing without a selection', async () => {
    expect(getDefaultProviderModel('openrouter')).toBe('openrouter/free');

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await testProviderConnection('openrouter', 'sk-or-v1-test');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { model: string };
    expect(body.model).toBe('openrouter/free');
  });
});
