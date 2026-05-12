// AI 助手共享类型定义

// ── 模型类型（在此定义，供 aiUtils.tsx 和其他文件导入，避免循环依赖）──────────────
export type ModelType = 'wenxin' | 'deepseek' | 'openai' | 'custom';

// ── 对话历史类型 ────────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  github_login: string;
  repo_full_name: string;
  branch: string;
  title: string;
  model_type: string;
  model_name?: string;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// ── 消息类型 ────────────────────────────────────────────────────────────────────

/** 内联工具调用条目（在气泡内展示） */
export interface InlineTool {
  id: string;
  tool: string;
  label: string;
  hint: string;
  status: 'running' | 'success' | 'fail';
  elapsedMs?: number;
  result?: string;
}

/** 内联任务计划步骤（在气泡内展示） */
export interface InlineStep {
  id: string;
  title: string;
  desc: string;
  status: 'pending' | 'running' | 'done' | 'error';
  retryCount?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  // ── 新增字段 ────────────────────────────────────────────────────────────────
  /** 思考过程内容 */
  thinkingContent?: string;
  /** 思考是否完成 */
  thinkingDone?: boolean;
  /** 内联任务步骤（气泡内展示，移动端可见） */
  inlinePlan?: InlineStep[];
  /** 内联工具调用列表（气泡内展示，移动端可见） */
  inlineTools?: InlineTool[];
}// ── 工具调用记录类型 ────────────────────────────────────────────────────────────

export interface ToolHistoryItem {
  id: string;
  tool: string;
  label: string;
  hint: string;
  status: 'running' | 'success' | 'fail';
  startedAt: number;
  elapsedMs?: number;
  result?: string;
}

// ── SSE Typed Chunk 类型 ───────────────────────────────────────────────────────

export interface TaskPlanStep {
  id: string;
  title: string;
  desc: string;
}

export type SSEChunk =
  | { type: 'content'; content: string }
  | { type: 'think_start' }
  | { type: 'think_chunk'; content: string }
  | { type: 'think_end' }
  | { type: 'tool_start'; id: string; tool: string; label: string; hint: string }
  | { type: 'tool_end'; id: string; status: 'success' | 'fail'; result?: string; elapsedMs: number }
  | { type: 'plan'; steps: TaskPlanStep[] }
  | { type: 'step_start'; stepId: string }
  | { type: 'step_end'; stepId: string; status: 'done' | 'error' }
  | { type: 'step_retry'; stepId: string; retryCount: number }
  | { type: 'heartbeat' };

// ── 模型配置 ────────────────────────────────────────────────────────────────────

export interface ModelConfig {
  type: ModelType;
  api_key?: string;
  endpoint?: string;
  model?: string;
  /**
   * 请求超时毫秒数（默认 300000 = 5 分钟）
   * 用户可在模型设置中调整，复杂任务建议设 5~10 分钟
   */
  timeoutMs?: number;
}