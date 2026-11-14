// AI Assistant V2 — 通用事件驱动 Agent 类型
import type { ModelConfig } from '@/components/ai/aiTypes';

export interface RepoContext {
  fullName: string;
  defaultBranch: string;
  branch?: string;
}

export interface V2ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface V2ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface V2ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
}

export interface ProviderStreamResult {
  content: string;
  reasoning: string;
  toolCalls: V2ToolCall[];
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface ToolRunResult {
  ok: boolean;
  content: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  risk: 'read' | 'write' | 'dangerous';
  execute: (args: Record<string, unknown>, ctx: ToolRuntimeContext) => Promise<ToolRunResult>;
}

export interface ToolRuntimeContext {
  token: string;
  repo?: RepoContext;
  signal?: AbortSignal;
}

export type AgentEvent =
  | { type: 'run_start'; runId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_start'; call: V2ToolCall }
  | { type: 'tool_end'; call: V2ToolCall; ok: boolean; content: string }
  | { type: 'usage'; usage: NonNullable<ProviderStreamResult['usage']> }
  | { type: 'done'; text: string; steps: number }
  | { type: 'error'; message: string };

export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RunAgentOptions {
  token: string;
  repo?: RepoContext;
  config: ModelConfig;
  history: AgentHistoryMessage[];
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  /** 测试注入：默认使用真实 provider */
  callModel?: (
    config: ModelConfig,
    messages: V2ProviderMessage[],
    tools: V2ToolDefinition[],
    signal: AbortSignal,
    onEvent: (event: AgentEvent) => void,
  ) => Promise<ProviderStreamResult>;
  /** 测试注入：覆盖默认工具集合 */
  tools?: AgentTool[];
  maxSteps?: number;
}

export interface UiToolRun {
  id: string;
  name: string;
  arguments: string;
  status: 'running' | 'done' | 'error';
  content?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface UiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  tools?: UiToolRun[];
  streaming?: boolean;
  error?: boolean;
  createdAt: string;
}