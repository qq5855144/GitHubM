// AI 助手共享类型定义

// ── 模型类型（在此定义，供 aiUtils.tsx 和其他文件导入，避免循环依赖）──────────────
export type ModelType = 'wenxin' | 'deepseek' | 'gemini' | 'qwen' | 'openai' | 'custom';

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

/** 内联工具调用条目（在气泡内展示，兼容旧代码） */
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

/** 用户上传的附件（图片或文本文件） */
export interface Attachment {
  id: string;
  name: string;
  /** 'image' = 图片（base64 预览）| 'text' = 代码/文本文件 | 'binary' = 其他二进制 */
  type: 'image' | 'text' | 'binary';
  mimeType: string;
  /** 图片：base64 data URL；文本文件：原始文本内容；binary：base64 */
  content: string;
  size: number;
}

/** AI 发出的文件上传请求 */
export interface FileRequest {
  id: string;
  filename: string;
  description: string;
  mime_types?: string;
  /** 用户已完成上传，卡片变为已处理状态 */
  fulfilled?: boolean;
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
  /** 用户消息携带的附件 */
  attachments?: Attachment[];
  /** AI 发出的文件上传请求列表 */
  fileRequests?: FileRequest[];
  /**
   * 气泡类型：
   *  - 'step'     = 每个任务步骤标题气泡（精简标题行）
   *  - 'answer'   = 最终回答气泡（含 Markdown 正文）
   *  - 'thinking' = AI 思考过程气泡（可折叠）
   *  - 'tool'     = 单个工具调用气泡（含结果）
   *  - undefined  = 普通消息（无 plan 时保持单气泡行为）
   */
  bubbleType?: 'step' | 'answer' | 'thinking' | 'tool';
  /** 步骤标题，bubbleType==='step' 时展示 */
  stepTitle?: string;
  /** 关联的步骤 ID */
  stepId?: string;
  /** 工具调用 ID（bubbleType==='tool' 时使用，用于 tool_end 更新） */
  toolCallId?: string;
  /** 工具名称（bubbleType==='tool'） */
  toolName?: string;
  /** 工具标签（bubbleType==='tool'） */
  toolLabel?: string;
  /** 工具提示（bubbleType==='tool'） */
  toolHint?: string;
  /** 工具调用状态（bubbleType==='tool'） */
  toolStatus?: 'running' | 'success' | 'fail';
  /** 工具耗时 ms（bubbleType==='tool'） */
  toolElapsedMs?: number;
  /** 工具返回结果摘要（bubbleType==='tool'，可折叠） */
  toolResult?: string;
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
  | { type: 'heartbeat' }
  | { type: 'status_info'; message: string }
  | { type: 'status_warning'; message: string }
  | { type: 'file_request'; id: string; filename: string; description: string; mime_types?: string }
  | { type: 'timeout'; workflow_id?: string }
  | { type: 'usage'; prompt_tokens: number; completion_tokens: number; total_tokens: number; model: string; providerType: string };

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