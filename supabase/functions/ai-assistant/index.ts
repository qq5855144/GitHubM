// AI 助手 Edge Function v3
// 支持多模型：文心 ERNIE / DeepSeek / OpenAI / 自定义兼容接口
// ReAct Agent：AI 通过工具链读取/写入 GitHub 仓库文件
// 新增：任务计划持久化到 Supabase + 步骤失败自动重试

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── 模型配置 ────────────────────────────────────────────────────────────────

interface ModelConfig {
  /** wenxin | deepseek | openai | custom */
  type: string;
  /** 用户自带 API Key（DeepSeek/OpenAI/Custom） */
  api_key?: string;
  /** 自定义接口地址（custom 时必填） */
  endpoint?: string;
  /** 具体模型名称，如 deepseek-chat / gpt-4o */
  model?: string;
}

// 根据模型配置构建 LLM 请求参数
function buildLLMRequest(cfg: ModelConfig, platformKey: string): {
  url: string;
  headers: Record<string, string>;
  bodyExtra: Record<string, unknown>;
} {
  switch (cfg.type) {
    case "deepseek":
      return {
        url: "https://api.deepseek.com/v1/chat/completions",
        headers: { Authorization: `Bearer ${cfg.api_key}` },
        // max_tokens: 8192 防止 DeepSeek 在任务中途截断输出
        bodyExtra: { model: cfg.model || "deepseek-chat", stream: true, max_tokens: 8192 },
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { Authorization: `Bearer ${cfg.api_key}` },
        // max_tokens: 16384 给 GPT 系列充足输出空间
        bodyExtra: { model: cfg.model || "gpt-4o-mini", stream: true, max_tokens: 16384 },
      };
    case "custom":
      return {
        url: cfg.endpoint!,
        headers: cfg.api_key ? { Authorization: `Bearer ${cfg.api_key}` } : {},
        // 自定义接口同样设大 max_tokens，避免中途截断
        bodyExtra: cfg.model
          ? { model: cfg.model, stream: true, max_tokens: 8192 }
          : { stream: true, max_tokens: 8192 },
      };
    default: // wenxin（platform managed）
      return {
        url: "https://app-bgc5z86utjwh-api-zYkZz8qovQ1L-gateway.appmiaoda.com/v2/chat/completions",
        headers: { "X-Gateway-Authorization": `Bearer ${platformKey}` },
        // 文心：enable_thinking=false + 不限制输出长度
        bodyExtra: { enable_thinking: false, max_tokens: 8192 },
      };
  }
}

// ── GitHub API 工具 ──────────────────────────────────────────────────────────

interface GithubContext {
  token: string;
  owner: string;
  repo: string;
}

async function githubRequest(ctx: GithubContext, apiPath: string, options: RequestInit = {}) {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new GithubApiError(res.status, body, apiPath);
  }
  // 204 No Content 时不解析 JSON
  if (res.status === 204) return {};
  return res.json();
}

/** 结构化 GitHub API 错误，携带 HTTP 状态码和原始响应体 */
class GithubApiError extends Error {
  status: number;
  body: string;
  apiPath: string;
  constructor(status: number, body: string, apiPath: string) {
    super(`GitHub API ${status}: ${body}`);
    this.status = status;
    this.body = body;
    this.apiPath = apiPath;
  }
}

/**
 * 通用 4xx 错误诊断：根据状态码 + 响应体返回中文诊断建议。
 * 供所有工具函数 catch 块调用，提升 AI 的自愈能力。
 */
function diagnose4xx(err: unknown, context?: string): string {
  if (!(err instanceof GithubApiError)) {
    return `操作失败：${(err as Error).message}`;
  }
  const { status, body, apiPath } = err;
  let bodyMsg = body;
  try { bodyMsg = JSON.parse(body)?.message ?? body; } catch (_) { /* keep raw */ }

  const ctx2 = context ? `【${context}】` : "";

  switch (status) {
    case 401:
      return `${ctx2} ❌ 401 认证失败：Token 已过期或无效。\n建议：请在设置页重新填写有效的 GitHub Personal Access Token（PAT）。`;
    case 403:
      if (bodyMsg.includes("workflow")) {
        return `${ctx2} ❌ 403 权限不足：Token 缺少 \`workflow\` 权限，无法操作 Actions 工作流。\n建议：在 GitHub → Settings → Tokens 中为该 PAT 勾选 \`workflow\` scope 后重试。`;
      }
      if (bodyMsg.includes("push") || bodyMsg.includes("branch")) {
        return `${ctx2} ❌ 403 分支受保护：目标分支已启用分支保护规则，禁止直接推送。\n建议：create_branch 创建新分支 → 在新分支上修改 → create_pr 发起 PR → 由有权限的人 merge_pull_request。`;
      }
      if (bodyMsg.includes("rate limit") || bodyMsg.includes("secondary rate")) {
        return `${ctx2} ❌ 403 触发速率限制：API 请求过于频繁。\n建议：等待 1-2 分钟后重试；或检查 Token 权限，确保用正确 Token 而非未授权访问。`;
      }
      return `${ctx2} ❌ 403 操作被拒绝：${bodyMsg}\n建议：检查 Token 的 scope 是否包含对应权限（repo、workflow、admin:org 等）。`;
    case 404:
      if (apiPath.includes("/contents/")) {
        const filePath = apiPath.split("/contents/")[1]?.split("?")[0] ?? "目标文件";
        return `${ctx2} ❌ 404 文件不存在：\`${filePath}\` 在仓库中未找到。\n建议：用 file_tree 或 list_files 确认正确路径后重试；若要新建，改用 write_file。`;
      }
      if (apiPath.includes("/branches/")) {
        return `${ctx2} ❌ 404 分支不存在：请用 list_branches 确认分支名称拼写，或先用 create_branch 创建该分支。`;
      }
      if (apiPath.includes("/pulls/") || apiPath.includes("/issues/")) {
        const num = apiPath.match(/\/(pulls|issues)\/(\d+)/)?.[2];
        return `${ctx2} ❌ 404 PR/Issue #${num ?? "?"} 不存在：请用 list_pull_requests 或 list_issues 确认编号后重试。`;
      }
      if (apiPath.includes("/actions/workflows/")) {
        const wf = apiPath.match(/\/workflows\/([^/]+)\//)?.[1];
        return `${ctx2} ❌ 404 工作流 \`${wf ?? "?"}\` 不存在：请用 list_workflows 获取正确的 workflow_id 后重试。`;
      }
      return `${ctx2} ❌ 404 资源不存在：\`${apiPath}\`\n建议：确认仓库名、路径、编号是否正确，必要时先 list_* 查询。`;
    case 409:
      if (bodyMsg.includes("merge conflict") || bodyMsg.includes("conflict")) {
        return `${ctx2} ❌ 409 合并冲突：PR 存在合并冲突，无法自动 merge。\n建议：在本地或通过 patch_file 手动解决冲突后重新提交，再尝试合并。`;
      }
      if (bodyMsg.includes("already exists")) {
        return `${ctx2} ❌ 409 已存在：目标资源（分支/文件/标签）已存在，无法重复创建。\n建议：用 list_branches 或 list_files 确认，若确实需要覆盖，先删除再创建。`;
      }
      return `${ctx2} ❌ 409 冲突：${bodyMsg}\n建议：检查资源状态，解决冲突后重试。`;
    case 422: {
      // 解析 GitHub 422 的结构化 errors 数组（仅靠顶层 message 字段信息不足）
      // GitHub 常见格式：{ "message": "Validation Failed", "errors": [{ "message": "No commits between X and Y" }] }
      let errorsDetail = "";
      try {
        const parsed = JSON.parse(body);
        const errors = parsed?.errors as Array<Record<string, string>> | undefined;
        if (Array.isArray(errors) && errors.length) {
          errorsDetail = errors.map(e =>
            e.message ? e.message : `field=${e.field ?? "?"} code=${e.code ?? "?"}`
          ).join("；");
        }
      } catch (_) { /* ignore */ }

      // "No commits between" 可能出现在顶层 message 或 errors[].message 中，两处都要检查
      const combinedText = `${bodyMsg} ${errorsDetail}`.toLowerCase();
      if (combinedText.includes("no commits between") || combinedText.includes("no commits")) {
        // head 与 base 分支内容完全一致，GitHub 拒绝创建空 PR
        const searchIn = errorsDetail.toLowerCase().includes("no commits") ? errorsDetail : bodyMsg;
        const branches = searchIn.match(/between\s+(\S+)\s+and\s+(\S+)/i);
        const bFrom = branches?.[1] ?? "head 分支";
        const bTo   = branches?.[2] ?? "base 分支";
        return `${ctx2} ❌ 422 无法创建 PR：分支 \`${bFrom}\` 与 \`${bTo}\` 内容完全相同，没有差异提交。\n原因：恢复分支是基于 base 创建的，尚未写入任何新提交，两分支 HEAD 指向同一 commit。\n解决：先用 write_file / patch_file 写入要恢复的内容并提交，再调用 create_pr。`;
      }
      if (combinedText.includes("already exists") || combinedText.includes("pull request already")) {
        // 该两分支间已存在 open PR，无需重复创建
        return `${ctx2} ❌ 422 PR 已存在：这两个分支之间已有一个 open 状态的 PR。\n建议：用 list_pull_requests 查看已有 PR，直接对现有 PR 操作（merge_pull_request 或关闭后重建）。`;
      }
      if (bodyMsg.includes("workflow_dispatch")) {
        return `${ctx2} ❌ 422 工作流缺少 workflow_dispatch 触发器（将自动修复）。`;
      }
      if (bodyMsg.includes("protected branch")) {
        return `${ctx2} ❌ 422 分支保护规则阻止操作：目标分支设有保护规则（需要 PR review / status check 通过）。\n建议：走 create_pr → merge_pull_request 流程，确保 CI 通过并获得 review 后再合并。`;
      }
      if (errorsDetail) {
        // 字段级校验失败（head 分支不存在、title 为空等），errorsDetail 含具体原因
        return `${ctx2} ❌ 422 参数校验失败：${errorsDetail}\n建议：① title 不能为空；② head/base 填写已存在的分支名（不加 owner: 前缀）；③ 用 list_branches 确认分支名称后重试。`;
      }
      if (bodyMsg.includes("Validation Failed")) {
        return `${ctx2} ❌ 422 参数校验失败（无详细字段信息）\n建议：① title 不能为空；② head/base 填分支名（不加 owner: 前缀，如 restore/main 而非 user:restore/main）；③ 确保 head 分支已存在（list_branches 确认）；④ head 与 base 分支必须有差异提交。`;
      }
      return `${ctx2} ❌ 422 无法处理的请求：${bodyMsg}${errorsDetail ? `\n详情：${errorsDetail}` : ""}\n建议：检查参数是否符合 GitHub API 要求，或先查询资源状态再重试。`;
    }
    case 410:
      return `${ctx2} ❌ 410 资源已被删除：该 Issue/PR/分支已永久删除，无法再操作。`;
    case 451:
      return `${ctx2} ❌ 451 访问受限（法律原因）：该仓库或内容在当前地区受到访问限制。`;
    default:
      return `${ctx2} ❌ GitHub API ${status} 错误：${bodyMsg}\n原始路径：\`${apiPath}\``;
  }
}

async function listFiles(ctx: GithubContext, path: string): Promise<string> {
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${path}`);
    if (Array.isArray(data)) {
      const items = data.map((f: { name: string; type: string; size: number }) =>
        `${f.type === "dir" ? "📁" : "📄"} ${f.name}${f.type === "file" ? ` (${f.size}B)` : ""}`
      );
      return `目录 "${path || "/"}" 内容：\n${items.join("\n")}`;
    }
    return JSON.stringify(data);
  } catch (e) { return diagnose4xx(e, "list_files"); }
}

/**
 * 递归列出文件树（深度可控），适合快速了解项目结构。
 * @param maxDepth 最大递归深度（默认3）
 * @param ignorePatterns 跳过的目录名（默认跳过 node_modules/.git/dist/build/.next）
 */
async function getFileTree(
  ctx: GithubContext,
  path: string,
  maxDepth = 3,
  currentDepth = 0,
  ignorePatterns = ["node_modules", ".git", "dist", "build", ".next", ".turbo", "__pycache__", ".cache"],
): Promise<string> {
  if (currentDepth >= maxDepth) return "";
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${path}`);
    if (!Array.isArray(data)) return "";
    const indent = "  ".repeat(currentDepth);
    const lines: string[] = [];
    for (const item of data as Array<{ name: string; type: string; size: number }>) {
      if (item.type === "dir") {
        if (ignorePatterns.includes(item.name)) {
          lines.push(`${indent}📁 ${item.name}/ (已跳过)`);
          continue;
        }
        lines.push(`${indent}📁 ${item.name}/`);
        const sub = await getFileTree(ctx, path ? `${path}/${item.name}` : item.name, maxDepth, currentDepth + 1, ignorePatterns);
        if (sub) lines.push(sub);
      } else {
        lines.push(`${indent}📄 ${item.name} (${item.size}B)`);
      }
    }
    return lines.join("\n");
  } catch { return ""; }
}

async function fileTree(ctx: GithubContext, path: string, maxDepth: number): Promise<string> {
  try {
    const depth = Math.min(maxDepth || 3, 5); // 最大深度不超过 5，防止超时
    const tree = await getFileTree(ctx, path || "", depth);
    return `仓库文件树（${path || "/"}, 深度${depth}）：\n${tree || "（空目录）"}`;
  } catch (e) { return diagnose4xx(e, "file_tree"); }
}

/**
 * 在文件中搜索文本（逐行 grep），返回匹配行的行号+内容。
 * 适用于 GitHub Search API 速率受限时的替代方案。
 */
/** base64 + UTF-8 解码（正确处理中文/日文/emoji 等多字节字符） */
function decodeBase64Utf8(b64: string): string {
  const binaryStr = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * 通用文件内容获取辅助函数。
 * 自动处理大文件（>1MB）：先通过 Contents API 拿到 SHA，再走 Git Blobs API 取完整内容。
 * 返回 { content, sha, size, totalLines } 或错误字符串。
 */
async function fetchFileContent(
  ctx: GithubContext,
  filePath: string,
): Promise<{ content: string; sha: string; size: number; totalLines: number } | string> {
  const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
  if (Array.isArray(data)) return `"${filePath}" 是目录，请用 file_tree 列出其内容。`;
  if (!data.sha) return `无法读取文件 "${filePath}"：缺少 blob SHA。`;

  let rawContent: string;
  const isLarge = !data.content || data.content.trim() === "" || (data.size && data.size > 1_000_000);

  if (isLarge) {
    // 大文件：Git Blobs API
    const blob = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/blobs/${data.sha}`);
    if (!blob.content) {
      const sizeLabel = data.size ? Math.round(data.size / 1024) + "KB" : "未知大小";
      return `无法读取大文件 "${filePath}"（${sizeLabel}），GitHub API 返回空内容。`;
    }
    rawContent = decodeBase64Utf8(blob.content);
  } else {
    if (data.encoding !== "base64") return `无法解码文件 "${filePath}"（编码：${data.encoding}）`;
    rawContent = decodeBase64Utf8(data.content);
  }

  return {
    content: rawContent,
    sha: data.sha as string,
    size: (data.size as number) ?? 0,
    totalLines: rawContent.split("\n").length,
  };
}

/**
 * 文件内搜索（grep）。
 * 支持大文件（>1MB）自动切换 Blobs API；
 * 每页最多返回 100 条匹配，超出时附带继续搜索的指引（offset 参数）。
 * @param offset 跳过前 N 条匹配（用于翻页，默认 0）
 */
async function grepInFile(
  ctx: GithubContext,
  filePath: string,
  pattern: string,
  caseSensitive = false,
  offset = 0,
): Promise<string> {
  try {
    const result = await fetchFileContent(ctx, filePath);
    if (typeof result === "string") return result;

    const { content, totalLines } = result;
    const lines = content.split("\n");

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
    } catch {
      // 用户输入非法正则时退回字面量匹配
      regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
    }

    const allMatches: string[] = [];
    lines.forEach((line, i) => {
      if (regex.test(line)) {
        allMatches.push(`${String(i + 1).padStart(6, " ")} | ${line}`);
      }
      regex.lastIndex = 0;
    });

    if (!allMatches.length) {
      return `"${filePath}" 中未找到匹配 "${pattern}" 的行（共搜索 ${totalLines} 行）`;
    }

    const PAGE = 100;
    const safeOffset = Math.max(0, Math.min(offset, allMatches.length - 1));
    const page = allMatches.slice(safeOffset, safeOffset + PAGE);
    const remaining = allMatches.length - safeOffset - page.length;

    const header = `"${filePath}" 匹配 "${pattern}" 共 ${allMatches.length} 处` +
      (safeOffset > 0 ? `，显示第 ${safeOffset + 1}–${safeOffset + page.length} 条` : `，显示第 1–${page.length} 条`) +
      `（文件共 ${totalLines} 行）：`;

    const truncHint = remaining > 0
      ? `\n\n⚠️ 还有 ${remaining} 条未显示。继续查看请调用：` +
        `{"tool":"grep_in_file","path":"${filePath}","pattern":"${pattern}","offset":"${safeOffset + PAGE}"}`
      : "";

    return `${header}\n\`\`\`\n${page.join("\n")}\n\`\`\`` + truncHint;
  } catch (e) { return diagnose4xx(e, "grep_in_file"); }
}

/**
 * 批量读取多个文件（逗号分隔路径），一次工具调用读取多个文件，减少 round trip。
 * 每个文件最多返回前 300 行；自动支持大文件（>1MB）Blobs API 切换。
 */
async function batchReadFiles(ctx: GithubContext, paths: string): Promise<string> {
  const fileList = paths.split(",").map(p => p.trim()).filter(Boolean).slice(0, 5);
  if (!fileList.length) return "请提供至少一个文件路径";
  const PREVIEW_LINES = 300;
  const results: string[] = [];
  for (const fp of fileList) {
    try {
      const fetched = await fetchFileContent(ctx, fp);
      if (typeof fetched === "string") {
        results.push(`\n=== ${fp} ===\n${fetched}`);
        continue;
      }
      const { content, sha, size, totalLines } = fetched;
      const lines = content.split("\n");
      const preview = lines.slice(0, PREVIEW_LINES);
      const sizeKB = Math.round(size / 1024);
      const numbered = preview.map((l, i) => `${String(i + 1).padStart(6, " ")} | ${l}`).join("\n");
      const truncHint = totalLines > PREVIEW_LINES
        ? `\n⚠️ 文件共 ${totalLines} 行，仅展示前 ${PREVIEW_LINES} 行。` +
          `完整读取请用：{"tool":"read_file","path":"${fp}","start_line":"1","end_line":"${PREVIEW_LINES}"}`
        : "";
      const sizeNote = sizeKB > 100 ? ` | ${sizeKB}KB` : "";
      results.push(
        `\n=== ${fp}（${totalLines} 行${sizeNote}）SHA: ${sha} ===\n\`\`\`\n${numbered}\n\`\`\`` + truncHint,
      );
    } catch (e) {
      results.push(`\n=== ${fp} ===\n${diagnose4xx(e, "batch_read")}`);
    }
  }
  return results.join("\n");
}

/**
 * 读取文件内容。
 * @param startLine 起始行号（1-based，可选），不传则从头读
 * @param endLine   结束行号（1-based，可选），不传则到末尾
 *
 * 自动处理大文件（>1MB）：GitHub Contents API 对超大文件返回空 content，
 * 此时自动切换到 Git Blobs API（/git/blobs/{sha}）获取完整内容。
 * 每次最多返回 500 行（减少 round trips），超出时附带剩余行数提示。
 */
async function readFile(
  ctx: GithubContext,
  filePath: string,
  startLine?: number,
  endLine?: number,
): Promise<string> {
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
    if (Array.isArray(data)) return `"${filePath}" 是目录，请用 file_tree 列出其内容。`;

    let fullContent: string;

    // 大文件（>1MB）或 content 为空时，切换到 Git Blobs API
    if (!data.content || data.content.trim() === "" || (data.size && data.size > 1_000_000)) {
      if (!data.sha) return `无法读取文件 "${filePath}"：缺少 blob SHA，请检查路径是否正确。`;
      const blob = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/blobs/${data.sha}`);
      if (!blob.content) return `无法读取大文件 "${filePath}"（大小：${data.size ? Math.round(data.size/1024) + "KB" : "未知"}），GitHub API 返回空内容。`;
      fullContent = decodeBase64Utf8(blob.content);
    } else {
      if (data.encoding !== "base64") return `无法解码文件 "${filePath}"（编码：${data.encoding}）`;
      fullContent = decodeBase64Utf8(data.content);
    }

    const allLines = fullContent.split("\n");
    const totalLines = allLines.length;

    // 确定实际读取范围（转为 0-based 索引）
    const from = startLine ? Math.max(1, startLine) : 1;
    // 每次最多读 500 行，减少 token 消耗同时覆盖更多代码
    const MAX_CHUNK = 500;
    const rawTo = endLine ? Math.min(totalLines, endLine) : totalLines;
    const to    = Math.min(rawTo, from + MAX_CHUNK - 1);

    const selectedLines = allLines.slice(from - 1, to);
    const isTruncated = to < rawTo || (to < totalLines && !endLine);
    const fileSizeKB = data.size ? Math.round(data.size / 1024) : null;
    const sizeNote = fileSizeKB && fileSizeKB > 100 ? ` | 文件大小: ${fileSizeKB}KB` : "";

    const lineHeader = (startLine || endLine)
      ? ` 第 ${from}–${to} 行（共 ${totalLines} 行）`
      : ` 第 ${from}–${to} 行（共 ${totalLines} 行）`;

    // 每行加行号，方便 patch_file 精确定位
    const numberedContent = selectedLines
      .map((line, i) => `${String(from + i).padStart(6, " ")} | ${line}`)
      .join("\n");

    const truncationHint = isTruncated
      ? `\n\n⚠️ 文件共 ${totalLines} 行，本次只返回第 ${from}–${to} 行。` +
        `继续读取请调用：{"tool":"read_file","path":"${filePath}","start_line":"${to + 1}","end_line":"${Math.min(totalLines, to + MAX_CHUNK)}"}`
      : "";

    return (
      `文件 "${filePath}"${lineHeader}${sizeNote}：\n\`\`\`\n${numberedContent}\n\`\`\`` +
      `\n_SHA: ${data.sha} | 总行数: ${totalLines}${sizeNote}_` +
      truncationHint
    );
  } catch (e) { return diagnose4xx(e, "read_file"); }
}

/**
 * 获取文件的元信息（大小、总行数、SHA），不返回文件内容。
 * 用途：AI 读大文件前先调用此工具，了解总行数，制定分段读取计划。
 * 对于 >1MB 的大文件，会使用 Blobs API 读取内容来统计行数。
 */
async function getFileInfo(ctx: GithubContext, filePath: string): Promise<string> {
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
    if (Array.isArray(data)) return `"${filePath}" 是目录，请用 file_tree 列出其内容。`;

    const sizeKB = data.size ? Math.round(data.size / 1024) : 0;
    const isLarge = data.size && data.size > 1_000_000;

    let lineCount = "未知";
    if (!isLarge && data.content && data.encoding === "base64") {
      // 普通文件：直接统计行数
      const content = decodeBase64Utf8(data.content);
      lineCount = String(content.split("\n").length);
    } else if (isLarge && data.sha) {
      // 大文件：通过 Blobs API 获取内容来统计行数
      try {
        const blob = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/blobs/${data.sha}`);
        if (blob.content) {
          const content = decodeBase64Utf8(blob.content);
          lineCount = String(content.split("\n").length);
        }
      } catch {
        lineCount = "无法统计（Blobs API 失败）";
      }
    }

    const MAX_CHUNK = 500;
    const chunks = lineCount !== "未知" && lineCount !== "无法统计（Blobs API 失败）"
      ? `\n分段建议：共 ${lineCount} 行，建议每次读 ${MAX_CHUNK} 行，` +
        `需要 ${Math.ceil(Number(lineCount) / MAX_CHUNK)} 次 read_file 调用可读完全文。`
      : "";

    return (
      `文件信息：${filePath}\n` +
      `- 大小：${sizeKB}KB（${data.size ?? 0} 字节）${isLarge ? " ⚠️ 大文件，将自动用 Blobs API 读取" : ""}\n` +
      `- 总行数：${lineCount}\n` +
      `- SHA：${data.sha}\n` +
      `- 类型：${data.type}` +
      chunks
    );
  } catch (e) { return diagnose4xx(e, "get_file_info"); }
}


/**
 * 局部修改文件（patch）：仅替换指定行范围，不覆盖整个文件。
 * 自动支持大文件（>1MB）通过 Blobs API 读取。
 * patch 成功后自动回显修改区域（±5行上下文），AI 可直接确认修改是否正确。
 * @param startLine 起始行号（1-based，包含）
 * @param endLine   结束行号（1-based，包含）
 * @param newContent 用于替换 [startLine, endLine] 范围的新内容（可多行）
 * @param commitMessage commit 信息
 * @param branch 目标分支
 */
async function patchFile(
  ctx: GithubContext,
  filePath: string,
  startLine: number,
  endLine: number,
  newContent: string,
  commitMessage: string,
  branch?: string,
): Promise<string> {
  try {
    // 1. 读取原文件（自动处理大文件）
    const fetched = await fetchFileContent(ctx, filePath);
    if (typeof fetched === "string") return fetched;
    const { content: fullContent, sha: fileSha, totalLines } = fetched;
    const allLines = fullContent.split("\n");

    // 参数边界校验
    if (startLine < 1 || endLine < startLine || startLine > totalLines) {
      return `行号超出范围：文件共 ${totalLines} 行，请求 ${startLine}–${endLine}`;
    }
    const safeEnd = Math.min(endLine, totalLines);

    // 2. 拼接新内容：前段 + 替换内容 + 后段
    const before   = allLines.slice(0, startLine - 1);
    const after    = allLines.slice(safeEnd);
    const newLines = newContent.split("\n");
    const patched  = [...before, ...newLines, ...after].join("\n");
    const patchedLines = patched.split("\n");

    // 3. base64 编码（兼容 UTF-8）
    const encoded = btoa(unescape(encodeURIComponent(patched)));

    // 4. 写回 GitHub
    const body: Record<string, string> = { message: commitMessage, content: encoded, sha: fileSha };
    if (branch) body.branch = branch;

    const result = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`,
      { method: "PUT", body: JSON.stringify(body) },
    );

    const commitSha = (result.commit?.sha as string)?.slice(0, 7) || "成功";
    const replacedCount = safeEnd - startLine + 1;
    const newCount = newLines.length;

    // 5. 验证快照：git diff 风格（- 旧行 / + 新行 / 上下文行）
    const CONTEXT = 5;
    const ctxFrom = Math.max(1, startLine - CONTEXT);
    const ctxTo   = Math.min(patchedLines.length, startLine + newCount - 1 + CONTEXT);
    const snapLines: string[] = [];

    // 上下文行（修改前）
    for (let i = ctxFrom; i < startLine; i++) {
      snapLines.push(`${String(i).padStart(6, " ")}   | ${allLines[i - 1]}`);
    }
    // 被删除的旧行（-）
    for (let i = startLine; i <= safeEnd; i++) {
      snapLines.push(`${String(i).padStart(6, " ")} - | ${allLines[i - 1]}`);
    }
    // 新增的行（+）
    newLines.forEach((nl, ni) => {
      snapLines.push(`${String(startLine + ni).padStart(6, " ")} + | ${nl}`);
    });
    // 下文行（修改后）
    const afterStart = startLine + newCount;
    for (let i = afterStart; i <= ctxTo; i++) {
      snapLines.push(`${String(i).padStart(6, " ")}   | ${patchedLines[i - 1]}`);
    }

    return (
      `✅ patch "${filePath}" 成功：第 ${startLine}–${safeEnd} 行（${replacedCount} 行→${newCount} 行），` +
      `commit: ${commitSha}，信息：${commitMessage}\n\n` +
      `📋 修改验证快照（- 已删除  + 新增  上下文 ${CONTEXT} 行）：\n\`\`\`diff\n${snapLines.join("\n")}\n\`\`\``
    );
  } catch (e) { return diagnose4xx(e, "patch_file"); }
}


async function writeFile(
  ctx: GithubContext, filePath: string, content: string,
  commitMessage: string, branch?: string
): Promise<string> {
  try {
    let sha: string | undefined;
    try {
      const existing = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
      sha = existing.sha;
    } catch { /* 新文件 */ }
    const body: Record<string, string> = {
      message: commitMessage,
      content: btoa(unescape(encodeURIComponent(content))),
    };
    if (sha) body.sha = sha;
    if (branch) body.branch = branch;
    const result = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`, {
      method: "PUT", body: JSON.stringify(body),
    });
    return `✅ 文件 "${filePath}" 已${sha ? "更新" : "创建"}，提交：${result.commit?.sha?.slice(0, 7) || "成功"}，信息：${commitMessage}`;
  } catch (e) { return diagnose4xx(e, "write_file"); }
}

async function searchCode(ctx: GithubContext, query: string): Promise<string> {
  try {
    const data = await githubRequest(
      ctx, `/search/code?q=${encodeURIComponent(query)}+repo:${ctx.owner}/${ctx.repo}&per_page=10`
    );
    if (!data.items?.length) return `未找到匹配 "${query}" 的代码`;
    return `搜索 "${query}" 找到 ${data.total_count} 个结果（前10）：\n${
      data.items.map((item: { path: string }) => `• ${item.path}`).join("\n")
    }`;
  } catch (e) { return diagnose4xx(e, "search_code"); }
}

/**
 * 全仓库搜索：在整个仓库所有文件中搜索关键词，精确返回匹配的文件路径和行号。
 *
 * 流程：
 * 1. 使用 GitHub Search Code API 找到包含关键词的文件列表（最多 10 个文件）
 * 2. 对每个匹配文件调用 fetchFileContent + grep，找出精确行号
 *
 * @param query       搜索关键词（支持正则）
 * @param filePattern 可选，文件路径过滤（如 "*.ts" 或 "src/"）
 * @param offset      跳过前 N 个匹配文件，用于翻页（默认 0）
 */
async function grepInRepo(
  ctx: GithubContext,
  query: string,
  filePattern?: string,
  offset = 0,
): Promise<string> {
  try {
    // Step 1: GitHub Search Code API 找到含关键词的文件
    let searchQ = `${encodeURIComponent(query)}+repo:${ctx.owner}/${ctx.repo}`;
    if (filePattern) searchQ += `+path:${encodeURIComponent(filePattern)}`;
    const PAGE_SIZE = 8;
    const searchUrl = `/search/code?q=${searchQ}&per_page=${PAGE_SIZE}&page=${Math.floor(offset / PAGE_SIZE) + 1}`;

    const data = await githubRequest(ctx, searchUrl);
    if (!data.items?.length) {
      return `全仓库搜索 "${query}" 未找到匹配文件${filePattern ? `（路径过滤：${filePattern}）` : ""}`;
    }

    const totalCount = data.total_count as number;
    const items = data.items as Array<{ path: string; html_url: string }>;

    // Step 2: 对每个文件做精确行号定位（并发限制，避免请求过多）
    let regex: RegExp;
    try {
      regex = new RegExp(query, "gi");
    } catch {
      regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    }

    const fileResults: string[] = [];
    for (const item of items) {
      try {
        const fetched = await fetchFileContent(ctx, item.path);
        if (typeof fetched === "string") {
          fileResults.push(`📄 ${item.path}\n  ⚠️ ${fetched}`);
          continue;
        }
        const lines = fetched.content.split("\n");
        const matches: string[] = [];
        lines.forEach((line, i) => {
          regex.lastIndex = 0;
          if (regex.test(line)) {
            const lineNo = String(i + 1).padStart(6, " ");
            // 高亮匹配部分（用 >> 包裹）
            const highlighted = line.replace(regex, (m) => `>>${m}<<`);
            matches.push(`  ${lineNo} | ${highlighted}`);
          }
          regex.lastIndex = 0;
        });
        if (matches.length) {
          fileResults.push(`📄 ${item.path}（${matches.length} 处匹配）：\n${matches.slice(0, 20).join("\n")}` +
            (matches.length > 20 ? `\n  … 还有 ${matches.length - 20} 处，用 grep_in_file 查看全部` : ""));
        } else {
          fileResults.push(`📄 ${item.path}（Search API 匹配但行级 grep 未命中，可能是注释或字符串）`);
        }
      } catch {
        fileResults.push(`📄 ${item.path}（读取文件失败）`);
      }
    }

    const shownFrom = offset + 1;
    const shownTo   = offset + items.length;
    const hasMore   = totalCount > shownTo;
    const header = `🔍 全仓库搜索 "${query}"，共找到约 ${totalCount} 个匹配文件` +
      (filePattern ? `（路径过滤：${filePattern}）` : "") +
      `\n本次展示第 ${shownFrom}–${shownTo} 个文件：\n`;

    const truncHint = hasMore
      ? `\n\n⚠️ 还有更多匹配文件未展示。继续查看请调用：` +
        `{"tool":"grep_in_repo","query":"${query}","offset":"${shownTo}"` +
        (filePattern ? `,"file_pattern":"${filePattern}"` : "") + `}`
      : "";

    return header + fileResults.join("\n\n") + truncHint;
  } catch (e) { return diagnose4xx(e, "grep_in_repo"); }
}

/**
 * 批量 patch：对同一文件的多处非连续行一次性修改，合并为单个 commit。
 * 相比多次调用 patch_file，减少 commit 数量，保持提交历史整洁。
 *
 * @param patches JSON 字符串，格式：[{"start_line":N,"end_line":M,"content":"新内容"},...]
 *                每个 patch 的行号基于**原始文件**（不考虑其他 patch 的偏移）
 * @param commitMessage commit 信息
 * @param branch 目标分支
 */
async function batchPatch(
  ctx: GithubContext,
  filePath: string,
  patches: Array<{ start_line: number; end_line: number; content: string }>,
  commitMessage: string,
  branch?: string,
): Promise<string> {
  try {
    if (!patches?.length) return "patches 数组为空，请提供至少一个修改项";

    // 1. 读取原文件（自动支持大文件）
    const fetched = await fetchFileContent(ctx, filePath);
    if (typeof fetched === "string") return fetched;
    const { content: fullContent, sha: fileSha, totalLines } = fetched;
    const allLines = fullContent.split("\n");

    // 2. 校验所有 patch 的行号
    for (const p of patches) {
      if (p.start_line < 1 || p.end_line < p.start_line || p.start_line > totalLines) {
        return `行号超出范围：文件共 ${totalLines} 行，patch {start_line:${p.start_line}, end_line:${p.end_line}} 无效`;
      }
    }

    // 3. 按 start_line 倒序处理（从文件末尾往前改），防止行号偏移
    const sorted = [...patches].sort((a, b) => b.start_line - a.start_line);

    // 保存每处修改的 diff 信息（用原始行内容）
    const diffSnapshots: string[] = [];
    const workLines = [...allLines];

    for (const p of sorted) {
      const safeEnd   = Math.min(p.end_line, workLines.length);
      const oldLines  = workLines.slice(p.start_line - 1, safeEnd);
      const newLines  = p.content.split("\n");

      // 构建 diff 快照
      const CONTEXT = 3;
      const ctxFrom = Math.max(1, p.start_line - CONTEXT);
      const ctxTo   = Math.min(workLines.length, safeEnd + CONTEXT);

      const snapLines: string[] = [];
      for (let i = ctxFrom; i <= ctxTo; i++) {
        if (i >= p.start_line && i <= safeEnd) {
          // 被删除的旧行
          snapLines.push(`${String(i).padStart(6, " ")} - | ${workLines[i - 1]}`);
        } else {
          snapLines.push(`${String(i).padStart(6, " ")}   | ${workLines[i - 1]}`);
        }
      }
      // 新增行插入（显示在被删行位置之后）
      newLines.forEach((nl, ni) => {
        snapLines.splice(
          CONTEXT + (safeEnd - p.start_line + 1) + ni,
          0,
          `${String(p.start_line + ni).padStart(6, " ")} + | ${nl}`,
        );
      });

      diffSnapshots.unshift(
        `**第 ${p.start_line}–${safeEnd} 行**（${oldLines.length} 行 → ${newLines.length} 行）：\n\`\`\`diff\n${snapLines.join("\n")}\n\`\`\``,
      );

      // 应用修改
      workLines.splice(p.start_line - 1, safeEnd - p.start_line + 1, ...newLines);
    }

    // 4. 写回 GitHub（单次 commit）
    const encoded = btoa(unescape(encodeURIComponent(workLines.join("\n"))));
    const body: Record<string, string> = { message: commitMessage, content: encoded, sha: fileSha };
    if (branch) body.branch = branch;

    const result = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`,
      { method: "PUT", body: JSON.stringify(body) },
    );

    const commitSha = (result.commit?.sha as string)?.slice(0, 7) || "成功";

    return (
      `✅ batch_patch "${filePath}" 成功：${patches.length} 处修改合并为单个 commit ${commitSha}\n` +
      `信息：${commitMessage}\n\n` +
      `📋 各处修改 diff 快照（- 旧行  + 新行）：\n\n` +
      diffSnapshots.join("\n\n")
    );
  } catch (e) { return diagnose4xx(e, "batch_patch"); }
}

async function listBranches(ctx: GithubContext): Promise<string> {
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/branches?per_page=50`);
    if (!Array.isArray(data) || !data.length) return "该仓库暂无分支";
    const names = data.map((b: { name: string; protected: boolean }) =>
      `• ${b.name}${b.protected ? " 🔒（受保护）" : ""}`
    );
    return `仓库分支列表（共 ${data.length} 个）：\n${names.join("\n")}`;
  } catch (e) { return diagnose4xx(e, "list_branches"); }
}

async function listCommits(ctx: GithubContext, path?: string, branch?: string): Promise<string> {
  try {
    let url = `/repos/${ctx.owner}/${ctx.repo}/commits?per_page=10`;
    if (path) url += `&path=${encodeURIComponent(path)}`;
    if (branch) url += `&sha=${encodeURIComponent(branch)}`;
    const data = await githubRequest(ctx, url);
    if (!Array.isArray(data) || !data.length) return "暂无提交记录";
    const items = data.map((c: { sha: string; commit: { message: string; author: { name: string; date: string } } }) =>
      `• \`${c.sha.slice(0, 7)}\` ${c.commit.message.split("\n")[0]} — ${c.commit.author.name} (${c.commit.author.date.slice(0, 10)})`
    );
    return `最近 ${data.length} 条提交${path ? `（文件 ${path}）` : ""}：\n${items.join("\n")}`;
  } catch (e) { return diagnose4xx(e, "list_commits"); }
}

async function createBranch(
  ctx: GithubContext,
  branchName: string,
  fromBranch?: string,
): Promise<string> {
  try {
    // 获取来源分支的最新 SHA
    const sourceBranch = fromBranch || "main";
    let baseSha: string;
    try {
      const ref = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/ref/heads/${encodeURIComponent(sourceBranch)}`);
      baseSha = ref.object.sha;
    } catch {
      // 尝试获取默认分支
      const repoInfo = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}`);
      const defBranch = repoInfo.default_branch || "main";
      const ref = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/ref/heads/${encodeURIComponent(defBranch)}`);
      baseSha = ref.object.sha;
    }
    await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    });
    return `✅ 分支 \`${branchName}\` 已从 \`${fromBranch || "默认分支"}\` 创建成功`;
  } catch (e) { return diagnose4xx(e, "create_branch"); }
}

async function createPullRequest(
  ctx: GithubContext,
  title: string,
  head: string,
  base: string,
  body?: string,
): Promise<string> {
  // ── 入参清洗 ──────────────────────────────────────────────────────────────
  // head/base 可能带 "owner:" 前缀（跨 fork 格式），同仓库 PR 去掉前缀
  const cleanHead = (head ?? "").trim().replace(/^[^:]+:/, "");
  const cleanBase = (base ?? "").trim().replace(/^[^:]+:/, "");
  const cleanTitle = (title ?? "").trim() || `restore: 恢复 ${cleanHead} 到 ${cleanBase}`;
  const cleanBody  = (body ?? "").trim();

  if (!cleanHead || !cleanBase) {
    return `【create_pr】 ❌ 参数缺失：head（源分支）和 base（目标分支）均不能为空。\n请先用 list_branches 确认分支名称后重试。`;
  }
  if (cleanHead === cleanBase) {
    return `【create_pr】 ❌ 参数错误：head 分支与 base 分支相同（均为 \`${cleanHead}\`），无法创建 PR。\n请确认要合并的源分支名称。`;
  }

  // ── 预检：是否已存在该两分支间的 open PR ─────────────────────────────────
  try {
    const existing = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/pulls?state=open&head=${ctx.owner}:${cleanHead}&base=${cleanBase}&per_page=1`,
    ) as Array<Record<string, unknown>>;
    if (existing.length > 0) {
      const pr = existing[0];
      return `【create_pr】 ℹ️ PR 已存在（无需重复创建）：\`${cleanHead}\` → \`${cleanBase}\` 已有 open PR。\n- #${pr.number} **${pr.title}**  [查看](${pr.html_url})\n如需合并，直接用：{"tool":"merge_pull_request","pull_number":"${pr.number}","merge_method":"squash"}`;
    }
  } catch (_) { /* 预检失败不阻断，继续尝试创建 */ }

  // ── 创建 PR ───────────────────────────────────────────────────────────────
  try {
    const pr = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title: cleanTitle, head: cleanHead, base: cleanBase, body: cleanBody, draft: false }),
    });
    return `✅ PR 已创建：[#${pr.number} ${pr.title}](${pr.html_url})\n- 从 \`${cleanHead}\` → \`${cleanBase}\`\n- 状态：${pr.state}`;
  } catch (e) { return diagnose4xx(e, "create_pr"); }
}

// ── GitHub Actions 工作流工具 ─────────────────────────────────────────────────

/** 列出仓库所有工作流文件 */
async function listWorkflows(ctx: GithubContext): Promise<string> {
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/workflows`);
    if (!data.workflows?.length) return "该仓库没有工作流文件。";
    const rows = data.workflows.map((w: Record<string, string>) =>
      `- **${w.name}**（\`${w.path}\`）ID: \`${w.id}\`  状态: ${w.state}`
    );
    return `共 ${data.total_count} 个工作流：\n${rows.join("\n")}`;
  } catch (e) { return diagnose4xx(e, "list_workflows"); }
}

/** 获取工作流最近的运行记录 */
async function getWorkflowRuns(
  ctx: GithubContext,
  workflowId: string,
  limit = 10,
): Promise<string> {
  try {
    // workflowId 可以是数字 ID 或工作流文件名（如 deploy.yml）
    const path = workflowId
      ? `/repos/${ctx.owner}/${ctx.repo}/actions/workflows/${workflowId}/runs?per_page=${limit}`
      : `/repos/${ctx.owner}/${ctx.repo}/actions/runs?per_page=${limit}`;
    const data = await githubRequest(ctx, path);
    if (!data.workflow_runs?.length) return "没有找到运行记录。";
    const rows = data.workflow_runs.map((r: Record<string, string>) => {
      const duration = r.updated_at && r.run_started_at
        ? `${Math.round((new Date(r.updated_at).getTime() - new Date(r.run_started_at).getTime()) / 1000)}s`
        : "-";
      const statusIcon = r.conclusion === "success" ? "✅" : r.conclusion === "failure" ? "❌"
        : r.status === "in_progress" ? "🔄" : r.conclusion === "cancelled" ? "⏹" : "⏳";
      return `${statusIcon} Run #${r.run_number}  结论: ${r.conclusion || r.status}  分支: \`${r.head_branch}\`  耗时: ${duration}  ID: \`${r.id}\`  触发: ${r.event}`;
    });
    return `最近 ${data.workflow_runs.length} 次运行：\n${rows.join("\n")}`;
  } catch (e) { return diagnose4xx(e, "get_workflow_runs"); }
}

/** 获取某次运行的 Jobs 及步骤状态 */
async function getRunJobs(ctx: GithubContext, runId: string): Promise<string> {
  try {
    const data = await githubRequest(
      ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/jobs`,
    );
    if (!data.jobs?.length) return `运行 #${runId} 没有 Job 记录。`;
    const lines: string[] = [`运行 ID \`${runId}\` 共 ${data.jobs.length} 个 Job：\n`];
    for (const job of data.jobs as Array<Record<string, unknown>>) {
      const icon = job.conclusion === "success" ? "✅" : job.conclusion === "failure" ? "❌"
        : job.status === "in_progress" ? "🔄" : "⏳";
      lines.push(`${icon} **${job.name}** (Job ID: \`${job.id}\`)  状态: ${job.conclusion || job.status}`);
      const steps = (job.steps as Array<Record<string, string>>) || [];
      for (const step of steps) {
        const sIcon = step.conclusion === "success" ? "  ✓" : step.conclusion === "failure" ? "  ✗"
          : step.status === "in_progress" ? "  ►" : "  ○";
        lines.push(`${sIcon} ${step.name}  (${step.conclusion || step.status || "pending"})`);
      }
    }
    return lines.join("\n");
  } catch (e) { return diagnose4xx(e, "get_run_jobs"); }
}

/** 下载并返回某个 Job 的日志（纯文本，截取最后 12000 字符） */
async function getJobLogs(ctx: GithubContext, jobId: string): Promise<string> {
  try {
    // GitHub 返回 302 重定向到实际日志 URL，需要手动跟随
    const redirectResp = await fetch(
      `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/actions/jobs/${jobId}/logs`,
      {
        headers: {
          Authorization: `token ${ctx.token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "GitHubManagerApp",
        },
        redirect: "manual",
      },
    );
    let logText = "";
    if (redirectResp.status === 302) {
      const logUrl = redirectResp.headers.get("location") || "";
      const logResp = await fetch(logUrl);
      logText = await logResp.text();
    } else if (redirectResp.status === 200) {
      logText = await redirectResp.text();
    } else {
      return `获取日志失败：HTTP ${redirectResp.status}`;
    }

    // 日志可能很长，只保留最后 12000 字符（最关键的报错信息在末尾）
    const truncated = logText.length > 12000
      ? `...[前 ${logText.length - 12000} 字符已省略]\n\n${logText.slice(-12000)}`
      : logText;
    return `Job \`${jobId}\` 日志（共 ${logText.length} 字符）：\n\`\`\`\n${truncated}\n\`\`\``;
  } catch (e) { return diagnose4xx(e, "get_job_logs"); }
}

/** 手动触发工作流（workflow_dispatch 事件）；422 时自动添加触发器并重试。
 *  触发成功后会等待约 5s 再查最新 run_id，方便后续 check_run_status 直接使用。
 */
async function triggerWorkflow(
  ctx: GithubContext,
  workflowId: string,
  ref: string,
  inputs?: Record<string, string>,
): Promise<string> {
  const doDispatch = async () =>
    githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/actions/workflows/${workflowId}/dispatches`,
      { method: "POST", body: JSON.stringify({ ref, inputs: inputs || {} }) },
    );

  /** 触发后等待 GitHub 记录本次运行，返回新产生的 run_id（找不到则返回 null） */
  const resolveNewRunId = async (): Promise<string | null> => {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const runs = await githubRequest(
        ctx,
        `/repos/${ctx.owner}/${ctx.repo}/actions/workflows/${workflowId}/runs?per_page=1&branch=${encodeURIComponent(ref)}`,
      );
      const latest = runs.workflow_runs?.[0];
      if (latest?.id) return String(latest.id);
    } catch { /* 忽略 */ }
    return null;
  };

  try {
    await doDispatch();
    const runId = await resolveNewRunId();
    const runHint = runId
      ? `\n🆔 本次运行 ID：\`${runId}\`。请立即调用：{"tool":"check_run_status","run_id":"${runId}","workflow_type":"normal"}`
      : `\n稍后可用 get_workflow_runs 查看进度。`;
    return `✅ 已触发工作流 \`${workflowId}\`，分支：\`${ref}\`。${runHint}`;
  } catch (e) {
    const isDispatchMissing =
      e instanceof GithubApiError &&
      e.status === 422 &&
      e.body.includes("workflow_dispatch");

    if (!isDispatchMissing) return diagnose4xx(e, `trigger_workflow(${workflowId})`);

    // ── 自动修复：在工作流文件中注入 workflow_dispatch 触发器 ─────────────
    const workflowPath = workflowId.includes("/")
      ? workflowId
      : `.github/workflows/${workflowId}`;

    let fileData: Record<string, string>;
    try {
      fileData = await githubRequest(
        ctx,
        `/repos/${ctx.owner}/${ctx.repo}/contents/${workflowPath}`,
      );
    } catch (readErr) {
      return `❌ 工作流缺少 workflow_dispatch，且无法读取文件自动修复：${diagnose4xx(readErr, "read workflow file")}`;
    }

    if (fileData.encoding !== "base64") {
      return `❌ 工作流 \`${workflowId}\` 缺少 workflow_dispatch，文件编码非 base64，无法自动修复。`;
    }

    const original = decodeBase64Utf8(fileData.content);
    if (original.includes("workflow_dispatch")) {
      try { await doDispatch(); } catch (_) { /* ignore */ }
      const runId2 = await resolveNewRunId();
      const runHint2 = runId2
        ? `\n🆔 本次运行 ID：\`${runId2}\`。请立即调用：{"tool":"check_run_status","run_id":"${runId2}","workflow_type":"normal"}`
        : "";
      return `✅ 工作流已包含 workflow_dispatch，已重新触发 \`${workflowId}\`。${runHint2}`;
    }

    // 在 `on:` 行之后插入 `  workflow_dispatch: {}`
    const lines = original.split("\n");
    const onIdx = lines.findIndex(l => /^on\s*:/.test(l.trim()));
    if (onIdx === -1) {
      return `❌ 未在工作流文件中找到 \`on:\` 块，无法自动注入 workflow_dispatch。请 read_file 检查后手动 patch_file 修复。`;
    }
    lines.splice(onIdx + 1, 0, "  workflow_dispatch: {}");
    const patched = lines.join("\n");
    const encoded = btoa(unescape(encodeURIComponent(patched)));

    try {
      await githubRequest(
        ctx,
        `/repos/${ctx.owner}/${ctx.repo}/contents/${workflowPath}`,
        {
          method: "PUT",
          body: JSON.stringify({
            message: "ci: 自动添加 workflow_dispatch 触发器",
            content: encoded,
            sha: fileData.sha,
            branch: ref,
          }),
        },
      );
    } catch (writeErr) {
      return `❌ 自动注入 workflow_dispatch 失败（写入时报错）：${diagnose4xx(writeErr, "auto-patch workflow_dispatch")}`;
    }

    // 等待 GitHub 索引生效后重试
    await new Promise(r => setTimeout(r, 2000));
    try {
      await doDispatch();
      const runId3 = await resolveNewRunId();
      const runHint3 = runId3
        ? `\n🆔 本次运行 ID：\`${runId3}\`。请立即调用：{"tool":"check_run_status","run_id":"${runId3}","workflow_type":"normal"}`
        : `\n稍后可用 get_workflow_runs 查看运行进度。`;
      return `✅ 已自动为 \`${workflowId}\` 添加 \`workflow_dispatch\` 触发器并提交，随后触发成功（分支：\`${ref}\`）。${runHint3}`;
    } catch (retryErr) {
      return `⚠️ 已添加 workflow_dispatch 触发器并提交，但触发仍失败：${diagnose4xx(retryErr, "retry trigger")}`;
    }
  }
}

/**
 * 智能等待工作流运行完成（轮询模式）。
 * 根据 workflow_type 选择合适的等待策略，避免过早查询拿到空日志，
 * 也避免对耗时较长的构建任务（如 Android APK）等待时间不足。
 *
 * 等待策略：
 * - fast      : 初始等待 5s，每 10s 查一次，最多查 6 次（覆盖 ~65s）
 * - normal    : 初始等待 15s，每 20s 查一次，最多查 5 次（覆盖 ~115s）
 * - build_apk : 初始等待 60s，每 30s 查一次，最多查 3 次（覆盖 ~150s，约 2.5min）
 *               构建 APP 通常约 3 分钟，若第一次返回仍在运行，AI 应再调一次此工具。
 *
 * 返回：
 * - 已完成（success/failure/cancelled）→ 带结论和耗时；failure 自动附带 Jobs 失败摘要
 * - 超时仍在运行 → 返回当前状态 + 已等待时长 + 继续调用建议
 * - 运行无法启动（startup_failure）→ 立即返回错误，无需等待
 *
 * @param runId        运行 ID（由 trigger_workflow 返回，或 get_workflow_runs 获取）
 * @param workflowType 工作流类型：fast | normal | build_apk（默认 normal）
 */
async function checkRunStatus(
  ctx: GithubContext,
  runId: string,
  workflowType: "fast" | "normal" | "build_apk" = "normal",
): Promise<string> {
  type PollConfig = { initialWait: number; interval: number; maxPolls: number };
  const CONFIGS: Record<string, PollConfig> = {
    fast:      { initialWait: 5_000,  interval: 10_000, maxPolls: 6 },
    normal:    { initialWait: 15_000, interval: 20_000, maxPolls: 5 },
    build_apk: { initialWait: 60_000, interval: 30_000, maxPolls: 3 },
  };
  const cfg = CONFIGS[workflowType] ?? CONFIGS.normal;

  const runUrl = `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}`;

  // 首先快速检查一次，若已是 startup_failure 立即返回
  try {
    const snap = await githubRequest(ctx, runUrl);
    if (snap.conclusion === "startup_failure") {
      return (
        `❌ 工作流运行 \`${runId}\` 启动失败（startup_failure）。\n` +
        `这通常意味着工作流文件存在语法错误，或引用的 Action 版本不存在。\n` +
        `请用 read_file 检查 .github/workflows/ 下的工作流文件。`
      );
    }
    // 如果触发后立即已 completed（极少见但可能），直接返回
    if (snap.status === "completed") {
      return formatRunResult(snap, runId, 0);
    }
  } catch (e) {
    return diagnose4xx(e, `check_run_status(${runId})`);
  }

  // 初始等待
  await new Promise(r => setTimeout(r, cfg.initialWait));
  let elapsedMs = cfg.initialWait;

  for (let i = 0; i < cfg.maxPolls; i++) {
    let run: Record<string, unknown>;
    try {
      run = await githubRequest(ctx, runUrl);
    } catch (e) {
      return diagnose4xx(e, `check_run_status poll(${runId})`);
    }

    if (run.status === "completed") {
      return await formatRunResult(run, runId, elapsedMs, ctx);
    }

    // startup_failure 无论何时出现都立即返回
    if (run.conclusion === "startup_failure") {
      return (
        `❌ 工作流运行 \`${runId}\` 启动失败（startup_failure）。\n` +
        `工作流文件可能有语法错误，请用 read_file 检查 .github/workflows/ 目录。`
      );
    }

    // 还在运行：如果不是最后一次轮询，继续等待
    if (i < cfg.maxPolls - 1) {
      await new Promise(r => setTimeout(r, cfg.interval));
      elapsedMs += cfg.interval;
    }
  }

  // 超出轮询次数，仍在运行
  const elapsedSec = Math.round(elapsedMs / 1000);
  const continueHint = workflowType === "build_apk"
    ? `构建 APP 通常需要约 3 分钟，已等待 ${elapsedSec}s。请再次调用：\n{"tool":"check_run_status","run_id":"${runId}","workflow_type":"build_apk"}`
    : `已等待 ${elapsedSec}s，工作流仍在运行。可稍后调用：\n{"tool":"check_run_status","run_id":"${runId}","workflow_type":"${workflowType}"}`;

  return `⏳ 工作流 \`${runId}\` 仍在运行（已等待 ${elapsedSec}s）。\n${continueHint}`;
}

/** 格式化运行完成结果，failure 时自动附带 Jobs 失败摘要 */
async function formatRunResult(
  run: Record<string, unknown>,
  runId: string,
  elapsedMs: number,
  ctx?: GithubContext,
): Promise<string> {
  const conclusion  = run.conclusion  as string ?? "unknown";
  const startedAt   = run.run_started_at as string ?? "";
  const updatedAt   = run.updated_at   as string ?? "";
  const runNumber   = run.run_number   as number ?? 0;
  const headBranch  = run.head_branch  as string ?? "";

  // 实际耗时（从 GitHub 时间戳计算，比 elapsedMs 更准）
  const durationSec = startedAt && updatedAt
    ? Math.round((new Date(updatedAt).getTime() - new Date(startedAt).getTime()) / 1000)
    : Math.round(elapsedMs / 1000);

  const icon = conclusion === "success" ? "✅" : conclusion === "failure" ? "❌"
    : conclusion === "cancelled" ? "⏹" : "⚠️";

  let result =
    `${icon} 工作流运行 **#${runNumber}**（ID: \`${runId}\`）已完成\n` +
    `结论：\`${conclusion}\`  |  分支：\`${headBranch}\`  |  耗时：${durationSec}s`;

  // failure / cancelled：自动查 Jobs 返回失败摘要，AI 不需要再单独调用 get_run_jobs
  if ((conclusion === "failure" || conclusion === "cancelled") && ctx) {
    try {
      const jobsData = await githubRequest(
        ctx,
        `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/jobs`,
      );
      const jobs = (jobsData.jobs ?? []) as Array<Record<string, unknown>>;
      const failedJobs = jobs.filter(j => j.conclusion === "failure" || j.conclusion === "cancelled");

      if (failedJobs.length) {
        result += `\n\n**失败 Jobs**：`;
        for (const job of failedJobs) {
          result += `\n❌ \`${job.name}\` (Job ID: \`${job.id}\`)`;
          const steps = (job.steps ?? []) as Array<Record<string, string>>;
          const failedSteps = steps.filter(s => s.conclusion === "failure");
          if (failedSteps.length) {
            result += `\n   失败步骤：${failedSteps.map(s => `"${s.name}"`).join("、")}`;
          }
        }
        const firstFailedJobId = failedJobs[0]?.id;
        if (firstFailedJobId) {
          result += `\n\n📋 获取详细日志：{"tool":"get_job_logs","job_id":"${firstFailedJobId}"}`;
        }
      }
    } catch { /* 获取 Jobs 失败时忽略，不影响主结果 */ }
  }

  if (conclusion === "success") {
    result += `\n\n🎉 运行成功！`;
  }

  return result;
}

/** 取消正在运行的工作流 */
async function cancelWorkflowRun(ctx: GithubContext, runId: string): Promise<string> {
  try {
    await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/cancel`,
      { method: "POST" },
    );
    return `✅ 已发送取消请求，Run ID: \`${runId}\`。`;
  } catch (e) { return diagnose4xx(e, "cancel_workflow_run"); }
}

/** 重新运行失败的工作流 */
async function rerunWorkflowRun(ctx: GithubContext, runId: string, failedJobsOnly = false): Promise<string> {
  try {
    const path = failedJobsOnly
      ? `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/rerun-failed-jobs`
      : `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/rerun`;
    await githubRequest(ctx, path, { method: "POST" });
    return `✅ 已重新触发 Run \`${runId}\`（${failedJobsOnly ? "仅失败 Jobs" : "全部 Jobs"}），稍后可查看新运行。`;
  } catch (e) { return diagnose4xx(e, "rerun_workflow_run"); }
}

// ── 文件完善操作 ─────────────────────────────────────────────────────────────

/** 删除仓库文件 */
async function deleteFile(
  ctx: GithubContext,
  filePath: string,
  commitMessage: string,
  branch?: string,
): Promise<string> {
  try {
    const existing = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
    const body: Record<string, string> = { message: commitMessage, sha: existing.sha };
    if (branch) body.branch = branch;
    await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`, {
      method: "DELETE", body: JSON.stringify(body),
    });
    return `✅ 已删除文件 "${filePath}"，提交信息：${commitMessage}`;
  } catch (e) { return diagnose4xx(e, "delete_file"); }
}

// ── PR / Issue 管理 ──────────────────────────────────────────────────────────

/** 列出 Pull Requests */
async function listPullRequests(ctx: GithubContext, state = "open"): Promise<string> {
  try {
    const prs = await githubRequest(
      ctx, `/repos/${ctx.owner}/${ctx.repo}/pulls?state=${state}&per_page=20`,
    ) as Array<Record<string, unknown>>;
    if (!prs.length) return `没有 ${state} 状态的 PR。`;
    const rows = prs.map(pr =>
      `#${pr.number} **${pr.title}**  \`${(pr.head as Record<string,string>).ref}\` → \`${(pr.base as Record<string,string>).ref}\`  作者: ${(pr.user as Record<string,string>).login}  [查看](${pr.html_url})`
    );
    return `${state} 状态 PR（共 ${rows.length} 个）：\n${rows.join("\n")}`;
  } catch (e) { return diagnose4xx(e, "list_pull_requests"); }
}

/** 合并 Pull Request */
async function mergePullRequest(
  ctx: GithubContext,
  pullNumber: string,
  mergeMethod = "squash",
  commitTitle?: string,
): Promise<string> {
  try {
    const body: Record<string, string> = { merge_method: mergeMethod };
    if (commitTitle) body.commit_title = commitTitle;
    const result = await githubRequest(
      ctx, `/repos/${ctx.owner}/${ctx.repo}/pulls/${pullNumber}/merge`,
      { method: "PUT", body: JSON.stringify(body) },
    );
    return `✅ PR #${pullNumber} 已合并：${result.message}  SHA: ${result.sha?.slice(0, 7)}`;
  } catch (e) { return diagnose4xx(e, "merge_pull_request"); }
}

/** 列出 Issues */
async function listIssues(ctx: GithubContext, state = "open"): Promise<string> {
  try {
    const issues = await githubRequest(
      ctx, `/repos/${ctx.owner}/${ctx.repo}/issues?state=${state}&per_page=20`,
    ) as Array<Record<string, unknown>>;
    // 过滤掉 PR（GitHub Issues API 会把 PR 也返回）
    const realIssues = issues.filter(i => !(i as Record<string, unknown>).pull_request);
    if (!realIssues.length) return `没有 ${state} 状态的 Issue。`;
    const rows = realIssues.map(i =>
      `#${i.number} **${i.title}**  作者: ${(i.user as Record<string,string>).login}  标签: ${((i.labels as Array<Record<string,string>>) || []).map(l => l.name).join(", ") || "无"}  [查看](${i.html_url})`
    );
    return `${state} Issues（共 ${rows.length} 个）：\n${rows.join("\n")}`;
  } catch (e) { return diagnose4xx(e, "list_issues"); }
}

/** 创建 Issue */
async function createIssue(
  ctx: GithubContext,
  title: string,
  body?: string,
  labels?: string,
): Promise<string> {
  try {
    const payload: Record<string, unknown> = { title, body: body || "" };
    if (labels) payload.labels = labels.split(",").map(l => l.trim()).filter(Boolean);
    const issue = await githubRequest(
      ctx, `/repos/${ctx.owner}/${ctx.repo}/issues`,
      { method: "POST", body: JSON.stringify(payload) },
    );
    return `✅ Issue 已创建：[#${issue.number} ${issue.title}](${issue.html_url})`;
  } catch (e) { return diagnose4xx(e, "create_issue"); }
}

/** 列出 Actions Secrets 名称（值不可读取） */
async function listActionsSecrets(ctx: GithubContext): Promise<string> {
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/secrets`);
    if (!data.secrets?.length) return "该仓库没有配置 Actions Secrets。";
    const names = (data.secrets as Array<Record<string, string>>).map(s =>
      `- \`${s.name}\`  更新时间: ${s.updated_at?.slice(0, 10) || "-"}`
    );
    return `共 ${data.total_count} 个 Secrets（仅显示名称，值不可读取）：\n${names.join("\n")}`;
  } catch (e) { return diagnose4xx(e, "list_actions_secrets"); }
}

// ── 新增实用工具 ──────────────────────────────────────────────────────────────

/** 获取仓库基础信息（描述、语言、star、fork、默认分支、topics 等） */
async function getRepoInfo(ctx: GithubContext): Promise<string> {
  try {
    const d = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}`);
    const lines = [
      `📦 **${d.full_name}**`,
      d.description ? `> ${d.description}` : "",
      ``,
      `- 主语言：${d.language || "未知"}`,
      `- ⭐ Stars：${d.stargazers_count}  🍴 Forks：${d.forks_count}  👁 Watchers：${d.subscribers_count}`,
      `- 默认分支：\`${d.default_branch}\``,
      `- 可见性：${d.private ? "私有" : "公开"}`,
      `- 许可证：${d.license?.spdx_id || "无"}`,
      d.topics?.length ? `- Topics：${(d.topics as string[]).join(", ")}` : "",
      `- 创建时间：${d.created_at?.slice(0, 10)}  最后推送：${d.pushed_at?.slice(0, 10)}`,
      `- 仓库链接：${d.html_url}`,
    ].filter(Boolean);
    return lines.join("\n");
  } catch (e) { return diagnose4xx(e, "get_repo_info"); }
}

/** 添加 Issue 或 PR 评论 */
async function addComment(
  ctx: GithubContext,
  issueNumber: string,
  body: string,
): Promise<string> {
  try {
    const data = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/issues/${issueNumber}/comments`,
      { method: "POST", body: JSON.stringify({ body }) },
    );
    return `✅ 已在 #${issueNumber} 添加评论（ID: ${data.id}）：\n> ${body.slice(0, 80)}${body.length > 80 ? "…" : ""}`;
  } catch (e) { return diagnose4xx(e, `add_comment(#${issueNumber})`); }
}

/** 关闭 Issue（可选附带评论） */
async function closeIssue(
  ctx: GithubContext,
  issueNumber: string,
  comment?: string,
): Promise<string> {
  try {
    if (comment) {
      await githubRequest(
        ctx,
        `/repos/${ctx.owner}/${ctx.repo}/issues/${issueNumber}/comments`,
        { method: "POST", body: JSON.stringify({ body: comment }) },
      );
    }
    await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/issues/${issueNumber}`,
      { method: "PATCH", body: JSON.stringify({ state: "closed" }) },
    );
    return `✅ Issue #${issueNumber} 已关闭${comment ? "（已附带评论）" : ""}。`;
  } catch (e) { return diagnose4xx(e, `close_issue(#${issueNumber})`); }
}

/** 搜索 Issues（支持关键词、标签、作者、状态过滤） */
async function searchIssues(
  ctx: GithubContext,
  query: string,
  state = "open",
  labels?: string,
  assignee?: string,
  limit = 20,
): Promise<string> {
  try {
    // 构造 GitHub Search API 查询
    let q = `repo:${ctx.owner}/${ctx.repo} is:issue ${query}`;
    if (state !== "all") q += ` state:${state}`;
    if (labels) labels.split(",").forEach(l => { q += ` label:"${l.trim()}"`; });
    if (assignee) q += ` assignee:${assignee}`;
    const data = await githubRequest(
      ctx,
      `/search/issues?q=${encodeURIComponent(q)}&per_page=${Math.min(limit, 30)}&sort=updated&order=desc`,
    ) as { total_count: number; items: Array<Record<string, unknown>> };
    if (!data.items?.length) return `未找到匹配"${query}"的 Issue。`;
    const rows = data.items.map(i => {
      const lbls = ((i.labels as Array<Record<string, string>>) || []).map(l => l.name).join(", ");
      const assignees = ((i.assignees as Array<Record<string, string>>) || []).map(a => a.login).join(", ");
      return `#${i.number} **${i.title}**  状态:${i.state}  标签:${lbls || "无"}  负责人:${assignees || "无"}  [查看](${i.html_url})`;
    });
    return `搜索"${query}"找到 ${data.total_count} 个 Issue（显示前 ${rows.length} 个）：\n${rows.join("\n")}`;
  } catch (e) { return diagnose4xx(e, "search_issues"); }
}

/** 获取 Issue 详细信息（含正文、评论列表） */
async function getIssueDetails(
  ctx: GithubContext,
  issueNumber: string,
): Promise<string> {
  try {
    const [issue, comments] = await Promise.all([
      githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/issues/${issueNumber}`) as Promise<Record<string, unknown>>,
      githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/issues/${issueNumber}/comments?per_page=20`) as Promise<Array<Record<string, unknown>>>,
    ]);
    const labels = ((issue.labels as Array<Record<string, string>>) || []).map(l => l.name).join(", ");
    const assignees = ((issue.assignees as Array<Record<string, string>>) || []).map(a => a.login).join(", ");
    const lines = [
      `## Issue #${issue.number}: ${issue.title}`,
      `- 状态：${issue.state}  作者：${(issue.user as Record<string, string>)?.login}`,
      `- 标签：${labels || "无"}  负责人：${assignees || "无"}`,
      `- 创建：${String(issue.created_at).slice(0, 10)}  更新：${String(issue.updated_at).slice(0, 10)}`,
      `- 链接：${issue.html_url}`,
      ``,
      `### 正文`,
      (issue.body as string) || "（无正文）",
    ];
    if (comments.length > 0) {
      lines.push(``, `### 评论（${comments.length} 条）`);
      comments.slice(0, 10).forEach(c => {
        lines.push(`**@${(c.user as Record<string, string>)?.login}** (${String(c.created_at).slice(0, 10)})：`);
        lines.push((c.body as string)?.slice(0, 300) + ((c.body as string)?.length > 300 ? "…" : ""));
        lines.push("");
      });
      if (comments.length > 10) lines.push(`…还有 ${comments.length - 10} 条评论`);
    }
    return lines.join("\n");
  } catch (e) { return diagnose4xx(e, `get_issue_details(#${issueNumber})`); }
}

/** 更新 Issue（标题/正文/状态/标签/负责人） */
async function updateIssue(
  ctx: GithubContext,
  issueNumber: string,
  title?: string,
  body?: string,
  state?: string,
  labels?: string,
  assignees?: string,
): Promise<string> {
  try {
    const patch: Record<string, unknown> = {};
    if (title) patch.title = title;
    if (body !== undefined) patch.body = body;
    if (state) patch.state = state; // open | closed
    if (labels !== undefined) patch.labels = labels ? labels.split(",").map(l => l.trim()).filter(Boolean) : [];
    if (assignees !== undefined) patch.assignees = assignees ? assignees.split(",").map(a => a.trim()).filter(Boolean) : [];
    if (Object.keys(patch).length === 0) return "未提供任何更新字段，请指定 title/body/state/labels/assignees 之一。";
    const issue = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/issues/${issueNumber}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ) as Record<string, unknown>;
    const changes = Object.keys(patch).join("、");
    return `✅ Issue #${issue.number} 已更新（${changes}）：[${issue.title}](${issue.html_url})`;
  } catch (e) { return diagnose4xx(e, `update_issue(#${issueNumber})`); }
}

/** 列出仓库 Actions Variables（不含加密 Secrets） */
async function listActionsVariables(ctx: GithubContext): Promise<string> {
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/variables?per_page=30`) as { total_count: number; variables: Array<Record<string, string>> };
    if (!data.variables?.length) return "该仓库没有配置 Actions Variables（环境变量）。";
    const rows = data.variables.map(v =>
      `- \`${v.name}\` = \`${v.value}\`  更新时间: ${v.updated_at?.slice(0, 10) || "-"}`
    );
    return `共 ${data.total_count} 个 Actions Variables：\n${rows.join("\n")}`;
  } catch (e) { return diagnose4xx(e, "list_actions_variables"); }
}

/** 创建或更新单个 Actions Variable */
async function setActionsVariable(
  ctx: GithubContext,
  name: string,
  value: string,
): Promise<string> {
  try {
    // 先检查是否存在（GET），存在则 PATCH，不存在则 POST
    let exists = false;
    try {
      await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/variables/${name}`);
      exists = true;
    } catch { /* 404 → 不存在 */ }

    const method = exists ? "PATCH" : "POST";
    const url = exists
      ? `/repos/${ctx.owner}/${ctx.repo}/actions/variables/${name}`
      : `/repos/${ctx.owner}/${ctx.repo}/actions/variables`;
    const body = exists ? JSON.stringify({ value }) : JSON.stringify({ name, value });
    await githubRequest(ctx, url, { method, body });
    return `✅ Actions Variable \`${name}\` 已${exists ? "更新" : "创建"}，值：\`${value}\``;
  } catch (e) { return diagnose4xx(e, `set_actions_variable(${name})`); }
}

/** 关闭 PR */
async function closePR(
  ctx: GithubContext,
  pullNumber: string,
  comment?: string,
): Promise<string> {
  try {
    if (comment) {
      await githubRequest(
        ctx,
        `/repos/${ctx.owner}/${ctx.repo}/issues/${pullNumber}/comments`,
        { method: "POST", body: JSON.stringify({ body: comment }) },
      );
    }
    await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/pulls/${pullNumber}`,
      { method: "PATCH", body: JSON.stringify({ state: "closed" }) },
    );
    return `✅ PR #${pullNumber} 已关闭${comment ? "（已附带评论）" : ""}。`;
  } catch (e) { return diagnose4xx(e, `close_pr(#${pullNumber})`); }
}

/** 查看某次提交的 diff（文件列表 + 统计） */
async function getCommitDiff(ctx: GithubContext, sha: string): Promise<string> {
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/commits/${sha}`);
    const commit = data.commit;
    const files = (data.files as Array<Record<string, string | number>>) || [];
    const header = [
      `**提交 \`${sha.slice(0, 7)}\`**`,
      `作者：${commit?.author?.name} <${commit?.author?.email}>`,
      `时间：${commit?.author?.date?.slice(0, 19).replace("T", " ")}`,
      `信息：${commit?.message?.split("\n")[0]}`,
      `变更：+${data.stats?.additions} -${data.stats?.deletions}，共 ${files.length} 个文件`,
      ``,
    ].join("\n");
    const fileLines = files.slice(0, 20).map((f: Record<string, string | number>) =>
      `- ${f.status === "added" ? "➕" : f.status === "removed" ? "➖" : "✏️"} \`${f.filename}\`  +${f.additions} -${f.deletions}`
    );
    if (files.length > 20) fileLines.push(`…（共 ${files.length} 个文件，仅展示前 20 个）`);
    return header + fileLines.join("\n");
  } catch (e) { return diagnose4xx(e, `get_commit_diff(${sha})`); }
}

/** 查看 PR 的文件变更列表 */
async function getPRFiles(ctx: GithubContext, pullNumber: string): Promise<string> {
  try {
    const files = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/pulls/${pullNumber}/files?per_page=50`,
    ) as Array<Record<string, string | number>>;
    if (!files?.length) return `PR #${pullNumber} 没有文件变更。`;
    const lines = files.map(f =>
      `- ${f.status === "added" ? "➕" : f.status === "removed" ? "➖" : "✏️"} \`${f.filename}\`  +${f.additions} -${f.deletions}`
    );
    const total = files.reduce((s, f) => s + (Number(f.additions) + Number(f.deletions)), 0);
    return `PR #${pullNumber} 共变更 ${files.length} 个文件，${total} 行：\n${lines.join("\n")}`;
  } catch (e) { return diagnose4xx(e, `get_pr_files(#${pullNumber})`); }
}

/**
 * 对比两个 commit / 分支 / tag 之间的所有文件变更（类似 git diff base...head）。
 * 调用 GitHub Compare API，返回：变更统计摘要 + 每个文件的 +/- 行数 + patch 片段（超长截断）。
 *
 * @param base  基准（commit SHA、分支名、tag 名），例如 "main" 或 "v1.0.0"
 * @param head  目标（commit SHA、分支名、tag 名），例如 "feat/new-feature" 或 "abc1234"
 */
async function compareCommits(ctx: GithubContext, base: string, head: string): Promise<string> {
  try {
    const data = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    );

    const status      = data.status as string;           // "ahead" | "behind" | "diverged" | "identical"
    const aheadBy     = data.ahead_by  as number ?? 0;
    const behindBy    = data.behind_by as number ?? 0;
    const totalCommits= data.total_commits as number ?? 0;
    const files       = (data.files as Array<Record<string, string | number | undefined>>) ?? [];
    const commits     = (data.commits as Array<Record<string, Record<string, string>>>) ?? [];

    if (status === "identical") {
      return `\`${base}\` 与 \`${head}\` 完全相同，没有任何差异。`;
    }

    // 摘要
    const summary = [
      `📊 **对比结果：\`${base}\` ↔ \`${head}\`**`,
      `状态：${status}  |  head 超前 ${aheadBy} 提交，落后 ${behindBy} 提交`,
      `提交数：${totalCommits}  |  变更文件：${files.length} 个  |  +${data.stats?.additions ?? "?"} -${data.stats?.deletions ?? "?"}`,
      "",
    ].join("\n");

    // 最近几条提交
    const commitLines = commits.slice(0, 10).map(c =>
      `  \`${c.sha?.slice(0, 7)}\` ${c.commit?.message?.split("\n")[0]}  — ${c.commit?.author?.name ?? ""}`,
    );
    const commitSection = totalCommits > 0
      ? `**提交列表**（共 ${totalCommits} 条，展示前 ${commitLines.length} 条）：\n${commitLines.join("\n")}\n\n`
      : "";

    // 文件变更详情（每个文件展示 patch，超 40 行截断）
    const MAX_PATCH_LINES = 40;
    const fileDetails = files.slice(0, 30).map(f => {
      const icon = f.status === "added" ? "➕" : f.status === "removed" ? "➖" : f.status === "renamed" ? "🔄" : "✏️";
      const header = `${icon} \`${f.filename}\`  +${f.additions ?? 0} -${f.deletions ?? 0}  [${f.status}]`;
      if (!f.patch) return header;
      const patchLines = String(f.patch).split("\n");
      const truncated = patchLines.length > MAX_PATCH_LINES;
      const display = patchLines.slice(0, MAX_PATCH_LINES).join("\n");
      return `${header}\n\`\`\`diff\n${display}${truncated ? `\n…（patch 共 ${patchLines.length} 行，仅展示前 ${MAX_PATCH_LINES} 行）` : ""}\n\`\`\``;
    });
    if (files.length > 30) fileDetails.push(`…（共 ${files.length} 个文件，仅展示前 30 个）`);

    return summary + commitSection + `**文件变更详情**：\n\n` + fileDetails.join("\n\n");
  } catch (e) { return diagnose4xx(e, `compare_commits(${base}...${head})`); }
}

/**
 * 全仓库关键词一键替换（搜索 + 批量修改自动化）。
 * 流程：grep_in_repo 找到所有匹配位置 → 按文件分组 → 逐文件调用 batchPatch 应用替换。
 * 所有修改合并为每个文件一个 commit，返回完整替换报告。
 *
 * @param searchPattern  搜索的关键词（支持正则）
 * @param replacement    替换为的新文本（纯字符串，逐行替换匹配部分）
 * @param filePattern    可选，限制替换的文件路径（如 "src/" 或 ".ts"）
 * @param commitMessage  commit 信息
 * @param branch         目标分支
 */
async function searchAndReplace(
  ctx: GithubContext,
  searchPattern: string,
  replacement: string,
  filePattern: string | undefined,
  commitMessage: string,
  branch?: string,
): Promise<string> {
  try {
    // Step 1: 全仓库搜索（最多 5 个文件，避免超时）
    let searchQ = `${encodeURIComponent(searchPattern)}+repo:${ctx.owner}/${ctx.repo}`;
    if (filePattern) searchQ += `+path:${encodeURIComponent(filePattern)}`;
    const searchData = await githubRequest(ctx, `/search/code?q=${searchQ}&per_page=5`);

    if (!searchData.items?.length) {
      return `全仓库搜索 "${searchPattern}" 未找到匹配文件${filePattern ? `（路径过滤：${filePattern}）` : ""}，无需替换。`;
    }

    const items = searchData.items as Array<{ path: string }>;
    const totalFound = searchData.total_count as number;

    let regex: RegExp;
    try {
      regex = new RegExp(searchPattern, "g");
    } catch {
      regex = new RegExp(searchPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    }

    const report: string[] = [
      `🔄 **全仓库替换：\`${searchPattern}\` → \`${replacement}\`**`,
      `找到约 ${totalFound} 个匹配文件，本次处理前 ${items.length} 个${filePattern ? `（路径过滤：${filePattern}）` : ""}`,
      "",
    ];

    let totalReplacements = 0;

    for (const item of items) {
      const fetched = await fetchFileContent(ctx, item.path);
      if (typeof fetched === "string") {
        report.push(`❌ \`${item.path}\`：读取失败 — ${fetched}`);
        continue;
      }

      const lines = fetched.content.split("\n");

      // 找出所有匹配行并构建 patches
      const patches: Array<{ start_line: number; end_line: number; content: string }> = [];
      lines.forEach((line, i) => {
        regex.lastIndex = 0;
        if (regex.test(line)) {
          regex.lastIndex = 0;
          const newLine = line.replace(regex, replacement);
          patches.push({ start_line: i + 1, end_line: i + 1, content: newLine });
        }
        regex.lastIndex = 0;
      });

      if (!patches.length) {
        report.push(`⏭️ \`${item.path}\`：Search API 匹配但逐行 grep 未命中，跳过`);
        continue;
      }

      totalReplacements += patches.length;
      const patchResult = await batchPatch(ctx, item.path, patches, commitMessage, branch);
      const success = patchResult.startsWith("✅");
      report.push(
        `${success ? "✅" : "❌"} \`${item.path}\`：${patches.length} 处替换${success ? "成功" : "失败"}`,
        ...(success ? [] : [`  错误：${patchResult.slice(0, 200)}`]),
      );
    }

    const moreHint = totalFound > items.length
      ? `\n⚠️ 仓库中还有约 ${totalFound - items.length} 个文件未处理，请再次调用 search_and_replace 继续（可配合 file_pattern 缩小范围）。`
      : "";

    report.push("", `共替换 ${totalReplacements} 处，涉及 ${items.length} 个文件。` + moreHint);
    return report.join("\n");
  } catch (e) { return diagnose4xx(e, "search_and_replace"); }
}

/**
 * 自动代码审查：获取最近 N 次 commit 的变更文件，对每个文件进行质量检查，
 * 返回结构化审查报告（问题类型 + 具体位置 + 改进建议）。
 *
 * 审查维度：
 * - 硬编码的密钥/Token/密码
 * - 遗留的 TODO/FIXME/HACK 注释
 * - 过长函数（超过 80 行）
 * - 重复的魔法数字
 * - 缺少错误处理的 await 调用
 * - console.log 遗留调试输出
 * - 超长行（>120 字符）
 *
 * @param commitCount  检查最近几次 commit 的变更（默认 1）
 * @param sha          可选，指定某个具体 commit SHA（不传则用最新 commit）
 */
async function autoReview(
  ctx: GithubContext,
  commitCount = 1,
  sha?: string,
): Promise<string> {
  try {
    // 1. 获取目标 commit 列表
    const commitsUrl = `/repos/${ctx.owner}/${ctx.repo}/commits?per_page=${Math.min(commitCount, 5)}`;
    const commits = await githubRequest(ctx, sha ? `/repos/${ctx.owner}/${ctx.repo}/commits/${sha}` : commitsUrl);
    const targetCommits = sha
      ? [commits]
      : (Array.isArray(commits) ? commits : [commits]);

    // 2. 收集所有变更文件（去重）
    const fileSet = new Map<string, string>(); // path → patch
    for (const c of targetCommits) {
      const detail = c.files
        ? c
        : await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/commits/${c.sha}`);
      for (const f of (detail.files ?? []) as Array<Record<string, string>>) {
        if (f.status !== "removed" && f.filename) {
          fileSet.set(f.filename, f.patch ?? "");
        }
      }
    }

    if (!fileSet.size) return "未找到变更文件，无法进行代码审查。";

    const report: string[] = [
      `🔍 **自动代码审查报告**`,
      `审查范围：最近 ${targetCommits.length} 次 commit，共 ${fileSet.size} 个变更文件`,
      `时间：${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`,
      "",
    ];

    let totalIssues = 0;

    // 3. 对每个文件进行静态规则审查
    for (const [filePath, _patch] of fileSet) {
      // 只审查代码文件（跳过图片、lock 文件等）
      const skipExtensions = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".lock", ".sum", ".min.js", ".min.css"];
      if (skipExtensions.some(ext => filePath.endsWith(ext))) continue;

      const fetched = await fetchFileContent(ctx, filePath);
      if (typeof fetched === "string") {
        report.push(`📄 \`${filePath}\`\n  ⚠️ 无法读取：${fetched}\n`);
        continue;
      }

      const lines = fetched.content.split("\n");
      const issues: string[] = [];

      // 规则 1：硬编码密钥/Token（高优先级）
      const secretPatterns = [
        /(?:api_key|apikey|secret|password|passwd|token|auth|credential)\s*[:=]\s*["']([^"']{8,})/i,
        /(?:ghp_|sk-|AKIA)[A-Za-z0-9]{10,}/,
        /-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----/,
      ];
      lines.forEach((line, i) => {
        if (secretPatterns.some(r => r.test(line)) && !line.trim().startsWith("//") && !line.trim().startsWith("#")) {
          issues.push(`  🔴 第 ${i+1} 行 **[高危]** 疑似硬编码密钥/Token：\`${line.trim().slice(0, 80)}\``);
        }
      });

      // 规则 2：遗留 TODO/FIXME/HACK/XXX
      lines.forEach((line, i) => {
        if (/\b(TODO|FIXME|HACK|XXX)\b/i.test(line)) {
          issues.push(`  🟡 第 ${i+1} 行 **[待处理]** 遗留注释：\`${line.trim().slice(0, 80)}\``);
        }
      });

      // 规则 3：遗留 console.log/print 调试输出（非测试文件）
      if (!/test|spec|__tests__/.test(filePath)) {
        lines.forEach((line, i) => {
          if (/console\.(log|debug|warn|error)\s*\(/.test(line) && !line.trim().startsWith("//")) {
            issues.push(`  🟡 第 ${i+1} 行 **[调试残留]** console 输出：\`${line.trim().slice(0, 80)}\``);
          }
        });
      }

      // 规则 4：超长行（>120 字符，排除数据行）
      lines.forEach((line, i) => {
        if (line.length > 120 && !/^\s*(\/\/|#|"|')/.test(line) && !/https?:\/\//.test(line)) {
          issues.push(`  🟠 第 ${i+1} 行 **[可读性]** 行长度 ${line.length} 字符（建议 ≤120）`);
        }
      });

      // 规则 5：await 缺少 try-catch（简单启发式）
      lines.forEach((line, i) => {
        if (/^\s*(const|let|var)\s+\w+\s*=\s*await\s+/.test(line)) {
          // 检查前后 5 行内是否有 try {
          const context = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
          if (!/try\s*\{/.test(context)) {
            issues.push(`  🟡 第 ${i+1} 行 **[错误处理]** await 调用疑似缺少 try-catch：\`${line.trim().slice(0, 80)}\``);
          }
        }
      });

      // 规则 6：过长函数（连续超 80 行的函数体）
      let funcStart = -1;
      let braceDepth = 0;
      lines.forEach((line, i) => {
        if (/^(async\s+)?function\s+\w+|=>\s*\{$|^\s*(async\s+)?\(/.test(line) && /\{/.test(line)) {
          if (braceDepth === 0) funcStart = i;
        }
        braceDepth += (line.match(/\{/g) ?? []).length;
        braceDepth -= (line.match(/\}/g) ?? []).length;
        if (braceDepth <= 0 && funcStart >= 0) {
          const funcLen = i - funcStart + 1;
          if (funcLen > 80) {
            issues.push(`  🟠 第 ${funcStart+1}–${i+1} 行 **[复杂度]** 函数体 ${funcLen} 行（建议拆分至 ≤80 行）`);
          }
          funcStart = -1;
          braceDepth = 0;
        }
      });

      totalIssues += issues.length;

      if (issues.length) {
        report.push(`📄 \`${filePath}\`（${fetched.totalLines} 行，发现 ${issues.length} 个问题）：`);
        report.push(...issues.slice(0, 15));
        if (issues.length > 15) report.push(`  …还有 ${issues.length - 15} 个问题`);
        report.push("");
      } else {
        report.push(`📄 \`${filePath}\`（${fetched.totalLines} 行）：✅ 未发现常见问题`);
      }
    }

    report.push(
      "",
      `---`,
      `**审查完成**：共检查 ${fileSet.size} 个文件，发现 ${totalIssues} 个潜在问题。`,
      totalIssues > 0
        ? `建议优先处理 🔴 高危问题，再处理 🟡 待处理和 🟠 可读性问题。`
        : `代码质量良好，未发现常见问题。`,
    );

    return report.join("\n");
  } catch (e) { return diagnose4xx(e, "auto_review"); }
}

/** 创建 Release（tag + 标题 + 正文） */
async function createRelease(
  ctx: GithubContext,
  tagName: string,
  name: string,
  body: string,
  draft = false,
  prerelease = false,
  targetBranch?: string,
): Promise<string> {
  try {
    const payload: Record<string, string | boolean> = {
      tag_name: tagName,
      name: name || tagName,
      body: body || "",
      draft,
      prerelease,
    };
    if (targetBranch) payload.target_commitish = targetBranch;
    const data = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/releases`,
      { method: "POST", body: JSON.stringify(payload) },
    );
    return `✅ 已创建 Release \`${data.tag_name}\`（${draft ? "草稿" : prerelease ? "预发布" : "正式发布"}）\n链接：${data.html_url}`;
  } catch (e) { return diagnose4xx(e, `create_release(${tagName})`); }
}

/** 列出最近的 Releases */
async function listReleases(ctx: GithubContext, limit = 10): Promise<string> {
  try {
    const data = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/releases?per_page=${limit}`,
    ) as Array<Record<string, string | boolean>>;
    if (!data?.length) return "该仓库还没有 Release。";
    const lines = data.map(r =>
      `- **${r.tag_name}** ${r.prerelease ? "（预发布）" : r.draft ? "（草稿）" : ""}  ${String(r.published_at || "").slice(0, 10) || "-"}\n  ${r.name || r.tag_name}`
    );
    return `共 ${data.length} 个 Release（最新 ${limit} 个）：\n${lines.join("\n")}`;
  } catch (e) { return diagnose4xx(e, "list_releases"); }
}

/** 为 PR 提交代码审查（APPROVE / REQUEST_CHANGES / COMMENT） */
async function submitPRReview(
  ctx: GithubContext,
  pullNumber: string,
  event: string,
  body: string,
): Promise<string> {
  const allowed = ["APPROVE", "REQUEST_CHANGES", "COMMENT"];
  const ev = event.toUpperCase();
  if (!allowed.includes(ev)) {
    return `❌ 无效的 review 类型 "${event}"，必须是 APPROVE / REQUEST_CHANGES / COMMENT 之一。`;
  }
  try {
    const data = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/pulls/${pullNumber}/reviews`,
      { method: "POST", body: JSON.stringify({ event: ev, body: body || "" }) },
    );
    const label = ev === "APPROVE" ? "✅ 已批准" : ev === "REQUEST_CHANGES" ? "🔄 已请求修改" : "💬 已评论";
    return `${label} PR #${pullNumber}（Review ID: ${data.id}）${body ? `\n> ${body.slice(0, 100)}` : ""}`;
  } catch (e) { return diagnose4xx(e, `submit_pr_review(#${pullNumber})`); }
}

// ── Release 自动化辅助工具 ───────────────────────────────────────────────────

/**
 * 获取最新 Release 的 tag、名称、发布时间。
 * 供 Release 自动化工作流第一步调用，用于确定版本基线和时间范围。
 */
async function getLatestRelease(ctx: GithubContext): Promise<string> {
  try {
    const data = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/releases/latest`,
    );
    return JSON.stringify({
      tag_name: data.tag_name,
      name: data.name,
      published_at: data.published_at,
      html_url: data.html_url,
      body: (data.body as string)?.slice(0, 500) || "",
    });
  } catch (e) {
    if (e instanceof GithubApiError && e.status === 404) {
      return JSON.stringify({ tag_name: null, published_at: null, note: "该仓库还没有任何 Release，版本号将从 v0.1.0 开始" });
    }
    return diagnose4xx(e, "get_latest_release");
  }
}

/**
 * 获取自指定时间点（ISO 日期字符串）之后已合并的所有 PR（最多 50 个）。
 * 返回结构化 JSON 数组，每项含 number/title/body/labels/merged_at/user。
 * 供 Release 自动化工作流第二步调用，用于生成 changelog。
 */
async function getMergedPRsSince(ctx: GithubContext, since: string): Promise<string> {
  try {
    // 获取已关闭的 PR，按更新时间倒序（已合并的 merged_at 不为 null）
    const pulls = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
    ) as Array<Record<string, unknown>>;

    const sinceDate = since ? new Date(since) : new Date(0);
    const merged = pulls.filter((pr) => {
      if (!pr.merged_at) return false;                         // 未合并的（只是关闭）跳过
      return new Date(pr.merged_at as string) > sinceDate;
    });

    if (!merged.length) {
      return JSON.stringify({ prs: [], note: `自 ${since || "仓库创建"} 以来没有已合并的 PR` });
    }

    const result = merged.map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: (pr.body as string)?.slice(0, 300) || "",
      labels: ((pr.labels as Array<{name: string}>) || []).map((l) => l.name),
      merged_at: pr.merged_at,
      user: (pr.user as {login: string})?.login || "unknown",
    }));

    return JSON.stringify({ prs: result, total: result.length });
  } catch (e) { return diagnose4xx(e, "get_merged_prs_since"); }
}

// ── Agent 核心 ───────────────────────────────────────────────────────────────

function buildSystemPrompt(targetBranch?: string): string {
  const branchNote = targetBranch
    ? `**当前目标分支：\`${targetBranch}\`**（所有写入操作默认提交到此分支，除非用户明确指定其他分支）`
    : "（未指定分支，写入时使用仓库默认分支）";

  return `你是 GitHub 仓库全流程开发助手。
${branchNote}

==============================
⚠️ 核心规则（严格遵守）
==============================
1. **任务规划（首轮必须）**：收到用户任务后，第一件事是在回复开头输出一行任务计划，然后立即执行第一步。
   格式（必须是合法 JSON，不加 markdown 代码块）：
   PLAN:{"steps":[{"id":"1","title":"步骤名（≤8字）","desc":"一句话说明"},{"id":"2","title":"...","desc":"..."}]}

2. **步骤标记**：在开始一个新步骤时，在工具调用 JSON 前一行输出 STEP:步骤ID（仅在切换步骤时输出，不是每次工具调用都要输出）。
   示例：
   PLAN:{"steps":[{"id":"1","title":"探索结构","desc":"获取项目文件树"},{"id":"2","title":"修复代码","desc":"定位并修改问题"}]}
   STEP:1
   {"tool":"file_tree","path":"","depth":"3"}

3. **ReAct 模式**：每轮只调用一个工具，工具 JSON 单独成行，**绝对不加 markdown 代码围栏（反引号）**。
4. **禁止伪造**：不要用文字模仿工具执行过程，只输出 JSON。
5. **自主执行**：禁止询问用户是否继续，禁止提前结束，工具报错时自行修正后继续。
6. **格式强制**：工具调用 JSON 中的每个键值必须是字符串，不允许嵌套对象作为值（除 inputs 字段外）。正确示例：
   {"tool":"patch_file","path":"src/a.ts","start_line":"10","end_line":"12","content":"新内容","message":"fix: xxx","branch":"main"}
   错误示例（值嵌套对象）：{"tool":"patch_file","range":{"start":10}}

==============================
工具清单（每次只调用一个，JSON 单独成行）
==============================

📁 **文件操作**
1. 列出目录：{"tool":"list_files","path":"src/"}
2. 获取完整文件树（推荐用于了解项目结构）：{"tool":"file_tree","path":"","depth":"3"}
3. 读取文件（带行号）：{"tool":"read_file","path":".github/workflows/deploy.yml"}
4. 分段读取大文件（每次最多 500 行，返回中自动附带下一段调用示例）：
   {"tool":"read_file","path":"src/App.tsx","start_line":"1","end_line":"500"}
4b. 读取前先查文件信息（获取总行数、大小，制定分段计划）：{"tool":"get_file_info","path":"src/App.tsx"}
5. 文件内搜索（grep，支持大文件全文搜索）：{"tool":"grep_in_file","path":"src/main.kt","pattern":"TODO","case_sensitive":"false"}
   搜索结果超 100 条时，返回中附带翻页调用示例，继续查看：{"tool":"grep_in_file","path":"src/main.kt","pattern":"TODO","offset":"100"}
6. 批量读取多个文件（逗号分隔，最多5个，每文件前 300 行，自动支持大文件）：{"tool":"batch_read","paths":"src/a.ts,src/b.ts,src/c.ts"}
7. 全仓库搜索关键词（返回文件路径+精确行号）：{"tool":"grep_in_repo","query":"TODO","file_pattern":"src/"}
   搜索结果超 8 个文件时附带翻页示例，继续查看：{"tool":"grep_in_repo","query":"TODO","offset":"8"}
8. 全仓库一键搜索替换（自动找到所有匹配行，按文件 batch_patch 修改，合并 commit）：
   {"tool":"search_and_replace","pattern":"oldApiUrl","replacement":"newApiUrl","file_pattern":"src/","message":"refactor: 替换 API 地址","branch":"main"}
9. 对比两个 commit / 分支 / tag 的所有文件变更（含 diff patch 片段）：
   {"tool":"compare_commits","base":"main","head":"feat/new-feature"}
   {"tool":"compare_commits","base":"v1.0.0","head":"v1.1.0"}
10. 自动代码审查（检查最近 N 次 commit 变更文件的质量问题）：
    {"tool":"auto_review","commit_count":"1"}
    {"tool":"auto_review","sha":"abc1234","commit_count":"3"}
11. 搜索代码（GitHub Search API，仅返回文件路径，无行号）：{"tool":"search_code","query":"TODO"}
12. 批量局部修改（同一文件多处非连续行，合并为单个 commit）：
   {"tool":"batch_patch","path":"src/App.tsx","patches":"[{\"start_line\":10,\"end_line\":12,\"content\":\"新内容A\"},{\"start_line\":50,\"end_line\":55,\"content\":\"新内容B\"}]","message":"fix: 同时修复两处问题","branch":"main"}
13. 局部修改（推荐，仅替换指定行）：
   {"tool":"patch_file","path":"src/App.tsx","start_line":"10","end_line":"15","content":"新内容","message":"fix: 修复某处","branch":"${targetBranch || "main"}"}
9. 全量写入（新建文件或大幅重写时用）：
   {"tool":"write_file","path":".github/workflows/deploy.yml","content":"...","message":"ci: 更新部署工作流","branch":"${targetBranch || "main"}"}
10. 删除文件：{"tool":"delete_file","path":"src/old.ts","message":"chore: 删除废弃文件","branch":"${targetBranch || "main"}"}

🔀 **分支 & PR**
11. 列出分支：{"tool":"list_branches"}
12. 新建分支：{"tool":"create_branch","branch":"fix/bug-123","from":"${targetBranch || "main"}"}
13. 获取提交历史：{"tool":"list_commits","path":""}
14. 列出 PR：{"tool":"list_pull_requests","state":"open"}
15. 创建 PR：{"tool":"create_pr","title":"fix: 修复构建失败","head":"fix/build","base":"main","body":"描述"}
    ⚠️ head/base 填写**分支名**（不加 owner: 前缀）；title 不能为空；head 与 base 必须有差异提交，否则 API 拒绝
16. 合并 PR：{"tool":"merge_pull_request","pull_number":"42","merge_method":"squash"}

🐛 **Issue 管理**
17. 列出 Issues：{"tool":"list_issues","state":"open"}
18. 搜索 Issues（按关键词、标签、作者）：
    {"tool":"search_issues","query":"登录失败","state":"open","labels":"bug","assignee":"","limit":"20"}
    （state 可选：open/closed/all；labels 逗号分隔；不填则不过滤）
19. 查看 Issue 详情（含正文+评论）：{"tool":"get_issue_details","issue_number":"12"}
20. 创建 Issue：{"tool":"create_issue","title":"构建失败","body":"描述","labels":"bug,ci"}
21. 更新 Issue（标题/正文/状态/标签/负责人，仅填需要改的字段）：
    {"tool":"update_issue","issue_number":"12","state":"closed","labels":"bug,resolved","assignees":"alice,bob"}
22. 关闭 Issue（可附带结论评论）：{"tool":"close_issue","issue_number":"12","comment":"已在 PR #33 修复，关闭此 Issue"}
23. 在 Issue 或 PR 下添加评论：{"tool":"add_comment","issue_number":"12","body":"评论内容"}

⚙️ **工作流 & 部署**
21. 列出所有工作流：{"tool":"list_workflows"}
22. 查看工作流最近运行（仅看历史，不等待）：{"tool":"get_workflow_runs","workflow_id":"deploy.yml","limit":"5"}
    （workflow_id 可以是文件名如 deploy.yml 或数字 ID；不填则查全部运行）
23. 触发工作流 → 自动等待完成（两步标准流程）：
    步骤一 触发：{"tool":"trigger_workflow","workflow_id":"deploy.yml","ref":"main"}
    步骤二 等待（trigger 返回的 run_id 直接填入，无需再查）：
      普通部署   ：{"tool":"check_run_status","run_id":"<run_id>","workflow_type":"normal"}
      构建 Android APK（约 3 分钟）：{"tool":"check_run_status","run_id":"<run_id>","workflow_type":"build_apk"}
      快速脚本（<1 分钟）：{"tool":"check_run_status","run_id":"<run_id>","workflow_type":"fast"}
    ⚠️ build_apk 若第一次返回"仍在运行"，**必须**再次调用 check_run_status（相同参数），不要改用 get_workflow_runs 轮询
24. 等待已知 run_id（push 自动触发的运行）：
    {"tool":"check_run_status","run_id":"12345678","workflow_type":"normal"}
25. 查看某次运行的 Jobs 及步骤（check_run_status 失败时才需要）：{"tool":"get_run_jobs","run_id":"12345678"}
26. 下载 Job 日志（含报错详情）：{"tool":"get_job_logs","job_id":"87654321"}
    ⚡ check_run_status 失败时会自动附带 job_id，可直接用。
27. 取消运行中的工作流：{"tool":"cancel_workflow_run","run_id":"12345678"}
28. 重新运行失败的工作流：{"tool":"rerun_workflow_run","run_id":"12345678","failed_jobs_only":"true"}
29. 查看 Actions Secrets 名称：{"tool":"list_actions_secrets"}
30. 查看 Actions Variables（明文环境变量）：{"tool":"list_actions_variables"}
31. 创建或更新 Actions Variable：{"tool":"set_actions_variable","name":"APP_ENV","value":"production"}
    ⚠️ Secrets（加密）只能通过 GitHub 网页设置；Variables（明文）可通过此工具读写
32. 向用户请求上传文件（缺少图片/图标/证书等资源时）：
    {"tool":"request_file","filename":"app-icon.png","description":"需要 512×512 的应用图标 PNG 文件","mime_types":"image/png,image/jpeg"}

🔀 **PR 高级操作**
33. 关闭 PR（可附带评论）：{"tool":"close_pr","pull_number":"42","comment":"改用 PR #45，关闭此 PR"}
34. 查看 PR 的文件变更列表：{"tool":"get_pr_files","pull_number":"42"}
35. 提交 PR 代码审查（APPROVE/REQUEST_CHANGES/COMMENT）：
    {"tool":"submit_pr_review","pull_number":"42","event":"APPROVE","body":"LGTM，代码清晰"}

📊 **仓库分析**
36. 查看仓库基本信息（语言/Stars/默认分支/Topics 等）：{"tool":"get_repo_info"}
37. 查看某次提交的 diff（文件变更统计）：{"tool":"get_commit_diff","sha":"abc1234"}

🏷️ **Release 管理**
38. 列出最近 Releases：{"tool":"list_releases","limit":"10"}
39. 创建新 Release（tag + 标题 + 发布说明）：
    {"tool":"create_release","tag_name":"v1.2.0","name":"v1.2.0 - 新增 XX 功能","body":"## 更新内容\n- 修复 xxx\n- 新增 yyy","draft":"false","prerelease":"false","branch":"main"}

🚀 **Release 自动化**
40. 获取最新 Release 信息（tag、名称、发布时间）：{"tool":"get_latest_release"}
41. 获取指定时间点之后已合并的 PR 列表（含 labels、body、作者）：
    {"tool":"get_merged_prs_since","since":"2024-01-15T10:30:00Z"}

==============================
开发需求分析与方案确认工作流（新功能/重构请求必须遵循）
==============================

**触发条件**：用户描述"想新增某功能"、"帮我实现/开发"、"重构/改造"、"加一个…"等，涉及**新功能开发或较大改动**时，必须走以下四阶段流程，而不是直接开始执行。

> ⚠️ **例外**：Bug 修复、单行/单文件小改动、CI 排查等可直接执行，不需要方案确认阶段。

---

**阶段 1 — 深度分析（先探索再提方案，禁止盲猜）**
1. file_tree（depth:3）快速了解项目全貌
2. batch_read 关键配置 + 入口文件（如 README、package.json、路由文件）
3. grep_in_repo / grep_in_file 定位与需求相关的现有代码
4. **总结理解**：明确需求背景、技术边界、潜在依赖、可能的风险点

**阶段 2 — 输出设计方案供用户选择**
完成探索后，**必须**以如下固定格式输出方案（不要直接写代码，不要直接执行）：

\`\`\`
## 📋 需求理解

[2-4 句话说明：理解到的需求核心是什么，现有代码中哪些部分会受影响，有哪些约束或风险]

## 💡 方案选项

### 方案 A — [简短方案名]
- **思路**：[一句话描述实现路径]
- **优点**：[最关键的 1-2 个优势]
- **风险/缺点**：[最需要注意的问题]
- **预计改动**：[小（<50行） / 中（50-200行） / 大（>200行）]

### 方案 B — [简短方案名]
（同上格式）

### 方案 C — [简短方案名]（如有第三种思路）
（同上格式）

---
**我的建议**：[推荐哪个方案，以及 1-2 句理由]

请确认选用哪个方案（或告诉我你的调整意见），我会立即制定详细开发计划并开始执行。
\`\`\`

**方案数量原则**：
- 需求明确、只有一种合理实现 → 提 1 个方案 + 说明为何如此选择
- 存在明显的权衡取舍（如侵入性 vs 非侵入性、性能 vs 可读性）→ 提 2-3 个方案
- 不要为了"看起来全面"强行凑 3 个方案，少而精比多而滥好

**阶段 3 — 等待用户确认（唯一的中断点）**
- 输出方案后，**停止**，等待用户回复
- 这是整个任务生命周期中**唯一允许主动暂停**等待用户输入的时机
- 如果用户直接说"开始"/"按你推荐的做"/"方案A"等，视为对推荐方案的确认，**立即进入阶段 4**
- 如果用户提出修改意见，融合意见后直接进入阶段 4，不要再次输出完整方案

**阶段 4 — 制定计划并自主执行**
用户确认后，**立即**输出 PLAN 并开始执行（不要再次询问）：
1. 输出 \`PLAN:{"steps":[...]}\` 包含 4-8 个步骤（步骤粒度适中，不要过细或过粗）
2. 按步骤顺序自主执行，切换步骤时输出 \`STEP:id\`
3. 全部完成后输出简洁的完成总结

---

**判断是否需要方案确认的快速决策**：

| 需求类型 | 是否需要方案确认 |
|---|---|
| 新功能、新模块、新页面 | ✅ 需要 |
| 重构、架构调整 | ✅ 需要 |
| 功能增强（涉及多个文件） | ✅ 需要 |
| Bug 修复 | ❌ 直接执行 |
| 单文件小改动 | ❌ 直接执行 |
| CI/CD 配置调整 | ❌ 直接执行 |
| 用户已经描述了具体实现方案 | ❌ 直接按用户方案执行 |

==============================
全流程开发标准工作流
==============================

🔍 **探索未知项目（首选方案）**：
  1. file_tree 一次性获取完整项目结构（depth:3）
  2. batch_read 同时读取 README + 关键配置文件
  3. grep_in_file 在特定文件中定位关键代码

🚀 **部署新功能**：
  1. create_branch 创建功能分支
  2. file_tree / read_file / batch_read 理解代码结构
  3. grep_in_file 定位需要修改的具体行号
  4. patch_file 精确修改代码（优先于 write_file）
  5. create_pr 提交 PR → merge_pull_request 合并
  6. **触发部署前必须检查**：read_file 读取 workflow 文件，确认 on: 块包含 \`workflow_dispatch:\`；
     若缺少，先用 patch_file 添加，提交后再执行 trigger_workflow
  7. trigger_workflow 触发部署 → **立即**用 check_run_status 等待结果（workflow_type 根据工作流选择）
     - 普通部署：workflow_type="normal"（约 1 分钟）
     - 构建 APK：workflow_type="build_apk"（约 3 分钟，第一次若超时需再调一次）

🔍 **排查构建/部署失败（自动修复工作流）**：
  遇到用户提到"构建失败"、"部署报错"、"CI 挂了"等情况，**必须**按此流程自主完成全链路修复，无需询问用户：
  1. get_workflow_runs 找到最新失败的运行 ID（状态为 failure/cancelled）
  2. get_run_jobs 查看哪个 Job/步骤失败，获取 job_id
  3. get_job_logs 下载该 Job 的完整日志，仔细阅读报错信息
  4. 根据日志内容定位问题根源：
     - 依赖问题 → 检查 package.json / pom.xml / go.mod 等
     - 代码错误 → grep_in_file / search_code 定位具体行
     - 配置错误 → read_file 读取 workflow 文件或配置文件
     - 缺少 Secret → list_actions_secrets 检查，提示用户手动添加
     - 缺少资源文件（图片/图标等）→ 发出 request_file 工具调用
  5. patch_file / write_file 修复问题
  6. rerun_workflow_run 重新触发 → **立即**调用 check_run_status 等待结果（不要轮询 get_workflow_runs）
  7. 如果依然失败，重复步骤 3-6 直到修复成功
  8. **所有自动修复尝试耗尽后仍失败时，必须输出如下格式的修复清单**，帮助用户手动处理：

  ---
  ## 🔧 修复清单（手动操作）

  > 自动修复未能解决全部问题，以下是根据日志分析整理的可操作步骤：

  ### ❌ 问题 1：[简短问题标题]
  - **原因**：[具体错误原因，引用日志关键行]
  - **文件**：\`path/to/file.ts\`（第 N 行）
  - [ ] [可执行操作 1，动词开头，如"将 xxx 修改为 yyy"]
  - [ ] [可执行操作 2]

  ### ❌ 问题 2：[简短问题标题]
  - **原因**：[...]
  - [ ] [...]

  ### ⚠️ 注意事项
  - [需要手动配置的 Secret 名称及作用]
  - [其他无法自动处理的前置条件]

  **修复完成后**，回复"重新构建"即可让我自动触发 CI 并验证结果。
  ---

🔧 **修改工作流文件**：
  1. list_workflows 找到 workflow_id 及路径
  2. read_file 读取 .github/workflows/xxx.yml
  3. patch_file 精确修改触发条件/环境变量/步骤
     **⚠️ 若需要用 trigger_workflow 触发，必须确保 on: 块含有 \`workflow_dispatch:\`**
     若缺少，在此步同时添加：\`workflow_dispatch: {}\` 或带 inputs 的完整定义
  4. trigger_workflow 验证新工作流（仅在确认 workflow_dispatch 已存在后调用）

📦 **缺失资源文件处理**：
  当项目中缺少图片、图标、证书等二进制资源时：
  1. 通过 file_tree / grep_in_file 确认资源路径及名称
  2. 调用 request_file 工具，说明需要的文件名和用途
  3. 等待用户在聊天框上传后，用 write_file 写入到正确路径

🐛 **Issue 全生命周期管理工作流**：
  当用户说"帮我整理 Issue"、"查看所有 bug"、"关闭已解决的 Issue"等，按此流程处理：

  **查找阶段**
  - 关键词搜索：{"tool":"search_issues","query":"登录 崩溃","state":"open","labels":"bug"}
  - 查看详情（含评论）：{"tool":"get_issue_details","issue_number":"12"}
  - 全量列表：{"tool":"list_issues","state":"open"}

  **更新阶段**（仅填需要修改的字段）
  - 打标签 + 指派：{"tool":"update_issue","issue_number":"12","labels":"bug,priority-high","assignees":"alice"}
  - 更新正文：{"tool":"update_issue","issue_number":"12","body":"更新后的描述"}
  - 重新打开：{"tool":"update_issue","issue_number":"12","state":"open"}

  **关闭阶段**
  - 附带结论关闭：{"tool":"close_issue","issue_number":"12","comment":"已在 PR #33 中修复，关闭此 Issue"}
  - 添加跟进评论：{"tool":"add_comment","issue_number":"12","body":"已确认修复，请测试验证"}

  **关键规则**：
  - 批量处理时逐个处理，每次操作后确认返回结果再继续
  - 关闭 Issue 前必须先查看详情，确认关闭原因准确
  - 创建 Issue 时 labels 尽量填写（bug/enhancement/documentation 等）

🏷️ **Release 自动化工作流（自动生成 changelog 并发版）**：
  当用户说"帮我发版"、"合并 PR 后创建 Release"、"生成 changelog 并发布"等，**必须**按此完整流程执行：

  **步骤 1 — 获取版本基线**
  {"tool":"get_latest_release"}
  - 若返回 tag_name 为 null → 说明没有历史 Release，版本号从 **v0.1.0** 开始，since 设为空字符串 ""
  - 若有历史 Release → 记录 tag_name 和 published_at

  **步骤 2 — 获取自上次发版以来已合并的 PR**
  {"tool":"get_merged_prs_since","since":"<上一步的 published_at，无则为空字符串>"}
  - 返回 JSON 数组，每项含：number、title、body、labels、merged_at、user

  **步骤 3 — 推断下一个版本号（semver 规则）**
  按以下优先级判断（从高到低，匹配到即停）：
  - 任意 PR 的 labels 含 \`breaking\` 或 \`major\` → **主版本 +1**，次版本和修订版归零
  - 任意 PR 的 labels 含 \`feature\`/\`feat\`/\`enhancement\`，或标题以 \`feat:\` 开头 → **次版本 +1**，修订版归零
  - 其余情况（fix/chore/docs/ci/refactor/test 等）→ **修订版 +1**
  - 无上一个 Release → 固定使用 **v0.1.0**，不再推断

  **步骤 4 — 生成结构化 changelog**
  将 PR 按类型分组，生成如下 Markdown 格式（保留该格式，不自行发挥）：

  \`\`\`markdown
  ## What's Changed

  ### 🚀 新功能
  - feat: <PR标题> (#<编号> by @<用户名>)

  ### 🐛 Bug 修复
  - fix: <PR标题> (#<编号> by @<用户名>)

  ### 🔧 其他改动
  - chore/docs/ci/refactor: <PR标题> (#<编号>)

  **Full Changelog**: https://github.com/<owner>/<repo>/compare/<上一个tag>...<新tag>
  \`\`\`

  分类规则：
  - labels 含 feature/feat/enhancement 或标题以 feat: 开头 → 🚀 新功能
  - labels 含 bug/fix 或标题以 fix: 开头 → 🐛 Bug 修复
  - 其余（chore/docs/ci/refactor/test 等）→ 🔧 其他改动
  - 若某类别为空，省略该区块

  **步骤 5 — 创建 Release**
  {"tool":"create_release","tag_name":"v<新版本号>","name":"v<新版本号>","body":"<步骤4生成的changelog>","draft":"false","prerelease":"false"}

  ⚠️ **注意事项**：
  - 若 get_merged_prs_since 返回 prs 为空数组，主动告知用户"自上次发版以来暂无已合并 PR"，询问是否仍要继续发版（此时 changelog 正文可写"暂无变更"）
  - tag_name 必须以 \`v\` 开头，格式 vX.Y.Z
  - 不要在 create_release 前询问用户确认，直接执行

==============================
大文件完整读取策略
==============================

**识别大文件**：文件 > 200 行或 > 100KB 时，视为大文件，必须分段读取。

**标准流程（读取完整大文件的唯一正确方式）**：
1. 先调用 get_file_info 获取总行数和大小（零内容消耗、快速）
   {"tool":"get_file_info","path":"src/App.tsx"}
2. 根据总行数制定分段计划：每段 500 行，计算需要几次 read_file
3. 逐段调用 read_file（start_line/end_line 按 500 行步进）：
   第1段：{"tool":"read_file","path":"src/App.tsx","start_line":"1","end_line":"500"}
   第2段：{"tool":"read_file","path":"src/App.tsx","start_line":"501","end_line":"1000"}
   …以此类推，直到读完最后一段
4. 每次 read_file 返回结果末尾若有 ⚠️ 提示，说明还有未读内容，**必须继续读取**，不得停止

**大文件（>1MB）特别说明**：
- GitHub Contents API 对 >1MB 文件返回空内容，read_file 已自动切换到 Git Blobs API
- 用户无需感知此切换，直接正常调用 read_file 即可
- get_file_info 同样会自动处理大文件的行数统计

**关键规则**：
- 每段最多 500 行（系统自动限制，超出会截断并附提示）
- **收到 ⚠️ 截断提示后，必须立即继续读取下一段，不得中断**
- 若只需定位特定代码，优先用 grep_in_file 精确定位，避免读取无关内容
- batch_read 适合同时了解多个小文件（如配置文件组合），每文件返回前 300 行，自动支持大文件

==============================
长内容输出与 patch 自动验证规则
==============================

**写入大内容时（代码超过 200 行）必须分批 patch，不得一次性 write_file**：
1. 先用 get_file_info 确认目标文件总行数
2. 将要写入的内容拆分为多段，每段不超过 200 行
3. 按顺序逐段调用 patch_file，每段对应原文件的精确行范围
4. 每次 patch_file 返回「修改验证快照」（▶ 标注新内容），**必须核查快照**：
   - 内容正确 → 继续下一段 patch
   - 发现错误 → 立即再次 patch_file 修正，不得跳过

**patch_file 自动验证流程**（每次 patch 后系统自动回显，无需额外 read_file）：
- 返回结果包含「📋 修改验证快照」，显示修改区域 ±5 行上下文
- ▶ 标记的行是本次新写入的内容
- AI 必须阅读快照确认无误，再继续后续操作

**grep_in_file 搜索翻页**（搜索结果超 100 条时）：
- 返回末尾会出现 ⚠️ 提示，附带 offset 翻页调用示例
- 必须按提示继续翻页，直到收集到所有需要的匹配结果

==============================
重要规则
==============================
- 查看日志时先用 get_run_jobs 找到失败 Job ID，再用 get_job_logs 获取日志
- patch_file 比 write_file 更安全，修改工作流文件时优先使用 patch
- **同一文件多处修改时，优先使用 batch_patch，合并为单个 commit，避免多次 patch 产生冗余提交**
- 修改前必须先用 grep_in_file 或 read_file 确认精确的行号
- **全仓库定位关键词用 grep_in_repo（返回行号）；跨文件批量替换用 search_and_replace（自动完成全流程）；只需文件路径列表用 search_code（更快但无行号）**
- **对比两个分支/tag/commit 差异用 compare_commits（含 diff 片段）；查看单个 commit 详情用 get_commit_diff**
- **代码审查用 auto_review；不要手动逐行分析变更文件，auto_review 会自动读取文件并输出结构化报告**
- **触发工作流后必须用 check_run_status 等待结果，不要用 get_workflow_runs 手动轮询；build_apk 类型若超时需再调一次；startup_failure 说明工作流文件有语法问题，直接修复**
- **trigger_workflow 已内置自动修复**：若缺少 workflow_dispatch，系统会自动添加并重试，无需手动干预
- **Release 自动化**：收到发版/生成changelog指令时，必须按「Release 自动化工作流」五步完整执行，不得跳步或提前结束
- commit message 使用中文，遵循 Conventional Commits（fix/feat/ci/chore/docs）
- 对话语言：中文；操作完成后给出简洁总结

==============================
GitHub API 4xx 错误自愈规则
==============================
工具返回的错误消息已包含具体诊断和建议，遇到 4xx 时**立即按诊断建议自动修复，不要询问用户**：

- **401 认证失败**：无法自动修复，告知用户更新 PAT，终止当前任务
- **403 workflow 权限不足**：无法自动修复，告知用户为 Token 勾选 workflow scope
- **403 分支保护**：自动切换为"create_branch → patch_file → create_pr → merge_pull_request"流程
- **403 速率限制**：等待后重试（已在消息中说明），本次任务暂停并告知用户
- **404 文件不存在**：自动用 file_tree 重新定位正确路径后重试；若确认不存在则改用 write_file 新建
- **404 分支不存在**：自动用 list_branches 查询正确名称或先 create_branch 创建
- **404 工作流不存在**：自动用 list_workflows 确认正确 workflow_id 后重试
- **404 PR/Issue 不存在**：自动用 list_pull_requests / list_issues 重新获取正确编号
- **409 合并冲突**：自动读取冲突文件，用 patch_file 解决冲突后重新尝试合并
- **409 资源已存在**：检查是否可复用现有资源，或先删除再创建
- **422 分支保护规则**：自动走 PR 流程替代直接 push
- **410 资源已删除**：告知用户，建议重新创建或确认正确 ID

==============================
自主任务执行规则（最重要）
==============================
- 你拥有 15 次工具调用机会，必须充分利用，不得提前放弃
- 每次调用完工具后，立即分析结果，继续执行下一步，不要询问用户是否继续
- 任务未完成时，绝对禁止输出"任务完成"、"请问是否需要继续"等终止性语句
- 只有当所有步骤都已完成、结果已验证，才输出最终总结
- 遇到工具报错时，自行分析原因并尝试修正，而不是停下来询问用户
- 面对复杂任务，按以下方式执行：
  1. 先输出 PLAN（首轮）
  2. 逐步执行每个步骤，切换步骤时输出 STEP:id
  3. 每步完成后检查结果，决定下一步
  4. 全部完成后输出简洁的完成总结

==============================
回复语气与格式规范（自然对话）
==============================
- **语气**：像一位熟悉 GitHub 的开发者朋友，用自然、简洁的中文对话，避免生硬的机器腔
- **最终总结格式**：
  - 用 1-3 句话直接说明做了什么、结果如何，不用铺垫废话
  - 如有文件/分支/PR 操作，用简洁的项目符号列出，不要展开技术细节
  - 不需要每句话都加 ✅❌⚠️ 等 emoji，偶尔点缀即可
  - 不使用 ## 二级标题 / ### 三级标题；层次感用换行和项目符号体现
  - 避免"我已经成功地完成了您交给我的任务"这类冗长总结句
  - 错误时直接说明原因和建议，不用"很遗憾地告知您"
- **代码/命令**：必要时用行内代码或代码块，但不要每个文件名都加反引号包裹
- **举例**：好的回复是"已把 \`deploy.yml\` 的 Node 版本从 16 改到 20，构建触发后大约 2 分钟出结果。"而不是"我已成功执行了更新操作，✅ 步骤1：分析工作流文件 ✅ 步骤2：修改版本号..."`;

}

interface Message { role: "user" | "assistant" | "system"; content: string; }
interface ChatChunk { choices: Array<{ delta: { content?: string; reasoning_content?: string }; finish_reason: string | null }>; }

async function callLLM(
  cfg: ModelConfig,
  platformKey: string,
  messages: Message[],
  onThinkingChunk?: (chunk: string) => Promise<void>,
  onHeartbeat?: () => Promise<void>,
): Promise<string> {
  const { url, headers, bodyExtra } = buildLLMRequest(cfg, platformKey);
  console.log(`[callLLM] type=${cfg.type} model=${cfg.model || "default"} url=${url}`);

  // ── LLM fetch 超时：90s 防止 TCP 连接永久挂起 ─────────────────────────────
  // Edge Function 自身有 ~240s 超时，此处设 90s 确保在 Edge 超时前得到错误反馈
  const llmAbort = new AbortController();
  const llmTimer = setTimeout(() => llmAbort.abort("llm-timeout"), 90_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ messages, ...bodyExtra }),
      signal: llmAbort.signal,
    });
  } catch (e) {
    clearTimeout(llmTimer);
    const err = e as Error;
    if (err?.name === "AbortError") {
      throw new Error("LLM 请求超时（90s）：模型服务响应过慢，请稍后重试");
    }
    throw new Error(`LLM 网络请求失败：${err.message}`);
  }
  clearTimeout(llmTimer);

  if (!res.ok || !res.body) {
    // ── 清洁化 HTTP 错误：避免将完整 HTML 页面写入 Error.message ──────────────
    let errText = "";
    try { errText = await res.text(); } catch { /* ignore */ }

    // 优先提取 JSON error 字段
    let errMsg = "";
    try {
      const parsed = JSON.parse(errText);
      errMsg = parsed?.error?.message || parsed?.error || parsed?.message || "";
    } catch { /* not JSON */ }

    if (!errMsg) {
      // HTML 页面：提取 <title> 或截取纯文本
      if (errText.trim().startsWith("<") || errText.includes("<!DOCTYPE")) {
        const titleMatch = errText.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
        errMsg = titleMatch?.[1]?.trim() || "服务端返回 HTML 页面（可能为限流/防火墙拦截）";
      } else {
        // 纯文本：截断到 400 字符，避免超大错误对象
        errMsg = errText.replace(/\s+/g, " ").trim().slice(0, 400) || res.statusText;
      }
    }

    // 附带 HTTP 状态码，便于区分 401/403/429/5xx
    const fullMsg = `LLM 调用失败（HTTP ${res.status}）：${errMsg}`;
    console.error(`[callLLM] 失败 status=${res.status} msg=${errMsg.slice(0, 200)}`);
    throw new Error(fullMsg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "", buf = "";
  let hadReasoningContent = false; // 标记是否收到过 reasoning_content（思考过程）

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;
      try {
        const chunk = JSON.parse(raw) as ChatChunk;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // ── 思考过程 (DeepSeek Reasoner) ──
        if (delta.reasoning_content) {
          hadReasoningContent = true;
          if (onThinkingChunk) await onThinkingChunk(delta.reasoning_content);
        } else if (onHeartbeat) {
          // 非思考内容时，每次收到 chunk 就发心跳，防止 SSE 连接超时
          await onHeartbeat();
        }

        // ── 正式内容 ──
        full += delta.content ?? "";
      } catch { /* 跳过非 JSON 行 */ }
    }
  }

  // ── 空响应检测：仅有 reasoning_content 但 content 始终为空 ──────────────────
  // 部分免费模型（如文心 ERNIE 限流时）只输出思考过程，正式 content 字段为空。
  // 若直接返回空字符串，下游 JSON 解析会将其当作"无工具调用"并触发错误流程。
  if (full.trim() === "") {
    if (hadReasoningContent) {
      console.error("[callLLM] 模型只返回了 reasoning_content，content 字段为空（可能限流或配额耗尽）");
      throw new Error("模型只返回了思考过程（reasoning_content），正式回答为空。可能触发了限流或配额耗尽，请稍后重试");
    }
    // 无任何内容：也抛出错误，避免下游静默失败
    console.error("[callLLM] 模型返回了空响应（full.length=0）");
    throw new Error("模型返回了空响应，可能是上下文过长或服务异常，请重试");
  }

  console.log(`[callLLM] 完成 full.length=${full.length}`);
  return full;
}

// ── 解析辅助工具 ──────────────────────────────────────────────────────────────

/**
 * 去除 LLM 输出中的 markdown 代码围栏（```json ... ``` 等），
 * 避免正则/JSON.parse 因反引号而失败。
 */
function stripCodeFences(text: string): string {
  return text
    .replace(/^```[a-zA-Z]*\s*\n?/gm, "")
    .replace(/^```\s*$/gm, "")
    .trim();
}

/**
 * 在文本中用括号匹配法提取第一个完整 JSON 对象字符串。
 * 支持嵌套 `{}` 和内容中包含花括号的字符串值，
 * 避免 `[^{}]*` 正则因 patch_file.content 等多行字段而失败。
 */
function extractFirstJsonObject(text: string): string | null {
  let depth = 0, start = -1;
  let inString = false, escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * 健壮提取工具调用 JSON。
 * 策略（优先级从高到低）：
 *   1. 逐行扫描：找以 `{` 开头且含 `"tool"` 的行，尝试 JSON.parse
 *   2. 括号匹配：在完整文本中遍历所有顶层 `{}` 块，找含 `"tool"` 的可解析对象
 * 在每种策略前均先剥除 markdown 代码围栏。
 */
function extractToolCall(text: string): Record<string, string> | null {
  const clean = stripCodeFences(text);

  // 策略 1：逐行扫描（最常见情况：工具 JSON 单独成行）
  for (const line of clean.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes('"tool"')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.tool === "string") return parsed as Record<string, string>;
    } catch { /* 继续下一行 */ }
  }

  // 策略 2：括号匹配法（工具 JSON 跨行或与其他文字混在一起时）
  let searchFrom = 0;
  while (searchFrom < clean.length) {
    const idx = clean.indexOf("{", searchFrom);
    if (idx === -1) break;
    const candidate = extractFirstJsonObject(clean.slice(idx));
    if (!candidate) break;
    if (candidate.includes('"tool"')) {
      try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed.tool === "string") return parsed as Record<string, string>;
      } catch { /* 继续搜索 */ }
    }
    searchFrom = idx + 1;
  }
  return null;
}

/** 从文本中提取任务计划（首轮 PLAN:{...} 行）。
 *  支持 `PLAN :` / `PLAN:` 以及 markdown 围栏包裹，
 *  用括号匹配法提取完整 JSON 避免正则截断。 */
interface PlanStep { id: string; title: string; desc: string; }
function extractPlan(text: string): PlanStep[] | null {
  const clean = stripCodeFences(text);
  // 找 PLAN: 的位置（允许冒号前后有空格）
  const planIdx = clean.search(/\bPLAN\s*:/i);
  if (planIdx === -1) return null;
  // 截取 PLAN: 之后的文本，找第一个完整 JSON 对象
  const afterPlan = clean.slice(planIdx).replace(/^PLAN\s*:\s*/i, "");
  const jsonStr = extractFirstJsonObject(afterPlan);
  if (!jsonStr) return null;
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
      return parsed.steps as PlanStep[];
    }
  } catch { /* ignore */ }
  return null;
}

/** 从文本中提取步骤标记 STEP:id（不区分大小写，允许冒号前后有空格）。 */
function extractStepMarker(text: string): string | null {
  const m = text.match(/\bSTEP\s*:\s*([a-zA-Z0-9_-]+)/i);
  return m ? m[1] : null;
}

function executeTool(
  ctx: GithubContext,
  call: Record<string, string>,
  targetBranch?: string,
): Promise<string> {
  switch (call.tool) {
    // ── 文件操作 ────────────────────────────────────────────────────────────
    case "list_files":   return listFiles(ctx, call.path || "");
    case "read_file":    return readFile(
      ctx, call.path,
      call.start_line ? parseInt(call.start_line, 10) : undefined,
      call.end_line   ? parseInt(call.end_line,   10) : undefined,
    );
    case "get_file_info": return getFileInfo(ctx, call.path);
    case "patch_file":   return patchFile(
      ctx, call.path,
      parseInt(call.start_line, 10),
      parseInt(call.end_line,   10),
      call.content,
      call.message,
      call.branch || targetBranch,
    );
    case "write_file":   return writeFile(ctx, call.path, call.content, call.message, call.branch || targetBranch);
    case "delete_file":  return deleteFile(ctx, call.path, call.message, call.branch || targetBranch);
    case "search_code":  return searchCode(ctx, call.query);
    case "grep_in_repo": return grepInRepo(
      ctx, call.query,
      call.file_pattern,
      call.offset ? parseInt(call.offset, 10) : 0,
    );
    case "batch_patch":  return batchPatch(
      ctx, call.path,
      (() => {
        try { return JSON.parse(call.patches || "[]"); } catch { return []; }
      })(),
      call.message,
      call.branch || targetBranch,
    );
    // ── 新工具 ───────────────────────────────────────────────────────────
    case "file_tree":    return fileTree(ctx, call.path || "", parseInt(call.depth || "3", 10));
    case "grep_in_file": return grepInFile(ctx, call.path, call.pattern, call.case_sensitive === "true", call.offset ? parseInt(call.offset, 10) : 0);
    case "batch_read":   return batchReadFiles(ctx, call.paths || "");
    // ── 分支 & PR ────────────────────────────────────────────────────────────
    case "list_branches":     return listBranches(ctx);
    case "list_commits":      return listCommits(ctx, call.path, call.branch || targetBranch);
    case "create_branch":     return createBranch(ctx, call.branch, call.from || targetBranch);
    case "list_pull_requests": return listPullRequests(ctx, call.state || "open");
    case "create_pr":         return createPullRequest(ctx, call.title, call.head, call.base, call.body);
    case "merge_pull_request": return mergePullRequest(ctx, call.pull_number, call.merge_method || "squash", call.commit_title);
    // ── Issue ────────────────────────────────────────────────────────────────
    case "list_issues":   return listIssues(ctx, call.state || "open");
    case "create_issue":  return createIssue(ctx, call.title, call.body, call.labels);
    case "search_issues": return searchIssues(
      ctx, call.query || "",
      call.state || "open",
      call.labels,
      call.assignee,
      call.limit ? parseInt(call.limit, 10) : 20,
    );
    case "get_issue_details": return getIssueDetails(ctx, call.issue_number);
    case "update_issue":  return updateIssue(
      ctx, call.issue_number,
      call.title, call.body, call.state, call.labels, call.assignees,
    );
    // ── Actions 工作流 ───────────────────────────────────────────────────────
    case "list_workflows":      return listWorkflows(ctx);
    case "get_workflow_runs":   return getWorkflowRuns(ctx, call.workflow_id || "", parseInt(call.limit || "10", 10));
    case "get_run_jobs":        return getRunJobs(ctx, call.run_id);
    case "get_job_logs":        return getJobLogs(ctx, call.job_id);
    case "trigger_workflow":    return triggerWorkflow(ctx, call.workflow_id, call.ref, undefined);
    case "check_run_status":    return checkRunStatus(
      ctx, call.run_id,
      (call.workflow_type as "fast" | "normal" | "build_apk") || "normal",
    );
    case "cancel_workflow_run": return cancelWorkflowRun(ctx, call.run_id);
    case "rerun_workflow_run":  return rerunWorkflowRun(ctx, call.run_id, call.failed_jobs_only === "true");
    case "list_actions_secrets": return listActionsSecrets(ctx);
    case "list_actions_variables": return listActionsVariables(ctx);
    case "set_actions_variable": return setActionsVariable(ctx, call.name, call.value);
    case "get_repo_info":        return getRepoInfo(ctx);
    case "add_comment":          return addComment(ctx, call.issue_number || call.pull_number, call.body);
    case "close_issue":          return closeIssue(ctx, call.issue_number, call.comment);
    case "close_pr":             return closePR(ctx, call.pull_number, call.comment);
    case "get_commit_diff":      return getCommitDiff(ctx, call.sha);
    case "get_pr_files":         return getPRFiles(ctx, call.pull_number);
    case "compare_commits":      return compareCommits(ctx, call.base, call.head);
    case "search_and_replace":   return searchAndReplace(
      ctx, call.pattern, call.replacement, call.file_pattern,
      call.message, call.branch || targetBranch,
    );
    case "auto_review":          return autoReview(
      ctx,
      call.commit_count ? parseInt(call.commit_count, 10) : 1,
      call.sha || undefined,
    );
    case "create_release":       return createRelease(ctx, call.tag_name, call.name, call.body, call.draft === "true", call.prerelease === "true", call.branch || targetBranch);
    case "list_releases":        return listReleases(ctx, parseInt(call.limit || "10", 10));
    case "submit_pr_review":     return submitPRReview(ctx, call.pull_number, call.event, call.body);
    // Release 自动化辅助工具
    case "get_latest_release":   return getLatestRelease(ctx);
    case "get_merged_prs_since": return getMergedPRsSince(ctx, call.since || "");
    default: return `未知工具: ${call.tool}`;
  }
}

// ── Supabase 持久化辅助 ───────────────────────────────────────────────────────

function makeSupabase() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return createClient(url, key);
}

/** 创建工作流记录，返回 workflow id */
async function dbCreateWorkflow(
  sb: ReturnType<typeof createClient>,
  userId: string,
  repo: string,
  taskSummary: string,
  steps: PlanStep[],
): Promise<string | null> {
  try {
    const { data, error } = await sb
      .from("task_workflows")
      .insert({
        user_id: userId,
        repo,
        task_summary: taskSummary.slice(0, 200),
        status: "running",
        total_steps: steps.length,
        done_steps: 0,
        fail_steps: 0,
      })
      .select("id")
      .maybeSingle();
    if (error || !data) { console.error("[db] createWorkflow error", error?.message); return null; }

    // 批量插入步骤
    const stepRows = steps.map((s, i) => ({
      workflow_id: data.id,
      step_id: s.id,
      seq: i,
      title: s.title,
      description: s.desc,
      status: "pending",
    }));
    const { error: sErr } = await sb.from("task_workflow_steps").insert(stepRows);
    if (sErr) console.error("[db] insertSteps error", sErr.message);

    return data.id as string;
  } catch (e) { console.error("[db] createWorkflow exception", (e as Error).message); return null; }
}

/** 更新步骤状态 */
async function dbUpdateStep(
  sb: ReturnType<typeof createClient>,
  workflowId: string,
  stepId: string,
  patch: { status?: string; retry_count?: number; started_at?: string; finished_at?: string },
) {
  try {
    await sb
      .from("task_workflow_steps")
      .update(patch)
      .eq("workflow_id", workflowId)
      .eq("step_id", stepId);
  } catch (e) { console.error("[db] updateStep exception", (e as Error).message); }
}

/** 完成工作流（统计成功/失败步骤数） */
async function dbFinishWorkflow(
  sb: ReturnType<typeof createClient>,
  workflowId: string,
) {
  try {
    const { data: steps } = await sb
      .from("task_workflow_steps")
      .select("status")
      .eq("workflow_id", workflowId);
    if (!steps) return;
    const done = steps.filter(s => s.status === "done").length;
    const fail = steps.filter(s => s.status === "error").length;
    const status = fail > 0 ? "partial_fail" : "done";
    await sb
      .from("task_workflows")
      .update({ status, done_steps: done, fail_steps: fail, finished_at: new Date().toISOString() })
      .eq("id", workflowId);
  } catch (e) { console.error("[db] finishWorkflow exception", (e as Error).message); }
}

// ── SSE 流输出 ───────────────────────────────────────────────────────────────

function createSSEStream() {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  
  const sendRaw = (data: string) => writer.write(encoder.encode(`data: ${data}\n\n`));
  
  /** 发送结构化事件（新版） */
  const sendTyped = (payload: unknown) => sendRaw(JSON.stringify(payload));

  /** 发送纯内容 Chunk（兼容旧版前端） */
  const sendChunk = (content: string) => 
    sendTyped({ type: "content", content });

  const sendDone = async () => { 
    await sendRaw("[DONE]"); 
    await writer.close(); 
  };

  return { readable, sendTyped, sendChunk, sendDone };
}

/**
 * 逐词流式推送最终回答，模拟打字机效果。
 * 将文本按"词+空白"分组，每 ~10ms 推送一组，
 * 代码块（```...```）整体一次性推送避免渲染撕裂。
 * isAborted：可选回调，返回 true 时提前终止输出。
 */
async function streamAnswer(
  text: string,
  sendChunk: (s: string) => Promise<void>,
  delayMs = 10,
  isAborted?: () => boolean,
) {
  if (!text) return;

  // 先检测是否有代码块——若全文只是一段代码，直接一次性输出
  if (text.startsWith("```") && text.trimEnd().endsWith("```")) {
    await sendChunk(text);
    return;
  }

  // 按行切分；代码块整体输出，普通行逐词输出
  const lines = text.split("\n");
  let inCodeBlock = false;
  let codeBuffer = "";

  for (let li = 0; li < lines.length; li++) {
    if (isAborted?.()) return; // 用户中断，提前退出
    const line = lines[li];
    const suffix = li < lines.length - 1 ? "\n" : "";

    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBuffer = line + "\n";
      } else {
        // 退出代码块：整体一次性推送
        inCodeBlock = false;
        codeBuffer += line + suffix;
        await sendChunk(codeBuffer);
        codeBuffer = "";
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer += line + "\n";
      continue;
    }

    // 普通行：英文按词，中文每 3 字为一组
    const segments: string[] = [];
    let buf = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const isCJK = ch >= "\u4e00" && ch <= "\u9fff";
      if (isCJK) {
        if (buf) { segments.push(buf); buf = ""; }
        buf += ch;
        if (buf.length >= 3) { segments.push(buf); buf = ""; }
      } else if (ch === " " || ch === "\t") {
        buf += ch;
        segments.push(buf);
        buf = "";
      } else {
        buf += ch;
      }
    }
    if (buf) segments.push(buf);

    for (let si = 0; si < segments.length; si++) {
      if (isAborted?.()) return;
      await sendChunk(segments[si]);
      if (si < segments.length - 1 || suffix) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    if (suffix) await sendChunk(suffix);
  }

  // 未闭合的代码块（异常情况）直接输出
  if (codeBuffer) await sendChunk(codeBuffer);
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  let messages: Message[], githubToken: string, owner: string, repo: string;
  let modelConfig: ModelConfig = { type: "wenxin" };
  let targetBranch: string | undefined;
  let userId = "anonymous";

  try {
    const body = await req.json();
    messages = body.messages;
    githubToken = body.github_token;
    owner = body.owner;
    repo = body.repo;
    targetBranch = body.target_branch || undefined;
    if (body.model_config) modelConfig = body.model_config;
    if (body.user_id) userId = body.user_id;
    if (!messages?.length || !githubToken || !owner || !repo) {
      throw new Error("缺少必要参数：messages, github_token, owner, repo");
    }
    // 非文心模型需要用户提供 API Key
    if (modelConfig.type !== "wenxin" && !modelConfig.api_key) {
      throw new Error(`使用 ${modelConfig.type} 模型需要提供 API Key`);
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const platformKey = Deno.env.get("INTEGRATIONS_API_KEY") ?? "";
  if (modelConfig.type === "wenxin" && !platformKey) {
    return new Response(JSON.stringify({ error: "服务配置错误：缺少平台 API 密钥" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ctx: GithubContext = { token: githubToken, owner, repo };
  const { readable, sendTyped, sendChunk, sendDone } = createSSEStream();

  // 客户端中断信号：用户点"停止"时 req.signal 触发 abort
  const abortSig = req.signal;

  (async () => {
    try {
    const fullMessages: Message[] = [{ role: "system", content: buildSystemPrompt(targetBranch) }, ...messages];
    console.log(`[main] model=${modelConfig.type} hasApiKey=${!!modelConfig.api_key} owner=${owner} repo=${repo}`);
    
    // 心跳辅助函数：每次调用都向 SSE 写入一条 heartbeat，保持连接活跃
    const heartbeat = () => sendTyped({ type: "heartbeat" });
    // 启动背景心跳，每 15 秒发送一次，防止工具调用等耗时操作导致连接中断
    const heartbeatTimer = setInterval(heartbeat, 15000);

    // Supabase 客户端（可能为 null，持久化失败不影响主流程）
    const sb = makeSupabase();
    // 工作流 DB id（首轮收到 plan 后写入）
    let workflowDbId: string | null = null;

    const TOOL_LABELS: Record<string, string> = {
      // 文件操作
      list_files: "列出目录", read_file: "读取文件", get_file_info: "文件信息", patch_file: "局部修改文件",
      write_file: "写入文件", delete_file: "删除文件", search_code: "搜索代码",
      file_tree: "文件树", grep_in_file: "文件内搜索", batch_read: "批量读取文件",
      grep_in_repo: "全仓库搜索", batch_patch: "批量局部修改",
      // 分支 & PR
      list_branches: "列出分支", list_commits: "提交历史", create_branch: "新建分支",
      list_pull_requests: "列出 PR", create_pr: "创建 PR", merge_pull_request: "合并 PR",
      // Issue
      list_issues: "列出 Issues", create_issue: "创建 Issue",
      search_issues: "搜索 Issues", get_issue_details: "Issue 详情", update_issue: "更新 Issue",
      // Actions 工作流
      list_workflows: "列出工作流", get_workflow_runs: "查看运行记录",
      get_run_jobs: "查看 Jobs", get_job_logs: "下载日志",
      trigger_workflow: "触发工作流", check_run_status: "等待运行完成",
      cancel_workflow_run: "取消运行",
      rerun_workflow_run: "重新运行", list_actions_secrets: "查看 Secrets",
      list_actions_variables: "查看 Variables", set_actions_variable: "设置 Variable",
      // 资源请求
      request_file: "请求上传文件",
      // 新增工具
      get_repo_info: "仓库信息",
      add_comment: "添加评论", close_issue: "关闭 Issue", close_pr: "关闭 PR",
      get_commit_diff: "查看提交变更", get_pr_files: "PR 文件变更",
      compare_commits: "对比 commit/分支", search_and_replace: "全仓库搜索替换", auto_review: "自动代码审查",
      create_release: "创建 Release", list_releases: "列出 Release",
      submit_pr_review: "PR 代码审查",
      get_latest_release: "获取最新 Release", get_merged_prs_since: "获取已合并 PR",
    };
    // 每批最多 20 轮工具调用；最多自动续跑 3 批，总上限 60 轮
    const MAX_ROUNDS_PER_BATCH = 20;
    const MAX_BATCHES = 3;
    // 当前正在执行的计划步骤 ID
    let currentStepId: string | null = null;
    // 连续"无工具调用"的 nudge 计数（最多纠正 2 次，防止死循环）
    let nudgeCount = 0;
    const MAX_NUDGE = 2;
    // 总轮次计数（跨批次）
    let totalRound = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
    let batchDone = false; // 本批是否已完成（break 出内层循环）
    for (let round = 0; round < MAX_ROUNDS_PER_BATCH; round++, totalRound++) {
      // ── 用户主动中断：立即退出循环 ────────────────────────────────────────
      if (abortSig.aborted) { batchDone = true; break; }

      let assistantText = "";
      let thinkingStarted = false;

      // 定义思考过程回调；普通内容 chunk 触发心跳
      const onThinkingChunk = async (chunk: string) => {
        if (!thinkingStarted) {
          await sendTyped({ type: "think_start" });
          thinkingStarted = true;
        }
        await sendTyped({ type: "think_chunk", content: chunk });
      };

      try {
        assistantText = await callLLM(modelConfig, platformKey, fullMessages, onThinkingChunk, heartbeat);
        if (thinkingStarted) await sendTyped({ type: "think_end" });
      } catch (e) {
        const errMsg = (e as Error).message ?? String(e);
        // ── 错误分类：永久性错误立即终止；瞬时错误指数退避重试 ──────────────────
        // 永久性：401/403 API Key 问题，重试无意义
        const isPermanent =
          errMsg.includes("HTTP 401") || errMsg.includes("HTTP 403") ||
          errMsg.includes("401）") || errMsg.includes("403）") ||
          errMsg.includes("认证失败") || errMsg.includes("无权限");
        // 瞬时性：429 限流 / 5xx 服务异常 / 超时 / 网络抖动
        const isTransient =
          errMsg.includes("HTTP 429") || errMsg.includes("429）") ||
          errMsg.includes("限流") || errMsg.includes("超时") ||
          errMsg.includes("LLM 网络") || errMsg.includes("5") && /HTTP 5\d\d/.test(errMsg);

        if (isPermanent) {
          // 永久错误：直接输出到流并终止整个任务，不重试
          console.error(`[batch ${batch}] 永久错误，终止任务：${errMsg}`);
          await streamAnswer(`❌ AI 调用失败（配置错误）：${errMsg}`, sendChunk);
          batchDone = true;
          break;
        }

        if (isTransient && round < MAX_ROUNDS_PER_BATCH - 1) {
          // 瞬时错误：最多退避重试 2 次（通过 round 计数控制），每次等待 3s
          const retryDelay = 3000;
          console.warn(`[batch ${batch} round ${round}] 瞬时错误，${retryDelay}ms 后重试：${errMsg}`);
          // 用 status_warning 事件通知前端（toast），而非写入对话气泡
          await sendTyped({ type: "status_warning", message: `遇到临时错误，${retryDelay / 1000}s 后自动重试…` });
          await new Promise(r => setTimeout(r, retryDelay));
          continue; // 重试本轮，不 break
        }

        // 其他未知错误 / 重试次数用尽
        console.error(`[batch ${batch} round ${round}] 错误终止：${errMsg}`);
        await streamAnswer(`❌ AI 调用失败：${errMsg}`, sendChunk);
        batchDone = true;
        break;
      }

      // ── 预处理：统一剥除 markdown 代码围栏 ────────────────────────────────────
      // LLM 有时会用 ```json ... ``` 包裹 PLAN/工具 JSON，导致所有正则失效
      const rawText = assistantText;
      assistantText = stripCodeFences(assistantText);

      // ── 首轮（每批第 0 轮）提取任务计划 ─────────────────────────────────────
      if (totalRound === 0) {
        const plan = extractPlan(rawText); // 使用原始文本（stripCodeFences 在内部处理）
        if (plan && plan.length > 0) {
          await sendTyped({ type: "plan", steps: plan });
          // 持久化：创建工作流 + 步骤
          if (sb) {
            const firstMsg = messages[messages.length - 1]?.content ?? "";
            workflowDbId = await dbCreateWorkflow(sb, userId, `${owner}/${repo}`, firstMsg, plan);
          }
        }
        // 从显示文本中移除 PLAN:{...} 块（宽松匹配，支持多行 JSON）
        assistantText = assistantText.replace(/\bPLAN\s*:\s*\{[\s\S]*?\}\s*/i, "").trim();
      }

      // ── 每轮提取步骤标记 ─────────────────────────────────────────────────────
      const stepMarker = extractStepMarker(assistantText);
      if (stepMarker && stepMarker !== currentStepId) {
        // 结束上一个步骤
        if (currentStepId) {
          await sendTyped({ type: "step_end", stepId: currentStepId, status: "done" });
          if (sb && workflowDbId) {
            await dbUpdateStep(sb, workflowDbId, currentStepId, {
              status: "done", finished_at: new Date().toISOString(),
            });
          }
        }
        currentStepId = stepMarker;
        await sendTyped({ type: "step_start", stepId: currentStepId });
        if (sb && workflowDbId) {
          await dbUpdateStep(sb, workflowDbId, currentStepId, {
            status: "running", started_at: new Date().toISOString(),
          });
        }
      }
      // 移除 STEP:N 标记行（在提取工具调用前清除，避免干扰解析）
      assistantText = assistantText.replace(/\bSTEP\s*:\s*\S+[ \t]*\n?/i, "").trim();

      const toolCall = extractToolCall(assistantText);
      if (!toolCall) {
        // ── Nudge 机制：任务进行中但 LLM 忘记输出工具 JSON ─────────────────────
        // 判断条件：有步骤在执行（或 totalRound=0 时刚给了 PLAN），且 nudge 未超限
        const taskOngoing = currentStepId !== null || totalRound === 0;
        if (taskOngoing && nudgeCount < MAX_NUDGE) {
          nudgeCount++;
          console.log(`[nudge ${nudgeCount}] totalRound=${totalRound} 无工具调用，注入纠正提示`);
          // 保留 LLM 已输出的文字内容，再追加纠正指令
          const displayText = assistantText.replace(/\bPLAN\s*:\s*\{[\s\S]*?\}/i, "").trim();
          if (displayText) await sendChunk(displayText + "\n");
          fullMessages.push({ role: "assistant", content: rawText });
          fullMessages.push({
            role: "user",
            content: "⚠️ 系统提示：你刚才没有输出工具调用 JSON。请直接输出下一个工具的 JSON，不要有任何 markdown 围栏或额外解释，格式示例：\n{\"tool\":\"list_files\",\"path\":\"\"}\n请继续执行任务。",
          });
          continue; // 重新进入循环，让 LLM 补发工具 JSON
        }

        // ── 真正的最终回答：结束当前步骤 ────────────────────────────────────
        if (currentStepId) {
          await sendTyped({ type: "step_end", stepId: currentStepId, status: "done" });
          if (sb && workflowDbId) {
            await dbUpdateStep(sb, workflowDbId, currentStepId, {
              status: "done", finished_at: new Date().toISOString(),
            });
          }
          currentStepId = null;
        }
        // 持久化工作流完成
        if (sb && workflowDbId) await dbFinishWorkflow(sb, workflowDbId);
        // 逐词流式输出最终回答，模拟打字机效果
        await streamAnswer(assistantText, sendChunk, 10, () => abortSig.aborted);
        batchDone = true; // 任务已完成，退出外层批次循环
        break;
      }

      // 成功解析到工具调用，重置 nudge 计数
      nudgeCount = 0;

      // 工具调用前的前置文本：取工具 JSON 出现之前的内容
      // 用 indexOf 找到工具 JSON 在文本中的起始位置，避免正则 split 的局限
      const _toolJsonStr = JSON.stringify(toolCall); // 规范化后的 JSON（调试用）
      // 找到工具 JSON 在 assistantText 中的大概位置（通过 "tool" 键名定位）
      const toolKeyIdx = assistantText.indexOf('"tool"');
      // 向前找最近的 `{`
      const braceIdx = toolKeyIdx !== -1 ? assistantText.lastIndexOf("{", toolKeyIdx) : -1;
      const beforeText = braceIdx > 0 ? assistantText.slice(0, braceIdx).trim() : "";
      if (beforeText) await sendChunk(beforeText + "\n\n");

      const label = TOOL_LABELS[toolCall.tool] || toolCall.tool;
      const hint = toolCall.tool === "read_file" && (toolCall.start_line || toolCall.end_line)
        ? `${toolCall.path} 第${toolCall.start_line || "1"}–${toolCall.end_line || "末尾"}行`
        : toolCall.tool === "patch_file"
          ? `${toolCall.path} 第${toolCall.start_line}–${toolCall.end_line}行`
          : toolCall.tool === "get_workflow_runs"
            ? `workflow: ${toolCall.workflow_id || "全部"}`
            : toolCall.tool === "get_run_jobs" || toolCall.tool === "cancel_workflow_run" || toolCall.tool === "rerun_workflow_run"
              ? `run_id: ${toolCall.run_id}`
              : toolCall.tool === "get_job_logs"
                ? `job_id: ${toolCall.job_id}`
                : toolCall.tool === "trigger_workflow"
                  ? `${toolCall.workflow_id} @ ${toolCall.ref}`
                  : toolCall.tool === "merge_pull_request"
                    ? `PR #${toolCall.pull_number}`
                    : toolCall.tool === "file_tree"
                      ? `${toolCall.path || "/"} (深度${toolCall.depth || 3})`
                      : toolCall.tool === "grep_in_file"
                        ? `${toolCall.path} → "${toolCall.pattern}"`
                        : toolCall.tool === "batch_read"
                          ? toolCall.paths
                          : toolCall.path || toolCall.query || toolCall.title || toolCall.branch || "";
      
      const toolCallId = `tool-${Date.now()}-${totalRound}`;

      // ── 用户中断：工具执行前最后一次检查 ────────────────────────────────
      if (abortSig.aborted) { batchDone = true; break; }

      // ── request_file：虚拟工具，向前端发出文件上传请求事件 ────────────────
      if (toolCall.tool === "request_file") {
        const fileReqId = `freq-${Date.now()}`;
        await sendTyped({
          type: "file_request",
          id: fileReqId,
          filename: toolCall.filename || "file",
          description: toolCall.description || "请上传所需文件",
          mime_types: toolCall.mime_types || "",
        });
        // 向上下文追加：AI 已发出请求，等待用户回复
        fullMessages.push({ role: "assistant", content: rawText });
        fullMessages.push({
          role: "user",
          content: `已向用户请求上传文件"${toolCall.filename || 'file'}"，请继续等待用户上传。上传完成后系统会将文件内容附加到对话中。`,
        });
        // 结束本次流式（前端收到 file_request 后会引导用户上传，并开启新一轮对话）
        batchDone = true;
        break;
      }

      await sendTyped({ 
        type: "tool_start", 
        id: toolCallId, 
        tool: toolCall.tool, 
        label, 
        hint 
      });

      const startTime = Date.now();
      let toolResult = "";
      try { 
        // 工具执行前先发一次心跳，执行过程中 GitHub API 也可能耗时数秒
        await heartbeat();
        toolResult = await executeTool(ctx, toolCall, targetBranch);
      }
      catch (e) { toolResult = `工具执行出错：${(e as Error).message}`; }
      
      const elapsedMs = Date.now() - startTime;
      const toolFailed = toolResult.includes("出错") || toolResult.includes("失败");
      const toolStatus = toolFailed ? "fail" : "success";
      
      await sendTyped({ 
        type: "tool_end", 
        id: toolCallId, 
        status: toolStatus, 
        result: toolResult.slice(0, 1000),
        elapsedMs 
      });

      // ── 步骤失败自动重试（最多 2 次，间隔递增） ─────────────────────────────
      // 重试仅针对整体步骤（step_end error 场景），工具级失败由 AI 下轮自行处理。
      // 此处：若工具执行失败且当前步骤有标记，向前端发送 step_retry 事件
      if (toolFailed && currentStepId) {
        const MAX_RETRIES = 2;
        let retryCount = 0;
        let retriedResult = toolResult;
        while (retryCount < MAX_RETRIES && (retriedResult.includes("出错") || retriedResult.includes("失败"))) {
          retryCount++;
          const delay = retryCount * 1000; // 1s, 2s
          await new Promise(res => setTimeout(res, delay));
          await sendTyped({ type: "step_retry", stepId: currentStepId, retryCount });
          // 持久化重试次数
          if (sb && workflowDbId) {
            await dbUpdateStep(sb, workflowDbId, currentStepId, { retry_count: retryCount });
          }
          try {
            await heartbeat();
            retriedResult = await executeTool(ctx, toolCall, targetBranch);
          } catch (e) { retriedResult = `工具执行出错：${(e as Error).message}`; }
        }
        // 无论原始是否相同，都使用最新的 retriedResult
        toolResult = retriedResult;
        const retryFailed = toolResult.includes("出错") || toolResult.includes("失败");
        // 若重试后仍失败，标记当前步骤为最终失败
        if (retryFailed && currentStepId) {
          await sendTyped({ type: "step_end", stepId: currentStepId, status: "error" });
          if (sb && workflowDbId) {
            await dbUpdateStep(sb, workflowDbId, currentStepId, {
              status: "error", finished_at: new Date().toISOString(),
            });
            await dbFinishWorkflow(sb, workflowDbId);
          }
          currentStepId = null;
          // 注入指令：让 LLM 根据已有错误上下文生成修复清单，而非输出硬编码终止消息
          fullMessages.push({
            role: "user",
            content: [
              "⚠️ 系统提示：上述步骤已连续失败并重试 2 次，无法自动完成修复。",
              "请根据以上日志和错误信息，按照「修复清单」格式（步骤 8）输出一份完整的可执行 Markdown 清单，",
              "帮助用户手动处理每个问题。不要再调用工具，直接输出清单即可。",
            ].join("")
          });
          // 再发起一次 LLM 调用，让 AI 生成有上下文的修复清单
          try {
            const repairResp = await callLLM(modelConfig, platformKey, fullMessages);
            await streamAnswer(repairResp, sendChunk, 10, () => abortSig.aborted);
          } catch (_e) {
            await streamAnswer("⚠️ 步骤执行失败（已重试 2 次），自动修复终止。请检查上方日志并手动修复。", sendChunk);
          }
          batchDone = true;
          break;
        }
      }

      // 将原始 assistantText（含 PLAN/STEP 标记）压入历史，保持上下文完整性
      fullMessages.push({ role: "assistant", content: rawText });
      // 工具结果注入时截断至 1500 字符，防止超长结果撑爆上下文窗口
      const truncatedResult = toolResult.length > 1500
        ? toolResult.slice(0, 1500) + `\n…（内容已截断，原始长度 ${toolResult.length} 字符，如需完整内容请重新调用工具并缩小查询范围）`
        : toolResult;
      fullMessages.push({
        role: "user",
        content: `工具执行结果：\n${truncatedResult}\n\n请根据结果继续执行下一步。若还有未完成的步骤，继续调用工具；若全部步骤已完成，输出简洁的完成总结（不要再输出工具 JSON）。`,
      });

      // ── 本批次工具轮次耗尽：任务未完则自动续跑 ─────────────────────────────
      if (round === MAX_ROUNDS_PER_BATCH - 1) {
        const hasMoreBatches = batch < MAX_BATCHES - 1;
        if (hasMoreBatches) {
          // 任务仍在进行：用 status_info 事件通知前端（toast），不写入对话气泡
          console.log(`[auto-continue] batch=${batch} totalRound=${totalRound} 自动续跑`);
          await sendTyped({ type: "status_info", message: `第 ${batch + 1} 批任务完成，继续执行剩余步骤…` });
          // 注入系统提示：告知 AI 继续剩余步骤，不要重新规划
          fullMessages.push({
            role: "user",
            content: "⚠️ 系统提示：由于任务较复杂，请继续执行剩余未完成的步骤。不要重新输出 PLAN，直接从下一个工具调用开始继续。",
          });
          nudgeCount = 0; // 新批次重置 nudge 计数
          // batchDone 保持 false，外层 for 将进入下一个 batch
        } else {
          // 所有批次已耗尽
          if (currentStepId) {
            await sendTyped({ type: "step_end", stepId: currentStepId, status: "done" });
            if (sb && workflowDbId) {
              await dbUpdateStep(sb, workflowDbId, currentStepId, {
                status: "done", finished_at: new Date().toISOString(),
              });
            }
          }
          if (sb && workflowDbId) await dbFinishWorkflow(sb, workflowDbId);
          await streamAnswer(`⚠️ 已达到最大工具调用轮次（${totalRound + 1} 轮），任务可能未完全完成，请重新发送指令继续。`, sendChunk);
          batchDone = true;
        }
      }
    } // end inner for

    if (batchDone || abortSig.aborted) break; // 内层正常完成 / 用户中断，退出外层
    } // end outer for (batch)

    if (sb && workflowDbId) await dbFinishWorkflow(sb, workflowDbId);
    clearInterval(heartbeatTimer);
    await sendDone();
    } catch (fatalErr) {
      // 顶层兜底：未预期的异常，写入流后关闭，防止代理层因未处理的 rejection 返回 500
      console.error("[IIFE fatal]", (fatalErr as Error).message);
      // @ts-ignore: heartbeatTimer is defined in outer scope
      if (typeof heartbeatTimer !== 'undefined') clearInterval(heartbeatTimer);
      try { await streamAnswer(`❌ 内部错误：${(fatalErr as Error).message}`, sendChunk); } catch { /* ignore */ }
      try { await sendDone(); } catch { /* ignore */ }
    }
  })();

  return new Response(readable, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});
