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
    });
    expect(result.finalText).toBe('已处理工具错误');
  });

  it('plan 节点生成计划并写 checkpoint', async () => {
    const events: GraphEvent[] = [];
    const checkpoints: number[] = [];
    const result = await runLangGraphAgent({
      messages: [{ role: 'user', content: '实现登录' }],
      planner: async () => [
        { id: '1', title: '读取代码', status: 'pending' },
        { id: '2', title: '修改代码', status: 'pending' },
      ],
      model: async () => ({ content: '计划完成' }),
      executeTool: async () => 'ok',
      onCheckpoint: s => { checkpoints.push(s.plan.length); },
      onEvent: e => events.push(e),
    });
    expect(result.plan).toHaveLength(2);
    expect(events.map(e => e.type)).toContain('plan');
    expect(events.map(e => e.type)).toContain('checkpoint');
    expect(checkpoints).toContain(2);
  });

  it('写工具后触发 verify 节点', async () => {
    const events: GraphEvent[] = [];
    let turn = 0;
    const result = await runLangGraphAgent({
      messages: [{ role: 'user', content: '修改 README' }],
      model: async () => {
        turn++;
        if (turn === 1) {
          return {
            content: '',
            toolCall: { id: 'w1', name: 'patch_file', arguments: { path: 'README.md' } },
          };
        }
        return { content: '修改完成' };
      },
      executeTool: async () => ({ output: 'patched', risk: 'write' as const }),
      verifier: async () => ({ passed: true, summary: 'CI passed' }),
      onEvent: e => events.push(e),
    });
    expect(events.map(e => e.type)).toContain('verify_start');
    expect(events.map(e => e.type)).toContain('verify_end');
    expect(result.verification?.passed).toBe(true);
    expect(result.finalText).toBe('修改完成');
  });

  it('交付检查未通过时继续执行，直到可交付', async () => {
    const events: GraphEvent[] = [];
    let turn = 0;
    let checks = 0;
    const result = await runLangGraphAgent({
      messages: [{ role: 'user', content: '修好构建并确认可交付' }],
      model: async () => {
        turn++;
        if (turn === 1) {
          return {
            content: '',
            toolCall: { id: 'c1', name: 'run_build', arguments: {} },
          };
        }
        if (turn === 2) return { content: '已修复，应该可以了' };
        return { content: '构建已通过，可以交付' };
      },
      executeTool: async () => 'build passed',
      assessDeliverable: async () => {
        checks++;
        return checks === 1
          ? { deliverable: false, missing: '还没有实际验证构建结果' }
          : { deliverable: true };
      },
      onEvent: e => events.push(e),
    });

    expect(turn).toBe(3);
    expect(checks).toBe(2);
    expect(result.finalText).toBe('构建已通过，可以交付');
    expect(result.error).toBe('');
    expect(events.map(e => e.type)).toContain('deliverable_start');
    expect(events.map(e => e.type)).toContain('deliverable_end');
    expect(events.map(e => e.type)).toContain('final');
  });
});