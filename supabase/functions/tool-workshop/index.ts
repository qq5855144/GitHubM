// 工具改进工坊 Edge Function
// 管理 AI 自主上报的工具问题提案：列表查询、审核、拒绝、应用补丁
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function makeSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return createClient(url, key);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 400) {
  return json({ error: msg }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const sb = makeSupabase();
  if (!sb) return err("Supabase 未配置", 500);

  const url = new URL(req.url);
  // action 从 query param 或 body 获取
  let action = url.searchParams.get("action") ?? "";
  let body: Record<string, unknown> = {};

  if (req.method === "POST") {
    try { body = await req.json(); } catch { /* ignore */ }
    if (!action) action = String(body.action ?? "");
  }

  // ── GET /tool-workshop?action=list ──────────────────────────────────────
  if (action === "list") {
    const status   = url.searchParams.get("status") ?? "pending";
    const toolName = url.searchParams.get("tool_name") ?? "";
    const limit    = parseInt(url.searchParams.get("limit") ?? "50", 10);

    let query = sb
      .from("tool_improvement_proposals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status !== "all") query = query.eq("status", status);
    if (toolName) query = query.eq("tool_name", toolName);

    const { data, error } = await query;
    if (error) return err(error.message, 500);
    return json({ proposals: data ?? [] });
  }

  // ── GET /tool-workshop?action=stats ─────────────────────────────────────
  if (action === "stats") {
    const { data, error } = await sb
      .from("tool_improvement_proposals")
      .select("status, severity");
    if (error) return err(error.message, 500);

    const rows = (data ?? []) as Array<{ status: string; severity: string }>;
    const stats = {
      total:    rows.length,
      pending:  rows.filter(r => r.status === "pending").length,
      approved: rows.filter(r => r.status === "approved").length,
      applied:  rows.filter(r => r.status === "applied").length,
      rejected: rows.filter(r => r.status === "rejected").length,
      high:     rows.filter(r => r.severity === "high").length,
      medium:   rows.filter(r => r.severity === "medium").length,
      low:      rows.filter(r => r.severity === "low").length,
    };
    return json({ stats });
  }

  // ── POST /tool-workshop  { action: "approve", id } ──────────────────────
  if (action === "approve") {
    const id = String(body.id ?? "");
    if (!id) return err("缺少 id");

    const { error } = await sb
      .from("tool_improvement_proposals")
      .update({ status: "approved" })
      .eq("id", id)
      .eq("status", "pending");          // 只允许从 pending → approved

    if (error) return err(error.message, 500);
    return json({ success: true, message: "提案已审核通过" });
  }

  // ── POST /tool-workshop  { action: "reject", id, reason? } ──────────────
  if (action === "reject") {
    const id = String(body.id ?? "");
    if (!id) return err("缺少 id");

    const { error } = await sb
      .from("tool_improvement_proposals")
      .update({ status: "rejected" })
      .eq("id", id);

    if (error) return err(error.message, 500);
    return json({ success: true, message: "提案已拒绝" });
  }

  // ── POST /tool-workshop  { action: "apply", id } ────────────────────────
  // 将提案标记为 applied，并返回 code patch 供平台或开发者手动部署
  if (action === "apply") {
    const id = String(body.id ?? "");
    if (!id) return err("缺少 id");

    // 获取提案详情
    const { data: proposal, error: fetchErr } = await sb
      .from("tool_improvement_proposals")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (fetchErr) return err(fetchErr.message, 500);
    if (!proposal) return err("提案不存在", 404);
    if (proposal.status === "applied") return err("提案已应用，无需重复操作");
    if (proposal.status === "rejected") return err("提案已拒绝，无法应用");

    // 若提案有 code_before / code_after，验证格式
    const codeBefore = String(proposal.code_before ?? "").trim();
    const codeAfter  = String(proposal.code_after  ?? "").trim();
    const hasCode    = codeBefore.length > 0 && codeAfter.length > 0;

    // 标记为 applied
    const { error: updateErr } = await sb
      .from("tool_improvement_proposals")
      .update({ status: "applied", applied_at: new Date().toISOString() })
      .eq("id", id);

    if (updateErr) return err(updateErr.message, 500);

    return json({
      success: true,
      message: "提案已标记为应用，请将以下代码变更合并到 ai-assistant Edge Function 并重新部署。",
      proposal: {
        id:          proposal.id,
        tool_name:   proposal.tool_name,
        explanation: proposal.explanation ?? proposal.issue,
        has_code:    hasCode,
        code_before: hasCode ? codeBefore : null,
        code_after:  hasCode ? codeAfter  : null,
      },
    });
  }

  // ── POST /tool-workshop  { action: "submit", ...fields } ────────────────
  // 前端手动提交改进建议（补充 AI 上报）
  if (action === "submit") {
    const toolName   = String(body.tool_name   ?? "").trim();
    const issue      = String(body.issue       ?? "").trim();
    const severity   = String(body.severity    ?? "medium");
    const codeBefore = String(body.code_before ?? "").trim();
    const codeAfter  = String(body.code_after  ?? "").trim();
    const explanation = String(body.explanation ?? "").trim();

    if (!toolName || !issue) return err("tool_name 和 issue 为必填项");
    if (!["low", "medium", "high"].includes(severity)) return err("severity 必须是 low/medium/high");

    const { data, error } = await sb
      .from("tool_improvement_proposals")
      .insert({
        tool_name: toolName,
        issue,
        severity,
        explanation: explanation || null,
        code_before: codeBefore || null,
        code_after:  codeAfter  || null,
        submitted_by: "manual",
        status: "pending",
      })
      .select("id")
      .maybeSingle();

    if (error) return err(error.message, 500);
    return json({ success: true, id: data?.id });
  }

  return err(`未知 action: ${action}`);
});
