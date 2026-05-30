-- 为 ai_chat_messages 增加 message_type 与 meta_json 列（PR #2 改动）
ALTER TABLE ai_chat_messages
  ADD COLUMN message_type text NOT NULL DEFAULT 'plain'
    CHECK (message_type IN ('plain', 'memory_summary')),
  ADD COLUMN meta_json text;

-- 补充索引：快速查询记忆摘要行
CREATE INDEX idx_ai_chat_messages_type
  ON ai_chat_messages(session_id, message_type);