import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '@/App';
import '@/pages/AiAssistantV2Page';
import { loadSessionIndex, loadSessionMessages, saveSessionIndex, saveSessionMessages } from '@/ai-v2/sessionStore';
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

it('exports an unopened conversation from storage through the Android download bridge', async () => {
  const saveBlobData = vi.fn();
  vi.stubGlobal('AndroidBridge', { saveBlobData, notifyReady: vi.fn() });
  const createdAt = '2026-07-05T08:00:00.000Z';
  const updatedAt = '2026-07-06T08:00:00.000Z';
  await saveSessionIndex('audit-user', {
    activeId: 'active',
    sessions: [
      { id: 'active', title: '当前对话', titleSource: 'manual', repo: null, createdAt, updatedAt },
      { id: 'archive', title: '项目/审查', titleSource: 'manual', repo: { fullName: 'octo/project', defaultBranch: 'main', branch: 'review' }, createdAt, updatedAt },
    ],
  });
  await saveSessionMessages('audit-user', 'archive', [
    { id: 'q', role: 'user', content: '检查这些代码 🧪', createdAt, attachments: [{
      id: 'attachment', name: 'notes.txt', path: 'src/a_b.ts', source: 'repo', size: 28, content: 'internal attachment payload',
    }] },
    {
      id: 'a', role: 'assistant', createdAt: updatedAt, reasoning: 'internal trace',
      content: ['**完整答复**', '', '```ts', 'const value = 1;', '```'].join('\n'),
    },
  ]);
  render(<App />);
  expect(await screen.findByRole('heading', { name: '当前对话' })).toBeVisible();
  fireEvent.click(screen.getByTitle(i18n.t('会话列表')));
  const drawer = await screen.findByRole('dialog', { name: i18n.t('对话历史') });
  const row = within(drawer).getByText('项目/审查').closest('.group');
  if (!(row instanceof HTMLElement)) throw new Error('Missing conversation row');
  fireEvent.click(within(row).getByRole('button', { name: i18n.t('导出对话为 Markdown') }));

  await waitFor(() => expect(saveBlobData).toHaveBeenCalledOnce());
  const [name, mime, base64] = saveBlobData.mock.calls[0];
  const text = new TextDecoder().decode(Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
  expect(name).toBe('项目-审查-2026-07-06.md');
  expect(mime).toBe('text/markdown');
  expect(text).toContain('# 项目/审查');
  expect(text).toContain('octo/project');
  expect(text).toContain('review');
  expect(text).toContain('检查这些代码 🧪');
  expect(text).toContain('**完整答复**');
  expect(text).toContain('const value = 1;');
  expect(text).toContain('src/a\\_b.ts');
  expect(text).not.toContain('internal attachment payload');
  expect(text).not.toContain('internal trace');
  fireEvent.keyDown(drawer, { key: 'Escape' });
  expect(await screen.findByRole('heading', { name: '当前对话' })).toBeVisible();
});
