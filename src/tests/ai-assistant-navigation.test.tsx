import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '@/App';
import { loadSessionIndex, loadSessionMessages } from '@/ai-v2/sessionStore';
import { saveModelConfig } from '@/components/ai/aiUtils';
import i18n from '@/i18n';

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    user: { id: 1, login: 'audit-user' }, token: 'github-token',
    loading: false, isAuthenticated: true,
  }),
}));

vi.mock('@/components/layouts/MainLayout', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <>
      <Link to="/ai-assistant">Chat route</Link>
      <Link to="/ai-settings">Settings route</Link>
      {children}
    </>
  ),
}));

vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('@/components/system/LaunchUpdateChecker', () => ({ default: () => null }));
vi.mock('@/lib/visitStats', () => ({
  recordVisit: vi.fn(),
  recordGlobalVisit: vi.fn(),
}));

const encode = (text: string) => new TextEncoder().encode(text);

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/ai-assistant';
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Element.prototype.scrollIntoView ??= vi.fn();
  saveModelConfig({ type: 'openai', model: 'gpt-4o-mini', api_key: 'openai-key' });
});

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function sendMessage(value: string) {
  const input = await screen.findByPlaceholderText(i18n.t('输入消息… Enter 发送，Shift+Enter 换行'));
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByTitle(i18n.t('发送')));
}

it('keeps one Android run active while switching application routes and saves its entire answer', async () => {
  const startAgentTask = vi.fn();
  const stopAgentTask = vi.fn();
  vi.stubGlobal('AndroidBridge', { startAgentTask, stopAgentTask, notifyReady: vi.fn() });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const output = 'BEGIN ' + 'x'.repeat(20010) + ' END';
  let fetchSignal: AbortSignal | undefined | null;
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    fetchSignal = init?.signal;
    return new Response(new ReadableStream({
      start(controller) { stream = controller; },
    }));
  });
  vi.stubGlobal('fetch', fetch);

  const first = render(<App />);
  await sendMessage('Keep running');
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(startAgentTask).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole('link', { name: 'Settings route' }));
  await waitFor(() => expect(window.location.hash).toBe('#/ai-settings'));
  expect(fetchSignal?.aborted).toBe(false);
  expect(stopAgentTask).not.toHaveBeenCalled();

  await act(async () => {
    stream.enqueue(encode('data: ' + JSON.stringify({ choices: [{ delta: { content: output } }] }) + '\n\n'));
    stream.enqueue(encode('data: [DONE]\n\n'));
    stream.close();
  });
  await waitFor(() => expect(stopAgentTask).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('link', { name: 'Chat route' }));
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('展开全文') }));
  expect(await screen.findByText(output)).toBeVisible();

  first.unmount();
  const savedIndex = await loadSessionIndex('audit-user');
  const saved = await loadSessionMessages('audit-user', savedIndex!.activeId);
  expect(saved.find(message => message.role === 'assistant')?.content).toBe(output);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('展开全文') }));
  expect(await screen.findByText(output)).toBeVisible();
  expect(fetch).toHaveBeenCalledOnce();
});

it('retains partial text and shows a separate status when the stream ends early', async () => {
  const fetch = vi.fn(async () => new Response(
    'data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n',
  ));
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  await sendMessage('Question');
  expect(await screen.findByText('Partial answer')).toBeVisible();
  expect(await screen.findByText(/模型响应提前结束/)).toBeVisible();
});
