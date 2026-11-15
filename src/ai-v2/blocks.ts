// AI V2 — 助手消息区块：按发生顺序保存 思考 / 正文 / 工具
import type { UiAssistantBlock, UiChatMessage } from './types';

let sequence = 0;

function nextBlockId(type: string): string {
  sequence += 1;
  return `blk_${type}_${Date.now().toString(36)}_${sequence}`;
}

/** 追加流式片段：连续同类型合并成一个区块，遇到工具调用自动断开 */
export function appendBlockDelta(
  blocks: UiAssistantBlock[] | undefined,
  type: 'text' | 'reasoning',
  text: string,
): UiAssistantBlock[] {
  if (!text) return blocks || [];
  const list = blocks ? blocks.slice() : [];
  const last = list[list.length - 1];
  if (last && last.type === type) {
    list[list.length - 1] = { ...last, text: `${last.text || ''}${text}` };
  } else {
    list.push({ id: nextBlockId(type), type, text });
  }
  return list;
}

export function appendToolBlock(
  blocks: UiAssistantBlock[],
  toolId: string,
): UiAssistantBlock[] {
  return [...blocks, { id: nextBlockId('tool'), type: 'tool', toolId }];
}

/** 旧消息没有区块时，按 思考 → 正文 → 工具 还原一份初始结构 */
export function ensureBlocks(message: UiChatMessage): UiAssistantBlock[] {
  if (message.blocks) return message.blocks;
  const list: UiAssistantBlock[] = [];
  if (message.reasoning) list.push({ id: nextBlockId('reasoning'), type: 'reasoning', text: message.reasoning });
  if (message.content) list.push({ id: nextBlockId('text'), type: 'text', text: message.content });
  for (const tool of message.tools || []) {
    list.push({ id: nextBlockId('tool'), type: 'tool', toolId: tool.id });
  }
  return list;
}

export type AssistantRenderGroup =
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'execution'; id: string; toolIds: string[] };

/**
 * 把有序区块合并成展示分组：
 * 连续的工具调用合并成一个执行组，其余按原顺序保留。
 */
export function buildRenderGroups(blocks: UiAssistantBlock[]): AssistantRenderGroup[] {
  const groups: AssistantRenderGroup[] = [];
  for (const block of blocks) {
    if (block.type === 'tool') {
      if (!block.toolId) continue;
      const last = groups[groups.length - 1];
      if (last && last.kind === 'execution') {
        last.toolIds.push(block.toolId);
      } else {
        groups.push({ kind: 'execution', id: block.id, toolIds: [block.toolId] });
      }
      continue;
    }
    if (!block.text) continue;
    groups.push({ kind: block.type === 'reasoning' ? 'reasoning' : 'text', id: block.id, text: block.text });
  }
  return groups;
}