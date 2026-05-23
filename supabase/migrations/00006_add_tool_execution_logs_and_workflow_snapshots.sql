
-- ── tool_execution_logs：记录每次工具调用 ──────────────────────────────────────
CREATE TABLE tool_execution_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   text NOT NULL,
  turn_id      text NOT NULL,
  tool_name    text NOT NULL,
  label        text,
  hint         text,
  status       text NOT NULL CHECK (status IN ('success', 'error', 'running')),
  elapsed_ms   integer,
  result_json  text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_tel_session_turn ON tool_execution_logs(session_id, turn_id, started_at);

ALTER TABLE tool_execution_logs ENABLE ROW LEVEL SECURITY;

-- 插入：已登录用户插入自己的记录；匿名用户（user_id IS NULL）也可插入
CREATE POLICY "tel_insert" ON tool_execution_logs
  FOR INSERT WITH CHECK (
    user_id IS NULL OR user_id = auth.uid()
  );

-- 查询：已登录用户只能查自己的；匿名用户查 user_id IS NULL 的
CREATE POLICY "tel_select" ON tool_execution_logs
  FOR SELECT USING (
    user_id = auth.uid() OR (auth.uid() IS NULL AND user_id IS NULL)
  );

-- 删除：只能删自己的
CREATE POLICY "tel_delete" ON tool_execution_logs
  FOR DELETE USING (user_id = auth.uid());


-- ── workflow_snapshots：每轮对话的快照，支持断点恢复 ──────────────────────────
CREATE TABLE workflow_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       text NOT NULL,
  turn_id          text NOT NULL,
  messages_json    text NOT NULL,
  tool_history_json text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_ws_session_created ON workflow_snapshots(session_id, created_at DESC);
CREATE UNIQUE INDEX idx_ws_session_turn ON workflow_snapshots(session_id, turn_id);

ALTER TABLE workflow_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ws_insert" ON workflow_snapshots
  FOR INSERT WITH CHECK (
    user_id IS NULL OR user_id = auth.uid()
  );

CREATE POLICY "ws_upsert" ON workflow_snapshots
  FOR UPDATE USING (
    user_id = auth.uid() OR (auth.uid() IS NULL AND user_id IS NULL)
  );

CREATE POLICY "ws_select" ON workflow_snapshots
  FOR SELECT USING (
    user_id = auth.uid() OR (auth.uid() IS NULL AND user_id IS NULL)
  );

CREATE POLICY "ws_delete" ON workflow_snapshots
  FOR DELETE USING (user_id = auth.uid());
