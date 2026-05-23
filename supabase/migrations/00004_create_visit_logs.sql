
-- 访问日志表
CREATE TABLE visit_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  page_path     text        NOT NULL,
  ip_hash       text        NOT NULL,   -- SHA-256(IP)，用于 UV 统计
  session_id    text        NOT NULL,   -- 会话标识，同一会话去重 PV
  device_type   text,                   -- mobile / desktop
  referrer      text,
  visited_at    timestamptz NOT NULL DEFAULT now()
);

-- 近 7 天查询用索引
CREATE INDEX idx_visit_logs_visited_at ON visit_logs (visited_at DESC);
CREATE INDEX idx_visit_logs_ip_hash    ON visit_logs (ip_hash);

-- 开启 Realtime 发布
ALTER PUBLICATION supabase_realtime ADD TABLE visit_logs;

-- RLS：开启但允许匿名写入（无需登录即可记录访问）
ALTER TABLE visit_logs ENABLE ROW LEVEL SECURITY;

-- 任何人（含匿名）都可以插入日志
CREATE POLICY "anyone can insert visit log"
  ON visit_logs FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- 只有已登录用户可以读取统计数据（管理员查看）
CREATE POLICY "authenticated can read visit logs"
  ON visit_logs FOR SELECT
  TO authenticated
  USING (true);
