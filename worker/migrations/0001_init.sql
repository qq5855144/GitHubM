-- GitHubM 全网访问统计
-- 统一口径：只记录访问量，不再区分 PV / UV。

CREATE TABLE IF NOT EXISTS daily_stats (
  day TEXT PRIMARY KEY,
  visits INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS last_hits (
  user_id_hash TEXT PRIMARY KEY,
  last_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_last_hits_last_at ON last_hits(last_at);