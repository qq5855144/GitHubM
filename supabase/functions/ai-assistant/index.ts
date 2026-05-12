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
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
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
  } catch (e) { return `列出目录失败：${(e as Error).message}`; }
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
  } catch (e) { return `获取文件树失败：${(e as Error).message}`; }
}

/**
 * 在文件中搜索文本（逐行 grep），返回匹配行的行号+内容。
 * 适用于 GitHub Search API 速率受限时的替代方案。
 */
async function grepInFile(
  ctx: GithubContext,
  filePath: string,
  pattern: string,
  caseSensitive = false,
): Promise<string> {
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
    if (data.encoding !== "base64") return `无法解码文件 "${filePath}"`;
    const content = decodeBase64Utf8(data.content);
    const lines = content.split("\n");
    const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
    const matches: string[] = [];
    lines.forEach((line, i) => {
      if (regex.test(line)) {
        matches.push(`${String(i + 1).padStart(5, " ")} | ${line}`);
      }
      regex.lastIndex = 0;
    });
    if (!matches.length) return `"${filePath}" 中未找到匹配 "${pattern}" 的行`;
    return `"${filePath}" 中匹配 "${pattern}" 的行（共 ${matches.length} 处）：\n\`\`\`\n${matches.slice(0, 50).join("\n")}\n\`\`\`` +
      (matches.length > 50 ? `\n（仅显示前 50 条，共 ${matches.length} 条）` : "");
  } catch (e) { return `grep 搜索失败：${(e as Error).message}`; }
}

/**
 * 批量读取多个文件（逗号分隔路径），一次工具调用读取多个文件，减少 round trip。
 * 每个文件自动分段返回前 100 行（防止超长）。
 */
async function batchReadFiles(ctx: GithubContext, paths: string): Promise<string> {
  const fileList = paths.split(",").map(p => p.trim()).filter(Boolean).slice(0, 5); // 最多5个
  if (!fileList.length) return "请提供至少一个文件路径";
  const results: string[] = [];
  for (const fp of fileList) {
    const content = await readFile(ctx, fp, 1, 100);
    results.push(`\n=== ${fp} ===\n${content}`);
  }
  return results.join("\n");
}

/** base64 + UTF-8 解码（正确处理中文/日文/emoji 等多字节字符） */
function decodeBase64Utf8(b64: string): string {
  const binaryStr = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * 读取文件内容。
 * @param startLine 起始行号（1-based，可选），不传则从头读
 * @param endLine   结束行号（1-based，可选），不传则到末尾
 * 不再截断字符数，完整返回所请求的行范围。
 */
async function readFile(
  ctx: GithubContext,
  filePath: string,
  startLine?: number,
  endLine?: number,
): Promise<string> {
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
    if (data.encoding !== "base64") return `无法解码文件 "${filePath}"（编码：${data.encoding}）`;

    const fullContent = decodeBase64Utf8(data.content);
    const allLines = fullContent.split("\n");
    const totalLines = allLines.length;

    // 确定实际读取范围（转为 0-based 索引）
    const from = startLine ? Math.max(1, startLine) : 1;
    const to   = endLine   ? Math.min(totalLines, endLine) : totalLines;

    const selectedLines = allLines.slice(from - 1, to);
    const lineHeader = (startLine || endLine)
      ? ` 第 ${from}–${to} 行（共 ${totalLines} 行）`
      : `（共 ${totalLines} 行）`;

    // 在每行前加行号，方便 AI 精确定位 patch_file 操作
    const numberedContent = selectedLines
      .map((line, i) => `${String(from + i).padStart(6, " ")} | ${line}`)
      .join("\n");

    return (
      `文件 "${filePath}"${lineHeader}：\n\`\`\`\n${numberedContent}\n\`\`\`` +
      `\n_SHA: ${data.sha} | 总行数: ${totalLines}_`
    );
  } catch (e) { return `读取文件失败：${(e as Error).message}`; }
}

/**
 * 局部修改文件（patch）：仅替换指定行范围，不覆盖整个文件。
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
    // 1. 先读取原文件，获取完整内容 + SHA
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
    if (data.encoding !== "base64") return `无法解码文件 "${filePath}"`;

    const fullContent = decodeBase64Utf8(data.content);
    const allLines = fullContent.split("\n");
    const totalLines = allLines.length;

    // 参数边界校验
    if (startLine < 1 || endLine < startLine || startLine > totalLines) {
      return `行号超出范围：文件共 ${totalLines} 行，请求 ${startLine}–${endLine}`;
    }
    const safeEnd = Math.min(endLine, totalLines);

    // 2. 拼接新内容：前段 + 替换内容 + 后段
    const before  = allLines.slice(0, startLine - 1);          // 0 ~ startLine-2
    const after   = allLines.slice(safeEnd);                    // safeEnd ~ end
    const newLines = newContent.split("\n");
    const patched = [...before, ...newLines, ...after].join("\n");

    // 3. base64 编码（兼容 UTF-8）
    const encoded = btoa(unescape(encodeURIComponent(patched)));

    // 4. 写回 GitHub
    const body: Record<string, string> = {
      message: commitMessage,
      content: encoded,
      sha: data.sha,
    };
    if (branch) body.branch = branch;

    const result = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`,
      { method: "PUT", body: JSON.stringify(body) },
    );

    const replacedCount = safeEnd - startLine + 1;
    const newCount = newLines.length;
    return (
      `✅ 已 patch "${filePath}"：替换第 ${startLine}–${safeEnd} 行（${replacedCount} 行→${newCount} 行），` +
      `提交：${result.commit?.sha?.slice(0, 7) || "成功"}，信息：${commitMessage}`
    );
  } catch (e) { return `patch 文件失败：${(e as Error).message}`; }
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
  } catch (e) { return `写入文件失败：${(e as Error).message}`; }
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
  } catch (e) { return `搜索代码失败：${(e as Error).message}`; }
}

async function listBranches(ctx: GithubContext): Promise<string> {
  try {
    const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/branches?per_page=50`);
    if (!Array.isArray(data) || !data.length) return "该仓库暂无分支";
    const names = data.map((b: { name: string; protected: boolean }) =>
      `• ${b.name}${b.protected ? " 🔒（受保护）" : ""}`
    );
    return `仓库分支列表（共 ${data.length} 个）：\n${names.join("\n")}`;
  } catch (e) { return `获取分支列表失败：${(e as Error).message}`; }
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
  } catch (e) { return `获取提交历史失败：${(e as Error).message}`; }
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
  } catch (e) { return `创建分支失败：${(e as Error).message}`; }
}

async function createPullRequest(
  ctx: GithubContext,
  title: string,
  head: string,
  base: string,
  body?: string,
): Promise<string> {
  try {
    const pr = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({ title, head, base, body: body || "", draft: false }),
    });
    return `✅ PR 已创建：[#${pr.number} ${pr.title}](${pr.html_url})\n- 从 \`${head}\` → \`${base}\`\n- 状态：${pr.state}`;
  } catch (e) { return `创建 PR 失败：${(e as Error).message}`; }
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
  } catch (e) { return `列出工作流失败：${(e as Error).message}`; }
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
  } catch (e) { return `获取运行记录失败：${(e as Error).message}`; }
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
  } catch (e) { return `获取 Jobs 失败：${(e as Error).message}`; }
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
  } catch (e) { return `下载日志失败：${(e as Error).message}`; }
}

/** 手动触发工作流（workflow_dispatch 事件） */
async function triggerWorkflow(
  ctx: GithubContext,
  workflowId: string,
  ref: string,
  inputs?: Record<string, string>,
): Promise<string> {
  try {
    await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/actions/workflows/${workflowId}/dispatches`,
      { method: "POST", body: JSON.stringify({ ref, inputs: inputs || {} }) },
    );
    return `✅ 已触发工作流 \`${workflowId}\`，分支/标签：\`${ref}\`。稍后可用 get_workflow_runs 查看进度。`;
  } catch (e) { return `触发工作流失败：${(e as Error).message}`; }
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
  } catch (e) { return `取消运行失败：${(e as Error).message}`; }
}

/** 重新运行失败的工作流 */
async function rerunWorkflowRun(ctx: GithubContext, runId: string, failedJobsOnly = false): Promise<string> {
  try {
    const path = failedJobsOnly
      ? `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/rerun-failed-jobs`
      : `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/rerun`;
    await githubRequest(ctx, path, { method: "POST" });
    return `✅ 已重新触发 Run \`${runId}\`（${failedJobsOnly ? "仅失败 Jobs" : "全部 Jobs"}），稍后可查看新运行。`;
  } catch (e) { return `重新运行失败：${(e as Error).message}`; }
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
  } catch (e) { return `删除文件失败：${(e as Error).message}`; }
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
  } catch (e) { return `列出 PR 失败：${(e as Error).message}`; }
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
  } catch (e) { return `合并 PR 失败：${(e as Error).message}`; }
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
  } catch (e) { return `列出 Issue 失败：${(e as Error).message}`; }
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
  } catch (e) { return `创建 Issue 失败：${(e as Error).message}`; }
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
  } catch (e) { return `列出 Secrets 失败：${(e as Error).message}`; }
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
4. 分段读取大文件（超长文件必须分段，每次最多读 100 行）：{"tool":"read_file","path":"src/App.tsx","start_line":"1","end_line":"100"}
5. 文件内搜索（grep）：{"tool":"grep_in_file","path":"src/main.kt","pattern":"TODO","case_sensitive":"false"}
6. 批量读取多个文件（逗号分隔，最多5个，每文件前100行）：{"tool":"batch_read","paths":"src/a.ts,src/b.ts,src/c.ts"}
7. 搜索代码（GitHub Search API）：{"tool":"search_code","query":"TODO"}
8. 局部修改（推荐，仅替换指定行）：
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
16. 合并 PR：{"tool":"merge_pull_request","pull_number":"42","merge_method":"squash"}

🐛 **Issue 管理**
17. 列出 Issues：{"tool":"list_issues","state":"open"}
18. 创建 Issue：{"tool":"create_issue","title":"构建失败","body":"描述","labels":"bug,ci"}

⚙️ **工作流 & 部署**
19. 列出所有工作流：{"tool":"list_workflows"}
20. 查看工作流最近运行：{"tool":"get_workflow_runs","workflow_id":"deploy.yml","limit":"5"}
    （workflow_id 可以是文件名如 deploy.yml 或数字 ID；不填则查全部运行）
21. 查看某次运行的 Jobs 及步骤：{"tool":"get_run_jobs","run_id":"12345678"}
22. 下载 Job 日志（含报错详情）：{"tool":"get_job_logs","job_id":"87654321"}
23. 手动触发工作流：{"tool":"trigger_workflow","workflow_id":"deploy.yml","ref":"main","inputs":{}}
24. 取消运行中的工作流：{"tool":"cancel_workflow_run","run_id":"12345678"}
25. 重新运行失败的工作流：{"tool":"rerun_workflow_run","run_id":"12345678","failed_jobs_only":"true"}
26. 查看 Actions Secrets 名称：{"tool":"list_actions_secrets"}
27. 向用户请求上传文件（缺少图片/图标/证书等资源时）：
    {"tool":"request_file","filename":"app-icon.png","description":"需要 512×512 的应用图标 PNG 文件","mime_types":"image/png,image/jpeg"}

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
  6. trigger_workflow 触发部署 → get_workflow_runs 轮询状态

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
  6. rerun_workflow_run 重新触发，再次 get_workflow_runs 确认是否通过
  7. 如果依然失败，重复步骤 3-6 直到修复成功

🔧 **修改工作流文件**：
  1. list_workflows 找到 workflow_id 及路径
  2. read_file 读取 .github/workflows/xxx.yml
  3. patch_file 精确修改触发条件/环境变量/步骤
  4. trigger_workflow 验证新工作流

📦 **缺失资源文件处理**：
  当项目中缺少图片、图标、证书等二进制资源时：
  1. 通过 file_tree / grep_in_file 确认资源路径及名称
  2. 调用 request_file 工具，说明需要的文件名和用途
  3. 等待用户在聊天框上传后，用 write_file 写入到正确路径

==============================
超长文件处理策略
==============================
- 文件 > 200 行：必须使用 start_line/end_line 分段读取，每次不超过 100 行
- 先读取前 50 行了解结构，再按需分段读取目标区域
- 使用 grep_in_file 精确定位目标行号，避免盲目翻阅
- batch_read 适合同时了解多个小文件（如配置文件组合）

==============================
重要规则
==============================
- 查看日志时先用 get_run_jobs 找到失败 Job ID，再用 get_job_logs 获取日志
- patch_file 比 write_file 更安全，修改工作流文件时优先使用 patch
- 修改前必须先用 grep_in_file 或 read_file 确认精确的行号
- commit message 使用中文，遵循 Conventional Commits（fix/feat/ci/chore/docs）
- 对话语言：中文；操作完成后给出简洁总结

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
    // ── 新工具 ───────────────────────────────────────────────────────────
    case "file_tree":    return fileTree(ctx, call.path || "", parseInt(call.depth || "3", 10));
    case "grep_in_file": return grepInFile(ctx, call.path, call.pattern, call.case_sensitive === "true");
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
    // ── Actions 工作流 ───────────────────────────────────────────────────────
    case "list_workflows":      return listWorkflows(ctx);
    case "get_workflow_runs":   return getWorkflowRuns(ctx, call.workflow_id || "", parseInt(call.limit || "10", 10));
    case "get_run_jobs":        return getRunJobs(ctx, call.run_id);
    case "get_job_logs":        return getJobLogs(ctx, call.job_id);
    case "trigger_workflow":    return triggerWorkflow(ctx, call.workflow_id, call.ref, undefined);
    case "cancel_workflow_run": return cancelWorkflowRun(ctx, call.run_id);
    case "rerun_workflow_run":  return rerunWorkflowRun(ctx, call.run_id, call.failed_jobs_only === "true");
    case "list_actions_secrets": return listActionsSecrets(ctx);
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
      list_files: "列出目录", read_file: "读取文件", patch_file: "局部修改文件",
      write_file: "写入文件", delete_file: "删除文件", search_code: "搜索代码",
      file_tree: "文件树", grep_in_file: "文件内搜索", batch_read: "批量读取文件",
      // 分支 & PR
      list_branches: "列出分支", list_commits: "提交历史", create_branch: "新建分支",
      list_pull_requests: "列出 PR", create_pr: "创建 PR", merge_pull_request: "合并 PR",
      // Issue
      list_issues: "列出 Issues", create_issue: "创建 Issue",
      // Actions 工作流
      list_workflows: "列出工作流", get_workflow_runs: "查看运行记录",
      get_run_jobs: "查看 Jobs", get_job_logs: "下载日志",
      trigger_workflow: "触发工作流", cancel_workflow_run: "取消运行",
      rerun_workflow_run: "重新运行", list_actions_secrets: "查看 Secrets",
      // 资源请求
      request_file: "请求上传文件",
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
          await streamAnswer("⚠️ 步骤执行失败（已重试 2 次），终止任务。", sendChunk);
          batchDone = true;
          break;
        }
      }

      // 将原始 assistantText（含 PLAN/STEP 标记）压入历史，保持上下文完整性
      fullMessages.push({ role: "assistant", content: rawText });
      fullMessages.push({
        role: "user",
        content: `工具执行结果：\n${toolResult}\n\n请根据结果继续执行下一步。若还有未完成的步骤，继续调用工具；若全部步骤已完成，输出简洁的完成总结（不要再输出工具 JSON）。`,
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
