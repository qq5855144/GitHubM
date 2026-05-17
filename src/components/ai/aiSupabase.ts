// AI 助手 Supabase 数据层工具函数
import { supabase } from '@/db/supabase';
import type { ChatSession, ChatSessionMessage } from './aiTypes';

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
