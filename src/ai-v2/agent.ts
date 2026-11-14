// AI Assistant V2 — 无固定流程的通用 Agent 循环
import type {
  AgentEvent,
  AgentHistoryMessage,
  AgentTool,
  RunAgentOptions,
  ToolRunResult,
  V2ProviderMessage,
  V2ToolCall,
  V2ToolDefinition,
} from './types';
import { streamProvider } from './providers';
import { getToolsForContext } from './tools/github';

export function buildSystemPrompt(repo?: { fullName: string; branch?: string; defaultBranch: string }): string {
  return [
    '你是 GitHubM 内置的通用 AI 助手。',
    '',
    '工作原则：',
    '1. 简单问题直接回答，不要为了展示流程而规划、验证或调用工具。',
    '2. 需要仓库事实时使用工具读取；不要编造文件内容、分支或运行结果。',
    '3. 当前任务不需要工具时，保持纯聊天即可。',
    '4. 工具失败时如实说明，并给出可行的下一步。',
    '5. 回答使用用户使用的语言，默认中文；代码使用 Markdown 代码块。',
    '6. 不要声称执行了尚未执行的操作。',
    '',
    repo
      ? [
          `当前可选仓库上下文：${repo.fullName}`,
          `当前分支：${repo.branch || repo.defaultBranch || 'main'}`,
          '你可以使用 GitHub 只读工具查看仓库信息、目录、文件和代码搜索结果。',
          '当前版本不提供写操作；如果用户要求修改文件，请明确说明需要进入写操作模式。',
        ].join('\n')
      : [
          '当前没有选择仓库。默认以通用助手身份聊天。',
          '如果用户需要仓库能力，可以提示用户在输入框上方添加仓库上下文。',
        ].join('\n'),
  ].join('\n');
}

function toToolDefinitions(tools: AgentTool[]): V2ToolDefinition[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('工具参数必须是 JSON 对象');
  }
  return parsed as Record<string, unknown>;
}

function toolErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runGeneralAgent(options: RunAgentOptions): Promise<void> {
  const {
    token,
    repo,
    config,
    history,
    signal,
    onEvent,
    callModel = streamProvider,
    maxSteps = 12,
  } = options;

  const runId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const tools = options.tools ?? getToolsForContext(repo);
  const toolMap = new Map(tools.map(tool => [tool.name, tool]));
  const toolDefs = toToolDefinitions(tools);
  const messages: V2ProviderMessage[] = [
    { role: 'system', content: buildSystemPrompt(repo) },
    ...history.map((item): V2ProviderMessage => ({
      role: item.role,
      content: item.content,
    })),
  ];

  const repeatedCalls = new Map<string, number>();
  let finalText = '';
  let steps = 0;

  onEvent({ type: 'run_start', runId });

  for (; steps < maxSteps; steps++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const result = await callModel(config, messages, toolDefs, signal, onEvent);
    if (result.usage) onEvent({ type: 'usage', usage: result.usage });

    const assistantMessage: V2ProviderMessage = {
      role: 'assistant',
      content: result.content || null,
    };
    if (result.reasoning) assistantMessage.reasoning_content = result.reasoning;
    if (result.toolCalls.length > 0) {
      assistantMessage.tool_calls = result.toolCalls.map(call => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      }));
    }
    messages.push(assistantMessage);

    if (result.toolCalls.length === 0) {
      finalText = result.content;
      onEvent({ type: 'done', text: finalText, steps: steps + 1 });
      return;
    }

    for (const call of result.toolCalls) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      onEvent({ type: 'tool_start', call });

      const signature = `${call.name}:${call.arguments}`;
      const count = (repeatedCalls.get(signature) || 0) + 1;
      repeatedCalls.set(signature, count);

      let outcome: ToolRunResult;
      if (count >= 3) {
        outcome = { ok: false, content: '检测到重复调用相同工具和参数，已停止重复执行。' };
      } else {
        const tool = toolMap.get(call.name);
        if (!tool) {
          outcome = { ok: false, content: `工具不存在：${call.name}` };
        } else {
          try {
            const args = safeParseArgs(call.arguments);
            outcome = await tool.execute(args, { token, repo, signal });
          } catch (error) {
            outcome = { ok: false, content: `工具执行失败：${toolErrorMessage(error)}` };
          }
        }
      }

      const content = outcome.content || (outcome.ok ? '（无输出）' : '（工具执行失败，未返回详情）');
      onEvent({ type: 'tool_end', call, ok: outcome.ok, content });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content,
      });
    }
  }

  onEvent({
    type: 'error',
    message: `已达到最大工具轮数（${maxSteps}），任务可能尚未完成。`,
  });
}

/** 给 UI 的轻量历史：只保留最终文本，工具轨迹不进入下一轮上下文 */
export function toAgentHistory(messages: Array<{ role: 'user' | 'assistant'; content: string }>): AgentHistoryMessage[] {
  return messages
    .filter(message => message.content.trim().length > 0)
    .slice(-20)
    .map(message => ({ role: message.role, content: message.content.slice(0, 12000) }));
}

export function collectToolDefinitions(tools: AgentTool[]): V2ToolDefinition[] {
  return toToolDefinitions(tools);
}

export function toolCallLabel(call: V2ToolCall): string {
  try {
    const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
    const path = args.path || args.query;
    return path ? `${call.name}(${String(path)})` : call.name;
  } catch {
    return call.name;
  }
}

export const __testing = { safeParseArgs, toToolDefinitions };