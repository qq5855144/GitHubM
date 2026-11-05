// 对话记忆与持久化压缩
//
// 这两件事以前散落在 AiAssistantPage 里：
//   - buildModelHistory 只取 content，重进/跨轮后丢失工具执行结果
//   - 持久化直接把 base64 图片和超大工具结果写进 localStorage，容易撞 5MB 配额
// 抽成纯函数后可以独立测试，也便于后续换成 IndexedDB。

import type { Message } from '@/components/ai/aiTypes';

export function truncateForStorage(text: string | undefined, max: number): string | undefined {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + `\n…（持久化时截断，原始长度 ${text.length} 字符）`;
}

/** 持久化前压缩大字段，避免 localStorage 5MB 配额被图片/工具日志撑爆 */
export function compactMessageForStorage(message: Message): Message {
  const compact: Message = { ...message };
  compact.content = truncateForStorage(message.content, 12_000) ?? '';
  compact.thinkingContent = truncateForStorage(message.thinkingContent, 2_000);
  compact.toolResult = truncateForStorage(message.toolResult, 2_000);
  if (message.inlineTools) {
    compact.inlineTools = message.inlineTools.map(tool => ({
      ...tool,
      result: truncateForStorage(tool.result, 1_000),
    }));
  }
  if (message.attachments) {
    compact.attachments = message.attachments.map(att => ({
      ...att,
      // 图片 base64 最容易撑爆 localStorage；历史恢复时保留文件名/类型，不保留内容
      content: att.type === 'text'
        ? (truncateForStorage(att.content, 2_000) ?? '')
        : '',
    }));
  }
  return compact;
}

/** 把中间气泡（工具/步骤）转换为模型可理解的文本，避免跨轮丢失执行结果 */
export function messageToModelHistoryText(message: Message): string {
  if (message.messageType === 'memory_summary') return message.content;
  if (message.bubbleType === 'thinking') return '';
  if (message.bubbleType === 'step') return message.stepTitle ? `[步骤] ${message.stepTitle}` : '';
  if (message.bubbleType === 'tool') {
    const label = message.toolLabel || message.toolName || '工具';
    const result = (message.toolResult || '').trim();
    const brief = result.length > 1_500 ? `${result.slice(0, 1_500)}…` : result;
    return brief ? `[工具 ${label}] ${brief}` : `[工具 ${label}] ${message.toolStatus ?? ''}`;
  }

  const attachmentText = (message.attachments ?? [])
    .filter(att => att.type === 'text' && att.content)
    .map(att => `[附件 ${att.name}]\n${att.content.slice(0, 4_000)}`)
    .join('\n');
  const content = [message.content, attachmentText].filter(Boolean).join('\n\n');
  if (content) return content;

  if (message.inlineTools?.length) {
    return message.inlineTools
      .map(t => `[工具 ${t.label || t.tool}] ${t.status}${t.result ? `：${t.result.slice(0, 800)}` : ''}`)
      .join('\n');
  }
  return '';
}

/** 跨轮对话历史：保留用户/助手正文、工具结果摘要、附件文本；最多 80 条 */
export function buildModelHistory(
  messages: Message[],
  latestUserText?: string
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const normalized = messages
    .filter(m => m.id !== 'welcome')
    .filter(m => !m.streaming)
    .map(m => ({ role: m.role, content: messageToModelHistoryText(m) }))
    .filter(m => m.content.trim().length > 0)
    .slice(-80);

  if (!latestUserText) return normalized;
  if (normalized.length === 0) return [{ role: 'user', content: latestUserText }];

  const last = normalized[normalized.length - 1];
  if (last.role === 'user') {
    return [...normalized.slice(0, -1), { role: 'user', content: latestUserText }];
  }
  return [...normalized, { role: 'user', content: latestUserText }];
}