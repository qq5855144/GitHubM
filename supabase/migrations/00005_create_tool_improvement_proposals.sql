
-- 工具改进提案表：AI 在执行过程中发现工具不足时提交改进建议
CREATE TABLE tool_improvement_proposals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name    text NOT NULL,           -- 工具名称（如 patch_file、read_file）
  issue        text NOT NULL,           -- 发现的问题描述
  severity     text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  context      text,                    -- 触发问题时的执行上下文（repo、任务摘要等）
  code_before  text,                    -- 有问题的代码片段（AI 填写，可为空）
  code_after   text,                    -- 建议的改进代码（AI 填写，可为空）
  explanation  text,                    -- 改进说明
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'applied', 'rejected')),
  submitted_by text,                    -- 提交者标识（AI 模型名称 + 仓库）
  applied_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 提高查询效率
CREATE INDEX idx_tip_status     ON tool_improvement_proposals (status);
CREATE INDEX idx_tip_tool_name  ON tool_improvement_proposals (tool_name);
CREATE INDEX idx_tip_created_at ON tool_improvement_proposals (created_at DESC);

-- RLS：所有人可读（用于前端展示），只有 service_role 可写（通过 Edge Function 操作）
ALTER TABLE tool_improvement_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_proposals" ON tool_improvement_proposals
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "service_write_proposals" ON tool_improvement_proposals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
