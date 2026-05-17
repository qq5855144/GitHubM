// AI 助手 Supabase 数据层工具函数
import { supabase } from '@/db/supabase';
import type { ChatSession, ChatSessionMessage, ToolHistoryItem } from './aiTypes';
import type { Message } from './aiTypes';

// ── 会话操作 ────────────────────────────────────────────────────────────────────

/** 新建或更新会话标题 */
export async function upsertSession(
  session: Omit<ChatSession, 'created_at' | 'updated_at'>
): Promise<string | null> {
  const { data, error } = await supabase
    .from('ai_chat_sessions')
    .upsert({ ...session }, { onConflict: 'id' })
    .select('id')
    .maybeSingle();
  if (error) { console.error('保存会话失败', error); return null; }
  return data?.id ?? null;
}

/** 批量插入对话消息 */
export async function insertMessages(
  sessionId: string,
  msgs: Array<{ role: string; content: string }>
): Promise<void> {
  const rows = msgs.map(m => ({ session_id: sessionId, role: m.role, content: m.content }));
  const { error } = await supabase.from('ai_chat_messages').insert(rows);
  if (error) console.error('保存消息失败', error);
}

/** 获取指定用户的会话列表（按仓库分组，最多 50 条） */
export async function fetchSessions(login: string): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from('ai_chat_sessions')
    .select('*')
    .eq('github_login', login)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

/** 获取会话下所有消息（按时间升序） */
export async function fetchSessionMessages(sessionId: string): Promise<ChatSessionMessage[]> {
  const { data, error } = await supabase
    .from('ai_chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

/** 删除会话（级联删除消息由 DB 外键处理） */
export async function deleteSession(sessionId: string): Promise<void> {
  await supabase.from('ai_chat_sessions').delete().eq('id', sessionId);
}

// ── 工具执行日志持久化 ─────────────────────────────────────────────────────────

/** 批量插入本轮工具调用日志 */
export async function insertToolExecutionLogs(
  sessionId: string,
  turnId: string,
  items: ToolHistoryItem[],
  userId?: string | null,
): Promise<void> {
  if (items.length === 0) return;
  const rows = items.map(t => ({
    session_id: sessionId,
    turn_id: turnId,
    tool_name: t.tool,
    label: t.label ?? null,
    hint: t.hint ?? null,
    status: t.status === 'fail' ? 'error' : t.status === 'running' ? 'running' : 'success',
    elapsed_ms: t.elapsedMs ?? null,
    result_json: t.result ? t.result.slice(0, 4000) : null,
    started_at: new Date(t.startedAt).toISOString(),
    user_id: userId ?? null,
  }));
  const { error } = await supabase.from('tool_execution_logs').insert(rows);
  if (error) console.error('[aiSupabase] 工具日志保存失败', error);
}

/** 查询指定 session 的工具执行日志（按 turn + 时间升序） */
export async function fetchToolExecutionLogs(
  sessionId: string,
): Promise<Array<{
  id: string; session_id: string; turn_id: string; tool_name: string;
  label: string | null; hint: string | null; status: string;
  elapsed_ms: number | null; result_json: string | null; started_at: string;
}>> {
  const { data, error } = await supabase
    .from('tool_execution_logs')
    .select('id, session_id, turn_id, tool_name, label, hint, status, elapsed_ms, result_json, started_at')
    .eq('session_id', sessionId)
    .order('started_at', { ascending: true })
    .limit(500);
  if (error) { console.error('[aiSupabase] 工具日志查询失败', error); return []; }
  return Array.isArray(data) ? data : [];
}

// ── workflow 快照 ──────────────────────────────────────────────────────────────

/** Upsert 本轮 workflow 快照（messages + toolHistory） */
export async function upsertWorkflowSnapshot(
  sessionId: string,
  turnId: string,
  messages: Message[],
  toolHistory: ToolHistoryItem[],
  userId?: string | null,
): Promise<void> {
  const { error } = await supabase.from('workflow_snapshots').upsert(
    {
      session_id: sessionId,
      turn_id: turnId,
      messages_json: JSON.stringify(messages),
      tool_history_json: JSON.stringify(toolHistory),
      user_id: userId ?? null,
    },
    { onConflict: 'session_id,turn_id' },
  );
  if (error) console.error('[aiSupabase] workflow 快照保存失败', error);
}

/** 获取指定 session 最新的 workflow 快照 */
export async function fetchLatestSnapshot(
  sessionId: string,
): Promise<{ messages: Message[]; toolHistory: ToolHistoryItem[] } | null> {
  const { data, error } = await supabase
    .from('workflow_snapshots')
    .select('messages_json, tool_history_json')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return {
      messages: JSON.parse(data.messages_json) as Message[],
      toolHistory: JSON.parse(data.tool_history_json) as ToolHistoryItem[],
    };
  } catch {
    return null;
  }
}

// ── AI 模型列表获取 ─────────────────────────────────────────────────────────────

/** 通过 Edge Function 获取指定平台的可用模型列表 */
export async function fetchModelsFromAPI(
  type: string,
  apiKey: string,
  endpoint: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${supabaseUrl}/functions/v1/list-ai-models`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({ type, api_key: apiKey, endpoint }),
  });
  const data = await res.json() as { error?: string; models?: Array<{ id: string; name: string }> };
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data.models || [];
}
