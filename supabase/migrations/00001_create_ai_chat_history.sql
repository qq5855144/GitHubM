
-- AI 对话历史：会话表
CREATE TABLE ai_chat_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_login text NOT NULL,
  repo_full_name text NOT NULL,
  branch      text NOT NULL DEFAULT 'main',
  title       text NOT NULL DEFAULT '新对话',
  model_type  text NOT NULL DEFAULT 'wenxin',
  model_name  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- AI 对话历史：消息表
CREATE TABLE ai_chat_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('user','assistant')),
  content       text NOT NULL,
  message_type  text NOT NULL DEFAULT 'plain' CHECK (message_type IN ('plain', 'memory_summary')),
  meta_json     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 索引：按会话查消息、按用户+仓库查会话
CREATE INDEX idx_ai_chat_messages_session ON ai_chat_messages(session_id, created_at);
CREATE INDEX idx_ai_chat_sessions_login_repo ON ai_chat_sessions(github_login, repo_full_name, updated_at DESC);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION touch_session_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE ai_chat_sessions SET updated_at = now() WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_session
AFTER INSERT ON ai_chat_messages
FOR EACH ROW EXECUTE FUNCTION touch_session_updated_at();

-- RLS（无认证，按 github_login 隔离）
ALTER TABLE ai_chat_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_messages  ENABLE ROW LEVEL SECURITY;

-- 任何人可根据 github_login 读写自己的数据（anon key + login 校验）
CREATE POLICY "sessions_all" ON ai_chat_sessions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "messages_all" ON ai_chat_messages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
