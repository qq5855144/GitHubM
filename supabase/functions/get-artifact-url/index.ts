/**
 * get-artifact-url — 服务端获取 Actions Artifact 预签名下载地址
 *
 * 为什么需要 Edge Function？
 *   archive_download_url（api.github.com/repos/.../artifacts/{id}/zip）必须携带
 *   Authorization 头，GitHub 返回 302 重定向到临时预签名 URL（~1 分钟有效）。
 *   浏览器端 window.open / fetch 均无法同时满足：
 *     - window.open：浏览器导航不携带 Authorization → 401
 *     - fetch + redirect:'manual'：浏览器 CORS 限制无法读取 opaqueredirect 的 Location 头
 *     - fetch + redirect:'follow'：流式下载大文件（APK 100MB+）在客户端内存中不可靠
 *
 *   服务端没有 CORS 限制，可以：
 *     1. 用 redirect:'manual' 拿到 302 Location（预签名 URL）
 *     2. 仅返回这个轻量 URL（不传输二进制），客户端再 window.open 打开
 *
 * 请求格式：POST { owner, repo, artifact_id, token }
 * 响应格式：{ url: string }  —— 预签名 URL，直接可用 window.open 下载
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { owner, repo, artifact_id, token } = await req.json() as {
      owner: string;
      repo: string;
      artifact_id: number | string;
      token: string;
    };

    if (!owner || !repo || !artifact_id || !token) {
      return new Response(
        JSON.stringify({ error: "缺少必要参数：owner / repo / artifact_id / token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifact_id}/zip`;

    // 服务端无 CORS 限制，可以 redirect:'manual' 读取 302 Location 头
    const resp = await fetch(apiUrl, {
      method: "GET",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "GitHubManagerApp",
      },
      redirect: "manual",
    });

    // 预期：302 重定向到临时预签名 URL
    if (resp.status === 302) {
      const downloadUrl = resp.headers.get("location");
      if (!downloadUrl) {
        return new Response(
          JSON.stringify({ error: "GitHub 返回 302 但缺少 Location 头" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ url: downloadUrl }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 401 / 403 / 404 等错误
    const body = await resp.text();
    let message = body;
    try { message = (JSON.parse(body) as { message?: string }).message ?? body; } catch { /* keep raw */ }

    const hint = resp.status === 401
      ? "Token 无效或已过期，请重新设置 GitHub Token"
      : resp.status === 403
        ? "Token 缺少 actions:read 权限，或 Artifact 已过期"
        : resp.status === 404
          ? "Artifact 不存在或已过期（Actions Artifacts 默认保留 90 天）"
          : `GitHub API 返回 ${resp.status}：${message}`;

    return new Response(
      JSON.stringify({ error: hint }),
      { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `服务器错误：${(err as Error).message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
