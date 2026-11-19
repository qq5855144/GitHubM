import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARACTER_ID,
  deleteCustomCharacter,
  loadActiveCharacter,
  loadCharacters,
  saveActiveCharacterId,
  saveCustomCharacter,
} from '@/ai-v2/characters';
import { buildSystemPrompt } from '@/ai-v2/agent';

describe('AI character cards', () => {
  beforeEach(() => localStorage.clear());

  it('uses the built-in engineer card by default', () => {
    const active = loadActiveCharacter('alice');
    expect(active.id).toBe(DEFAULT_CHARACTER_ID);
    expect(active.prompt).toContain('资深软件工程师');
    expect(active.prompt).toContain('根因优先');
    expect(loadCharacters('alice')).toHaveLength(1);
  });

  it('creates, edits, selects and deletes a custom character', () => {
    const created = saveCustomCharacter('alice', {
      name: '审查员',
      description: '严格审查',
      prompt: '只关注正确性和回归风险。',
    });
    expect(created).not.toBeNull();
    expect(loadCharacters('alice')).toHaveLength(2);

    saveActiveCharacterId('alice', created!.id);
    expect(loadActiveCharacter('alice').name).toBe('审查员');

    const edited = saveCustomCharacter('alice', {
      id: created!.id,
      name: '高级审查员',
      description: '更严格',
      prompt: '检查边界条件和异常路径。',
    });
    expect(edited?.name).toBe('高级审查员');
    expect(loadActiveCharacter('alice').prompt).toContain('异常路径');

    deleteCustomCharacter('alice', created!.id);
    expect(loadCharacters('alice')).toHaveLength(1);
    expect(loadActiveCharacter('alice').id).toBe(DEFAULT_CHARACTER_ID);
  });

  it('injects persona into the system prompt', () => {
    const prompt = buildSystemPrompt(undefined, '你是一个严格审查代码的工程师。');
    expect(prompt).toContain('# 角色设定');
    expect(prompt).toContain('严格审查代码');
    expect(prompt).toContain('工作原则');
    expect(prompt).toContain('不可信数据');
  });
});