import { describe, expect, it } from 'vitest';
import type { Message } from '@/components/ai/aiTypes';
import {
  buildModelHistory,
  compactMessageForStorage,
  messageToModelHistoryText,
} from '@/lib/agent/conversationMemory';

function msg(partial: Partial<Message> & { id: string; role: Message['role'] }): Message {
  return { content: '', ...partial } as Message;
}

describe('conversationMemory', () => {
  it('把工具结果、步骤与附件文本带入跨轮上下文', () => {
    const messages: Message[] = [
      msg({ id: 'u1', role: 'user', content: '修复登录' }),
      msg({ id: 's1', role: 'assistant', bubbleType: 'step', stepTitle: '定位文件' }),
      msg({
        id: 't1', role: 'assistant', bubbleType: 'tool',
        toolLabel: '读取文件', toolStatus: 'success', toolResult: 'export function login() {}',
      }),
      msg({ id: 'th1', role: 'assistant', bubbleType: 'thinking', thinkingContent: '内部思考' }),
      msg({
        id: 'u2', role: 'user', content: '继续',
        attachments: [{ id: 'a1', name: 'log.txt', type: 'text', mimeType: 'text/plain', content: 'TypeError: x', size: 12 }],
      }),
    ];

    const history = buildModelHistory(messages);
    const joined = history.map(h => h.content).join('\n');
    expect(joined).toContain('[步骤] 定位文件');
    expect(joined).toContain('[工具 读取文件] export function login');
    expect(joined).toContain('TypeError: x');
    expect(joined).not.toContain('内部思考');
  });

  it('最新用户消息替换重复的最后一条', () => {
    const history = buildModelHistory(
      [msg({ id: 'u1', role: 'user', content: '旧问题' })],
      '新问题',
    );
    expect(history).toEqual([{ role: 'user', content: '新问题' }]);
  });

  it('最多保留 80 条有效历史', () => {
    const messages: Message[] = [];
    for (let i = 0; i < 120; i++) {
      messages.push(msg({ id: `u${i}`, role: 'user', content: `消息 ${i}` }));
    }
    const history = buildModelHistory(messages);
    expect(history).toHaveLength(80);
    expect(history[79].content).toBe('消息 119');
  });

  it('持久化压缩图片 base64 与超长工具结果', () => {
    const image = compactMessageForStorage(msg({
      id: 'img', role: 'user', content: '看图',
      attachments: [{
        id: 'a1', name: 'x.png', type: 'image', mimeType: 'image/png',
        content: 'data:image/png;base64,' + 'A'.repeat(10000), size: 10000,
      }],
    }));
    expect(image.attachments?.[0].content).toBe('');

    const tool = compactMessageForStorage(msg({
      id: 't', role: 'assistant', bubbleType: 'tool', toolResult: 'x'.repeat(5000),
      inlineTools: [{ id: 'i', tool: 'read_file', label: '读取', hint: '', status: 'success', result: 'y'.repeat(5000) }],
    }));
    expect(tool.toolResult?.length).toBeLessThan(3200);
    expect(tool.inlineTools?.[0].result?.length).toBeLessThan(2200);
  });

  it('文本附件只保留截断后的内容', () => {
    const compact = compactMessageForStorage(msg({
      id: 'u', role: 'user', content: '附件',
      attachments: [{
        id: 'a', name: 'big.txt', type: 'text', mimeType: 'text/plain',
        content: 'z'.repeat(9000), size: 9000,
      }],
    }));
    expect(compact.attachments?.[0].content.length).toBeLessThan(4200);
  });

  it('messageToModelHistoryText 对空消息返回空串', () => {
    expect(messageToModelHistoryText(msg({ id: 'x', role: 'assistant' }))).toBe('');
  });
});