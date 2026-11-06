// LangGraph.js Agent 运行时
//
// 迁移目标：把「计划 → 模型 → 工具 → 验证 → checkpoint」交给 LangGraph，
// 不再在 aiAgentCore 里手写 for 循环和字符串协议。
//
// 模型与工具通过 adapter 注入，当前模块不直接依赖 aiAgentCore。

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

export type GraphToolRisk = 'read' | 'write' | 'dangerous';

export interface GraphToolResult {
  output: string;
  risk?: GraphToolRisk;
  changedFiles?: string[];
}

export interface GraphPlanStep {
  id: string;
  title: string;
  desc?: string;
  status?: 'pending' | 'running' | 'done' | 'error';
}

export interface GraphVerificationResult {
  passed: boolean;
  summary: string;
}

export interface GraphModelResult {
  content: string;
  toolCall?: GraphToolCall | null;
}

export interface GraphEvent {
  type:
    | 'plan'
    | 'model_start'
    | 'model_end'
    | 'tool_start'
    | 'tool_end'
    | 'checkpoint'
    | 'verify_start'
    | 'verify_end'
    | 'final'
    | 'error';
  step?: number;
  tool?: string;
  toolCallId?: string;
  content?: string;
  error?: string;
  plan?: GraphPlanStep[];
  verification?: GraphVerificationResult;
}

export type GraphModel = (
  messages: GraphMessage[],
  signal?: AbortSignal
) => Promise<GraphModelResult>;

export type GraphToolExecutor = (
  call: GraphToolCall,
  signal?: AbortSignal
) => Promise<string | GraphToolResult>;

/** 可选的计划器；不传则跳过 plan 节点 */
export type GraphPlanner = (
  messages: GraphMessage[],
  signal?: AbortSignal
) => Promise<GraphPlanStep[]>;

/** 可选的验证器；写操作后调用 */
export type GraphVerifier = (
  messages: GraphMessage[],
  signal?: AbortSignal
) => Promise<GraphVerificationResult>;

export interface RunLangGraphOptions {
  model: GraphModel;
  executeTool: GraphToolExecutor;
  messages: GraphMessage[];
  signal?: AbortSignal;
  maxSteps?: number;
  maxVerifyAttempts?: number;
  /** START → plan → model */
  planner?: GraphPlanner;
  /** 写操作后的验证节点 */
  verifier?: GraphVerifier;
  /** 工具风险分类；默认按工具名推断 */
  classifyTool?: (name: string) => GraphToolRisk;
  /** 每次工具执行 / 验证后调用，用于持久化 checkpoint */
  onCheckpoint?: (snapshot: {
    messages: GraphMessage[];
    plan: GraphPlanStep[];
    steps: number;
    finalText: string;
    verification?: GraphVerificationResult;
  }) => void | Promise<void>;
  onEvent?: (event: GraphEvent) => void;
}

const WRITE_TOOL_RE = /(write|patch|delete|create|update|merge|trigger|set_|search_and_replace|push_files)/i;

function defaultClassifyTool(name: string): GraphToolRisk {
  if (/delete|merge|close|release|trigger|set_actions/i.test(name)) return 'dangerous';
  if (WRITE_TOOL_RE.test(name)) return 'write';
  return 'read';
}

const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<GraphMessage[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  plan: Annotation<GraphPlanStep[]>({
    reducer: (_current, update) => update,
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
  verificationAttempts: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  needsVerification: Annotation<boolean>({
    reducer: (_current, update) => update,
    default: () => false,
  }),
  verification: Annotation<GraphVerificationResult | undefined>({
    reducer: (_current, update) => update,
    default: () => undefined,
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
 * 状态图：
 *
 *   START → plan → model ──(toolCall)──→ tools → checkpoint → model
 *                    ├──(需要验证)──────→ verify → model
 *                    └──(完成)──────────→ END
 */
export function createAgentGraph(options: {
  model: GraphModel;
  executeTool: GraphToolExecutor;
  maxSteps: number;
  maxVerifyAttempts: number;
  planner?: GraphPlanner;
  verifier?: GraphVerifier;
  classifyTool: (name: string) => GraphToolRisk;
  onCheckpoint?: RunLangGraphOptions['onCheckpoint'];
  signal?: AbortSignal;
  onEvent?: (event: GraphEvent) => void;
}) {
  const {
    model,
    executeTool,
    maxSteps,
    maxVerifyAttempts,
    planner,
    verifier,
    classifyTool,
    onCheckpoint,
    signal,
    onEvent,
  } = options;

  const callCheckpoint = async (state: {
    messages: GraphMessage[];
    plan: GraphPlanStep[];
    steps: number;
    finalText: string;
    verification?: GraphVerificationResult;
  }) => {
    await onCheckpoint?.(state);
    onEvent?.({ type: 'checkpoint', step: state.steps });
  };

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode('planning', async (state) => {
      if (!planner) return { plan: [] };
      const plan = await planner(state.messages, signal);
      onEvent?.({ type: 'plan', plan });
      await callCheckpoint({
        messages: state.messages,
        plan,
        steps: state.steps,
        finalText: state.finalText,
        verification: state.verification,
      });
      return { plan };
    })
    .addNode('model', async (state) => {
      if (signal?.aborted) return { error: 'aborted', finalText: '' };
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

      const risk = classifyTool(call.name);
      onEvent?.({ type: 'tool_start', step: state.steps, tool: call.name, toolCallId: call.id });
      let output: string;
      try {
        const result = await executeTool(call, signal);
        output = typeof result === 'string' ? result : result.output;
      } catch (err) {
        output = `工具执行失败：${err instanceof Error ? err.message : String(err)}`;
      }
      onEvent?.({
        type: 'tool_end',
        step: state.steps,
        tool: call.name,
        toolCallId: call.id,
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
        needsVerification: state.needsVerification || risk !== 'read',
      };
    })
    .addNode('checkpoint', async (state) => {
      await callCheckpoint(state);
      return {};
    })
    .addNode('verify', async (state) => {
      if (!verifier) return {};
      onEvent?.({ type: 'verify_start', step: state.steps });
      let result: GraphVerificationResult;
      try {
        result = await verifier(state.messages, signal);
      } catch (err) {
        result = {
          passed: false,
          summary: `验证器异常：${err instanceof Error ? err.message : String(err)}`,
        };
      }
      onEvent?.({ type: 'verify_end', step: state.steps, verification: result });
      await callCheckpoint({
        messages: state.messages,
        plan: state.plan,
        steps: state.steps,
        finalText: state.finalText,
        verification: result,
      });

      if (result.passed) {
        return { verification: result, needsVerification: false };
      }
      return {
        messages: [{
          role: 'user' as const,
          content: `[CI 验证失败]\n${result.summary}\n请根据失败信息修复，然后再次验证。`,
        }],
        verification: result,
        verificationAttempts: state.verificationAttempts + 1,
      };
    })
    .addEdge(START, 'planning')
    .addEdge('planning', 'model')
    .addConditionalEdges(
      'model',
      (state) => {
        if (state.pendingToolCall) return 'tools';
        if (
          state.needsVerification &&
          verifier &&
          !state.verification?.passed &&
          state.verificationAttempts < maxVerifyAttempts
        ) {
          return 'verify';
        }
        return END;
      },
      { tools: 'tools', verify: 'verify', [END]: END }
    )
    .addEdge('tools', 'checkpoint')
    .addEdge('checkpoint', 'model')
    .addEdge('verify', 'model');

  return graph.compile();
}

export interface LangGraphRunResult {
  messages: GraphMessage[];
  plan: GraphPlanStep[];
  finalText: string;
  steps: number;
  verification?: GraphVerificationResult;
  error: string;
}

/** 执行一次图，返回完整状态与最终回答 */
export async function runLangGraphAgent(
  options: RunLangGraphOptions
): Promise<LangGraphRunResult> {
  const maxSteps = options.maxSteps ?? 20;
  const graph = createAgentGraph({
    model: options.model,
    executeTool: options.executeTool,
    maxSteps,
    maxVerifyAttempts: options.maxVerifyAttempts ?? 2,
    planner: options.planner,
    verifier: options.verifier,
    classifyTool: options.classifyTool ?? defaultClassifyTool,
    onCheckpoint: options.onCheckpoint,
    signal: options.signal,
    onEvent: options.onEvent,
  });

  const result = await graph.invoke(
    {
      messages: options.messages,
      plan: [],
      pendingToolCall: null,
      steps: 0,
      verificationAttempts: 0,
      needsVerification: false,
      verification: undefined,
      finalText: '',
      error: '',
    },
    { recursionLimit: maxSteps * 3 + (options.verifier ? 8 : 0) + 8 }
  );

  return {
    messages: result.messages,
    plan: result.plan,
    finalText: result.finalText,
    steps: result.steps,
    verification: result.verification,
    error: result.error,
  };
}