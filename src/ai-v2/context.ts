// AI V2 — Context Builder：系统提示词 + 技能 + 记忆 + 预算裁剪
import type { AgentHistoryMessage, CapabilityInfo, V2ProviderMessage } from './types';
import { searchMemories } from './memory';
import { selectSkills } from './skills';

export interface BuiltContext {
  messages: V2ProviderMessage[];
  estimatedTokens: number;
  trimmedMessages: number;
  skillIds: string[];
  memoryIds: string[];
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const char of text) {
    const code = char.codePointAt(0) || 0;
    if (code >= 0x2e80 && code <= 0x9fff) tokens += 1;
    else if (code >= 0xac00 && code <= 0xd7af) tokens += 1;
    else if (code >= 0xf900 && code <= 0xfaff) tokens += 1;
    else if (code >= 0x3040 && code <= 0x30ff) tokens += 1;
    else if (/\s/.test(char)) tokens += 0.1;
    else tokens += 0.28;
  }
  return Math.max(1, Math.ceil(tokens));
}

export function truncateTextToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0 || !text) return '';
  let tokens = 0;
  let index = 0;
  for (const char of text) {
    const code = char.codePointAt(0) || 0;
    const cost = code >= 0x2e80
      ? 1
      : /\s/.test(char) ? 0.1 : 0.28;
    if (tokens + cost > maxTokens) break;
    tokens += cost;
    index += char.length;
  }
  if (index >= text.length) return text;
  return `${text.slice(0, index)}\n\n…（内容因上下文预算被截断，原长度 ${text.length} 字符）`;
}

function messageTokens(message: V2ProviderMessage): number {
  const toolCalls = message.tool_calls ? JSON.stringify(message.tool_calls) : '';
  const content = Array.isArray(message.content)
    ? message.content.map(part => part.type === 'text' ? part.text : '__IMAGE__').join('\n')
    : (message.content || '');
  const imageTokens = Array.isArray(message.content)
    ? message.content.filter(part => part.type === 'image_url').length * 1000
    : 0;
  return estimateTokens(`${content}\n${message.reasoning_content || ''}\n${toolCalls}`) + imageTokens;
}

/**
 * 工具循环可能连续产生大量结果。发送模型前压缩旧工具结果，
 * 只保留最近的完整结果，避免无上限轮数把上下文撑爆。
 */
export function compactProviderMessages(
  messages: V2ProviderMessage[],
  budget = 32000,
): V2ProviderMessage[] {
  if (!messages.length) return messages;
  const safeBudget = Math.max(4000, budget);
  if (messages.reduce((sum, item) => sum + messageTokens(item), 0) <= safeBudget) {
    return messages;
  }

  const cloned = messages.map(item => ({ ...item }));
  let toolSeen = 0;
  for (let index = cloned.length - 1; index >= 0; index--) {
    const item = cloned[index];
    if (item.role !== 'tool') continue;
    toolSeen++;
    if (toolSeen > 2 && typeof item.content === 'string' && item.content.length > 1500) {
      item.content = `${item.content.slice(0, 1500)}\n\n…（较早工具结果已压缩，原始长度 ${item.content.length} 字符）`;
    }
  }

  let systemPrefix: V2ProviderMessage[] = [];
  let body = cloned;
  for (let index = 0; index < cloned.length; index++) {
    if (cloned[index].role !== 'system') {
      systemPrefix = cloned.slice(0, index);
      body = cloned.slice(index);
      break;
    }
  }

  const total = () => [...systemPrefix, ...body].reduce((sum, item) => sum + messageTokens(item), 0);
  if (total() <= safeBudget) return [...systemPrefix, ...body];

  const userIndexes = body
    .map((item, index) => item.role === 'user' ? index : -1)
    .filter(index => index >= 0);

  let compacted: V2ProviderMessage[] | null = null;
  for (const index of userIndexes) {
    const candidate = [...systemPrefix, ...body.slice(index)];
    if (candidate.reduce((sum, item) => sum + messageTokens(item), 0) <= safeBudget) {
      compacted = candidate;
      break;
    }
  }

  if (!compacted && userIndexes.length) {
    compacted = [...systemPrefix, ...body.slice(userIndexes[userIndexes.length - 1])];
  }

  if (!compacted) {
    let start = Math.max(0, body.length - 8);
    while (start < body.length && body[start].role === 'tool') start += 1;
    compacted = [...systemPrefix, ...body.slice(start)];
  }

  const overBudget = (items: V2ProviderMessage[]) =>
    items.reduce((sum, item) => sum + messageTokens(item), 0) > safeBudget;

  // 仍超预算时，从最早的完整工具回合开始丢弃，保留最近几轮。
  while (overBudget(compacted) && compacted.length > 8) {
    const userIndex = compacted.findIndex(item => item.role === 'user');
    if (userIndex < 0) break;
    let start = userIndex + 1;
    while (start < compacted.length && compacted[start].role !== 'assistant') start++;
    if (start >= compacted.length) break;
    let end = start + 1;
    while (end < compacted.length && compacted[end].role === 'tool') end++;
    compacted.splice(start, end - start);
  }

  // 兜底清理：任何压缩路径都不能让请求以孤儿 tool 消息开头。
  const firstBodyIndex = compacted.findIndex(item => item.role !== 'system');
  if (firstBodyIndex >= 0) {
    let start = firstBodyIndex;
    while (start < compacted.length && compacted[start].role === 'tool') start += 1;
    if (start > firstBodyIndex) compacted.splice(firstBodyIndex, start - firstBodyIndex);
  }
  // 最后一个用户消息本身仍然过大时，截断非系统消息正文。
  return compacted.map(item => {
    if (item.role === 'tool' && typeof item.content === 'string' && estimateTokens(item.content) > 1500) {
      return { ...item, content: truncateTextToTokens(item.content, 1500) };
    }
    if (item.role !== 'system' && typeof item.content === 'string' && estimateTokens(item.content) > 4000) {
      return { ...item, content: truncateTextToTokens(item.content, 4000) };
    }
    return item;
  });
}

export function buildAgentContext(params: {
  systemPrompt: string;
  history: AgentHistoryMessage[];
  query: string;
  userLogin?: string;
  capabilities: CapabilityInfo[];
  contextBudget?: number;
  memoryEnabled?: boolean;
}): BuiltContext {
  const budget = Math.max(6000, params.contextBudget || 32000);
  const skills = selectSkills(params.query);
  const memories = params.memoryEnabled === false
    ? []
    : searchMemories(params.userLogin, params.query, 5);

  const extraSections: string[] = [];
  if (params.capabilities.length) {
    extraSections.push([
      '# 当前激活能力',
      ...params.capabilities.map(item => `- ${item.id}：${item.label} — ${item.description}`),
    ].join('\n'));
  }
  if (skills.length) {
    extraSections.push([
      '# 相关技能',
      ...skills.map(skill => `## ${skill.title}\n${skill.content}`),
    ].join('\n\n'));
  }
  if (memories.length) {
    extraSections.push([
      '# 相关长期记忆',
      ...memories.map(memory => `- ${memory.content}${memory.tags.length ? `（${memory.tags.join('、')}）` : ''}`),
    ].join('\n'));
  }

  let systemContent = [params.systemPrompt, ...extraSections].filter(Boolean).join('\n\n');
  let systemTokens = estimateTokens(systemContent);
  const maxSystemTokens = Math.max(1000, budget - 6000);
  if (systemTokens > maxSystemTokens) {
    systemContent = truncateTextToTokens(systemContent, maxSystemTokens);
    systemTokens = estimateTokens(systemContent);
  }

  // 给本轮输出和工具结果预留空间
  const historyBudget = Math.max(1500, budget - systemTokens - 6000);
  const selected: AgentHistoryMessage[] = [];
  let used = 0;
  for (let i = params.history.length - 1; i >= 0; i--) {
    const item = params.history[i];
    const cost = estimateTokens(item.content);
    if (selected.length > 0 && used + cost > historyBudget) break;
    selected.unshift(item);
    used += cost;
  }
  const trimmedMessages = params.history.length - selected.length;
  if (trimmedMessages > 0) {
    systemContent += `\n\n# 上下文说明\n较早的 ${trimmedMessages} 条历史消息因预算限制已省略；如需细节请让用户补充。`;
    if (estimateTokens(systemContent) > maxSystemTokens) {
      systemContent = truncateTextToTokens(systemContent, maxSystemTokens);
    }
    systemTokens = estimateTokens(systemContent);
  }

  const messages: V2ProviderMessage[] = [
    { role: 'system', content: systemContent },
    ...selected.map((item): V2ProviderMessage => ({ role: item.role, content: item.content })),
  ];

  return {
    messages,
    estimatedTokens: systemTokens + used,
    trimmedMessages,
    skillIds: skills.map(skill => skill.id),
    memoryIds: memories.map(memory => memory.id),
  };
}