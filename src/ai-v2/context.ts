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
  // 中文/代码混合的粗略估算：3 个字符约 1 token
  return Math.ceil(text.length / 3);
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