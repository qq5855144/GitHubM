import { describe, expect, it } from 'vitest';
import { appendBlockDelta, appendToolBlock, buildRenderGroups, ensureBlocks } from '@/ai-v2/blocks';
import type { UiChatMessage } from '@/ai-v2/types';

describe('assistant blocks', () => {
  it('merges consecutive deltas of the same type', () => {
    let blocks = appendBlockDelta(undefined, 'text', '你');
    blocks = appendBlockDelta(blocks, 'text', '好');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].text).toBe('你好');
  });

  it('splits text around a tool call', () => {
    let blocks = appendBlockDelta(undefined, 'text', '我先看下文件');
    blocks = appendToolBlock(blocks, 'call_1');
    blocks = appendBlockDelta(blocks, 'text', '文件没问题');
    expect(blocks.map(block => block.type)).toEqual(['text', 'tool', 'text']);
    expect(blocks[1].toolId).toBe('call_1');
  });

  it('keeps reasoning before the answer', () => {
    let blocks = appendBlockDelta(undefined, 'reasoning', '思考中');
    blocks = appendBlockDelta(blocks, 'text', '结论');
    expect(blocks.map(block => block.type)).toEqual(['reasoning', 'text']);
    expect(blocks[0].text).toBe('思考中');
  });

  it('restores blocks for legacy messages', () => {
    const legacy = {
      id: 'a1',
      role: 'assistant',
      content: '正文',
      reasoning: '推理',
      tools: [{ id: 't1', name: 'read', arguments: '{}', status: 'done' }],
      createdAt: '2026-01-01T00:00:00.000Z',
    } as UiChatMessage;
    const blocks = ensureBlocks(legacy);
    expect(blocks.map(block => block.type)).toEqual(['reasoning', 'text', 'tool']);
    expect(blocks[2].toolId).toBe('t1');
  });

  it('returns existing blocks untouched', () => {
    const blocks = appendBlockDelta(undefined, 'text', '原始');
    const message = { id: 'a2', role: 'assistant', content: '原始', blocks, createdAt: '' } as UiChatMessage;
    expect(ensureBlocks(message)).toBe(blocks);
  });

  it('groups consecutive tool calls into one execution group', () => {
    let blocks: ReturnType<typeof appendBlockDelta> = [{ id: 't1', type: 'text', text: '先看下' }];
    blocks = appendToolBlock(blocks, 'call_1');
    blocks = appendToolBlock(blocks, 'call_2');
    blocks = appendBlockDelta(blocks, 'text', '结论');
    blocks = appendToolBlock(blocks, 'call_3');

    const groups = buildRenderGroups(blocks);
    expect(groups.map(group => group.kind)).toEqual(['text', 'execution', 'text', 'execution']);
    const execution = groups[1];
    expect(execution.kind === 'execution' && execution.toolIds).toEqual(['call_1', 'call_2']);
  });

  it('keeps reasoning separate from the answer', () => {
    let blocks: ReturnType<typeof appendBlockDelta> = [{ id: 'r1', type: 'reasoning', text: '想一想' }];
    blocks = appendBlockDelta(blocks, 'text', '回答');
    expect(buildRenderGroups(blocks).map(group => group.kind)).toEqual(['reasoning', 'text']);
  });

  it('skips empty groups', () => {
    expect(buildRenderGroups([])).toEqual([]);
    expect(buildRenderGroups([{ id: 'x', type: 'text', text: '' }])).toEqual([]);
  });
});