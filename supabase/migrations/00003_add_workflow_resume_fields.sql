
-- task_workflows 增加断点恢复所需字段
ALTER TABLE task_workflows
  ADD COLUMN messages_snapshot  jsonb,            -- LLM 完整对话历史快照（用于断点恢复）
  ADD COLUMN last_step_id       text,             -- 最后执行到的步骤 ID
  ADD COLUMN interrupted        boolean NOT NULL DEFAULT false;  -- 是否因中断/批次耗尽而暂停

-- 快速查询未完成的可恢复工作流
CREATE INDEX idx_task_workflows_interrupted
  ON task_workflows(user_id, interrupted)
  WHERE interrupted = true;
