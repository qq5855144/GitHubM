// LangGraph.js Agent 运行时（迁移第一阶段）
//
// 目标：把「模型 → 工具 → 模型」的显式状态机交给 LangGraph，
// 不再在 aiAgentCore 里手写 for 循环和字符串协议。
//
// 当前模块只负责编排，不绑定具体模型/GitHub 工具：
//   - model：由上层适配器调用 callLLM
//   - executeTool：由上层适配器调用 executeTool
// 这样可以先独立测试图，再逐步接入 UI。

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

export type GraphRole = 'system' | 'user' | 'assistant' | 'tool';

export interface GraphMessage {
  role: GraphRole;
  content: string;
  /** tool 消息对应的调用 id */
  toolCallId?: string;
  /** assistant 消息上的工具调用 */
  toolCall?: GraphToolCall;
}

export interface GraphToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface GraphModelResult {
  content: string;
  toolCall?: GraphToolCall | null;
}

export interface GraphEvent {
  type: 'model_start' | 'model_end' | 'tool_start' | 'tool_end' | 'final' | 'error';
  step?: number;
  tool?: string;
  content?: string;
  error?: string;
}

export type GraphModel = (
  messages: GraphMessage[],
  signal?: AbortSignal
) => Promise<GraphModelResult>;

export type GraphToolExecutor = (
  call: GraphToolCall,
  signal?: AbortSignal
) => Promise<string>;

export interface RunLangGraphOptions {
  model: GraphModel;
  executeTool: GraphToolExecutor;
  messages: GraphMessage[];
  signal?: AbortSignal;
  maxSteps?: number;
  onEvent?: (event: GraphEvent) => void;
}

const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<GraphMessage[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  pendingToolCall: Annotation<GraphToolCall | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  steps: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  finalText: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => '',
  }),
  error: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => '',
  }),
});

/**
 * 构建 LangGraph 状态图：
 *
 *   START → model ──(有 toolCall)──→ tools → model
 *              └──(无 toolCall)────→ END
 */
export function createAgentGraph(options: {
  model: GraphModel;
  executeTool: GraphToolExecutor;
  maxSteps: number;
  signal?: AbortSignal;
  onEvent?: (event: GraphEvent) => void;
}) {
  const { model, executeTool, maxSteps, signal, onEvent } = options;

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode('model', async (state) => {
      if (signal?.aborted) {
        return { error: 'aborted', finalText: '' };
      }
      if (state.steps >= maxSteps) {
        const error = `已达到最大工具调用轮次（${maxSteps} 轮）`;
        onEvent?.({ type: 'error', step: state.steps, error });
        return { error, finalText: '' };
      }

      onEvent?.({ type: 'model_start', step: state.steps });
      const result = await model(state.messages, signal);
      const toolCall = result.toolCall ?? null;
      const assistantMessage: GraphMessage = {
        role: 'assistant',
        content: result.content,
        ...(toolCall ? { toolCall } : {}),
      };
      onEvent?.({
        type: 'model_end',
        step: state.steps,
        content: result.content,
        ...(toolCall ? { tool: toolCall.name } : {}),
      });

      if (!toolCall) {
        onEvent?.({ type: 'final', step: state.steps, content: result.content });
        return {
          messages: [assistantMessage],
          pendingToolCall: null,
          finalText: result.content,
        };
      }

      return {
        messages: [assistantMessage],
        pendingToolCall: toolCall,
        finalText: '',
      };
    })
    .addNode('tools', async (state) => {
      const call = state.pendingToolCall;
      if (!call) return { pendingToolCall: null };

      onEvent?.({ type: 'tool_start', step: state.steps, tool: call.name });
      let output: string;
      try {
        output = await executeTool(call, signal);
      } catch (err) {
        output = `工具执行失败：${err instanceof Error ? err.message : String(err)}`;
      }
      onEvent?.({
        type: 'tool_end',
        step: state.steps,
        tool: call.name,
        content: output,
      });

      return {
        messages: [{
          role: 'tool' as const,
          content: output,
          toolCallId: call.id,
        }],
        pendingToolCall: null,
        steps: state.steps + 1,
      };
    })
    .addEdge(START, 'model')
    .addConditionalEdges(
      'model',
      (state) => (state.pendingToolCall ? 'tools' : END),
      { tools: 'tools', [END]: END }
    )
    .addEdge('tools', 'model');

  return graph.compile();
}

export interface LangGraphRunResult {
  messages: GraphMessage[];
  finalText: string;
  steps: number;
  error: string;
}

/** 执行一次图，返回完整状态与最终回答 */
export async function runLangGraphAgent(
  options: RunLangGraphOptions
): Promise<LangGraphRunResult> {
  const graph = createAgentGraph({
    model: options.model,
    executeTool: options.executeTool,
    maxSteps: options.maxSteps ?? 20,
    signal: options.signal,
    onEvent: options.onEvent,
  });

  const result = await graph.invoke(
    {
      messages: options.messages,
      pendingToolCall: null,
      steps: 0,
      finalText: '',
      error: '',
    },
    { recursionLimit: (options.maxSteps ?? 20) * 2 + 4 }
  );

  return {
    messages: result.messages,
    finalText: result.finalText,
    steps: result.steps,
    error: result.error,
  };
}