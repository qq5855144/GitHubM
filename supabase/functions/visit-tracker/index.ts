// 访问统计 Edge Function
// 记录页面访问日志（PV/UV）并提供统计查询接口

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── 工具函数：将 UTC Date 转换为 CST（UTC+8）日期字符串 "YYYY-MM-DD" ─────────
// Edge Function 运行在 UTC 环境，new Date().toISOString() 返回 UTC 时间。
// 中国用户在 UTC+8，需要加 8 小时后再取日期，否则凌晨前显示前一天日期。
function toCSTDateKey(date: Date): string {
  const cst = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return cst.toISOString().slice(0, 10); // "YYYY-MM-DD"（CST 日期）
}

// SHA-256 哈希（隐私保护：不存明文 IP）
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 从 User-Agent 判断设备类型
function getDeviceType(ua: string): string {
  const lower = ua.toLowerCase();
  if (/mobile|android|iphone|ipad|tablet/.test(lower)) return "mobile";
  return "desktop";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ── GET /visit-tracker?action=stats  查询统计数据（需登录）──────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "stats") {
      const days = parseInt(url.searchParams.get("days") ?? "7", 10);
      const now = new Date();
      // since 基于 CST 凌晨 00:00（UTC+8），防止凌晨期间漏掉当天数据
      const todayCSTMidnight = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      todayCSTMidnight.setUTCHours(0, 0, 0, 0); // 归零为 CST 当天 0:00:00（等价于 UTC 前一天 16:00:00）
      const since = new Date(todayCSTMidnight.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

      // 查询近 N 天所有日志
      const { data, error } = await supabase
        .from("visit_logs")
        .select("visited_at, ip_hash, page_path")
        .gte("visited_at", since.toISOString())
        .order("visited_at", { ascending: true });

      if (error) {
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 按天聚合 PV / UV
      const dateMap: Record<string, { pv: number; uvSet: Set<string> }> = {};

      // 初始化近 N 天的 key（保证连续日期即使没数据也显示）
      for (let i = 0; i < days; i++) {
        const d = new Date(since);
        d.setDate(d.getDate() + i);
        const key = toCSTDateKey(d); // CST 日期 key
        dateMap[key] = { pv: 0, uvSet: new Set() };
      }

      for (const row of data ?? []) {
        const key = toCSTDateKey(new Date(row.visited_at)); // CST 日期 key
        if (dateMap[key]) {
          dateMap[key].pv++;
          dateMap[key].uvSet.add(row.ip_hash);
        }
      }

      const trend = Object.entries(dateMap).map(([date, v]) => ({
        date,
        label: `${parseInt(date.slice(5, 7))}/${parseInt(date.slice(8, 10))}`, // "5/15"
        pv: v.pv,
        uv: v.uvSet.size,
      }));

      // 汇总指标（近 N 天范围内）
      const today = toCSTDateKey(now); // 今日 CST 日期 key
      const todayData = dateMap[today] ?? { pv: 0, uvSet: new Set() };
      const allIpHashes = new Set((data ?? []).map((r) => r.ip_hash));

      // ── 历史全量总计（不受 days 限制）──────────────────────────────────────
      // PV：全表行数
      const { count: allTimePvRaw } = await supabase
        .from("visit_logs")
        .select("*", { count: "exact", head: true });

      // UV：全量去重 ip_hash 数（通过 RPC 或聚合）
      const { data: uvData } = await supabase
        .from("visit_logs")
        .select("ip_hash");
      const allTimeUv = new Set((uvData ?? []).map((r) => r.ip_hash)).size;

      const summary = {
        todayPv:    todayData.pv,
        todayUv:    todayData.uvSet.size,
        totalPv:    (data ?? []).length,            // 近 N 天 PV
        totalUv:    allIpHashes.size,               // 近 N 天 UV
        allTimePv:  allTimePvRaw ?? 0,              // 历史总 PV
        allTimeUv,                                  // 历史总 UV
        activeDays: Object.values(dateMap).filter((v) => v.pv > 0).length,
      };

      return new Response(
        JSON.stringify({ trend, summary }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── POST /visit-tracker  记录一次访问（无需登录）────────────────────────────
  if (req.method === "POST") {
    let body: { page_path?: string; session_id?: string; referrer?: string } = {};
    try { body = await req.json(); } catch { /* 忽略解析失败 */ }

    // 获取真实客户端 IP（Supabase Edge Function 在 Fly.io 上运行）
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const ua = req.headers.get("user-agent") ?? "";

    const [ipHash] = await Promise.all([sha256(ip)]);

    const { error } = await supabase.from("visit_logs").insert({
      page_path:   body.page_path ?? "/",
      ip_hash:     ipHash,
      session_id:  body.session_id ?? "unknown",
      device_type: getDeviceType(ua),
      referrer:    body.referrer ?? null,
    });

    if (error) {
      console.error("[visit-tracker] insert error:", error.message);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ error: "method not allowed" }),
    { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
