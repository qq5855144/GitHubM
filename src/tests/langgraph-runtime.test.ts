import { describe, expect, it } from 'vitest';
import {
  runLangGraphAgent,
  type GraphEvent,
  type GraphMessage,
  type GraphToolCall,
} from '@/lib/agent/langgraph/runtime';

describe('LangGraph agent runtime', () => {
  it('执行 model → tool → model 并输出最终回答', async () => {
    const events: GraphEvent[] = [];
    let modelTurn = 0;
    const calls: GraphToolCall[] = [];

    const result = await runLangGraphAgent({
      messages: [{ role: 'user', content: '读取 README' }],
      model: async (messages: GraphMessage[]) => {
        modelTurn++;
        if (modelTurn === 1) {
          expect(messages.some(m => m.role === 'user')).toBe(true);
          return {
            content: '',
            toolCall: {
              id: 'call_1',
              name: 'read_file',
              arguments: { path: 'README.md' },
            },
          };
        }
        // 第二轮必须看到 tool 结果
        expect(messages.some(m => m.role === 'tool' && m.content.includes('hello'))).toBe(true);
        return { content: 'README 内容已读取' };
      },
      executeTool: async (call) => {
        calls.push(call);
        return 'hello from README';
      },
      onEvent: e => events.push(e),
      maxSteps: 5,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('read_file');
    expect(result.finalText).toBe('README 内容已读取');
    expect(result.error).toBe('');
    expect(result.messages.map(m => m.role)).toEqual([
      'user', 'assistant', 'tool', 'assistant',
    ]);
    const types = events.map(e => e.type);
    expect(types).toContain('model_start');
    expect(types).toContain('tool_start');
    expect(types).toContain('tool_end');
    expect(types).toContain('final');
  });

  it('工具抛错时把错误作为 tool 结果继续给模型', async () => {
    let turn = 0;
    const result = await runLangGraphAgent({
      messages: [{ role: 'user', content: '读取不存在文件' }],
      model: async (messages) => {
        turn++;
        if (turn === 1) {
          return {
            content: '',
            toolCall: { id: 'c1', name: 'read_file', arguments: { path: 'x' } },
          };
        }
        expect(messages.some(m => m.role === 'tool' && m.content.includes('boom'))).toBe(true);
        return { content: '已处理工具错误' };
      },
      executeTool: async () => { throw new Error('boom'); },
      maxSteps: 5,
    });
    expect(result.finalText).toBe('已处理工具错误');
  });

  it('达到最大工具轮次后停止', async () => {
    const result = await runLangGraphAgent({
      messages: [{ role: 'user', content: '无限调用' }],
      model: async () => ({
        content: '',
        toolCall: { id: `c-${Date.now()}`, name: 'read_file', arguments: {} },
      }),
      executeTool: async () => 'ok',
      maxSteps: 2,
    });
    expect(result.steps).toBe(2);
    expect(result.error).toContain('最大工具调用轮次');
    expect(result.finalText).toBe('');
  });
});