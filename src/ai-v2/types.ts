// AI Assistant V2 — 通用事件驱动 Agent 类型
import type { ModelConfig } from '@/components/ai/aiTypes';
import type { UiAttachment } from './attachments';

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
  artifact?: ArtifactMeta;
}

export interface ArtifactMeta {
  id: string;
  title: string;
  mime: string;
  size: number;
  createdAt: string;
  runId?: string;
  toolName?: string;
  preview: string;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  description: string;
  arguments: Record<string, unknown>;
  risk: AgentTool['risk'];
}

export interface CapabilityInfo {
  id: string;
  label: string;
  description: string;
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
  userLogin?: string;
  repo?: RepoContext;
  signal?: AbortSignal;
}

export type AgentEvent =
  | { type: 'run_start'; runId: string; capabilities?: string[]; skills?: string[]; memories?: string[] }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_start'; call: V2ToolCall }
  | { type: 'tool_end'; call: V2ToolCall; ok: boolean; content: string; artifact?: ArtifactMeta }
  | { type: 'usage'; usage: NonNullable<ProviderStreamResult['usage']> }
  | { type: 'done'; text: string; steps: number }
  | { type: 'error'; message: string };

export interface AgentHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RunAgentOptions {
  token: string;
  userLogin?: string;
  runId?: string;
  repo?: RepoContext;
  config: ModelConfig;
  history: AgentHistoryMessage[];
  contextBudget?: number;
  memoryEnabled?: boolean;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  /** 写操作前的用户确认；未提供时写工具默认拒绝 */
  requestApproval?: (request: ApprovalRequest) => Promise<boolean>;
  /** 每个工具阶段后的状态快照，用于中断恢复 */
  onSnapshot?: (snapshot: { messages: V2ProviderMessage[]; steps: number }) => void;
  /** 恢复被中断的运行 */
  resumeMessages?: V2ProviderMessage[];
  resumeSteps?: number;
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
}

export interface UiToolRun {
  id: string;
  name: string;
  arguments: string;
  status: 'running' | 'done' | 'error';
  content?: string;
  artifact?: ArtifactMeta;
  startedAt?: number;
  endedAt?: number;
}

export interface UiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 包含附件正文的模型上下文；UI 仍显示 content */
  modelContent?: string;
  attachments?: UiAttachment[];
  reasoning?: string;
  tools?: UiToolRun[];
  streaming?: boolean;
  error?: boolean;
  createdAt: string;
}