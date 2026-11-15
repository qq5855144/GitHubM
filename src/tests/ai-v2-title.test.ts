import { describe, expect, it } from 'vitest';
import { deriveSessionTitle } from '@/ai-v2/sessionTitle';

describe('derived session titles', () => {
  it('turns common repository tasks into concise titles', () => {
    expect(deriveSessionTitle([{
      role: 'user',
      content: '请阅读当前仓库的 README，并解释项目结构',
    }])).toBe('仓库 README');
    expect(deriveSessionTitle([{
      role: 'user',
      content: 'Actions 构建失败，帮我查看完整日志',
    }])).toBe('CI 问题排查');
  });

  it('cleans generic prompts', () => {
    expect(deriveSessionTitle([{
      role: 'user',
      content: '请帮我写一个 TypeScript 工具函数',
    }])).toBe('代码实现');
  });

  it('uses attachment names when the prompt is only an attachment', () => {
    expect(deriveSessionTitle([{
      role: 'user',
      content: '请查看附件：report.pdf',
      attachments: [{ id: 'a1', name: 'report.pdf', source: 'local', size: 1, content: '' }],
    }])).toBe('附件 report.pdf');
  });
});