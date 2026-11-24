import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { saveModelConfig } from '@/components/ai/aiUtils';
import i18n from '@/i18n';
import AiAssistantV2Page from '@/pages/AiAssistantV2Page';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { login: 'octocat' }, token: 'github-token' }),
}));

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('selects the saved custom model and sends chat to its endpoint with its own key', async () => {
  saveModelConfig({
    type: 'custom', endpoint: 'https://custom.example/v1', model: 'custom-model', api_key: 'custom-key',
  });
  saveModelConfig({ type: 'openai', model: 'gpt-4o-mini', api_key: 'openai-key' });
  const fetch = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n'));
  vi.stubGlobal('fetch', fetch);
  Element.prototype.scrollIntoView ??= vi.fn();

  render(<MemoryRouter><AiAssistantV2Page /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'GPT-4o Mini' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /custom-model/ }));
  await screen.findByRole('button', { name: 'custom-model' });
  fireEvent.change(screen.getByPlaceholderText(i18n.t('输入消息… Enter 发送，Shift+Enter 换行')), {
    target: { value: 'Hello' },
  });
  fireEvent.click(screen.getByTitle(i18n.t('发送')));

  await waitFor(() => expect(fetch).toHaveBeenCalledWith('https://custom.example/v1/chat/completions',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer custom-key' }),
      body: expect.stringContaining('"model":"custom-model"'),
    })));
});
