-- ==============================================================================
-- 监控审计日志查询 (Supabase Logs Explorer)
-- 用途：查询和分析 Edge Function (ai-assistant) 中产生的工具调用性能与拦截日志
-- ==============================================================================

SELECT 
    timestamp,
    -- 提取 JSON 中的 tool 字段
    (regexp_match(event_message, '"tool":"([^"]+)"'))[1] as tool_name,
    -- 提取 JSON 中的 status 字段 (success / fail)
    (regexp_match(event_message, '"status":"([^"]+)"'))[1] as status,
    -- 提取 JSON 中的 elapsedMs 字段
    (regexp_match(event_message, '"elapsedMs":([0-9]+)'))[1]::integer as elapsed_ms,
    -- 提取 JSON 中的 cached 字段
    (regexp_match(event_message, '"cached":([^,}]+)'))[1] as is_cached,
    -- 提取 JSON 中的 errorMsg 字段（仅拦截或失败时存在）
    (regexp_match(event_message, '"errorMsg":"([^"]+)"'))[1] as error_message,
    -- 完整的事件 JSON 日志
    event_message as raw_log
FROM 
    edge_logs
WHERE 
    -- 筛选条件：限定来源为 ai-assistant 边缘函数，且包含打点前缀
    event_message LIKE '%[METRICS_AUDIT]%'
    -- 可选：如果你只想看失败的请求
    -- AND event_message LIKE '%"status":"fail"%'
ORDER BY 
    timestamp DESC
LIMIT 100;
