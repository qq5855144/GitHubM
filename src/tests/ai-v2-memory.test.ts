import { beforeEach, describe, expect, it } from 'vitest';
import { compactSnapshotMessages } from '@/ai-v2/runStore';
import {
  deleteSessionMessages,
  loadSessionIndex,
  loadSessionMessages,
  saveSessionIndex,
  saveSessionMessages,
} from '@/ai-v2/sessionStore';
import type { V2ProviderMessage } from '@/ai-v2/types';
import { MEMORY_TOOLS } from '@/ai-v2/tools/memory';

describe('AI memory budget', () => {
  it('requires approval for memory writes', () => {
    const saveTool = MEMORY_TOOLS.find(tool => tool.name === 'memory_save');
    expect(saveTool?.risk).toBe('write');
  });
  describe('snapshot compaction', () => {
    const buildMessages = (rounds: number): V2ProviderMessage[] => {
      const messages: V2ProviderMessage[] = [{ role: 'system', content: 'sys' }];
      for (let index = 0; index < rounds; index += 1) {
        messages.push({ role: 'user', content: `问题 ${index}` });
        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: [{ id: `call_${index}`, type: 'function', function: { name: 'tool', arguments: '{}' } }],
        });
        messages.push({ role: 'tool', tool_call_id: `call_${index}`, content: 'x'.repeat(5000) });
        messages.push({ role: 'assistant', content: `回答 ${index}` });
      }
      return messages;
    };

    it('keeps only the newest tool rounds and truncates tool results', () => {
      const compact = compactSnapshotMessages(buildMessages(15));
      const assistantCalls = compact.filter(message => message.tool_calls?.length);
      expect(assistantCalls.length).toBeLessThanOrEqual(10);

      const keptIds = new Set(assistantCalls.flatMap(message => (message.tool_calls || []).map(call => call.id)));
      const toolMessages = compact.filter(message => message.role === 'tool');
      expect(toolMessages.length).toBe(keptIds.size);
      for (const message of toolMessages) {
        expect(keptIds.has(message.tool_call_id || '')).toBe(true);
        expect(String(message.content).length).toBe(1500);
      }
    });

    it('retains images and clamps long text', () => {
      const compact = compactSnapshotMessages([
        { role: 'system', content: 'sys' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'y'.repeat(9000) },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
          ],
        },
      ]);
      const content = compact[1].content;
      expect(Array.isArray(content)).toBe(true);
      const parts = content as Array<{ type: string; text?: string }>;
      expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
      expect(parts[0].text?.length).toBe(4000);
    });

    it('does not start with an orphan tool response', () => {
      const compact = compactSnapshotMessages(buildMessages(20));
      expect(compact.length).toBeGreaterThan(0);
      expect(compact[0].role).not.toBe('tool');
    });
  });

  describe('session store split', () => {
    beforeEach(() => localStorage.clear());

    it('keeps the index free of message bodies', async () => {
      await saveSessionIndex('alice', {
        activeId: 's1',
        sessions: [{
          id: 's1',
          title: '测试',
          repo: null,
          titleSource: 'auto',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      });
      await saveSessionMessages('alice', 's1', [
        { id: 'm1', role: 'user', content: '你好', createdAt: '2026-01-01T00:00:00.000Z' },
      ]);

      const index = await loadSessionIndex('alice');
      expect(index?.activeId).toBe('s1');
      expect(index?.sessions[0]).not.toHaveProperty('messages');

      const messages = await loadSessionMessages('alice', 's1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('你好');
    });

    it('drops message shards on delete', async () => {
      await saveSessionMessages('alice', 's2', [
        { id: 'm2', role: 'user', content: '待删除', createdAt: '2026-01-01T00:00:00.000Z' },
      ]);
      await deleteSessionMessages('alice', 's2');
      expect(await loadSessionMessages('alice', 's2')).toEqual([]);
    });
  });
});