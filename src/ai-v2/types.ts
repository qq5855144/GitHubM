// AI Assistant V2 — 通用事件驱动 Agent 类型
import type { ModelConfig } from '@/components/ai/aiTypes';
import type { UiAttachment } from './attachments';
import type { TaskMemory, TaskProgress } from './taskMemory';

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

export type V2ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface V2ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | V2ContentPart[] | null;
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
  target?: WritePreview;
}

export interface WritePreview {
  repository: string;
  branch?: string;
  baseBranch?: string;
  fileSha?: string | null;
  headSha?: string;
  baseSha?: string;
  createsBranch?: boolean;
  pullTitle?: string;
  changes?: Array<{ path: string; diff: string }>;
  verification?: WriteVerification;
}

export type WriteVerification =
  | { kind: 'files'; repository: string; branch: string; files: Array<{ path: string; sha: string }> }
  | { kind: 'branch'; repository: string; branch: string; sha: string }
  | { kind: 'pull'; repository: string; head: string; base: string; title: string; sha: string }
  | { kind: 'merge'; repository: string; number: number; sha: string };

export interface PendingWrite {
  id: string;
  callId: string;
  tool: string;
  verification?: WriteVerification;
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
  approvedWrite?: WritePreview;
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
  content: string | V2ContentPart[];
}

export interface AgentCheckpoint {
  finished?: boolean;
  taskMemory?: TaskMemory;
  messages: V2ProviderMessage[];
  steps: number;
  toolCalls?: number;
  writeInFlight?: boolean;
  pendingWrite?: PendingWrite;
  completedWrites?: string[];
}

export interface RunAgentOptions {
  taskMemory?: TaskMemory;
  token: string;
  userLogin?: string;
  runId?: string;
  repo?: RepoContext;
  config: ModelConfig;
  history: AgentHistoryMessage[];
  contextBudget?: number;
  memoryEnabled?: boolean;
  /** 当前用户消息（可包含图片） */
  currentUserContent?: V2ProviderMessage['content'];
  currentUserText?: string;
  /** 当前角色卡的人格设定 */
  persona?: string;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  /** 写操作前的用户确认；未提供时写工具默认拒绝 */
  requestApproval?: (request: ApprovalRequest, signal: AbortSignal) => Promise<boolean>;
  /** 每个工具阶段后的状态快照，用于中断恢复 */
  onSnapshot?: (snapshot: AgentCheckpoint) => void | Promise<unknown>;
  /** 恢复被中断的运行 */
  resumeMessages?: V2ProviderMessage[];
  resumeSteps?: number;
  resumeToolCalls?: number;
  completedWrites?: string[];
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

/** 助手消息内记录的思考、正文和工具调用区块 */
export interface UiAssistantBlock {
  id: string;
  type: 'text' | 'reasoning' | 'tool';
  text?: string;
  toolId?: string;
}

export interface UiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 包含附件正文的模型上下文；UI 仍显示 content */
  modelContent?: string | V2ContentPart[];
  attachments?: UiAttachment[];
  taskScope?: string;
  taskProgress?: TaskProgress;
  reasoning?: string;
  tools?: UiToolRun[];
  /** 按发生顺序排列的区块；为空时退回旧版布局 */
  blocks?: UiAssistantBlock[];
  streaming?: boolean;
  error?: boolean;
  errorDetail?: string;
  metrics?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    durationMs?: number;
    firstTokenMs?: number;
    model?: string;
  };
  createdAt: string;
}
