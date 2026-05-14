
-- 任务工作流主表
CREATE TABLE task_workflows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,                           -- GitHub login
  repo          text NOT NULL,                           -- owner/repo
  task_summary  text NOT NULL,                           -- 用户发出的问题（截断至 200 字）
  status        text NOT NULL DEFAULT 'running'          -- running | done | partial_fail
    CHECK (status IN ('running','done','partial_fail')),
  total_steps   int  NOT NULL DEFAULT 0,
  done_steps    int  NOT NULL DEFAULT 0,
  fail_steps    int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

-- 工作流步骤表
CREATE TABLE task_workflow_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   uuid NOT NULL REFERENCES task_workflows(id) ON DELETE CASCADE,
  step_id       text NOT NULL,                           -- AI 输出的步骤 id（"1","2"…）
  seq           int  NOT NULL,                           -- 在计划中的顺序（0-based）
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','error')),
  retry_count   int  NOT NULL DEFAULT 0,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 索引：按用户 + 时间查询历史
CREATE INDEX idx_task_workflows_user     ON task_workflows(user_id, created_at DESC);
CREATE INDEX idx_task_workflow_steps_wf  ON task_workflow_steps(workflow_id, seq ASC);

-- 不启用 RLS（无鉴权，前端直接持 service key 的 Edge Function 写入）
-- 由 Edge Function 以 service role 操作，anon 只读
ALTER TABLE task_workflows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_workflow_steps  ENABLE ROW LEVEL SECURITY;

-- 允许任何人读（前端查历史）
CREATE POLICY "allow_select_workflows"
  ON task_workflows FOR SELECT
  USING (true);

CREATE POLICY "allow_select_steps"
  ON task_workflow_steps FOR SELECT
  USING (true);

-- 允许任何人删除自己的工作流（前端 delete 操作，按 user_id 过滤）
CREATE POLICY "allow_delete_workflows"
  ON task_workflows FOR DELETE
  USING (true);
