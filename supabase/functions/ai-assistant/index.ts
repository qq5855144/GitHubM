// AI 助手 Edge Function v3
// 支持多模型：文心 ERNIE / DeepSeek / Gemini / Qwen / OpenAI / 自定义兼容接口
// ReAct Agent：AI 通过工具链读取/写入 GitHub 仓库文件
// 新增：任务计划持久化到 Supabase + 步骤失败自动重试

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── 模型配置 ────────────────────────────────────────────────────────────────

interface ModelConfig {
  /** wenxin | deepseek | gemini | qwen | openai | custom */
  type: string;
  /** 用户自带 API Key（DeepSeek/Gemini/Qwen/OpenAI/Custom） */
  api_key?: string;
  /** 自定义接口地址（custom 时必填） */
  endpoint?: string;
  /** 具体模型名称，如 deepseek-v4-flash / deepseek-v4-pro / gemini-2.5-flash-preview-05-20 */
  model?: string;
  /**
   * 采样温度（0–2）。
   * 用户可手动指定；若未指定，由 inferTemperature() 按任务类型自动推断。
   * 代码写操作建议 0.1，分析类 0.3，普通对话 0.7。
   */
  temperature?: number;
}

// 根据模型配置构建 LLM 请求参数
// ── Function Calling 工具 Schema 定义 ────────────────────────────────────────
// 仅用于支持 FC 的模型（deepseek / openai / gemini / qwen）
// 文心 / custom 仍走 system prompt 纯文本模式

/**
 * 判断 DeepSeek 模型是否处于思考（Thinking）模式。
 * 新命名规则（2026-05）：
 *   - deepseek-v4-pro  → 默认思考模式（对应旧 deepseek-reasoner）
 *   - deepseek-v4-flash → 支持非思考/思考切换（默认思考）
 *   - deepseek-chat    → 旧名称，已于 2026/07/24 弃用，等价于 deepseek-v4-flash 非思考模式
 *   - deepseek-reasoner → 旧名称，已于 2026/07/24 弃用，等价于 deepseek-v4-pro
 * 思考模式下：不支持 temperature / top_p / presence_penalty / frequency_penalty 参数
 */
function isDeepSeekThinkingModel(model?: string): boolean {
  if (!model) return false;
  // 明确包含 reasoner / v4-pro 视为思考模型
  return model.includes("reasoner") || model.includes("v4-pro");
}

/** 判断模型类型是否支持 OpenAI 兼容 function calling */
function supportsFunctionCalling(type: string, model?: string): boolean {
  // DeepSeek 思考模型（deepseek-reasoner / deepseek-v4-pro）不支持 Function Calling
  // DeepSeek 新文档说明：思考模式下 tools 参数被忽略，会产生兼容性问题
  if (type === "deepseek" && isDeepSeekThinkingModel(model)) return false;
  return ["deepseek", "openai", "gemini", "qwen"].includes(type);
}

// 单个工具的 Schema 定义（OpenAI function 格式）
interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ── 文件操作 ────────────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "list_files",
      description: "列出仓库指定目录下的文件和子目录",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "目录路径，根目录传空字符串 \"\"" },
      }, required: ["path"] },
    },
  },
  {
    type: "function", function: {
      name: "file_tree",
      description: "递归获取完整文件树，适合快速了解项目结构（推荐优先使用）",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "起始路径，根目录传空字符串 \"\"" },
        depth: { type: "string", description: "最大递归深度，默认 \"3\"" },
      }, required: ["path"] },
    },
  },
  {
    type: "function", function: {
      name: "read_file",
      description: "读取文件内容（带行号）。大文件可用 start_line/end_line 分段读取，每次最多 500 行",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "文件路径" },
        start_line: { type: "string", description: "起始行号（可选，不填则从第 1 行开始）" },
        end_line: { type: "string", description: "结束行号（可选，不填则读到文件末尾）" },
      }, required: ["path"] },
    },
  },
  {
    type: "function", function: {
      name: "get_file_info",
      description: "获取文件基本信息（总行数、文件大小），适合读取大文件前制定分段计划",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "文件路径" },
      }, required: ["path"] },
    },
  },
  {
    type: "function", function: {
      name: "grep_in_file",
      description: "在单个文件内搜索关键词（支持大文件全文搜索）。context_lines > 0 时返回匹配行前后 N 行上下文（用于理解代码背景），适合修改前精准定位行号",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "文件路径" },
        pattern: { type: "string", description: "搜索关键词或正则表达式" },
        case_sensitive: { type: "string", description: "是否大小写敏感，\"true\" 或 \"false\"，默认 \"false\"" },
        context_lines: { type: "string", description: "匹配行前后各展示 N 行上下文（默认 \"0\" 仅精确行，建议 \"3\"–\"5\"）" },
        offset: { type: "string", description: "翻页偏移量，第一页传 \"0\"，超出时系统提示下一页偏移值" },
      }, required: ["path", "pattern"] },
    },
  },
  {
    type: "function", function: {
      name: "batch_read",
      description: "批量读取多个文件（逗号分隔路径，最多 5 个），每个文件返回前 300 行",
      parameters: { type: "object", properties: {
        paths: { type: "string", description: "逗号分隔的文件路径列表，如 \"src/a.ts,src/b.ts\"" },
      }, required: ["paths"] },
    },
  },
  {
    type: "function", function: {
      name: "grep_in_repo",
      description: "全仓库搜索关键词，返回匹配文件路径和精确行号",
      parameters: { type: "object", properties: {
        query: { type: "string", description: "搜索关键词" },
        file_pattern: { type: "string", description: "限制搜索的目录前缀，如 \"src/\"（可选）" },
        offset: { type: "string", description: "翻页偏移量，第一页传 \"0\"" },
      }, required: ["query"] },
    },
  },
  {
    type: "function", function: {
      name: "search_code",
      description: "通过 GitHub Search API 搜索代码（仅返回文件路径，无行号）",
      parameters: { type: "object", properties: {
        query: { type: "string", description: "搜索关键词" },
      }, required: ["query"] },
    },
  },
  {
    type: "function", function: {
      name: "patch_file",
      description: "局部修改文件指定行范围（推荐，仅替换 start_line 到 end_line 的内容）",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "文件路径" },
        start_line: { type: "string", description: "起始行号（从 1 开始）" },
        end_line: { type: "string", description: "结束行号（含）" },
        content: { type: "string", description: "替换内容（多行用 \\n 分隔）" },
        message: { type: "string", description: "commit 消息" },
        branch: { type: "string", description: "目标分支（可选，默认用仓库目标分支）" },
      }, required: ["path", "start_line", "end_line", "content", "message"] },
    },
  },
  {
    type: "function", function: {
      name: "batch_patch",
      description: "批量局部修改同一文件多处非连续行，合并为单个 commit",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "文件路径" },
        patches: { type: "string", description: "JSON 数组字符串，每项含 start_line/end_line/content" },
        message: { type: "string", description: "commit 消息" },
        branch: { type: "string", description: "目标分支（可选）" },
      }, required: ["path", "patches", "message"] },
    },
  },
  {
    type: "function", function: {
      name: "write_file",
      description: "全量写入文件（新建文件或大幅重写时使用）",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "完整文件内容" },
        message: { type: "string", description: "commit 消息" },
        branch: { type: "string", description: "目标分支（可选）" },
      }, required: ["path", "content", "message"] },
    },
  },
  {
    type: "function", function: {
      name: "delete_file",
      description: "删除仓库中的文件",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "文件路径" },
        message: { type: "string", description: "commit 消息" },
        branch: { type: "string", description: "目标分支（可选）" },
      }, required: ["path", "message"] },
    },
  },
  {
    type: "function", function: {
      name: "search_and_replace",
      description: "全仓库一键搜索替换，自动找到所有匹配行并批量修改，合并 commit",
      parameters: { type: "object", properties: {
        pattern: { type: "string", description: "要替换的目标字符串" },
        replacement: { type: "string", description: "替换为的新字符串" },
        file_pattern: { type: "string", description: "限制搜索范围的目录前缀（可选）" },
        message: { type: "string", description: "commit 消息" },
        branch: { type: "string", description: "目标分支（可选）" },
      }, required: ["pattern", "replacement", "message"] },
    },
  },
  {
    type: "function", function: {
      name: "preview_diff",
      description: "预览修改效果（不实际写入），修改前确认内容正确",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "文件路径" },
        start_line: { type: "string", description: "起始行号" },
        end_line: { type: "string", description: "结束行号" },
        content: { type: "string", description: "新内容" },
      }, required: ["path", "start_line", "end_line", "content"] },
    },
  },
  {
    type: "function", function: {
      name: "undo_last_commit",
      description: "撤销最后一次提交（逐文件恢复到上一版本，生成新的 Revert commit）",
      parameters: { type: "object", properties: {
        branch: { type: "string", description: "目标分支（可选）" },
      } },
    },
  },
  // ── 分支 & PR ────────────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "list_branches",
      description: "列出仓库所有分支",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function", function: {
      name: "list_commits",
      description: "获取提交历史（可按路径或分支筛选）",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "限制到特定文件路径（可选）" },
        branch: { type: "string", description: "分支名（可选）" },
      } },
    },
  },
  {
    type: "function", function: {
      name: "create_branch",
      description: "新建分支",
      parameters: { type: "object", properties: {
        branch: { type: "string", description: "新分支名" },
        from: { type: "string", description: "基于哪个分支创建（可选，默认用目标分支）" },
      }, required: ["branch"] },
    },
  },
  {
    type: "function", function: {
      name: "list_pull_requests",
      description: "列出 Pull Requests",
      parameters: { type: "object", properties: {
        state: { type: "string", description: "状态过滤：\"open\"（默认）、\"closed\" 或 \"all\"" },
      } },
    },
  },
  {
    type: "function", function: {
      name: "create_pr",
      description: "创建 Pull Request。head/base 填写分支名（不加 owner: 前缀），title 不能为空，head 与 base 必须有差异提交",
      parameters: { type: "object", properties: {
        title: { type: "string", description: "PR 标题（不能为空）" },
        head: { type: "string", description: "来源分支名（不加 owner: 前缀）" },
        base: { type: "string", description: "目标分支名（不加 owner: 前缀）" },
        body: { type: "string", description: "PR 描述（可选）" },
      }, required: ["title", "head", "base"] },
    },
  },
  {
    type: "function", function: {
      name: "merge_pull_request",
      description: "合并 Pull Request",
      parameters: { type: "object", properties: {
        pull_number: { type: "string", description: "PR 编号" },
        merge_method: { type: "string", description: "合并方式：\"squash\"（默认）、\"merge\" 或 \"rebase\"" },
        commit_title: { type: "string", description: "合并 commit 标题（可选）" },
      }, required: ["pull_number"] },
    },
  },
  {
    type: "function", function: {
      name: "close_pr",
      description: "关闭 Pull Request（不合并）",
      parameters: { type: "object", properties: {
        pull_number: { type: "string", description: "PR 编号" },
        comment: { type: "string", description: "关闭时附带的评论（可选）" },
      }, required: ["pull_number"] },
    },
  },
  {
    type: "function", function: {
      name: "get_pr_files",
      description: "查看 PR 的文件变更列表",
      parameters: { type: "object", properties: {
        pull_number: { type: "string", description: "PR 编号" },
      }, required: ["pull_number"] },
    },
  },
  {
    type: "function", function: {
      name: "submit_pr_review",
      description: "提交 PR 代码审查（APPROVE / REQUEST_CHANGES / COMMENT）",
      parameters: { type: "object", properties: {
        pull_number: { type: "string", description: "PR 编号" },
        event: { type: "string", description: "审查类型：\"APPROVE\"、\"REQUEST_CHANGES\" 或 \"COMMENT\"" },
        body: { type: "string", description: "审查意见" },
      }, required: ["pull_number", "event", "body"] },
    },
  },
  // ── Issue ────────────────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "list_issues",
      description: "列出 Issues",
      parameters: { type: "object", properties: {
        state: { type: "string", description: "状态：\"open\"（默认）、\"closed\" 或 \"all\"" },
      } },
    },
  },
  {
    type: "function", function: {
      name: "search_issues",
      description: "按关键词、标签、作者搜索 Issues 或 PR",
      parameters: { type: "object", properties: {
        query: { type: "string", description: "搜索关键词" },
        state: { type: "string", description: "状态：\"open\"、\"closed\" 或 \"all\"" },
        labels: { type: "string", description: "标签（逗号分隔，可选）" },
        assignee: { type: "string", description: "负责人用户名（可选）" },
        limit: { type: "string", description: "返回数量限制（默认 \"20\"）" },
      }, required: ["query"] },
    },
  },
  {
    type: "function", function: {
      name: "get_issue_details",
      description: "获取 Issue 详情（含正文和所有评论）",
      parameters: { type: "object", properties: {
        issue_number: { type: "string", description: "Issue 编号" },
      }, required: ["issue_number"] },
    },
  },
  {
    type: "function", function: {
      name: "create_issue",
      description: "创建新 Issue",
      parameters: { type: "object", properties: {
        title: { type: "string", description: "Issue 标题" },
        body: { type: "string", description: "Issue 正文描述" },
        labels: { type: "string", description: "标签（逗号分隔，可选）" },
      }, required: ["title", "body"] },
    },
  },
  {
    type: "function", function: {
      name: "update_issue",
      description: "更新 Issue（标题、正文、状态、标签、负责人，仅填需要改的字段）",
      parameters: { type: "object", properties: {
        issue_number: { type: "string", description: "Issue 编号" },
        title: { type: "string", description: "新标题（可选）" },
        body: { type: "string", description: "新正文（可选）" },
        state: { type: "string", description: "新状态：\"open\" 或 \"closed\"（可选）" },
        labels: { type: "string", description: "新标签（逗号分隔，可选）" },
        assignees: { type: "string", description: "新负责人（逗号分隔，可选）" },
      }, required: ["issue_number"] },
    },
  },
  {
    type: "function", function: {
      name: "close_issue",
      description: "关闭 Issue（可附带结论评论）",
      parameters: { type: "object", properties: {
        issue_number: { type: "string", description: "Issue 编号" },
        comment: { type: "string", description: "关闭时附带的评论（可选）" },
      }, required: ["issue_number"] },
    },
  },
  {
    type: "function", function: {
      name: "add_comment",
      description: "在 Issue 或 PR 下添加评论",
      parameters: { type: "object", properties: {
        issue_number: { type: "string", description: "Issue 或 PR 编号" },
        body: { type: "string", description: "评论内容" },
      }, required: ["issue_number", "body"] },
    },
  },
  // ── 仓库信息 ─────────────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "get_repo_info",
      description: "查看仓库基本信息（语言、Stars、默认分支、Topics 等）",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function", function: {
      name: "get_commit_diff",
      description: "查看某次提交的文件变更统计（diff）",
      parameters: { type: "object", properties: {
        sha: { type: "string", description: "commit SHA" },
      }, required: ["sha"] },
    },
  },
  {
    type: "function", function: {
      name: "compare_commits",
      description: "对比两个 commit / 分支 / tag 的所有文件变更（含 diff patch 片段）",
      parameters: { type: "object", properties: {
        base: { type: "string", description: "基准 commit / 分支 / tag" },
        head: { type: "string", description: "比较目标 commit / 分支 / tag" },
      }, required: ["base", "head"] },
    },
  },
  {
    type: "function", function: {
      name: "auto_review",
      description: "自动代码审查：检查最近 N 次 commit 变更文件的质量问题",
      parameters: { type: "object", properties: {
        commit_count: { type: "string", description: "检查最近几次 commit（默认 \"1\"）" },
        sha: { type: "string", description: "指定从某个 commit SHA 开始检查（可选）" },
      } },
    },
  },
  // ── Actions 工作流 ───────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "list_workflows",
      description: "列出仓库所有 Actions 工作流",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function", function: {
      name: "get_workflow_runs",
      description: "查看工作流最近运行记录（仅查历史，不等待）",
      parameters: { type: "object", properties: {
        workflow_id: { type: "string", description: "工作流文件名或 ID（如 \"deploy.yml\"），不填则查全部" },
        limit: { type: "string", description: "返回数量（默认 \"5\"）" },
      } },
    },
  },
  {
    type: "function", function: {
      name: "trigger_workflow",
      description: "触发工作流（workflow_dispatch 事件）。触发后必须立即调用 check_run_status 等待结果",
      parameters: { type: "object", properties: {
        workflow_id: { type: "string", description: "工作流文件名或 ID（如 \"deploy.yml\"）" },
        ref: { type: "string", description: "触发的分支或 tag" },
      }, required: ["workflow_id", "ref"] },
    },
  },
  {
    type: "function", function: {
      name: "check_run_status",
      description: "等待工作流运行完成并返回结果。workflow_type: \"normal\"（普通）、\"build_apk\"（Android 构建约3分钟）、\"fast\"（快速脚本）",
      parameters: { type: "object", properties: {
        run_id: { type: "string", description: "运行 ID（trigger_workflow 返回的 run_id）" },
        workflow_type: { type: "string", description: "工作流类型：\"normal\"、\"build_apk\" 或 \"fast\"" },
      }, required: ["run_id", "workflow_type"] },
    },
  },
  {
    type: "function", function: {
      name: "get_run_jobs",
      description: "查看某次运行的 Jobs 及步骤（check_run_status 失败时才需要）",
      parameters: { type: "object", properties: {
        run_id: { type: "string", description: "运行 ID" },
      }, required: ["run_id"] },
    },
  },
  {
    type: "function", function: {
      name: "get_job_logs",
      description: [
        "下载 Job 日志。",
        "• 不传 start_line/end_line：返回全局统计（总行数/字符数）+ 智能错误摘要（ERROR/FAILED/Exception 上下文各 35 行）+ 末尾 Build Summary，适合首次分析。",
        "• 传入 start_line/end_line：精准返回指定行范围（1-based），每次最多 800 行，可多次调用覆盖全部日志。",
        "• 使用策略：先不传范围拿错误摘要；若需完整日志，先看总行数，再按 800 行一段循环读取。",
      ].join(" "),
      parameters: { type: "object", properties: {
        job_id:     { type: "string", description: "Job ID" },
        start_line: { type: "string", description: "起始行号（1-based，含），不传则智能摘要模式" },
        end_line:   { type: "string", description: "结束行号（1-based，含），不传则智能摘要模式" },
      }, required: ["job_id"] },
    },
  },
  {
    type: "function", function: {
      name: "cancel_workflow_run",
      description: "取消正在运行的工作流",
      parameters: { type: "object", properties: {
        run_id: { type: "string", description: "运行 ID" },
      }, required: ["run_id"] },
    },
  },
  {
    type: "function", function: {
      name: "rerun_workflow_run",
      description: "重新运行失败的工作流（可选择只重跑失败的 jobs）",
      parameters: { type: "object", properties: {
        run_id: { type: "string", description: "运行 ID" },
        failed_jobs_only: { type: "string", description: "是否只重跑失败 jobs：\"true\" 或 \"false\"" },
      }, required: ["run_id"] },
    },
  },
  {
    type: "function", function: {
      name: "list_actions_secrets",
      description: "查看仓库 Actions Secrets 名称列表（值不可见）",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function", function: {
      name: "list_actions_variables",
      description: "查看仓库 Actions Variables（明文环境变量）",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function", function: {
      name: "set_actions_variable",
      description: "创建或更新 Actions Variable（明文环境变量，加密 Secrets 需在 GitHub 网页设置）",
      parameters: { type: "object", properties: {
        name: { type: "string", description: "变量名（大写字母+下划线）" },
        value: { type: "string", description: "变量值" },
      }, required: ["name", "value"] },
    },
  },
  {
    type: "function", function: {
      name: "get_run_artifacts",
      description: "查询某次运行产生的构建产物（Artifacts）列表",
      parameters: { type: "object", properties: {
        run_id: { type: "string", description: "运行 ID" },
      }, required: ["run_id"] },
    },
  },
  {
    type: "function", function: {
      name: "run_lint",
      description: "触发并运行 Lint 检查工作流，等待结果",
      parameters: { type: "object", properties: {
        branch: { type: "string", description: "检查的目标分支（可选）" },
      } },
    },
  },
  {
    type: "function", function: {
      name: "check_security",
      description: "安全扫描：检查硬编码密钥、eval、SQL 注入、XSS 等常见安全隐患",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "扫描路径（如 \"src/\"）" },
      }, required: ["path"] },
    },
  },
  {
    type: "function", function: {
      name: "trigger_and_monitor_build",
      description: "触发构建工作流并全程自动监控：失败时自动提取日志供分析修复，循环直到成功",
      parameters: { type: "object", properties: {
        workflow_id: { type: "string", description: "工作流文件名（如 \"build.yml\"）" },
        ref: { type: "string", description: "触发分支" },
        branch: { type: "string", description: "修复提交的目标分支（可选）" },
        max_fix_attempts: { type: "string", description: "最大自动修复次数（默认 \"3\"）" },
      }, required: ["workflow_id", "ref"] },
    },
  },
  // ── Release ──────────────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "list_releases",
      description: "列出最近的 Releases",
      parameters: { type: "object", properties: {
        limit: { type: "string", description: "返回数量（默认 \"10\"）" },
      } },
    },
  },
  {
    type: "function", function: {
      name: "get_latest_release",
      description: "获取最新 Release 信息（tag、名称、发布时间）",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function", function: {
      name: "create_release",
      description: "创建新 Release（tag + 标题 + 发布说明）",
      parameters: { type: "object", properties: {
        tag_name: { type: "string", description: "tag 名称（如 \"v1.2.0\"）" },
        name: { type: "string", description: "Release 标题" },
        body: { type: "string", description: "发布说明（Markdown 格式）" },
        draft: { type: "string", description: "是否为草稿：\"true\" 或 \"false\"" },
        prerelease: { type: "string", description: "是否为预发布：\"true\" 或 \"false\"" },
        branch: { type: "string", description: "基于哪个分支创建 tag（可选）" },
      }, required: ["tag_name", "name", "body"] },
    },
  },
  {
    type: "function", function: {
      name: "get_merged_prs_since",
      description: "获取指定时间点之后已合并的 PR 列表（含 labels、body、作者）",
      parameters: { type: "object", properties: {
        since: { type: "string", description: "起始时间（ISO 8601 格式，如 \"2024-01-15T10:30:00Z\"）" },
      }, required: ["since"] },
    },
  },
  // ── 文件请求 ─────────────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "request_file",
      description: "向用户请求上传文件（缺少图片/图标/证书等资源时使用）",
      parameters: { type: "object", properties: {
        filename: { type: "string", description: "需要的文件名（如 \"app-icon.png\"）" },
        description: { type: "string", description: "描述需要什么文件及规格要求" },
        mime_types: { type: "string", description: "允许的 MIME 类型（逗号分隔，如 \"image/png,image/jpeg\"）" },
      }, required: ["filename", "description"] },
    },
  },
  // ── 大文件高效操作工具（代码骨架 + 函数级读取）──────────────────────────────
  {
    type: "function", function: {
      name: "get_code_outline",
      description: "提取文件的代码骨架（函数/类/接口/类型列表 + 起止行号），不返回函数体。大文件操作必备第一步：先调用此工具建立全局结构认知，再用 read_function 或 read_file 精准读取目标函数，彻底避免逐段盲读整个文件。支持 TypeScript/JavaScript/Python/Go/Rust/Java/Kotlin。",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "文件路径，如 \"src/App.tsx\"" },
      }, required: ["path"] },
    },
  },
  {
    type: "function", function: {
      name: "read_function",
      description: "按函数/类/接口名称读取其完整体（含闭合括号），免去「先 grep 行号 → 再 read_file」两步。大文件修改必备：先 get_code_outline 找到目标符号名，再调用此工具一次拿到完整函数体。同名符号有多个时用 occurrence 指定第几个。",
      parameters: { type: "object", properties: {
        path: { type: "string", description: "文件路径" },
        function_name: { type: "string", description: "精确的函数/类/接口名称（区分大小写）" },
        occurrence: { type: "string", description: "同名符号有多个时取第几个（\"1\"=第一个，默认 \"1\"）" },
        ref: { type: "string", description: "git ref（分支名/tag/commit SHA），不填则读当前分支最新内容" },
      }, required: ["path", "function_name"] },
    },
  },
  // ── 工具自我改进 ──────────────────────────────────────────────────────────
  {
    type: "function", function: {
      name: "report_tool_issue",
      description: "当你发现某个工具存在缺陷、限制或可改进之处时调用此工具上报问题。例如：工具返回的信息不够完整、参数设计不合理、缺少某个功能、错误处理不当等。不要等任务结束才报告，发现即上报。",
      parameters: { type: "object", properties: {
        tool_name:   { type: "string", description: "有问题的工具名称（如 patch_file、read_file、get_job_logs）" },
        issue:       { type: "string", description: "具体问题描述：工具在什么情况下出现了什么问题，影响是什么" },
        severity:    { type: "string", description: "严重程度：low（轻微，有替代方案）| medium（影响效率）| high（导致任务失败）" },
        context:     { type: "string", description: "触发问题时的上下文：正在执行什么任务、调用参数是什么、得到了什么意外结果" },
      }, required: ["tool_name", "issue", "severity"] },
    },
  },
  {
    type: "function", function: {
      name: "propose_tool_fix",
      description: "在 report_tool_issue 之后，如果你知道如何修复这个工具问题，用此工具提交具体的代码改进方案。提供修改前和修改后的代码片段，帮助开发者快速应用改进。",
      parameters: { type: "object", properties: {
        tool_name:    { type: "string", description: "要改进的工具名称" },
        explanation:  { type: "string", description: "改进方案的说明：改了什么、为什么这样改、预期效果" },
        code_before:  { type: "string", description: "当前有问题的代码片段（函数体或关键逻辑，越精确越好）" },
        code_after:   { type: "string", description: "改进后的代码片段（与 code_before 对应的修改版本）" },
      }, required: ["tool_name", "explanation"] },
    },
  },
];

function buildLLMRequest(cfg: ModelConfig, platformKey: string): {
  url: string;
  headers: Record<string, string>;
  bodyExtra: Record<string, unknown>;
} {
  // 仅当 temperature 有值时才附加，避免覆盖模型默认行为
  const tempExtra = cfg.temperature !== undefined ? { temperature: cfg.temperature } : {};
  // 支持 FC 的模型注入 tools 定义，并设置 tool_choice:"auto" 让模型自主决定是否调用工具
  const fcExtra = supportsFunctionCalling(cfg.type, cfg.model)
    ? { tools: TOOL_DEFINITIONS, tool_choice: "auto", parallel_tool_calls: false }
    : {};
  switch (cfg.type) {
    case "deepseek": {
      // 新模型命名（2026-05）：
      //   deepseek-v4-flash  ← 对应旧 deepseek-chat（支持非思考/思考切换，默认思考）
      //   deepseek-v4-pro    ← 对应旧 deepseek-reasoner（强思考模型）
      // 旧名称 deepseek-chat / deepseek-reasoner 仍可用，将于 2026/07/24 弃用
      const dsModel = cfg.model || "deepseek-v4-flash";
      const dsIsThinking = isDeepSeekThinkingModel(dsModel);
      // 思考模式下不支持 temperature / top_p / presence_penalty / frequency_penalty
      const dsTempExtra = dsIsThinking ? {} : tempExtra;
      // 思考模式控制参数：
      //   thinking.type = "enabled" 开启思考（默认），"disabled" 关闭
      //   reasoning_effort = "high"（默认，适合普通请求） | "max"（复杂 Agent 请求）
      // deepseek-v4-flash 非 FC 时也注入思考参数（按需开启）；思考模型始终开启
      const dsThinkingExtra = dsIsThinking
        ? { thinking: { type: "enabled" }, reasoning_effort: "high" }
        : {};
      return {
        url: "https://api.deepseek.com/v1/chat/completions",
        headers: { Authorization: `Bearer ${cfg.api_key}` },
        bodyExtra: {
          model: dsModel,
          stream: true,
          // 新 API 支持最大 384K 输出；设 32768 兼顾成本与长任务需求
          max_tokens: 32768,
          ...dsTempExtra,
          ...dsThinkingExtra,
          ...fcExtra,
        },
      };
    }
    case "gemini":
      // Google AI Studio 提供 OpenAI 兼容接口，无需额外适配
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        headers: { Authorization: `Bearer ${cfg.api_key}` },
        bodyExtra: {
          model: cfg.model || "gemini-2.5-flash-preview-05-20",
          stream: true,
          max_tokens: 16384,
          ...tempExtra,
          ...fcExtra,
        },
      };
    case "qwen":
      // 阿里云 DashScope OpenAI 兼容接口
      return {
        url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        headers: { Authorization: `Bearer ${cfg.api_key}` },
        bodyExtra: {
          model: cfg.model || "qwen2.5-coder-32b-instruct",
          stream: true,
          max_tokens: 8192,
          ...tempExtra,
          ...fcExtra,
        },
      };
    case "openai":
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: { Authorization: `Bearer ${cfg.api_key}` },
        bodyExtra: { model: cfg.model || "gpt-4o-mini", stream: true, max_tokens: 16384, ...tempExtra, ...fcExtra },
      };
    case "custom":
      return {
        url: cfg.endpoint!,
        headers: cfg.api_key ? { Authorization: `Bearer ${cfg.api_key}` } : {},
        // 自定义接口不注入 tools（不确定是否支持 FC）
        bodyExtra: cfg.model
          ? { model: cfg.model, stream: true, max_tokens: 8192, ...tempExtra }
          : { stream: true, max_tokens: 8192, ...tempExtra },
      };
    default: // wenxin（platform managed）
      return {
        url: "https://app-bgc5z86utjwh-api-zYkZz8qovQ1L-gateway.appmiaoda.com/v2/chat/completions",
        headers: { "X-Gateway-Authorization": `Bearer ${platformKey}` },
        // 文心：enable_thinking=false + 不限制输出长度
        bodyExtra: { enable_thinking: false, max_tokens: 8192, ...tempExtra },
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
  const isWrite = options.method && options.method !== "GET";
  // GET 请求：在 URL 追加 _t=时间戳，彻底绕过 GitHub CDN 60s 强制缓存
  // 同时设置 no-cache 头双重保障；写请求不做处理，避免干扰
  let finalPath = apiPath;
  if (!isWrite) {
    finalPath += apiPath.includes("?") ? `&_t=${Date.now()}` : `?_t=${Date.now()}`;
  }
  const cacheHeaders: Record<string, string> = isWrite ? {} : {
    "Cache-Control": "no-cache, no-store",
    "Pragma": "no-cache",
  };
  const res = await fetch(`https://api.github.com${finalPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...cacheHeaders,
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

/**
 * 通过 Git Refs API 获取文件的最新 blob SHA，绕过 Contents API 的 CDN 缓存。
 * 流程：git/ref/heads/{branch} → git/commits/{sha} → git/trees/{sha}?recursive=1 → 找文件 SHA
 * 失败时 fallback 到 Contents API（仍带时间戳缓存破坏）。
 */
async function fetchLatestFileSha(
  ctx: GithubContext,
  filePath: string,
  branch: string,
): Promise<string | null> {
  try {
    // 1. 拿最新 commit SHA（Git Refs API 不走 CDN，近实时）
    const ref = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    const commitSha: string = ref?.object?.sha;
    if (!commitSha) return null;

    // 2. 拿 commit 对应的 tree SHA
    const commit = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/git/commits/${commitSha}`,
    );
    const treeSha: string = commit?.tree?.sha;
    if (!treeSha) return null;

    // 3. 递归遍历 tree，找到目标文件的 blob SHA
    const tree = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/git/trees/${treeSha}?recursive=1`,
    );
    const entry = (tree?.tree as Array<{ path: string; sha: string; type: string }>)
      ?.find(item => item.path === filePath && item.type === "blob");
    return entry?.sha ?? null;
  } catch {
    return null; // fallback 到调用方的 Contents API
  }
}

/**
 * 判断错误是否属于 SHA 冲突（409）。
 * GitHub 409 有两种：file conflict（真正的内容冲突）和 sha mismatch（SHA 过期）。
 * 我们只重试后者。
 */
function isShaConflict(err: unknown): boolean {
  if (!(err instanceof GithubApiError)) return false;
  if (err.status !== 409) return false;
  // 真正的合并冲突不重试
  const body = err.body.toLowerCase();
  return !body.includes("merge conflict") && !body.includes("pull request");
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
  ref?: string,
): Promise<{ content: string; sha: string; size: number; totalLines: number } | string> {
  // refQuery 只负责指定 ref，时间戳缓存破坏由 githubRequest 统一注入
  const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}${refQuery}`);
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
  contextLines = 0,
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
      regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
    }

    // 找到所有匹配的行索引
    const matchIndices: number[] = [];
    lines.forEach((line, i) => {
      if (regex.test(line)) matchIndices.push(i);
      regex.lastIndex = 0;
    });

    if (!matchIndices.length) {
      return `"${filePath}" 中未找到匹配 "${pattern}" 的行（共搜索 ${totalLines} 行）`;
    }

    // contextLines = 0：返回精确匹配行（原有行为）
    if (contextLines <= 0) {
      const allMatches = matchIndices.map(i =>
        `${String(i + 1).padStart(6, " ")} | ${lines[i]}`
      );
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
    }

    // contextLines > 0：将相邻匹配合并为上下文块，减少重复行
    const ctx_ = Math.max(0, Math.min(contextLines, 20));
    // 合并重叠区间：[(from, to), ...]
    const ranges: Array<[number, number]> = [];
    for (const idx of matchIndices) {
      const from = Math.max(0, idx - ctx_);
      const to   = Math.min(lines.length - 1, idx + ctx_);
      if (ranges.length && from <= ranges[ranges.length - 1][1] + 1) {
        ranges[ranges.length - 1][1] = Math.max(ranges[ranges.length - 1][1], to);
      } else {
        ranges.push([from, to]);
      }
    }

    const PAGE_BLOCKS = 30; // 每页最多 30 个上下文块
    const safeOffset  = Math.max(0, Math.min(offset, ranges.length - 1));
    const pageRanges  = ranges.slice(safeOffset, safeOffset + PAGE_BLOCKS);
    const remaining   = ranges.length - safeOffset - pageRanges.length;

    const blocks = pageRanges.map(([from, to]) => {
      const blockLines = lines.slice(from, to + 1).map((line, k) => {
        const lineNo = from + k + 1;
        // 高亮匹配行（用 > 标记）
        const isMatch = matchIndices.includes(from + k);
        return `${isMatch ? ">" : " "} ${String(lineNo).padStart(6, " ")} | ${line}`;
      });
      return blockLines.join("\n");
    });

    const header = `"${filePath}" 匹配 "${pattern}" 共 ${matchIndices.length} 处` +
      `，展示为 ${ranges.length} 个上下文块（各含前后 ${ctx_} 行）` +
      (safeOffset > 0 ? `，当前第 ${safeOffset + 1}–${safeOffset + pageRanges.length} 块` : `，第 1–${pageRanges.length} 块`) +
      `（文件共 ${totalLines} 行）：`;

    const truncHint = remaining > 0
      ? `\n\n⚠️ 还有 ${remaining} 个块未显示。继续查看请调用：` +
        `{"tool":"grep_in_file","path":"${filePath}","pattern":"${pattern}","context_lines":"${ctx_}","offset":"${safeOffset + PAGE_BLOCKS}"}`
      : "";

    return `${header}\n\`\`\`\n${blocks.join("\n── ──\n")}\n\`\`\`` + truncHint;
  } catch (e) { return diagnose4xx(e, "grep_in_file"); }
}

// ── 代码骨架符号提取（语言无关正则策略）────────────────────────────────────────
interface OutlineEntry {
  kind: string;   // function / class / interface / type / const / enum / method
  name: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
}

/**
 * 解析文件源码，提取顶层（及类级）符号骨架。
 * 支持 TypeScript / JavaScript / Python / Go / Java / Kotlin / Rust（正则策略）。
 * 不依赖外部 AST 库，用括号计数法确定函数/类的结束行。
 */
function parseCodeOutline(source: string, ext: string): OutlineEntry[] {
  const lines = source.split("\n");
  const entries: OutlineEntry[] = [];

  if (ext === ".py") {
    // Python：缩进+冒号法
    const defRe = /^(class|def|async def)\s+(\w+)/;
    for (let i = 0; i < lines.length; i++) {
      const m = defRe.exec(lines[i]);
      if (!m) continue;
      const indent = lines[i].search(/\S/);
      const kind = m[1] === "class" ? "class" : "function";
      const name = m[2];
      // 找结束行：下一个同级或更小缩进的非空行（含 class/def）
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        const trimmed = lines[j].trim();
        if (!trimmed) { end = j; continue; }
        const jIndent = lines[j].search(/\S/);
        if (jIndent <= indent && trimmed) { end = j - 1; break; }
        end = j;
        if (j === lines.length - 1) end = j;
      }
      entries.push({ kind, name, startLine: i + 1, endLine: end + 1, isExported: false });
    }
    return entries;
  }

  // C 风格语言（TS/JS/Go/Java/Kotlin/Rust 等）：括号计数法
  const isTSJS  = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext);
  const isGo    = ext === ".go";
  const isRust  = ext === ".rs";

  // 逐行扫描声明头，记录 startLine；然后从该行开始扫描括号，确定 endLine
  const declRe: RegExp[] = [];

  if (isTSJS) {
    declRe.push(
      // export default function / export async function / function
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/,
      // export class / class
      /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
      // export interface
      /^(?:export\s+)?interface\s+(\w+)/,
      // export type X = { / export type X<...> = {
      /^(?:export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=/,
      // export enum
      /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/,
      // export const name = (...) => {  /  export const name = function(
      /^(?:export\s+)?const\s+(\w+)\s*(?::\s*\S+\s*)?=\s*(?:async\s+)?(?:function|\([^)]*\)\s*(?::\s*\S+\s*)?=>)/,
    );
  } else if (isGo) {
    declRe.push(
      /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/,  // func (receiver) Name(
      /^type\s+(\w+)\s+(?:struct|interface)/,
    );
  } else if (isRust) {
    declRe.push(
      /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
      /^(?:pub\s+)?struct\s+(\w+)/,
      /^(?:pub\s+)?(?:trait|impl)\s+(\w+)/,
      /^(?:pub\s+)?enum\s+(\w+)/,
    );
  } else {
    // Java / Kotlin / C# 等：通用函数/类声明
    declRe.push(
      /^(?:public|private|protected|internal|static|final|abstract|override|suspend|\s)*(?:class|interface|enum)\s+(\w+)/,
      /^(?:public|private|protected|internal|static|final|abstract|override|suspend|\s)*(?:\w+(?:<[^>]*>)?)\s+(\w+)\s*\(/,
    );
  }

  // 括号深度追踪：从起始行找到对应的闭合括号行
  function findEndLine(startIdx: number): number {
    let depth = 0;
    let opened = false;
    for (let j = startIdx; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") { depth++; opened = true; }
        else if (ch === "}") { depth--; }
      }
      if (opened && depth <= 0) return j + 1; // 1-based
      // 安全上限：单个符号最多 2000 行
      if (j - startIdx > 2000) return Math.min(startIdx + 2000, lines.length);
    }
    return lines.length;
  }

  // 确定 kind 字符串
  function getKind(line: string, ext2: string): string {
    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext2)) {
      if (/\bclass\b/.test(line))     return "class";
      if (/\binterface\b/.test(line)) return "interface";
      if (/\btype\b/.test(line))      return "type";
      if (/\benum\b/.test(line))      return "enum";
      return "function";
    }
    if (ext2 === ".go") return /\btype\b/.test(line) ? "type" : "function";
    if (ext2 === ".rs") {
      if (/\bstruct\b/.test(line))   return "struct";
      if (/\btrait\b/.test(line))    return "trait";
      if (/\bimpl\b/.test(line))     return "impl";
      if (/\benum\b/.test(line))     return "enum";
      return "function";
    }
    if (/\bclass\b/.test(line) || /\binterface\b/.test(line)) return "class";
    return "function";
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 跳过注释行、空行
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    // 只匹配顶层或一级缩进（类内方法）
    const indent = line.search(/\S/);
    if (indent > 4) continue;

    for (const re of declRe) {
      const m = re.exec(line);
      if (!m) continue;
      const name = m[1];
      if (!name || name.length < 2) continue;
      const isExported = /^export\b/.test(trimmed) || /^pub\b/.test(trimmed) ||
                         /^public\b/.test(trimmed);
      const kind = getKind(line, ext);
      const endLine = findEndLine(i);
      entries.push({ kind, name, startLine: i + 1, endLine, isExported });
      break; // 一行只匹配一个声明
    }
  }

  return entries;
}

/**
 * get_code_outline 工具：读取文件并提取代码骨架（函数/类/接口/类型列表）。
 * 不返回函数体，只返回符号名 + 起止行号。让 AI 建立文件全局认知后，
 * 再用 read_function 或 read_file 精准读取目标函数。
 */
async function getCodeOutline(ctx: GithubContext, filePath: string): Promise<string> {
  try {
    const result = await fetchFileContent(ctx, filePath);
    if (typeof result === "string") return result;

    const { content, totalLines, size } = result;
    const ext = ("." + filePath.split(".").pop()).toLowerCase();
    const entries = parseCodeOutline(content, ext);

    if (!entries.length) {
      return `"${filePath}" 中未能识别出代码符号（共 ${totalLines} 行）。\n` +
        `可能原因：文件格式不受支持、全是注释/数据，或者是配置文件。\n` +
        `支持语言：TypeScript/JavaScript/Python/Go/Rust/Java/Kotlin。`;
    }

    const sizeKB = Math.round(size / 1024);
    const sizeNote = sizeKB > 0 ? ` | ${sizeKB}KB` : "";

    const lines = entries.map(e => {
      const exported = e.isExported ? "↑" : " ";
      const span = e.endLine > e.startLine
        ? `L${e.startLine}–${e.endLine}（${e.endLine - e.startLine + 1}行）`
        : `L${e.startLine}`;
      return `${exported} ${span.padEnd(22)} ${e.kind.padEnd(10)} ${e.name}`;
    });

    const legend = `（↑=导出  列格式：行范围  符号类型  符号名）`;
    const hint = `\n💡 读取完整函数体：{"tool":"read_function","path":"${filePath}","function_name":"<函数名>"}\n   或精确读取行范围：{"tool":"read_file","path":"${filePath}","start_line":"N","end_line":"M"}`;

    return `文件 "${filePath}" 代码骨架（共 ${entries.length} 个符号 | ${totalLines} 行${sizeNote}）${legend}：\n\`\`\`\n${lines.join("\n")}\n\`\`\`` + hint;
  } catch (e) { return diagnose4xx(e, "get_code_outline"); }
}

/**
 * read_function 工具：按函数/类/符号名读取完整体，免去"先 grep 行号 → 再 read_file"两步。
 * 支持重名符号选择（第几个匹配），以及从指定 ref 读取。
 *
 * @param functionName 精确的函数/类/接口/方法名（区分大小写）
 * @param occurrence   若同名符号有多个，取第几个（1-based，默认 1）
 * @param ref          git ref（分支名/tag/commit SHA），不填则读默认分支当前内容
 */
async function readFunction(
  ctx: GithubContext,
  filePath: string,
  functionName: string,
  occurrence = 1,
  ref?: string,
): Promise<string> {
  try {
    const result = await fetchFileContent(ctx, filePath, ref);
    if (typeof result === "string") return result;

    const { content, totalLines, size } = result;
    const ext = ("." + filePath.split(".").pop()).toLowerCase();
    const entries = parseCodeOutline(content, ext);

    // 精确名称匹配
    const matched = entries.filter(e => e.name === functionName);

    if (!matched.length) {
      // 降级：模糊匹配（忽略大小写），给出候选列表
      const fuzzy = entries.filter(e => e.name.toLowerCase() === functionName.toLowerCase());
      if (fuzzy.length) {
        const suggestions = fuzzy.map(e => `  • L${e.startLine}  ${e.kind}  ${e.name}`).join("\n");
        return `"${filePath}" 中未找到名为 "${functionName}" 的符号（大小写不匹配）。\n` +
          `相近名称：\n${suggestions}\n` +
          `请用精确名称重新调用 read_function，或用 get_code_outline 查看全部符号。`;
      }
      // 给出全量骨架帮助 AI 找到正确名称
      const outline = entries.slice(0, 30).map(e => `  • L${e.startLine}  ${e.kind}  ${e.name}`).join("\n");
      const moreHint = entries.length > 30 ? `\n  … 还有 ${entries.length - 30} 个符号，请用 get_code_outline 查看完整列表` : "";
      return `"${filePath}" 中未找到名为 "${functionName}" 的符号。\n` +
        `文件共 ${entries.length} 个符号，前 30 个：\n${outline}${moreHint}\n` +
        `提示：使用 get_code_outline 获取完整骨架，或 grep_in_file 搜索关键词定位行号。`;
    }

    // occurrence 超出范围时返回所有匹配概览
    const occ = Math.max(1, Math.min(occurrence, matched.length));
    if (occ < occurrence) {
      const overview = matched.map((e, i) => `  ${i + 1}. L${e.startLine}–${e.endLine}（${e.endLine - e.startLine + 1}行）`).join("\n");
      return `"${filePath}" 中共找到 ${matched.length} 个名为 "${functionName}" 的符号（你请求第 ${occurrence} 个，但只有 ${matched.length} 个）：\n${overview}`;
    }

    const entry = matched[occ - 1];
    const lines = content.split("\n");
    const body   = lines.slice(entry.startLine - 1, entry.endLine);
    const numbered = body.map((l, i) =>
      `${String(entry.startLine + i).padStart(6, " ")} | ${l}`
    ).join("\n");

    const sizeKB = Math.round(size / 1024);
    const sizeNote = sizeKB > 50 ? ` | 文件 ${sizeKB}KB` : "";
    const multiHint = matched.length > 1
      ? `\n💡 此文件共有 ${matched.length} 个同名符号，当前显示第 ${occ} 个。` +
        `读取其他：{"tool":"read_function","path":"${filePath}","function_name":"${functionName}","occurrence":"${occ < matched.length ? occ + 1 : 1}"}`
      : "";

    return `${entry.kind} \`${entry.name}\` — "${filePath}" L${entry.startLine}–${entry.endLine}（${body.length} 行${sizeNote}）：\n` +
      `\`\`\`\n${numbered}\n\`\`\`\n` +
      `_SHA 快照：文件共 ${totalLines} 行${sizeNote}_` +
      multiHint;
  } catch (e) { return diagnose4xx(e, "read_function"); }
}

/**
 * 批量读取多个文件（逗号分隔路径），一次工具调用读取多个文件，减少 round trip。
 * 每个文件最多返回前 300 行；自动支持大文件（>1MB）Blobs API 切换。
 */
async function batchReadFiles(ctx: GithubContext, paths: string): Promise<string> {
  const fileList = paths.split(",").map(p => p.trim()).filter(Boolean).slice(0, 5);
  if (!fileList.length) return "请提供至少一个文件路径";
  const PREVIEW_LINES = 300;

  // 并发读取所有文件，最多 5 个同时发起请求
  const settled = await Promise.allSettled(
    fileList.map(fp => fetchFileContent(ctx, fp).then(fetched => ({ fp, fetched })))
  );

  const results: string[] = [];
  for (const res of settled) {
    if (res.status === "rejected") {
      const idx = settled.indexOf(res);
      results.push(`\n=== ${fileList[idx]} ===\n${diagnose4xx(res.reason, "batch_read")}`);
      continue;
    }
    const { fp, fetched } = res.value;
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
    const MAX_CHUNK = 500;
    // 自动全文读取阈值：不带行范围且文件 ≤ 5000 行时，自动分段拼接完整返回
    const AUTO_FULL_READ_LIMIT = 5000;

    const fileSizeKB = data.size ? Math.round(data.size / 1024) : null;
    const sizeNote = fileSizeKB && fileSizeKB > 100 ? ` | 文件大小: ${fileSizeKB}KB` : "";

    // ── 未指定行范围 + 文件 ≤ AUTO_FULL_READ_LIMIT 行 → 自动全文返回 ──────────
    if (!startLine && !endLine && totalLines <= AUTO_FULL_READ_LIMIT) {
      const numberedContent = allLines
        .map((line, i) => `${String(i + 1).padStart(6, " ")} | ${line}`)
        .join("\n");
      return (
        `文件 "${filePath}" 第 1–${totalLines} 行（共 ${totalLines} 行，完整内容）${sizeNote}：\n\`\`\`\n${numberedContent}\n\`\`\`` +
        `\n_SHA: ${data.sha} | 总行数: ${totalLines}${sizeNote}_`
      );
    }

    // ── 未指定行范围 + 文件 > AUTO_FULL_READ_LIMIT 行 → 读第一段并强制续读提示 ─
    if (!startLine && !endLine && totalLines > AUTO_FULL_READ_LIMIT) {
      const from = 1;
      const to = MAX_CHUNK;
      const selectedLines = allLines.slice(0, to);
      const numberedContent = selectedLines
        .map((line, i) => `${String(i + 1).padStart(6, " ")} | ${line}`)
        .join("\n");
      return (
        `文件 "${filePath}" 第 ${from}–${to} 行（共 ${totalLines} 行${sizeNote}）：\n\`\`\`\n${numberedContent}\n\`\`\`` +
        `\n_SHA: ${data.sha} | 总行数: ${totalLines}${sizeNote}_` +
        `\n\n🔴 **[必读]** 文件共 ${totalLines} 行，本次仅返回第 ${from}–${to} 行，内容不完整。` +
        `\n⚠️ **必须立即继续读取剩余内容，不得停止**，按以下顺序逐段调用：` +
        Array.from({ length: Math.ceil((totalLines - to) / MAX_CHUNK) }, (_, k) => {
          const s = to + k * MAX_CHUNK + 1;
          const e = Math.min(totalLines, to + (k + 1) * MAX_CHUNK);
          return `\n   {"tool":"read_file","path":"${filePath}","start_line":"${s}","end_line":"${e}"}`;
        }).join("")
      );
    }

    // ── 指定了行范围 → 读取指定段 ────────────────────────────────────────────
    const from = Math.max(1, startLine ?? 1);
    const rawTo = endLine ? Math.min(totalLines, endLine) : totalLines;
    const to    = Math.min(rawTo, from + MAX_CHUNK - 1);

    const selectedLines = allLines.slice(from - 1, to);
    const isTruncated = to < rawTo || (to < totalLines && !endLine);

    const numberedContent = selectedLines
      .map((line, i) => `${String(from + i).padStart(6, " ")} | ${line}`)
      .join("\n");

    const truncationHint = isTruncated
      ? `\n\n🔴 **[必读]** 文件共 ${totalLines} 行，本次只返回第 ${from}–${to} 行，内容不完整。` +
        `\n⚠️ **必须立即继续读取下一段，不得停止**：` +
        `\n   {"tool":"read_file","path":"${filePath}","start_line":"${to + 1}","end_line":"${Math.min(totalLines, to + MAX_CHUNK)}"}`
      : "";

    return (
      `文件 "${filePath}" 第 ${from}–${to} 行（共 ${totalLines} 行）${sizeNote}：\n\`\`\`\n${numberedContent}\n\`\`\`` +
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

    // 参数边界校验（智能诊断）——先强制转成 number，防止 AI 传入字符串行号时字符串比较出错
    startLine = Number(startLine);
    endLine   = Number(endLine);
    if (isNaN(startLine) || isNaN(endLine)) {
      return `⚠️ 参数类型错误：start_line/end_line 必须是数字，收到 start_line=${startLine}, end_line=${endLine}。` +
        `\n请确保 JSON 中行号为数字而非字符串，例如 "start_line":"10" → "start_line":10`;
    }
    if (startLine < 1 || endLine < startLine || startLine > totalLines) {
      const diagHint =
        startLine > totalLines
          ? `⚠️ 行号越界：文件当前共 ${totalLines} 行，但请求修改第 ${startLine} 行。` +
            `\n📋 修复方案：先调用 {"tool":"get_file_info","path":"${filePath}"} 获取最新行数，再重新规划 patch 范围。`
          : endLine < startLine
            ? `⚠️ 参数错误：end_line(${endLine}) < start_line(${startLine})，请检查参数。`
            : `⚠️ 行号无效：start_line 必须 ≥ 1，当前值 ${startLine}。`;
      return diagHint;
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

    // 行数发生变化时，计算偏移量并附加强制警告，防止后续 patch 使用错误行号
    const lineDelta = newCount - replacedCount;
    const deltaWarning = lineDelta !== 0
      ? `\n\n⚠️ 行号偏移警告：本次替换使文件行数净变化 ${lineDelta > 0 ? "+" : ""}${lineDelta} 行（${replacedCount} 行 → ${newCount} 行）。` +
        `\n文件当前共 ${patchedLines.length} 行。` +
        `\n**如果你还有其他针对本文件的 patch 计划，其中位于第 ${safeEnd + 1} 行之后的所有 start_line/end_line 必须在原始行号基础上加 ${lineDelta > 0 ? "+" : ""}${lineDelta}。` +
        `强烈建议：将剩余所有修改合并为一次 batch_patch 调用，避免行号累积偏移导致错误。**`
      : "";

    return (
      `✅ patch "${filePath}" 成功：第 ${startLine}–${safeEnd} 行（${replacedCount} 行→${newCount} 行），` +
      `commit: ${commitSha}，信息：${commitMessage}\n\n` +
      `📋 修改验证快照（- 已删除  + 新增  上下文 ${CONTEXT} 行）：\n\`\`\`diff\n${snapLines.join("\n")}\n\`\`\`` +
      deltaWarning
    );
  } catch (e) {
    // ── SHA 冲突（409）：自动重试，最多 3 次，指数退避（500ms/1500ms/3000ms）───
    if (isShaConflict(e)) {
      const DELAYS = [500, 1500, 3000];
      for (let attempt = 0; attempt < DELAYS.length; attempt++) {
        await new Promise(r => setTimeout(r, DELAYS[attempt]));
        try {
          console.warn(`[patch_file] SHA 冲突，第 ${attempt + 1} 次重试（等待 ${DELAYS[attempt]}ms 后）：${filePath}`);

          // 优先用 Git Refs API 获取最新 SHA（绕过 CDN），失败则 fallback 到 Contents API
          let retrySha: string | undefined;
          const targetBranchName = branch ?? ctx.repo; // ctx.repo 作为默认分支名不准确，先 fallback
          const gitRefSha = await fetchLatestFileSha(ctx, filePath, branch ?? "main");
          if (gitRefSha) {
            retrySha = gitRefSha;
          } else {
            const retryMeta = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
            retrySha = retryMeta?.sha as string;
          }
          if (!retrySha) return `❌ patch_file 重试失败：无法获取文件 "${filePath}" 的最新 SHA`;

          // 重新读取最新内容（行号可能已变），重新应用 patch
          const retryFetched = await fetchFileContent(ctx, filePath);
          if (typeof retryFetched === "string") return retryFetched;
          const { content: retryContent, sha: retryContentSha, totalLines: retryTotalLines } = retryFetched;
          const freshSha = gitRefSha ?? retryContentSha; // Git Refs SHA 优先

          const retryAllLines = retryContent.split("\n");
          const retryStart = Math.max(1, Math.min(startLine, retryTotalLines));
          const retryEnd   = Math.min(endLine, retryTotalLines);
          const retryBefore  = retryAllLines.slice(0, retryStart - 1);
          const retryAfter   = retryAllLines.slice(retryEnd);
          const retryPatched = [...retryBefore, ...newContent.split("\n"), ...retryAfter].join("\n");
          const retryEncoded = btoa(unescape(encodeURIComponent(retryPatched)));

          const retryBody: Record<string, string> = { message: commitMessage, content: retryEncoded, sha: freshSha };
          if (branch) retryBody.branch = branch;
          const retryResult = await githubRequest(
            ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`,
            { method: "PUT", body: JSON.stringify(retryBody) },
          );
          const retryCommitSha = (retryResult.commit?.sha as string)?.slice(0, 7) || "成功";
          return (
            `✅ patch "${filePath}" 成功（SHA 冲突自动重试第 ${attempt + 1} 次）：` +
            `第 ${retryStart}–${retryEnd} 行，commit: ${retryCommitSha}，信息：${commitMessage}`
          );
        } catch (retryErr) {
          if (!isShaConflict(retryErr) || attempt === DELAYS.length - 1) {
            // 非 SHA 冲突错误，或已用尽重试次数
            return (
              `❌ patch_file 失败（SHA 冲突，已重试 ${attempt + 1} 次仍失败）：文件 "${filePath}"\n` +
              `💡 建议：调用 {"tool":"read_file","path":"${filePath}"} 获取最新内容和行号，再重新执行 patch_file\n` +
              `错误详情：${(retryErr as Error).message}`
            );
          }
          // 还有重试机会，继续循环
          console.warn(`[patch_file] 重试第 ${attempt + 1} 次仍冲突，继续重试：${(retryErr as Error).message}`);
        }
      }
    }
    // 分支保护（422）：无法直接 push
    const errMsg = (e as Error).message || "";
    if (errMsg.includes("422") || errMsg.includes("branch protection") || errMsg.includes("protected branch")) {
      return (
        `❌ patch_file 失败（分支保护）：分支 "${ctx.repo}" 启用了保护规则，禁止直接推送。\n` +
        `📋 修复方案：\n` +
        `  1. 新建临时分支：{"tool":"create_branch","branch":"fix/patch-${Date.now()}","from":"main"}\n` +
        `  2. 在新分支上执行 patch_file（指定 branch 参数）\n` +
        `  3. 创建 PR：{"tool":"create_pr","title":"...","head":"fix/patch-xxx","base":"main","body":"..."}`
      );
    }
    // 其他错误走通用诊断
    return diagnose4xx(e, "patch_file");
  }
}


async function writeFile(
  ctx: GithubContext, filePath: string, content: string,
  commitMessage: string, branch?: string
): Promise<string> {
  const _writeOnce = async (sha?: string): Promise<string> => {
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
  };

  try {
    let sha: string | undefined;
    try {
      // 时间戳缓存破坏由 githubRequest 统一处理，此处直接获取
      const existing = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
      sha = existing.sha;
    } catch { /* 新文件 */ }
    return await _writeOnce(sha);
  } catch (e) {
    // SHA 冲突：3 次重试 + 指数退避（500ms/1500ms/3000ms）
    if (!isShaConflict(e)) return diagnose4xx(e, "write_file");
    const DELAYS_WF = [500, 1500, 3000];
    for (let attempt = 0; attempt < DELAYS_WF.length; attempt++) {
      await new Promise(r => setTimeout(r, DELAYS_WF[attempt]));
      console.warn(`[write_file] SHA 冲突，第 ${attempt + 1} 次重试（等待 ${DELAYS_WF[attempt]}ms 后）：${filePath}`);
      try {
        // 优先用 Git Refs API 获取最新 SHA，避免 CDN 缓存干扰
        const gitRefSha = await fetchLatestFileSha(ctx, filePath, branch ?? "main");
        let freshSha: string;
        if (gitRefSha) {
          freshSha = gitRefSha;
        } else {
          const latest = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
          freshSha = latest?.sha as string;
        }
        if (!freshSha) return `❌ write_file 重试失败：无法获取文件 "${filePath}" 的最新 SHA`;
        return await _writeOnce(freshSha);
      } catch (retryErr) {
        if (!isShaConflict(retryErr) || attempt === DELAYS_WF.length - 1) {
          return diagnose4xx(retryErr, `write_file（SHA 冲突，已重试 ${attempt + 1} 次）`);
        }
        console.warn(`[write_file] 重试第 ${attempt + 1} 次仍冲突，继续重试：${(retryErr as Error).message}`);
      }
    }
    return `❌ write_file 失败：超出最大重试次数（${DELAYS_WF.length} 次）`;
  }
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
    // 并发读取所有匹配文件（GitHub Search API 已做限流，无需额外限制）
    const settled = await Promise.allSettled(
      items.map(async (item) => {
        const fetched = await fetchFileContent(ctx, item.path);
        return { item, fetched };
      })
    );
    for (const res of settled) {
      if (res.status === "rejected") {
        fileResults.push(`📄 （读取文件失败：${(res.reason as Error)?.message ?? res.reason}）`);
        continue;
      }
      const { item, fetched } = res.value;
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

    // 2. 归一化行号类型（AI 有时将行号作为字符串传入，字符串比较会产生错误结果，如 "105" < "98" = true）
    const normalized = patches.map((p, idx) => ({
      start_line: Number(p.start_line),
      end_line:   Number(p.end_line),
      content:    p.content ?? "",
      _idx:       idx,
    }));

    // 3. 逐项校验行号，分别给出精确原因
    for (const p of normalized) {
      if (isNaN(p.start_line) || isNaN(p.end_line)) {
        return `参数类型错误：patch[${p._idx}] 的 start_line/end_line 必须是数字，` +
          `当前值 start_line=${patches[p._idx].start_line}, end_line=${patches[p._idx].end_line}。` +
          `\n提示：请确保 patches JSON 中行号为数字而非字符串，例如 {"start_line":10,"end_line":12}`;
      }
      if (p.start_line < 1) {
        return `行号无效：patch[${p._idx}] start_line=${p.start_line} 必须 ≥ 1。` +
          `\n文件共 ${totalLines} 行，请 read_file 确认行号后重试。`;
      }
      if (p.end_line < p.start_line) {
        return `行号无效：patch[${p._idx}] end_line(${p.end_line}) < start_line(${p.start_line})，` +
          `结束行不能小于起始行。\n请 read_file 确认正确的行范围后重试。`;
      }
      if (p.start_line > totalLines) {
        return `行号超出范围：patch[${p._idx}] start_line=${p.start_line} 超出文件末尾（共 ${totalLines} 行）。` +
          `\n请先 read_file 获取最新内容和行号，再重新调用 batch_patch。`;
      }
      if (p.end_line > totalLines) {
        // end_line 超限：自动截断到文件末尾并给出明确提示，不视为错误
        console.warn(`[batch_patch] patch[${p._idx}] end_line=${p.end_line} 超出文件共 ${totalLines} 行，已自动截断至 ${totalLines}`);
        p.end_line = totalLines;
      }
    }

    // 4. 按 start_line 倒序处理（从文件末尾往前改），防止行号偏移
    const sorted = [...normalized].sort((a, b) => b.start_line - a.start_line);

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

    // 5. 写回 GitHub（单次 commit），SHA 冲突时自动重试（最多 3 次 + 指数退避）
    const encoded = btoa(unescape(encodeURIComponent(workLines.join("\n"))));
    const DELAYS_BP = [500, 1500, 3000];

    const tryWrite = async (sha: string): Promise<string> => {
      const body: Record<string, string> = { message: commitMessage, content: encoded, sha };
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
    };

    // 首次尝试
    try {
      return await tryWrite(fileSha);
    } catch (writeErr) {
      if (!isShaConflict(writeErr)) return diagnose4xx(writeErr, "batch_patch");
    }

    // SHA 冲突：重新计算内容并用最新 SHA 重试
    for (let attempt = 0; attempt < DELAYS_BP.length; attempt++) {
      await new Promise(r => setTimeout(r, DELAYS_BP[attempt]));
      console.warn(`[batch_patch] SHA 冲突，第 ${attempt + 1} 次重试（等待 ${DELAYS_BP[attempt]}ms 后）：${filePath}`);
      try {
        // 优先用 Git Refs API 获取最新 SHA，避免 CDN 缓存干扰
        let freshSha: string;
        const gitRefSha = await fetchLatestFileSha(ctx, filePath, branch ?? "main");
        if (gitRefSha) {
          freshSha = gitRefSha;
        } else {
          const meta = await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`);
          freshSha = meta?.sha as string;
        }
        if (!freshSha) return `❌ batch_patch 重试失败：无法获取文件 "${filePath}" 的最新 SHA`;

        // 重新读取最新文件内容，重新应用所有 patches
        const reFetched = await fetchFileContent(ctx, filePath);
        if (typeof reFetched === "string") return reFetched;
        const reWorkLines = reFetched.content.split("\n");
        const reSorted = [...normalized].sort((a, b) => b.start_line - a.start_line);
        for (const p of reSorted) {
          const safeEnd = Math.min(p.end_line, reWorkLines.length);
          reWorkLines.splice(p.start_line - 1, safeEnd - p.start_line + 1, ...p.content.split("\n"));
        }
        const reEncoded = btoa(unescape(encodeURIComponent(reWorkLines.join("\n"))));
        const reBody: Record<string, string> = { message: commitMessage, content: reEncoded, sha: gitRefSha ?? freshSha };
        if (branch) reBody.branch = branch;
        const reResult = await githubRequest(
          ctx,
          `/repos/${ctx.owner}/${ctx.repo}/contents/${filePath}`,
          { method: "PUT", body: JSON.stringify(reBody) },
        );
        const reCommitSha = (reResult.commit?.sha as string)?.slice(0, 7) || "成功";
        return (
          `✅ batch_patch "${filePath}" 成功（SHA 冲突自动重试第 ${attempt + 1} 次）：` +
          `${patches.length} 处修改合并为单个 commit ${reCommitSha}\n` +
          `信息：${commitMessage}\n\n` +
          `📋 各处修改 diff 快照（- 旧行  + 新行）：\n\n` +
          diffSnapshots.join("\n\n")
        );
      } catch (retryErr) {
        if (!isShaConflict(retryErr) || attempt === DELAYS_BP.length - 1) {
          return (
            `❌ batch_patch 失败（SHA 冲突，已重试 ${attempt + 1} 次仍失败）：文件 "${filePath}"\n` +
            `💡 建议：调用 {"tool":"read_file","path":"${filePath}"} 获取最新内容，再重新执行 batch_patch\n` +
            `错误详情：${(retryErr as Error).message}`
          );
        }
        console.warn(`[batch_patch] 重试第 ${attempt + 1} 次仍冲突，继续重试：${(retryErr as Error).message}`);
      }
    }
    return `❌ batch_patch 失败：超出最大重试次数（${DELAYS_BP.length} 次）`;
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

/**
 * 下载 Job 日志，支持两种模式：
 *  - 智能摘要模式（不传 startLine/endLine）：返回全局统计 + 错误块上下文 + 末尾 Summary
 *  - 分段读取模式（传入 startLine/endLine）：精准返回指定行范围，每次最多 PAGE_LINES 行
 *
 * AI 工作流：
 *   1. 首次不传范围 → 获取总行数 + 错误摘要
 *   2. 如需完整日志 → 循环按 PAGE_LINES 行一页读取，直到覆盖全部行
 */
async function getJobLogs(
  ctx: GithubContext,
  jobId: string,
  startLine?: number,
  endLine?: number,
): Promise<string> {
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

    const lines = logText.split("\n");
    const totalLines = lines.length;
    const totalChars = logText.length;

    // ── 分段读取模式 ──────────────────────────────────────────────────────────
    // AI 传入 start_line / end_line，精准返回指定范围
    const PAGE_LINES = 800; // 每次最多返回行数（约 40-80k 字符）
    if (startLine !== undefined || endLine !== undefined) {
      const s = Math.max(1, startLine ?? 1);
      const e = Math.min(totalLines, endLine ?? (s + PAGE_LINES - 1));
      const clampedE = Math.min(e, s + PAGE_LINES - 1); // 单次上限保护
      const slice = lines.slice(s - 1, clampedE).join("\n");
      const hasMore = clampedE < totalLines;
      const nextHint = hasMore
        ? `\n💡 还有更多：下一段 start_line=${clampedE + 1} end_line=${Math.min(totalLines, clampedE + PAGE_LINES)}`
        : `\n✅ 已到达日志末尾（第 ${totalLines} 行）`;
      return [
        `Job \`${jobId}\` 日志分段 [行 ${s}–${clampedE} / 共 ${totalLines} 行，${totalChars} 字符]：`,
        "```",
        slice,
        "```",
        nextHint,
      ].join("\n");
    }

    // ── 智能摘要模式（首次调用，不传范围）───────────────────────────────────
    const TOTAL_LIMIT = 60_000;   // 摘要模式最大返回字符
    const TAIL_CHARS  = 20_000;   // 末尾保留字符（含 build summary）
    const CTX_LINES   = 35;       // 错误块前后各保留行数

    // 统计头：帮助 AI 决定是否需要分段读取
    const statsHint = [
      `Job \`${jobId}\` 日志统计：共 **${totalLines} 行** / **${totalChars} 字符**`,
      totalChars > TOTAL_LIMIT
        ? `（日志较大，以下为智能摘要；如需完整日志，使用 start_line/end_line 每次读取 ${PAGE_LINES} 行）`
        : "（日志较小，完整返回）",
    ].join(" ");

    // 日志未超限：完整返回
    if (totalChars <= TOTAL_LIMIT) {
      return `${statsHint}\n\`\`\`\n${logText}\n\`\`\``;
    }

    // 错误块提取
    const errorPattern = /\b(error|Error|ERROR|FAILED|failed|FAILURE|Exception|exception|fatal|Fatal|FATAL|cannot|Cannot|undefined reference|unresolved)\b/;
    const errorLineIndices: Set<number> = new Set();
    for (let i = 0; i < totalLines; i++) {
      if (errorPattern.test(lines[i])) {
        const from = Math.max(0, i - CTX_LINES);
        const to   = Math.min(totalLines - 1, i + CTX_LINES);
        for (let j = from; j <= to; j++) errorLineIndices.add(j);
      }
    }

    const sortedIndices = Array.from(errorLineIndices).sort((a, b) => a - b);
    const errorSections: string[] = [];
    let charCount = 0;
    let i = 0;
    while (i < sortedIndices.length && charCount < TOTAL_LIMIT - TAIL_CHARS) {
      const start = sortedIndices[i];
      let end = start;
      while (i + 1 < sortedIndices.length && sortedIndices[i + 1] === sortedIndices[i] + 1) {
        i++;
        end = sortedIndices[i];
      }
      const sectionText = lines.slice(start, end + 1).join("\n");
      const label = `\n--- [行 ${start + 1}–${end + 1}] ---\n`;
      errorSections.push(label + sectionText);
      charCount += label.length + sectionText.length;
      i++;
    }

    const tail = logText.slice(-TAIL_CHARS);

    let output = statsHint + "\n";
    if (errorSections.length > 0) {
      output += `\n## ⚠️ 错误相关段落（${errorLineIndices.size} 行上下文）\n\`\`\`\n${errorSections.join("\n")}\n\`\`\`\n`;
    } else {
      output += "\n（未检测到明确错误关键词，仅返回末尾内容）\n";
    }
    output += `\n## 📋 末尾 ${TAIL_CHARS} 字符（Build Summary）\n\`\`\`\n${tail}\n\`\`\``;
    output += `\n\n💡 如需读取特定区段，使用 start_line/end_line，例如读取前 ${PAGE_LINES} 行：{"tool":"get_job_logs","job_id":"${jobId}","start_line":"1","end_line":"${PAGE_LINES}"}`;

    return output;
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
    const commitLines = commits.slice(0, 10).map((c: any) =>
      `  \`${String(c.sha).slice(0, 7)}\` ${String(c.commit?.message || "").split("\n")[0]}  — ${c.commit?.author?.name ?? ""}`,
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

/**
 * 查询某次工作流运行产生的 Artifacts（构建产物列表）。
 * 返回每个 artifact 的名称、大小、过期时间，供构建成功后核查产物使用。
 */
async function getRunArtifacts(ctx: GithubContext, runId: string): Promise<string> {
  if (!runId) return "❌ 参数缺失：run_id 为必填";
  try {
    const data = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${runId}/artifacts?per_page=30`,
    ) as { total_count: number; artifacts: Array<{
      id: number; name: string; size_in_bytes: number;
      expired: boolean; expires_at: string; archive_download_url: string;
    }> };

    const { total_count, artifacts } = data;
    if (!total_count || !artifacts?.length) {
      return `⚠️ Run #${runId} 没有产生任何 Artifact。\n（工作流可能未配置 upload-artifact 步骤，或产物已过期）`;
    }

    const formatSize = (bytes: number) => {
      if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${bytes} B`;
    };

    const lines = artifacts.map(a => {
      const expiry = a.expired ? "（已过期）" : `（有效至 ${String(a.expires_at).slice(0, 10)}）`;
      return `- **${a.name}**  ${formatSize(a.size_in_bytes)}  ${expiry}`;
    });

    return [
      `📦 Run #${runId} 共产生 ${total_count} 个 Artifact：`,
      ...lines,
      ``,
      `下载地址需使用已认证的 GitHub 账号访问 Actions 页面，或通过 GitHub CLI：`,
      `\`gh run download ${runId}\``,
    ].join("\n");
  } catch (e) { return diagnose4xx(e, `get_run_artifacts(${runId})`); }
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

// ── 任务5：新增工具实现 ─────────────────────────────────────────────────────

/**
 * preview_diff：预览修改后的文件片段（不实际写入），用于修改前确认。
 * 返回：修改前 vs 修改后的对比（unified diff 风格）。
 */
async function previewDiff(
  ctx: GithubContext,
  path: string,
  startLine: number,
  endLine: number,
  newContent: string,
): Promise<string> {
  if (!path || !startLine || !endLine || !newContent) {
    return "参数缺失：path / start_line / end_line / content 均为必填";
  }
  try {
    const fetched = await fetchFileContent(ctx, path);
    if (typeof fetched === "string") return fetched; // 错误信息
    const lines = fetched.content.split("\n");
    const total = lines.length;
    const s = Math.max(1, startLine);
    const e = Math.min(total, endLine);

    const before = lines.slice(s - 1, e);
    const after  = newContent.split("\n");

    const beforeStr = before.map((l, i) => `- ${String(s + i).padStart(5)} | ${l}`).join("\n");
    const afterStr  = after .map((l, i) => `+ ${String(s + i).padStart(5)} | ${l}`).join("\n");

    return [
      `📄 **预览 diff**：\`${path}\` 第 ${s}–${e} 行（共 ${total} 行，未实际写入）`,
      "```diff",
      beforeStr,
      "---",
      afterStr,
      "```",
      `提示：确认无误后，使用 patch_file 工具传入相同参数执行写入。`,
    ].join("\n");
  } catch (e) { return diagnose4xx(e, "preview_diff"); }
}

/**
 * undo_last_commit：撤销目标分支最后一次提交（回退到 HEAD~1，保留文件修改到工作区）。
 * 实现方式：读取 HEAD~1 的 SHA，逐一恢复变动文件，再创建一个新的 "Revert" 提交。
 * 注意：GitHub API 无直接 revert 接口，采用「创建 revert commit」的等效实现。
 */
async function undoLastCommit(ctx: GithubContext, branch?: string): Promise<string> {
  const ref = branch || "main" || "main";
  try {
    // 1. 获取最新两次提交
    const commits = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/commits?sha=${ref}&per_page=2`,
    ) as Array<Record<string, unknown>>;

    if (commits.length < 2) return "❌ 分支只有一次提交，无法撤销";

    const latestSha = (commits[0] as {sha: string}).sha;
    const prevSha   = (commits[1] as {sha: string}).sha;
    const latestMsg = ((commits[0] as {commit: {message: string}}).commit?.message || "").split("\n")[0];

    // 2. 获取最新提交的变动文件列表
    const diff = await githubRequest(
      ctx,
      `/repos/${ctx.owner}/${ctx.repo}/commits/${latestSha}`,
    ) as {files: Array<{filename: string; status: string; sha: string}>};

    const changedFiles = diff.files || [];
    if (!changedFiles.length) return `✅ 最新提交 ${latestSha.slice(0,7)} 无文件变动，无需撤销`;

    // 3. 获取 HEAD~1 时每个文件的内容，恢复到那个状态
    const results: string[] = [];
    for (const f of changedFiles) {
      try {
        if (f.status === "added") {
          // 新增文件 → 删除
          await deleteFile(ctx, f.filename, `Revert: 删除 ${f.filename}（撤销 ${latestSha.slice(0,7)}）`, ref);
          results.push(`🗑️ 已删除（撤销新增）：${f.filename}`);
        } else if (f.status === "removed") {
          // 被删文件 → 在 prevSha 恢复
          const fetched = await fetchFileContent(ctx, f.filename, prevSha);
          if (typeof fetched !== "string") {
            await writeFile(ctx, f.filename, fetched.content, `Revert: 恢复 ${f.filename}（撤销 ${latestSha.slice(0,7)}）`, ref);
            results.push(`♻️ 已恢复（撤销删除）：${f.filename}`);
          }
        } else {
          // 修改文件 → 恢复到 prevSha 版本
          const fetched = await fetchFileContent(ctx, f.filename, prevSha);
          if (typeof fetched !== "string") {
            await writeFile(ctx, f.filename, fetched.content, `Revert: 回滚 ${f.filename}（撤销 ${latestSha.slice(0,7)}）`, ref);
            results.push(`⏪ 已回滚：${f.filename}`);
          }
        }
      } catch (err) {
        results.push(`⚠️ 文件处理失败：${f.filename}（${(err as Error).message || err}）`);
      }
    }

    return [
      `✅ **已撤销最后一次提交**`,
      `- 分支：\`${ref}\``,
      `- 撤销提交：\`${latestSha.slice(0,7)}\` "${latestMsg}"`,
      `- 恢复到：\`${prevSha.slice(0,7)}\``,
      `- 处理文件 ${changedFiles.length} 个：`,
      ...results.map(r => `  ${r}`),
    ].join("\n");
  } catch (e) { return diagnose4xx(e, "undo_last_commit"); }
}

/**
 * run_lint：触发仓库中的 lint 工作流（如有），并等待结果。
 * 如无专用 lint workflow，则尝试触发 CI 并筛选 lint 相关 job 的日志。
 */
async function runLint(ctx: GithubContext, branch?: string): Promise<string> {
  const ref = branch || "main" || "main";
  try {
    // 1. 获取所有工作流，优先找 lint/eslint/check 相关的
    const wfList = await githubRequest(
      ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/workflows`,
    ) as {workflows: Array<{id: number; name: string; path: string; state: string}>};

    const lintWf = wfList.workflows.find(w =>
      w.state === "active" &&
      /lint|eslint|check|quality|format/i.test(w.name + w.path)
    );

    if (!lintWf) {
      // 没有专用 lint workflow，扫描最新 CI 运行的 lint job 日志
      const runs = await githubRequest(
        ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/runs?branch=${ref}&per_page=5`,
      ) as {workflow_runs: Array<{id: number; name: string; status: string; conclusion: string}>};

      const latest = runs.workflow_runs[0];
      if (!latest) return "⚠️ 未找到 lint 工作流，且没有最近的 CI 运行记录";

      // 从最新运行中筛选 lint job
      const jobs = await githubRequest(
        ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${latest.id}/jobs`,
      ) as {jobs: Array<{id: number; name: string; conclusion: string | null; steps: Array<{name: string; conclusion: string | null}>}>};

      const lintJobs = jobs.jobs.filter(j => /lint|eslint|format|check/i.test(j.name));
      if (!lintJobs.length) {
        return `⚠️ 最新 CI 运行 #${latest.id} 中没有找到 lint 相关 job。\n` +
          `全部 job：${jobs.jobs.map(j => j.name).join(", ")}\n` +
          `建议：手动在工作流文件中添加 lint 步骤。`;
      }

      const jobResults = lintJobs.map(j =>
        `- **${j.name}**：${j.conclusion === "success" ? "✅ 通过" : j.conclusion === "failure" ? "❌ 失败" : "⏳ " + (j.conclusion || "运行中")}`
      ).join("\n");
      return `📋 **Lint 结果**（来自最新 CI 运行 #${latest.id}）\n${jobResults}`;
    }

    // 2. 触发专用 lint 工作流
    await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/workflows/${lintWf.id}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref }),
    });

    // 3. 等待并轮询结果（最多等 90s）
    await new Promise(r => setTimeout(r, 8000));
    for (let i = 0; i < 6; i++) {
      const runs = await githubRequest(
        ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/workflows/${lintWf.id}/runs?branch=${ref}&per_page=1`,
      ) as {workflow_runs: Array<{id: number; status: string; conclusion: string | null; html_url: string}>};
      const run = runs.workflow_runs[0];
      if (!run) { await new Promise(r => setTimeout(r, 15000)); continue; }
      if (run.status === "completed") {
        const icon = run.conclusion === "success" ? "✅" : "❌";
        return `${icon} **Lint 工作流已完成**\n- 工作流：${lintWf.name}\n- 分支：\`${ref}\`\n- 结论：${run.conclusion}\n- 详情：${run.html_url}`;
      }
      await new Promise(r => setTimeout(r, 15000));
    }
    return `⏳ Lint 工作流已触发（${lintWf.name}），但 90s 内未完成，请用 get_workflow_runs 查看结果`;
  } catch (e) { return diagnose4xx(e, "run_lint"); }
}

/**
 * check_security：扫描代码中常见的安全隐患模式（硬编码密钥、eval、SQL 拼接等）。
 * 使用 GitHub Search API 逐项扫描，返回命中的文件列表与行上下文。
 */
async function checkSecurity(ctx: GithubContext, path: string): Promise<string> {
  const scope = path ? `path:${path}` : "";
  // 安全规则：[名称, 搜索关键词, 说明]
  const rules: [string, string, string][] = [
    ["硬编码密钥",     "password=",    "硬编码密码，应使用环境变量或 Secret"],
    ["硬编码 API Key", "api_key=",     "硬编码 API Key，应使用 Secret"],
    ["eval 调用",      "eval(",        "eval() 可执行任意代码，存在代码注入风险"],
    ["SQL 字符串拼接", "query+",       "可能存在 SQL 注入风险"],
    ["innerHTML 赋值", "innerHTML",    "直接设置 innerHTML 存在 XSS 风险"],
    ["TODO/FIXME",     "TODO security","标记了待修复的安全相关 TODO"],
    ["私钥泄露",       "BEGIN PRIVATE KEY", "疑似私钥内容直接写入代码"],
  ];

  const findings: string[] = [];
  let totalHits = 0;

  for (const [name, keyword, desc] of rules) {
    try {
      const query = `${keyword} repo:${ctx.owner}/${ctx.repo} ${scope}`;
      const res = await githubRequest(
        ctx, `/search/code?q=${encodeURIComponent(query)}&per_page=5`,
      ) as {total_count: number; items: Array<{path: string; html_url: string}>};

      if (res.total_count > 0) {
        totalHits += res.total_count;
        const fileList = res.items.map(i => `  - \`${i.path}\``).join("\n");
        findings.push(`⚠️ **${name}**（共 ${res.total_count} 处）\n  说明：${desc}\n${fileList}`);
      }
    } catch { /* 某项搜索失败不影响其他检查 */ }
    // 避免触发 GitHub Search API 速率限制
    await new Promise(r => setTimeout(r, 500));
  }

  if (!findings.length) {
    return `✅ **安全扫描通过**\n扫描范围：${path || "整个仓库"}\n未发现常见安全隐患模式。\n⚠️ 注意：此为启发式扫描，不能替代专业安全审计工具。`;
  }

  return [
    `🔍 **安全扫描报告**`,
    `扫描范围：${path || "整个仓库"} | 发现问题：${findings.length} 类 ${totalHits} 处`,
    "",
    findings.join("\n\n"),
    "",
    "⚠️ 此为启发式扫描，存在误报可能，请人工核实后处理。",
  ].join("\n");
}

// ── Agent 核心 ───────────────────────────────────────────────────────────────

/**
 * 根据任务类型自动推断合适的采样温度。
 * 优先级：用户在 model_config 中手动指定 > 自动推断。
 *
 * 推断规则：
 * - Auto 模式（代码写操作）: 0.1 — 最确定性，避免随机修改代码
 * - 分析/review/报告/建议类: 0.3 — 保持聚焦但允许一定灵活性
 * - 普通问答/对话:           0.7 — 正常创意水平
 */
function inferTemperature(
  userMessage: string,
  isAutoMode: boolean,
  userOverride?: number,
): number {
  // 用户手动指定时直接使用，不覆盖
  if (userOverride !== undefined) return userOverride;
  // Auto 执行模式（代码写操作）：确定性优先
  if (isAutoMode) return 0.1;
  // 分析/review 类关键词
  const analyticalPattern = /分析|review|评审|建议|报告|总结|摘要|解释|explain|debug|排查|诊断/i;
  if (analyticalPattern.test(userMessage)) return 0.3;
  // 默认普通对话
  return 0.7;
}

/**
 * 构建 system prompt。
 * - FC 模型（deepseek/openai/gemini/qwen）：精简版，工具通过 schema 传递，不再在文本里列举
 * - 非 FC 模型（wenxin/custom）：完整版，包含工具清单说明
 */
function buildSystemPrompt(targetBranch?: string, isAutoMode = false, modelType = "wenxin", modelConfig?: { model?: string }): string {
  const branchNote = targetBranch
    ? `**当前目标分支：\`${targetBranch}\`**（所有写入操作默认提交到此分支，除非用户明确指定其他分支）`
    : "（未指定分支，写入时使用仓库默认分支）";

  // ── 语言要求（对所有模型生效）──────────────────────────────────────────────
  // 明确要求模型内部思考过程和所有输出均使用中文，避免 DeepSeek V4 等模型思考时切换为英语
  const langNote = "**重要语言要求：无论内部推理还是最终回复，请全程使用中文，严禁切换为英语或其他语言。**";

  // ── FC 模型精简版 prompt ─────────────────────────────────────────────────
  // 工具已通过 JSON Schema 传递，不需要在 prompt 里列举；只保留行为规则
  if (supportsFunctionCalling(modelType, modelConfig?.model)) {
    if (!isAutoMode) {
      return `你是 GitHub 仓库开发助手，帮助用户管理仓库、查询信息、执行操作。
${langNote}
${branchNote}

## 核心规则
1. 查询类问题直接调用工具给出简洁回答，不输出 PLAN。
2. 单一操作（创建文件、合并PR、关闭Issue 等）直接执行，完成后告知结果。
3. 复杂任务（多文件修改、新功能开发、重构）先提方案，等用户确认后再执行。
4. 不确定意图时可以礼貌询问，而不是盲目执行。

## 工具自我改进
执行过程中遇到工具缺陷或限制时（信息不完整、参数不够用、无法处理某种场景），调用 report_tool_issue 上报。
有具体修复方案时继续调用 propose_tool_fix 提交改进代码。上报不会中断任务。

## 新功能/重构请求必须走的四阶段流程
**阶段 1**：先用工具探索项目（file_tree → batch_read 关键文件 → grep_in_repo 定位相关代码）
- 大文件（>500行）改造：优先 get_code_outline 建立骨架 → read_function 精准读取目标函数
**阶段 2**：输出方案（格式见下方），等用户确认
**阶段 3**：用户确认后，输出 PLAN 并开始执行
**阶段 4**：完成后输出 TASK_DONE

方案格式：
## 📋 需求理解
[需求核心、受影响代码、约束和风险]
## 💡 方案选项
### 方案 A — [方案名]
- **思路**：[一句话]
- **优点/缺点**：[关键点]
- **预计改动**：[小/中/大]
**我的建议**：[推荐哪个方案及理由]

## 回复规范
- 简洁：1-3 句话说明结果，不展开不必要细节
- 遇错：告知原因和建议，询问用户如何处理
- 语气：像熟悉 GitHub 的开发者朋友，自然简洁
- 代码/命令：必要时用行内代码，文件名不需要全部加反引号`;
    }

    // FC + autoMode
    return `你是 GitHub 仓库全流程开发助手。
${langNote}
${branchNote}

## 核心规则
1. **首轮必须输出任务计划**：收到任务后，在回复开头输出 PLAN，然后立即开始执行第一步。
   格式（合法 JSON，不加 markdown 代码块）：
   PLAN:{"steps":[{"id":"1","title":"步骤名（≤8字）","desc":"一句话说明"},{"id":"2","title":"...","desc":"..."}]}
2. **步骤标记**：切换到新步骤时输出 STEP:步骤ID（仅切换步骤时，不是每次工具调用都要输出）。
3. **自主执行**：禁止询问用户是否继续，禁止提前结束，工具报错时分析原因后继续。
4. **任务完成**：全部步骤完成后，在回复最开头输出 TASK_DONE，然后给一句简洁的完成总结。

## 工具自我改进（注意：执行途中才上报，不可作为第一个工具调用）
在执行过程中，**首先输出 PLAN 并开始执行任务步骤**；当遇到工具缺陷时（信息不完整、参数不够用、无法处理某种场景），再调用 report_tool_issue 上报。

## 开发需求分析工作流（新功能/重构必须遵循）
触发条件：用户说"想新增"、"帮我实现"、"重构"等涉及新功能或较大改动时：
1. file_tree → batch_read 关键配置 → grep_in_repo 定位相关代码（探索阶段）
   - 目标文件 > 500 行时：优先 get_code_outline 建立骨架 → read_function 精准读取目标函数
2. 输出方案选项等用户确认（唯一的暂停点）
3. 用户确认后立即输出 PLAN 并执行（不要再次询问）

排查构建/部署失败时，必须自主完成全链路修复：
get_workflow_runs → get_run_jobs → get_job_logs → 分析 → patch/write 修复 → rerun → check_run_status

## 回复规范
- 用 1-3 句话直接说明结果，不铺垫废话
- 不使用 ## 二级标题；层次感用换行和项目符号体现
- 错误时直接说明原因和建议`;
  }

  // ── 非 FC 模型：完整版 prompt（文心 / custom） ─────────────────────────────
  // 直接回答查询类问题；单步骤操作直接执行；复杂任务先提方案等待确认
  if (!isAutoMode) {
    return `你是 GitHub 仓库开发助手，帮助用户管理仓库、查询信息、执行简单操作。
${langNote}
${branchNote}

==============================
⚠️ 核心规则（严格遵守）
==============================
1. **直接回答**：查询类问题（README、文件内容、Issue 列表、PR 状态等）直接调用工具并给出简洁回答，不输出 PLAN。
2. **单步骤操作**：明确的单一操作（创建文件、合并PR、关闭Issue 等）直接执行，完成后告知结果。
3. **复杂任务先提方案**：涉及多个文件修改、新功能开发、重构等复杂任务时，先分析并提出方案选项，等用户确认后再执行。
4. **允许询问**：不确定用户意图时，可以礼貌地提问澄清，而不是盲目执行。
5. **工具格式**：每轮只调用一个工具，工具 JSON 单独成行，**绝对不加 markdown 代码围栏（反引号）**。
6. **禁止伪造**：不要用文字模仿工具执行过程，只输出 JSON。
7. **格式强制**：工具调用 JSON 中的每个键值必须是字符串，不允许嵌套对象作为值（除 inputs 字段外）。

==============================
对话行为准则
==============================
- **简洁回答**：用 1-3 句话说明操作结果或给出信息，不展开不必要的细节
- **遇到错误**：告知原因并给出建议，询问用户如何处理，而不是自行决策
- **不强制 PLAN**：除非用户明确要求"帮我规划任务"或任务确实需要 4+ 步骤，否则不输出 PLAN 格式
- **工具按需调用**：只调用回答问题所必需的工具，不要过度探索
- **语气**：像一位熟悉 GitHub 的开发者朋友，自然、简洁，避免机器腔`;
  } // end !isAutoMode

  // ── 自主 Agent 模式 ────────────────────────────────────────────────────────
  // 完整多步骤自主执行 prompt：强制 PLAN/STEP、禁止中途询问、自动续跑
  return `你是 GitHub 仓库全流程开发助手。
${langNote}
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
14. 全量写入（新建文件或大幅重写时用）：
   {"tool":"write_file","path":".github/workflows/deploy.yml","content":"...","message":"ci: 更新部署工作流","branch":"${targetBranch || "main"}"}
15. 删除文件：{"tool":"delete_file","path":"src/old.ts","message":"chore: 删除废弃文件","branch":"${targetBranch || "main"}"}
16. 预览修改效果（不实际写入，修改前确认内容）：
    {"tool":"preview_diff","path":"src/App.tsx","start_line":"10","end_line":"15","content":"新内容"}
17. 撤销最后一次提交（逐文件恢复到上一版本，生成新的 Revert commit）：
    {"tool":"undo_last_commit","branch":"main"}

🔀 **分支 & PR**
18. 列出分支：{"tool":"list_branches"}
19. 新建分支：{"tool":"create_branch","branch":"fix/bug-123","from":"${targetBranch || "main"}"}
20. 获取提交历史：{"tool":"list_commits","path":""}
21. 列出 PR：{"tool":"list_pull_requests","state":"open"}
22. 创建 PR：{"tool":"create_pr","title":"fix: 修复构建失败","head":"fix/build","base":"main","body":"描述"}
    ⚠️ head/base 填写**分支名**（不加 owner: 前缀）；title 不能为空；head 与 base 必须有差异提交，否则 API 拒绝
23. 合并 PR：{"tool":"merge_pull_request","pull_number":"42","merge_method":"squash"}

🐛 **Issue 管理**
24. 列出 Issues：{"tool":"list_issues","state":"open"}
25. 搜索 Issues（按关键词、标签、作者）：
    {"tool":"search_issues","query":"登录失败","state":"open","labels":"bug","assignee":"","limit":"20"}
    （state 可选：open/closed/all；labels 逗号分隔；不填则不过滤）
26. 查看 Issue 详情（含正文+评论）：{"tool":"get_issue_details","issue_number":"12"}
27. 创建 Issue：{"tool":"create_issue","title":"构建失败","body":"描述","labels":"bug,ci"}
28. 更新 Issue（标题/正文/状态/标签/负责人，仅填需要改的字段）：
    {"tool":"update_issue","issue_number":"12","state":"closed","labels":"bug,resolved","assignees":"alice,bob"}
29. 关闭 Issue（可附带结论评论）：{"tool":"close_issue","issue_number":"12","comment":"已在 PR #33 修复，关闭此 Issue"}
30. 在 Issue 或 PR 下添加评论：{"tool":"add_comment","issue_number":"12","body":"评论内容"}

⚙️ **工作流 & 部署**
31. 列出所有工作流：{"tool":"list_workflows"}
32. 查看工作流最近运行（仅看历史，不等待）：{"tool":"get_workflow_runs","workflow_id":"deploy.yml","limit":"5"}
    （workflow_id 可以是文件名如 deploy.yml 或数字 ID；不填则查全部运行）
33. 触发工作流 → 自动等待完成（两步标准流程）：
    步骤一 触发：{"tool":"trigger_workflow","workflow_id":"deploy.yml","ref":"main"}
    步骤二 等待（trigger 返回的 run_id 直接填入，无需再查）：
      普通部署   ：{"tool":"check_run_status","run_id":"<run_id>","workflow_type":"normal"}
      构建 Android APK（约 3 分钟）：{"tool":"check_run_status","run_id":"<run_id>","workflow_type":"build_apk"}
      快速脚本（<1 分钟）：{"tool":"check_run_status","run_id":"<run_id>","workflow_type":"fast"}
    ⚠️ build_apk 若第一次返回"仍在运行"，**必须**再次调用 check_run_status（相同参数），不要改用 get_workflow_runs 轮询
34. 等待已知 run_id（push 自动触发的运行）：
    {"tool":"check_run_status","run_id":"12345678","workflow_type":"normal"}
35. 查看某次运行的 Jobs 及步骤（check_run_status 失败时才需要）：{"tool":"get_run_jobs","run_id":"12345678"}
36. 下载 Job 日志（智能摘要，首次调用不传范围）：{"tool":"get_job_logs","job_id":"87654321"}
    ⚡ check_run_status 失败时会自动附带 job_id，可直接用。
    📖 日志较大时，摘要会告知总行数；如需完整日志，按行分段读取（每次 800 行）：
    {"tool":"get_job_logs","job_id":"87654321","start_line":"1","end_line":"800"}
    {"tool":"get_job_logs","job_id":"87654321","start_line":"801","end_line":"1600"}
    …依此类推直到"已到达日志末尾"提示出现。
37. 取消运行中的工作流：{"tool":"cancel_workflow_run","run_id":"12345678"}
38. 重新运行失败的工作流：{"tool":"rerun_workflow_run","run_id":"12345678","failed_jobs_only":"true"}
39. 查看 Actions Secrets 名称：{"tool":"list_actions_secrets"}
40. 查看 Actions Variables（明文环境变量）：{"tool":"list_actions_variables"}
41. 创建或更新 Actions Variable：{"tool":"set_actions_variable","name":"APP_ENV","value":"production"}
    ⚠️ Secrets（加密）只能通过 GitHub 网页设置；Variables（明文）可通过此工具读写
42. 向用户请求上传文件（缺少图片/图标/证书等资源时）：
    {"tool":"request_file","filename":"app-icon.png","description":"需要 512×512 的应用图标 PNG 文件","mime_types":"image/png,image/jpeg"}
43. 触发构建并全程自动监控（自动轮询，失败时返回日志供分析修复，循环直到成功）：
    {"tool":"trigger_and_monitor_build","workflow_id":"build.yml","ref":"main","max_fix_attempts":"3"}
44. 触发并运行 Lint 检查（找到 lint 工作流自动触发并等待结果）：
    {"tool":"run_lint","branch":"main"}
45. 安全扫描（扫描硬编码密钥/eval/SQL注入/XSS等常见安全隐患）：
    {"tool":"check_security","path":"src/"}
46. 查询某次运行产生的 Artifacts（构建产物列表、大小、有效期）：
    {"tool":"get_run_artifacts","run_id":"12345678"}

🔀 **PR 高级操作**
46. 关闭 PR（可附带评论）：{"tool":"close_pr","pull_number":"42","comment":"改用 PR #45，关闭此 PR"}
47. 查看 PR 的文件变更列表：{"tool":"get_pr_files","pull_number":"42"}
48. 提交 PR 代码审查（APPROVE/REQUEST_CHANGES/COMMENT）：
    {"tool":"submit_pr_review","pull_number":"42","event":"APPROVE","body":"LGTM，代码清晰"}

📊 **仓库分析**
49. 查看仓库基本信息（语言/Stars/默认分支/Topics 等）：{"tool":"get_repo_info"}
50. 查看某次提交的 diff（文件变更统计）：{"tool":"get_commit_diff","sha":"abc1234"}

🏷️ **Release 管理**
51. 列出最近 Releases：{"tool":"list_releases","limit":"10"}
52. 创建新 Release（tag + 标题 + 发布说明）：
    {"tool":"create_release","tag_name":"v1.2.0","name":"v1.2.0 - 新增 XX 功能","body":"## 更新内容\n- 修复 xxx\n- 新增 yyy","draft":"false","prerelease":"false","branch":"main"}

🚀 **Release 自动化**
53. 获取最新 Release 信息（tag、名称、发布时间）：{"tool":"get_latest_release"}
54. 获取指定时间点之后已合并的 PR 列表（含 labels、body、作者）：
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
3. 全部步骤完成后，**必须**在回复的最开头输出 \`TASK_DONE\`，然后紧跟简洁的完成总结。例如：\`TASK_DONE\n已完成 xxx，触发了构建，请等待结果。\`

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
  3. get_job_logs 下载该 Job 的日志（不传范围，获取智能摘要 + 总行数）
     - 若日志较大且错误信息不足，按 800 行分段读取直到找到根因：
       {"tool":"get_job_logs","job_id":"<id>","start_line":"1","end_line":"800"} …
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

✅ **构建成功后验证产物（必须执行）**：
  当任何构建任务成功后（trigger_and_monitor_build 或 check_run_status 返回成功），**必须**按以下顺序完成收尾工作，不得省略：

  **步骤 1 — 确认 Artifacts**
  - trigger_and_monitor_build 已在返回值中自动附带 Artifacts 列表，直接读取即可。
  - 若使用 check_run_status 触发构建成功，需额外调用：
    {"tool":"get_run_artifacts","run_id":"<成功的 run_id>"}
  - 根据结果判断：
    - 有产物 → 记录名称和大小，后续在任务总结中展示
    - 无产物（工作流未配置 upload-artifact）→ 告知用户构建成功但无 Artifact，提示可在 Actions 页面查看日志
    - 产物已过期 → 告知用户需重新触发构建

  **步骤 2 — 确认 Releases（若工作流会创建 Release）**
  - 若本次构建工作流包含发布步骤（如 gh release create、actions/create-release 等），调用：
    {"tool":"get_latest_release"}
  - 对比 Release 的 published_at 与本次构建时间，确认是否为本次产生的新 Release。
  - 有新 Release → 在任务总结中展示版本号和链接
  - 无 Release → 任务总结中注明"本次工作流未创建 Release"

  **步骤 3 — 生成开发任务总结（必须输出，固定格式）**
  完成上述验证后，**必须**输出以下格式的任务总结，然后结束任务：

  ---
  ## 🎉 任务完成

  **构建结果**：成功 ✅  **Run ID**：<run_id>  **分支**：\`<分支名>\`

  **构建产物**：
  - <artifact 名称>（<大小>，有效至 <日期>）
  （若无 Artifact：本次工作流未上传构建产物）

  **Release**：<版本号> — <链接>
  （若无 Release：本次工作流未创建 Release）

  **任务概要**：
  <用 2-4 句话描述本次任务：修改了哪些文件、触发了哪个工作流、构建产物的用途>

  ---

  ⚠️ **工作流编写规范**：创建或修改构建工作流时，必须包含 \`actions/upload-artifact\` 步骤，
  确保每次构建都会生成可下载的产物。示例：
  \`\`\`yaml
  - name: 上传构建产物
    uses: actions/upload-artifact@v4
    with:
      name: app-release
      path: app/build/outputs/apk/release/*.apk
  \`\`\`

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

**🆕 大文件高效操作（推荐工作流）**：

> 核心原则：**先建立全局认知，再精准读取目标，不要逐段盲读整个文件**

**新工具（优先使用）**：
- \`get_code_outline\` — 提取代码骨架（函数/类/接口列表 + 起止行号），不返回代码体，极低上下文消耗
- \`read_function\` — 按函数/类名称直接读取完整体，免去两步操作（grep行号 → read_file）
- \`grep_in_file\` with \`context_lines\` — 搜索时同时返回前后 N 行上下文，一步拿到足够背景

**推荐工作流（文件 > 500 行时强烈建议）**：
\`\`\`
步骤1：get_code_outline  →  建立文件全局结构（函数列表+行号）
步骤2：read_function     →  精准读取目标函数完整体（直接按名称）
步骤3：patch_file / batch_patch  →  按已知行号修改
\`\`\`

**示例**：
- 查看文件结构：\`{"tool":"get_code_outline","path":"src/services/github.ts"}\`
- 精准读取函数：\`{"tool":"read_function","path":"src/App.tsx","function_name":"AppContent"}\`
- 同名函数取第2个：\`{"tool":"read_function","path":"src/utils.ts","function_name":"format","occurrence":"2"}\`
- 搜索+上下文：\`{"tool":"grep_in_file","path":"src/main.ts","pattern":"fetchData","context_lines":"5"}\`

**何时仍用 read_file 逐段读取**：
- 需要理解函数之间的流程串联（多个函数如何协作）
- 文件结构不规则（如大量内联匿名函数）无法被 outline 覆盖
- 文件 ≤ 5000 行且需要全量代码上下文时，直接 read_file（不带行范围）一次返回完整内容

**read_file 自动全文模式（优先使用）**：
- 文件 ≤ 5000 行时，直接调用 \`{"tool":"read_file","path":"src/App.tsx"}\`（不带行范围），系统自动一次性返回完整内容
- 文件 > 5000 行时，系统返回第一段并附带**所有后续段落的调用列表**，必须逐段执行完毕

**标准流程（文件 > 5000 行时）**：
1. 先调用 \`get_code_outline\` 建立骨架（推荐替代 get_file_info）
2. 用 \`read_function\` 精准读取目标函数，无需分段
3. 确实需要跨函数全文时，再按 500 行步进分段 read_file

**大文件（>1MB）特别说明**：
- GitHub Contents API 对 >1MB 文件返回空内容，read_file 已自动切换到 Git Blobs API
- get_code_outline / read_function 同样自动处理大文件，用户无需感知

**关键规则（违反即视为任务失败）**：
- **收到 🔴 截断提示后，必须立即继续读取下一段，不得中断、不得向用户汇报"已读取部分"**
- **不得在文件未读完时就开始修改代码**，必须先读完目标代码再分析
- 大文件（> 500 行）修改代码前**必须先调用 get_code_outline 或 grep_in_file(context_lines≥3) 确认精确行号**，不得凭猜测行号直接 patch
- batch_read 适合同时了解多个小文件（如配置文件组合），每文件返回前 300 行，自动支持大文件

==============================
长内容输出与 patch 自动验证规则
==============================

**写入大内容时（代码超过 200 行）必须分批修改，不得一次性 write_file**：
1. 先用 get_code_outline 或 get_file_info 确认目标文件总行数
2. 将要写入的内容拆分为多段，每段不超过 200 行
3. **必须使用 batch_patch 一次性提交所有段落**，格式：\`[{"start_line":N1,"end_line":M1,"content":"段落1"},{"start_line":N2,"end_line":M2,"content":"段落2"},...]\`
   - batch_patch 内部按倒序处理各段，不存在行号偏移问题
   - ❌ 严禁分多次调用 patch_file：每次 patch 会改变文件行数，导致后续调用行号偏移，产生重复或错误内容
4. batch_patch 返回「各处修改 diff 快照」，**必须核查每处快照**：
   - 内容正确 → 完成
   - 发现错误 → read_file 重新读取当前行号，再次 batch_patch 修正

**patch_file 使用规则**（单处修改专用）：
- patch_file 仅适合对同一文件做**单处修改**；同一文件多处修改必须用 batch_patch
- 返回结果包含「📋 修改验证快照」，显示修改区域 ±5 行上下文，AI 必须阅读快照确认无误
- 若返回包含「⚠️ 行号偏移警告」，说明本次行数发生变化，后续如需再次修改该文件，必须先 read_file 获取最新行号，或改用 batch_patch

**grep_in_file 搜索翻页**（搜索结果超 100 条时）：
- 返回末尾会出现 ⚠️ 提示，附带 offset 翻页调用示例
- 必须按提示继续翻页，直到收集到所有需要的匹配结果

==============================
重要规则
==============================
- 查看日志时先用 get_run_jobs 找到失败 Job ID，再用 get_job_logs 获取日志
- patch_file 比 write_file 更安全，修改工作流文件时优先使用 patch
- **同一文件多处修改时，必须使用 batch_patch，合并为单个 commit；❌ 严禁多次顺序调用 patch_file——每次行数变化均会使后续行号偏移，导致重复或错误覆盖**
- **batch_patch 的各 patch 行号均基于原始文件，内部自动处理偏移，无需手动修正**
- 修改前必须先用 grep_in_file 或 read_file 确认精确的行号
- **全仓库定位关键词用 grep_in_repo（返回行号）；跨文件批量替换用 search_and_replace（自动完成全流程）；只需文件路径列表用 search_code（更快但无行号）**
- **大文件（>500行）操作必须先 get_code_outline 建立骨架认知，再 read_function 按名称精准读取函数体，避免逐段盲读浪费上下文**
- **grep_in_file 加 context_lines 参数（建议值 3–5）可一次拿到匹配行的上下文，替代「grep→read_file」两步流程**
- **对比两个分支/tag/commit 差异用 compare_commits（含 diff 片段）；查看单个 commit 详情用 get_commit_diff**
- **代码审查用 auto_review；不要手动逐行分析变更文件，auto_review 会自动读取文件并输出结构化报告**
- **触发工作流后必须用 check_run_status 等待结果，不要用 get_workflow_runs 手动轮询；build_apk 类型若超时需再调一次；startup_failure 说明工作流文件有语法问题，直接修复**
- **trigger_workflow 已内置自动修复**：若缺少 workflow_dispatch，系统会自动添加并重试，无需手动干预
- **构建成功必须验证产物**：构建任务成功后，必须按"构建成功后验证产物"工作流完成 Artifacts + Release 确认，并输出固定格式任务总结，然后才能结束任务
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
- 只有当所有步骤都已完成、结果已验证，才输出最终总结；**输出总结时必须在最开头写 \`TASK_DONE\`**（不可省略，系统依靠此标记判断任务完成）
- 遇到工具报错时，自行分析原因并尝试修正，而不是停下来询问用户
- 面对复杂任务，按以下方式执行：
  1. 先输出 PLAN（首轮）
  2. 逐步执行每个步骤，切换步骤时输出 STEP:id
  3. 每步完成后检查结果，决定下一步
  4. 全部完成后输出 \`TASK_DONE\` 后跟简洁的完成总结

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

interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** function calling 模式下 assistant 消息携带的工具调用信息 */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** function calling 模式下 tool 角色消息必须携带的 call_id */
  tool_call_id?: string;
  /**
   * DeepSeek-R1 等思考模型的推理过程。
   * ⚠️ 必须在下一轮 assistant 消息中原样传回，否则 API 报 HTTP 400。
   */
  reasoning_content?: string;
}

/** callLLM 的返回结构：文本内容 + 可能的结构化工具调用 */
interface LLMResult {
  /** 模型输出的自由文本（FC 模式下可能为空） */
  text: string;
  /** DeepSeek-R1 等思考模型的推理过程，必须在下轮 assistant 消息中原样传回 */
  reasoningContent?: string;
  /** 结构化工具调用（FC 模式下有值；自由文本模式下为 null） */
  toolCall: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  } | null;
}

interface ChatChunk {
  choices: Array<{
    delta: {
      content?: string;
      reasoning_content?: string;
      /** FC 模式：工具调用增量 */
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  model: string;
  type: string;
}

async function callLLM(
  cfg: ModelConfig,
  platformKey: string,
  messages: Message[],
  onThinkingChunk?: (chunk: string) => Promise<void>,
  onHeartbeat?: () => Promise<void>,
  onUsage?: (usage: LLMUsage) => void,
): Promise<LLMResult> {
  const { url, headers, bodyExtra } = buildLLMRequest(cfg, platformKey);
  console.log(`[callLLM] type=${cfg.type} model=${cfg.model || "default"} url=${url}`);

  // ── DeepSeek reasoning_content 一致性修复 ──────────────────────────────────
  // DeepSeek API（V4-Flash/V4-Pro 等）要求：所有 assistant 消息都必须携带 reasoning_content 字段。
  // 原因：
  //   1. 前端不保存 reasoning_content，断点恢复或页面刷新后历史消息里缺少该字段
  //   2. 外部代码（reasoningContentEverSeen）只能覆盖同一次请求内的多轮循环，无法跨请求
  //   3. DeepSeek 多个模型（deepseek-v4-flash、deepseek-v4-pro 等）都会输出 reasoning_content
  // 修复策略：所有 deepseek 模型统一启用修复，给所有缺少该字段的 assistant 消息补上""
  const isDeepSeek = cfg.type === "deepseek";
  const missingRC = messages.filter(m => m.role === "assistant" && m.reasoning_content == null).length;
  const needFix = isDeepSeek || missingRC > 0;
  const safeMessages: Message[] = needFix
    ? messages.map(m =>
        m.role === "assistant" && m.reasoning_content == null
          ? { ...m, reasoning_content: "" }
          : m
      )
    : messages;
  if (needFix) {
    const fixed = safeMessages.filter(m => m.role === "assistant" && m.reasoning_content === "").length;
    if (fixed > 0) {
      console.log(`[callLLM] reasoning_content 修复：为 ${fixed} 条 assistant 消息补充了空字符串（isDeepSeek=${isDeepSeek} model=${cfg.model} missingRC=${missingRC}）`);
    }
  }

  // ── 调试：打印所有 assistant 消息的 reasoning_content 状态 ──────────────────
  const dbgMsgs = safeMessages.map(m => m.role === "assistant" ? { role: m.role, hasRC: m.reasoning_content != null, rcLen: m.reasoning_content?.length ?? -1 } : { role: m.role });
  console.log(`[callLLM] debug-messages-structure: ${JSON.stringify(dbgMsgs)}`);

  // ── LLM fetch 超时：90s 防止 TCP 连接永久挂起 ─────────────────────────────
  // Edge Function 自身有 ~240s 超时，此处设 90s 确保在 Edge 超时前得到错误反馈
  const llmAbort = new AbortController();
  const llmTimer = setTimeout(() => llmAbort.abort("llm-timeout"), 90_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ messages: safeMessages, ...bodyExtra }),
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

    // ── 调试：HTTP 400 时打印发出去的 messages（开发调试专用，生产环境可删除） ──
    if (res.status === 400 && errMsg.includes("reasoning_content")) {
      const dbg = safeMessages.map(m => ({
        role: m.role,
        hasRC: m.reasoning_content != null,
        rcLen: m.reasoning_content?.length ?? -1,
        contentPreview: (m.content || "").slice(0, 60),
      }));
      console.error(`[callLLM] HTTP 400 reasoning_content 诊断：发出去的 messages 结构 = ${JSON.stringify(dbg)}`);
    }

    // 附带 HTTP 状态码，为常见错误提供中文友好提示
    let friendly = errMsg;
    if (res.status === 401) friendly = `API Key 无效或已过期（${errMsg || "401 Unauthorized"}）`;
    else if (res.status === 402) friendly = `账户余额不足，请前往平台充值（${errMsg || "402 Payment Required"}）`;
    else if (res.status === 403) friendly = `无访问权限（${errMsg || "403 Forbidden"}）`;
    else if (res.status === 429) friendly = `请求频率超限，请稍后再试（${errMsg || "429 Too Many Requests"}）`;
    else if (res.status >= 500) friendly = `平台服务异常（${res.status}），请稍后重试`;
    const fullMsg = `LLM 调用失败（HTTP ${res.status}）：${friendly}`;
    console.error(`[callLLM] 失败 status=${res.status} msg=${errMsg.slice(0, 200)}`);
    throw new Error(fullMsg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "", buf = "";
  let hadReasoningContent = false; // 标记是否收到过 reasoning_content（思考过程）
  let capturedUsage: ChatChunk["usage"] | null = null;

  // ── Function Calling 工具调用累积 ──────────────────────────────────────────
  // 流式模式下，tool_calls 数据跨多个 chunk，需要逐步拼接
  let fcId = "";
  let fcName = "";
  let fcArgsBuf = ""; // arguments 字符串，分多次 chunk 追加
  // ── 思考内容累积（DeepSeek-R1 等）──────────────────────────────────────────
  // reasoning_content 必须在下轮 assistant 消息中原样传回，此处完整保留
  let reasoningFull = "";

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
        // 捕获 usage 信息（部分平台在最后一个 chunk 中返回）
        if (chunk.usage?.total_tokens) capturedUsage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // ── FC 模式：累积 tool_calls ────────────────────────────────────────
        if (delta.tool_calls && delta.tool_calls.length > 0) {
          const tc = delta.tool_calls[0]; // parallel_tool_calls=false，只取第一个
          if (tc.id) fcId = tc.id;
          if (tc.function?.name) fcName = tc.function.name;
          if (tc.function?.arguments) fcArgsBuf += tc.function.arguments;
          if (onHeartbeat) await onHeartbeat();
          continue; // FC 响应不产生文本 content
        }

        // ── 思考过程 (DeepSeek Reasoner) ──
        if (delta.reasoning_content) {
          hadReasoningContent = true;
          reasoningFull += delta.reasoning_content; // 累积完整思考内容，供下轮传回
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

  // 回调 usage（有平台提供精确值则用；否则基于字符数估算）
  if (onUsage) {
    const modelName = cfg.model || "default";
    if (capturedUsage?.total_tokens) {
      onUsage({
        prompt_tokens: capturedUsage.prompt_tokens ?? 0,
        completion_tokens: capturedUsage.completion_tokens ?? 0,
        total_tokens: capturedUsage.total_tokens,
        model: modelName,
        type: cfg.type,
      });
    } else {
      // 粗估：平均 1 token ≈ 3 字符（中英混合）
      const inputChars = messages.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0);
      const outputChars = full.length + fcArgsBuf.length;
      const est_prompt = Math.ceil(inputChars / 3);
      const est_completion = Math.ceil(outputChars / 3);
      onUsage({
        prompt_tokens: est_prompt,
        completion_tokens: est_completion,
        total_tokens: est_prompt + est_completion,
        model: modelName,
        type: cfg.type,
      });
    }
  }

  // ── FC 工具调用优先返回 ─────────────────────────────────────────────────────
  if (fcName) {
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(fcArgsBuf || "{}");
    } catch {
      console.warn(`[callLLM] FC arguments JSON 解析失败，原始内容：${fcArgsBuf.slice(0, 200)}`);
    }
    console.log(`[callLLM] FC 工具调用 name=${fcName} id=${fcId} argsLen=${fcArgsBuf.length}`);
    return {
      text: full,
      reasoningContent: reasoningFull || undefined,
      toolCall: { id: fcId || `call-${Date.now()}`, name: fcName, arguments: parsedArgs },
    };
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
  return { text: full, reasoningContent: reasoningFull || undefined, toolCall: null };
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
function extractToolCall(text: string): Record<string, unknown> | null {
  const clean = stripCodeFences(text);

  // 策略 1：逐行扫描（最常见情况：工具 JSON 单独成行）
  for (const line of clean.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes('"tool"')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.tool === "string") return parsed as Record<string, unknown>;
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
        if (typeof parsed.tool === "string") return parsed as Record<string, unknown>;
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

/**
 * 将工具参数值规范化为字符串。
 * LLM 有时输出 JSON 数字/布尔值而非字符串（违反 "每个键值必须是字符串" 规则），
 * 此处统一转换，避免 parseInt(undefined) / parseInt(3) 等边缘情况。
 */
/**
 * trigger_and_monitor_build：触发构建工作流，每 60s 轮询结果，失败时自动提取日志
 * 并把错误上下文交给 LLM 修复，循环直到成功或达到最大修复次数。
 *
 * 参数：
 *   workflow_id    - 工作流文件名或 ID（如 "build.yml"）
 *   ref            - 触发分支/tag（默认 targetBranch）
 *   branch         - 目标分支（用于写入修复）
 *   max_fix_attempts - 最大自动修复次数（默认 3）
 */
async function triggerAndMonitorBuild(
  ctx: GithubContext,
  workflowId: string,
  ref: string,
  branch?: string,
  maxFixAttempts = 3,
): Promise<string> {
  if (!workflowId) return "❌ 参数缺失：workflow_id 为必填";
  const targetRef = ref || branch || "main" || "main";

  const log = (...msgs: string[]) => console.log(`[build-monitor] ${msgs.join(" ")}`);

  // ── 1. 触发工作流 ────────────────────────────────────────────────────────
  try {
    await githubRequest(ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/workflows/${workflowId}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: targetRef }),
    });
    log(`已触发 ${workflowId} @ ${targetRef}`);
  } catch (e) { return diagnose4xx(e, "trigger_and_monitor_build (触发阶段)"); }

  // 等待 GitHub 调度延迟
  await new Promise(r => setTimeout(r, 8000));

  // ── 2. 轮询函数：等待运行完成，最多 30 次 × 60s = 30min ─────────────────
  async function pollUntilDone(): Promise<{runId: number; conclusion: string; logsHint: string} | null> {
    for (let tick = 0; tick < 30; tick++) {
      try {
        const runs = await githubRequest(
          ctx,
          `/repos/${ctx.owner}/${ctx.repo}/actions/workflows/${workflowId}/runs?branch=${targetRef}&per_page=1`,
        ) as {workflow_runs: Array<{id: number; status: string; conclusion: string | null; html_url: string}>};

        const run = runs.workflow_runs[0];
        if (!run) { await new Promise(r => setTimeout(r, 60000)); continue; }

        log(`Run #${run.id} status=${run.status} conclusion=${run.conclusion ?? "—"} tick=${tick}`);

        if (run.status === "completed") {
          // 如果失败，获取失败 job 日志摘要
          let logsHint = "";
          if (run.conclusion !== "success") {
            try {
              const jobs = await githubRequest(
                ctx, `/repos/${ctx.owner}/${ctx.repo}/actions/runs/${run.id}/jobs`,
              ) as {jobs: Array<{id: number; name: string; conclusion: string | null}>};

              const failedJobs = jobs.jobs.filter(j => j.conclusion === "failure");
              for (const job of failedJobs.slice(0, 2)) {
                const logText = await getJobLogs(ctx, String(job.id));
                // 只取最后 200 行作为错误上下文
                const lastLines = logText.split("\n").slice(-200).join("\n");
                logsHint += `\n\n**Job: ${job.name}**\n\`\`\`\n${lastLines.slice(0, 4000)}\n\`\`\``;
              }
            } catch { /* 日志获取失败不阻断流程 */ }
          }
          return { runId: run.id, conclusion: run.conclusion || "unknown", logsHint };
        }
      } catch (e) { log(`轮询出错: ${(e as Error).message}`); }
      await new Promise(r => setTimeout(r, 60000));
    }
    return null; // 超时
  }

  // ── 3. 首次等待结果 ────────────────────────────────────────────────────────
  let result = await pollUntilDone();
  if (!result) {
    return `⏳ 构建超时（30min 未完成），请稍后用 get_workflow_runs 手动查询工作流 ${workflowId}`;
  }
  if (result.conclusion === "success") {
    // 自动查询本次构建产生的 Artifacts
    let artifactsInfo = "";
    try {
      artifactsInfo = await getRunArtifacts(ctx, String(result.runId));
    } catch { artifactsInfo = "（Artifacts 查询失败，请用 get_run_artifacts 手动查询）"; }

    return [
      `✅ **构建成功**`,
      `- 工作流：${workflowId}`,
      `- 分支：\`${targetRef}\``,
      `- Run ID：${result.runId}`,
      ``,
      artifactsInfo,
    ].join("\n");
  }

  // ── 4. 构建失败 → 返回日志供 LLM 分析（由外层重试机制驱动修复循环）────────
  // 注意：实际的"LLM分析修复"由任务6（智能重试）在 agent 循环层面完成。
  // 此函数负责：触发 → 等待 → 返回结构化失败信息（含日志）
  // agent 收到失败信息后，会进入 LLM 分析路径，修复代码，再次调用本工具。
  const fixInfo = [
    `❌ **构建失败**（第 1 次）`,
    `- 工作流：${workflowId}`,
    `- 分支：\`${targetRef}\``,
    `- Run ID：${result.runId}`,
    `- 最大允许修复次数：${maxFixAttempts}`,
    ``,
    `**错误日志：**${result.logsHint || "（日志获取失败，请用 get_job_logs 手动查看）"}`,
    ``,
    `请分析上述错误日志，定位问题根因，修复相关代码，然后再次调用 trigger_and_monitor_build。`,
  ].join("\n");

  log(`构建失败 Run #${result.runId}，返回日志供 LLM 分析`);
  return fixInfo;
}

function coerceStr(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") return v;
  return String(v);
}

function executeTool(
  ctx: GithubContext,
  call: Record<string, unknown>,
  targetBranch?: string,
): Promise<string> {
  // 规范化参数：LLM 可能输出数字/布尔值，统一转为字符串再处理
  const p = (k: string, fb = "") => coerceStr(call[k], fb);
  switch (call.tool) {
    // ── 文件操作 ────────────────────────────────────────────────────────────
    case "list_files":   return listFiles(ctx, p("path"));
    case "read_file":    return readFile(
      ctx, p("path"),
      p("start_line") ? parseInt(p("start_line"), 10) : undefined,
      p("end_line")   ? parseInt(p("end_line"),   10) : undefined,
    );
    case "get_file_info": return getFileInfo(ctx, p("path"));
    case "patch_file":   return patchFile(
      ctx, p("path"),
      parseInt(p("start_line"), 10),
      parseInt(p("end_line"),   10),
      p("content"),
      p("message"),
      p("branch") || targetBranch,
    );
    case "write_file":   return writeFile(ctx, p("path"), p("content"), p("message"), p("branch") || targetBranch);
    case "delete_file":  return deleteFile(ctx, p("path"), p("message"), p("branch") || targetBranch);
    case "search_code":  return searchCode(ctx, p("query"));
    case "grep_in_repo": return grepInRepo(
      ctx, p("query"),
      p("file_pattern") || undefined,
      p("offset") ? parseInt(p("offset"), 10) : 0,
    );
    case "batch_patch":  return batchPatch(
      ctx, p("path"),
      (() => {
        const raw = call.patches;
        if (Array.isArray(raw)) return raw;
        try { return JSON.parse(p("patches", "[]")); } catch { return []; }
      })(),
      p("message"),
      p("branch") || targetBranch,
    );
    // ── 新工具 ───────────────────────────────────────────────────────────
    case "file_tree":    return fileTree(ctx, p("path"), parseInt(p("depth", "3"), 10));
    case "grep_in_file": return grepInFile(
      ctx, p("path"), p("pattern"),
      p("case_sensitive") === "true",
      p("offset") ? parseInt(p("offset"), 10) : 0,
      p("context_lines") ? parseInt(p("context_lines"), 10) : 0,
    );
    case "batch_read":   return batchReadFiles(ctx, p("paths"));
    case "get_code_outline": return getCodeOutline(ctx, p("path"));
    case "read_function":    return readFunction(
      ctx, p("path"), p("function_name"),
      p("occurrence") ? parseInt(p("occurrence"), 10) : 1,
      p("ref") || undefined,
    );
    // ── 分支 & PR ────────────────────────────────────────────────────────────
    case "list_branches":     return listBranches(ctx);
    case "list_commits":      return listCommits(ctx, p("path") || undefined, p("branch") || targetBranch);
    case "create_branch":     return createBranch(ctx, p("branch"), p("from") || targetBranch);
    case "list_pull_requests": return listPullRequests(ctx, p("state", "open"));
    case "create_pr":         return createPullRequest(ctx, p("title"), p("head"), p("base"), p("body"));
    case "merge_pull_request": return mergePullRequest(ctx, p("pull_number"), p("merge_method", "squash"), p("commit_title") || undefined);
    // ── Issue ────────────────────────────────────────────────────────────────
    case "list_issues":   return listIssues(ctx, p("state", "open"));
    case "create_issue":  return createIssue(ctx, p("title"), p("body"), p("labels") || undefined);
    case "search_issues": return searchIssues(
      ctx, p("query"),
      p("state", "open"),
      p("labels") || undefined,
      p("assignee") || undefined,
      p("limit") ? parseInt(p("limit"), 10) : 20,
    );
    case "get_issue_details": return getIssueDetails(ctx, p("issue_number"));
    case "update_issue":  return updateIssue(
      ctx, p("issue_number"),
      p("title") || undefined, p("body") || undefined, p("state") || undefined,
      p("labels") || undefined, p("assignees") || undefined,
    );
    // ── Actions 工作流 ───────────────────────────────────────────────────────
    case "list_workflows":      return listWorkflows(ctx);
    case "get_workflow_runs":   return getWorkflowRuns(ctx, p("workflow_id"), parseInt(p("limit", "10"), 10));
    case "get_run_jobs":        return getRunJobs(ctx, p("run_id"));
    case "get_job_logs":        return getJobLogs(
      ctx, p("job_id"),
      p("start_line") ? parseInt(p("start_line"), 10) : undefined,
      p("end_line")   ? parseInt(p("end_line"),   10) : undefined,
    );
    case "trigger_workflow":    return triggerWorkflow(ctx, p("workflow_id"), p("ref"), undefined);
    case "check_run_status":    return checkRunStatus(
      ctx, p("run_id"),
      (p("workflow_type") as "fast" | "normal" | "build_apk") || "normal",
    );
    case "cancel_workflow_run": return cancelWorkflowRun(ctx, p("run_id"));
    case "rerun_workflow_run":  return rerunWorkflowRun(ctx, p("run_id"), p("failed_jobs_only") === "true");
    case "list_actions_secrets": return listActionsSecrets(ctx);
    case "list_actions_variables": return listActionsVariables(ctx);
    case "set_actions_variable": return setActionsVariable(ctx, p("name"), p("value"));
    case "get_repo_info":        return getRepoInfo(ctx);
    case "add_comment":          return addComment(ctx, p("issue_number") || p("pull_number"), p("body"));
    case "close_issue":          return closeIssue(ctx, p("issue_number"), p("comment") || undefined);
    case "close_pr":             return closePR(ctx, p("pull_number"), p("comment") || undefined);
    case "get_commit_diff":      return getCommitDiff(ctx, p("sha"));
    case "get_pr_files":         return getPRFiles(ctx, p("pull_number"));
    case "compare_commits":      return compareCommits(ctx, p("base"), p("head"));
    case "search_and_replace":   return searchAndReplace(
      ctx, p("pattern"), p("replacement"), p("file_pattern") || undefined,
      p("message"), p("branch") || targetBranch,
    );
    case "auto_review":          return autoReview(
      ctx,
      p("commit_count") ? parseInt(p("commit_count"), 10) : 1,
      p("sha") || undefined,
    );
    case "create_release":       return createRelease(ctx, p("tag_name"), p("name"), p("body"), p("draft") === "true", p("prerelease") === "true", p("branch") || targetBranch);
    case "list_releases":        return listReleases(ctx, parseInt(p("limit", "10"), 10));
    case "submit_pr_review":     return submitPRReview(ctx, p("pull_number"), p("event"), p("body"));
    // Release 自动化辅助工具
    case "get_latest_release":   return getLatestRelease(ctx);
    case "get_merged_prs_since": return getMergedPRsSince(ctx, p("since"));
    // ── 新增工具 ─────────────────────────────────────────────────────────────
    case "preview_diff":         return previewDiff(ctx, p("path"), parseInt(p("start_line"), 10), parseInt(p("end_line"), 10), p("content"));
    case "undo_last_commit":     return undoLastCommit(ctx, p("branch") || targetBranch);
    case "run_lint":             return runLint(ctx, p("branch") || targetBranch);
    case "check_security":       return checkSecurity(ctx, p("path") || "");
    case "trigger_and_monitor_build": return triggerAndMonitorBuild(
      ctx, p("workflow_id"), p("ref"), p("branch") || targetBranch,
      p("max_fix_attempts") ? parseInt(p("max_fix_attempts"), 10) : 3,
    );
    case "get_run_artifacts":        return getRunArtifacts(ctx, p("run_id"));
    default: return Promise.resolve(`未知工具: ${String(call.tool)}`);
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
        interrupted: false,
      })
      .select("id")
      .maybeSingle();
    if (error || !data) { console.error("[db] createWorkflow error", error?.message); return null; }

    // 批量插入步骤
    const stepRows = steps.map((s, i) => ({
      workflow_id: (data as any).id,
      step_id: s.id,
      seq: i,
      title: s.title,
      description: s.desc,
      status: "pending",
    }));
    // @ts-ignore
    const { error: sErr } = await sb.from("task_workflow_steps").insert(stepRows);
    if (sErr) console.error("[db] insertSteps error", sErr.message);

    return (data as any).id as string;
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
      // @ts-ignore
      .update(patch)
      .eq("workflow_id", workflowId)
      .eq("step_id", stepId);
  } catch (e) { console.error("[db] updateStep exception", (e as Error).message); }
}

/**
 * 清理消息链中的不完整 tool_calls 对。
 * slice(-60) 截断可能导致：
 * 1. 开头保留的第一条是 tool 消息（前面的 assistant 被截掉）
 * 2. 末尾保留的最后一条是 assistant(tool_calls)（后面的 tool 被截掉）
 * 3. 中间截断导致 summary(user) 后面紧跟 tool 消息
 * 这三种情况都会触发 LLM API 的 HTTP 400 错误。
 */
function sanitizeToolCallMessages(msgs: Message[]): Message[] {
  if (msgs.length === 0) return [];
  const result = [...msgs];

  // 1. 扫描整个数组：移除前面没有 assistant(tool_calls) 的孤立 tool 消息
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i];
    if (msg.role === "tool" && msg.tool_call_id) {
      const prev = result[i - 1];
      const hasPrevAssistantWithCall =
        prev &&
        prev.role === "assistant" &&
        prev.tool_calls?.some((tc) => tc.id === msg.tool_call_id);
      if (!hasPrevAssistantWithCall) {
        result.splice(i, 1);
      }
    }
  }

  // 2. 从末尾移除：没有对应 tool 回复的不完整 assistant(tool_calls)
  while (result.length > 0) {
    const last = result[result.length - 1];
    if (last.role === "assistant" && last.tool_calls && last.tool_calls.length > 0) {
      const allReplied = last.tool_calls.every((tc) =>
        result.some((m) => m.role === "tool" && m.tool_call_id === tc.id)
      );
      if (!allReplied) {
        result.pop();
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return result;
}

/** 保存 messages 快照（用于批次中断后恢复） */
async function dbSaveSnapshot(
  sb: ReturnType<typeof createClient>,
  workflowId: string,
  messages: Message[],
  lastStepId: string | null,
  interrupted: boolean,
) {
  try {
    // 保留最近 60 条消息，防止快照过大（jsonb 列最大 1GB，但实际控制合理大小）
    // ⚠️ 截断可能导致不完整的 tool_calls 对，保存前必须清理
    const snapshot = sanitizeToolCallMessages(messages.slice(-60));
    await sb
      .from("task_workflows")
      .update({
        messages_snapshot: snapshot,
        last_step_id: lastStepId,
        interrupted,
      })
      .eq("id", workflowId);
  } catch (e) { console.error("[db] saveSnapshot exception", (e as Error).message); }
}

/** 加载工作流快照（用于断点恢复） */
async function dbLoadSnapshot(
  sb: ReturnType<typeof createClient>,
  workflowId: string,
): Promise<{ messages: Message[]; lastStepId: string | null; taskSummary: string } | null> {
  try {
    const { data, error } = await sb
      .from("task_workflows")
      .select("messages_snapshot, last_step_id, task_summary, interrupted")
      .eq("id", workflowId)
      .maybeSingle();
    if (error || !data) return null;
    // ⚠️ 加载后再次清理：旧快照可能包含不完整的 tool_calls 对
    const rawMessages = ((data as any).messages_snapshot as Message[]) ?? [];
    return {
      messages: sanitizeToolCallMessages(rawMessages),
      lastStepId: ((data as any).last_step_id as string) ?? null,
      taskSummary: ((data as any).task_summary as string) ?? "",
    };
  } catch (e) { console.error("[db] loadSnapshot exception", (e as Error).message); return null; }
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
      // @ts-ignore
      .update({ status, done_steps: done, fail_steps: fail, finished_at: new Date().toISOString(), interrupted: false })
      .eq("id", workflowId);
  } catch (e) { console.error("[db] finishWorkflow exception", (e as Error).message); }
}

// ── SSE 流输出 ───────────────────────────────────────────────────────────────

/**
 * 创建标准化 SSE 流。
 *
 * 每条事件格式：
 * {
 *   "stream_id": "s_<uuid>",   // 当前流的唯一标识（整个请求共享）
 *   "turn_id":   "t_<uuid>",   // 当前对话轮次 ID（前端传入 idempotency_key 复用）
 *   "seq":       <number>,     // 单调递增序列号（前端用于去重/乱序检测）
 *   "timestamp": <epoch_ms>,   // 服务端发出时间
 *   "type":      "<event>",    // 事件类型
 *   ...payload                 // 事件专有字段
 * }
 */
function createSSEStream(streamId: string, turnId: string) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let seq = 0;

  const sendRaw = (data: string) => writer.write(encoder.encode(`data: ${data}\n\n`));

  /** 发送结构化事件（标准协议，含 seq/stream_id/turn_id/timestamp） */
  const sendTyped = (payload: Record<string, unknown>) => {
    const envelope = {
      stream_id: streamId,
      turn_id: turnId,
      seq: seq++,
      timestamp: Date.now(),
      ...payload,
    };
    return sendRaw(JSON.stringify(envelope));
  };

  /** 发送纯内容 Chunk */
  const sendChunk = (content: string) =>
    sendTyped({ type: "content", content });

  /** 正常完成：发送 done 事件后关闭流 */
  const sendDone = async () => {
    await sendTyped({ type: "done", total_seq: seq });
    await writer.close();
  };

  /** 错误完成：发送 error 事件后关闭流 */
  const sendError = async (code: string, message: string) => {
    try { await sendTyped({ type: "error", code, message }); } catch { /* ignore */ }
    try { await writer.close(); } catch { /* ignore */ }
  };

  return { readable, sendTyped, sendChunk, sendDone, sendError };
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

// ── 工具网关：并发控制、熔断降级、异步任务与状态机 ───────────────────────────

/**
 * 熔断器：跟踪工具执行失败率
 * 当某个工具连续失败超过阈值时，直接熔断（拒绝执行并返回降级提示），
 * 避免浪费时间或引起进一步的安全/冲突问题。
 */
class ToolCircuitBreaker {
  private failures = new Map<string, { count: number; lastFailure: number }>();
  private threshold = 3;
  private resetTimeoutMs = 60000; // 60秒冷却时间

  isOpen(toolName: string): boolean {
    const record = this.failures.get(toolName);
    if (!record) return false;
    if (record.count >= this.threshold) {
      if (Date.now() - record.lastFailure > this.resetTimeoutMs) {
        record.count = this.threshold - 1; // 半开状态，给一次机会
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess(toolName: string) {
    this.failures.delete(toolName);
  }

  recordFailure(toolName: string) {
    const record = this.failures.get(toolName) || { count: 0, lastFailure: 0 };
    record.count++;
    record.lastFailure = Date.now();
    this.failures.set(toolName, record);
  }
}
const globalCircuitBreaker = new ToolCircuitBreaker();

/**
 * 并发控制信号量：用于控制同一时间执行的特定任务最大并发数
 */
class ConcurrencySemaphore {
  private active = 0;
  constructor(private maxConcurrent: number) {}
  
  async acquire(): Promise<void> {
    while (this.active >= this.maxConcurrent) {
      await new Promise(r => setTimeout(r, 100)); // 简单轮询等待
    }
    this.active++;
  }
  
  release(): void {
    this.active = Math.max(0, this.active - 1);
  }
}
const writeOpSemaphore = new ConcurrencySemaphore(1); // 写操作严格串行，防止冲突

/**
 * 异步任务队列与状态机：管理高风险/写操作的生命周期
 * 状态机流转：queued -> running -> retrying -> completed | failed
 */
type TaskState = "queued" | "running" | "retrying" | "completed" | "failed";
interface WriteTask {
  id: string;
  tool: string;
  state: TaskState;
  retryCount: number;
  result?: string;
  error?: string;
}

class WriteTaskQueue {
  private tasks = new Map<string, WriteTask>();

  enqueue(id: string, tool: string) {
    this.tasks.set(id, { id, tool, state: "queued", retryCount: 0 });
    console.log(`[TaskQueue] 写操作任务入队: ${id} (${tool})`);
  }

  updateState(id: string, state: TaskState, updates?: Partial<WriteTask>) {
    const task = this.tasks.get(id);
    if (task) {
      task.state = state;
      if (updates) Object.assign(task, updates);
      console.log(`[TaskQueue] 状态流转 [${id}]: -> ${state}`);
    }
  }

  getTask(id: string) {
    return this.tasks.get(id);
  }
}
const writeTaskQueue = new WriteTaskQueue();


/**
 * 安全审核引擎：对传入的写操作参数进行高危动作拦截
 */
class SecurityPolicyEngine {
  // 禁止删除的核心系统文件
  private static protectedFiles = new Set(["package.json", "tsconfig.json", "supabase/functions/ai-assistant/index.ts"]);
  
  // 禁止直接往这些受保护分支写入代码（迫使用 PR）
  private static protectedBranches = new Set(["main", "master", "production"]);

  static validate(toolName: string, callParams: Record<string, unknown>, targetBranch?: string): void {
    const p = (k: string) => String(callParams[k] || "");
    const opBranch = p("branch") || targetBranch || "";
    
    // 拦截高危文件删除
    if (toolName === "delete_file" && this.protectedFiles.has(p("path"))) {
      throw new Error(`【安全风控】禁止直接删除核心配置文件：${p("path")}`);
    }

    // 拦截受保护分支的直接修改
    const writeTools = new Set(["write_file", "patch_file", "batch_patch"]);
    if (writeTools.has(toolName) && this.protectedBranches.has(opBranch)) {
      throw new Error(`【安全风控】禁止直接向受保护分支 "${opBranch}" 写入代码。请先调用 create_branch 切换到新分支，完成后提交 PR。`);
    }
  }
}

/**
 * 可观测性日志打点
 */
class MetricsLogger {
  static log(payload: {
    tool: string;
    status: "success" | "fail";
    elapsedMs: number;
    cached: boolean;
    errorMsg?: string;
  }) {
    // 生产环境中可通过 ELK 或 Supabase 日志进行分析
    console.log("[METRICS_AUDIT]", JSON.stringify({
      timestamp: new Date().toISOString(),
      ...payload
    }));
  }
}

/**
 * 统一结果协议封箱
 */
function normalizeResultProtocol(result: string, isError: boolean): string {
  try {
    // 如果已经是规范 JSON 则不重复包装
    JSON.parse(result);
    return result;
  } catch {
    return JSON.stringify({
      status: isError ? "error" : "success",
      summary: isError ? "工具执行遭遇异常" : "工具执行完成",
      structured_data: isError ? null : result,
      error_message: isError ? result : null
    });
  }
}

// ────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  // 优化：单次请求生命周期内的只读工具缓存，避免重复拉取相同文件/API消耗时间和Token
  const requestCache = new Map<string, string>();

  let messages: Message[], githubToken: string, owner: string, repo: string;
  let modelConfig: ModelConfig = { type: "wenxin" };
  let targetBranch: string | undefined;
  let userId = "anonymous";
  let resumeWorkflowId: string | undefined; // 断点恢复：传入 workflow id
  let isAutoMode = false; // 自主模式开关（前端 auto_mode 字段）
  let idempotencyKey: string | undefined; // 幂等键：防止重复执行写操作

  try {
    const body = await req.json();
    messages = body.messages;
    githubToken = body.github_token;
    owner = body.owner;
    repo = body.repo;
    targetBranch = body.target_branch || undefined;
    if (body.model_config) modelConfig = body.model_config;
    if (body.user_id) userId = body.user_id;
    if (body.resume_workflow_id) resumeWorkflowId = body.resume_workflow_id;
    if (body.idempotency_key) idempotencyKey = body.idempotency_key;
    // 读取自主模式标志：断点恢复时强制保持自主模式（恢复的任务必然是复杂任务）
    isAutoMode = !!body.auto_mode || !!resumeWorkflowId;
    // ── 模型路由：temperature 自适应 ────────────────────────────────────────
    // 若用户在 model_config 中未指定 temperature，则根据任务类型自动推断：
    //   Auto 模式（代码写操作）→ 0.1（最确定性）
    //   分析/review/报告类   → 0.3（聚焦但有弹性）
    //   普通对话             → 0.7（正常创意）
    const userLastMessage = Array.isArray(messages)
      ? (messages.filter(m => m.role === "user").pop()?.content ?? "")
      : "";
    modelConfig.temperature = inferTemperature(
      userLastMessage,
      isAutoMode,
      modelConfig.temperature,   // 用户手动设置时保留，不覆盖
    );
    console.log(`[model-route] type=${modelConfig.type} temperature=${modelConfig.temperature} autoMode=${isAutoMode}`);
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

  // 生成本次流的唯一标识：stream_id 每次新请求生成；turn_id 复用幂等键（有则用，无则新建）
  const streamId = `s_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const turnId = idempotencyKey ?? `t_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const { readable, sendTyped, sendChunk, sendDone, sendError } = createSSEStream(streamId, turnId);

  // 客户端中断信号：用户点"停止"时 req.signal 触发 abort
  const abortSig = req.signal;

  (async () => {
    try {
    // Supabase 客户端（可能为 null，持久化失败不影响主流程）
    const sb = makeSupabase();
    // 工作流 DB id（首轮收到 plan 后写入）
    let workflowDbId: string | null = null;

    // ── 断点恢复：若传入 resume_workflow_id，加载历史 messages 快照 ──────────
    let isResuming = false;
    let resumedLastStepId: string | null = null;
    if (resumeWorkflowId && sb) {
      const snap = await dbLoadSnapshot(sb, resumeWorkflowId);
      if (snap && snap.messages.length > 0) {
        // 用快照替换 messages（保留 system prompt）
        messages = snap.messages.filter(m => m.role !== "system");
        resumedLastStepId = snap.lastStepId;
        workflowDbId = resumeWorkflowId;
        isResuming = true;
        // 标记工作流重新运行
        await sb.from("task_workflows").update({ status: "running", interrupted: false }).eq("id", resumeWorkflowId);
        console.log(`[resume] workflow=${resumeWorkflowId} lastStep=${resumedLastStepId} msgs=${messages.length}`);
      }
    }

    let fullMessages: Message[] = [{ role: "system", content: buildSystemPrompt(targetBranch, isAutoMode, modelConfig.type, modelConfig) }, ...messages];
    console.log(`[main] model=${modelConfig.type} hasApiKey=${!!modelConfig.api_key} owner=${owner} repo=${repo} resume=${isResuming} autoMode=${isAutoMode}`);
    // 检查前端传来的历史消息：如果已有带 reasoning_content 的 assistant 消息，
    // 后续所有 assistant 消息也必须携带该字段（DeepSeek-R1 API 强制要求）
    // 注：前端目前不保存此字段，所以 messages 里的历史不会触发此标志，
    //     但对未来兼容性保留此检测
    const historyHasReasoning = messages.some(m => m.role === "assistant" && m.reasoning_content);
    
    // 心跳辅助函数：每次调用都向 SSE 写入一条 heartbeat，保持连接活跃
    const heartbeat = () => sendTyped({ type: "heartbeat" });
    // 启动背景心跳，每 15 秒发送一次，防止工具调用等耗时操作导致连接中断
    const heartbeatTimer = setInterval(heartbeat, 15000);

    const TOOL_LABELS: Record<string, string> = {
      // 文件操作
      list_files: "列出目录", read_file: "读取文件", get_file_info: "文件信息", patch_file: "局部修改文件",
      write_file: "写入文件", delete_file: "删除文件", search_code: "搜索代码",
      file_tree: "文件树", grep_in_file: "文件内搜索", batch_read: "批量读取文件",
      grep_in_repo: "全仓库搜索", batch_patch: "批量局部修改",
      get_code_outline: "提取代码骨架", read_function: "读取函数体",
      // 分支 & PR
      list_branches: "列出分支", list_commits: "提交历史", create_branch: "新建分支",
      list_pull_requests: "列出 PR", create_pr: "创建 PR", merge_pull_request: "合并 PR",
      // Issue
      list_issues: "列出 Issues", create_issue: "创建 Issue",
      search_issues: "搜索 Issues", get_issue_details: "Issue 详情", update_issue: "更新 Issue",
      // Actions 工作流
      list_workflows: "列出工作流", get_workflow_runs: "查看运行记录",
      get_run_jobs: "查看 Jobs", get_job_logs: "下载/分段读取日志",
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
      get_run_artifacts: "查询构建产物",
      // 工具自我改进
      report_tool_issue: "上报工具问题", propose_tool_fix: "提交改进方案",
    };
    // 每批最多 20 轮工具调用；最多自动续跑 3 批，总上限 60 轮
    const MAX_ROUNDS_PER_BATCH = 20;
    const MAX_BATCHES = 3;
    // 整体任务超时：8 分钟（480000ms），超时后自动保存快照并通知用户
    const TASK_TIMEOUT_MS = 480_000;
    const taskStartTime = Date.now();
    // 检查是否已超时（在每轮循环开始时调用）
    const isTaskTimedOut = () => Date.now() - taskStartTime >= TASK_TIMEOUT_MS;
    // 当前正在执行的计划步骤 ID
    let currentStepId: string | null = resumedLastStepId;
    // 连续"无工具调用"的 nudge 计数（最多纠正 2 次，防止死循环）
    let nudgeCount = 0;
    const MAX_NUDGE = 2;
    // 总轮次计数（跨批次）
    let totalRound = 0;
    // 任务计划是否已成功提取并发送（用于替代 totalRound===0 的一次性判断，
    // 修复：FC 模式 LLM 在 round 0 先调用 report_tool_issue 而不输出 PLAN，
    // 导致 totalRound===0 时 rawText 为空，计划永远不被提取的 bug）
    let planSent = false;
    // 智能重试：记录每个步骤（stepId）的失败次数，超过 MAX_SMART_RETRIES 才终止
    const stepFailCount = new Map<string, number>();
    const MAX_SMART_RETRIES = 2;
    /**
     * 本批次内是否曾经收到过 reasoning_content（DeepSeek-R1 思考模式）。
     * ⚠️ 一旦为 true，后续所有 assistant 消息都必须携带 reasoning_content（可为空字符串），
     *    否则 DeepSeek API 报 HTTP 400：reasoning_content must be passed back。
     */
    let reasoningContentEverSeen = historyHasReasoning;

    // ── 恢复执行时，首轮注入续跑指令 ───────────────────────────────────────
    if (isResuming) {
      fullMessages.push({
        role: "user",
        content: `⚠️ 系统提示：这是一次断点恢复执行。上次任务在步骤 "${resumedLastStepId ?? "未知"}" 时因批次耗尽而中断。` +
          `\n请直接继续执行剩余未完成的步骤，不要重新输出 PLAN，直接从下一个工具调用开始。`,
      });
    }

    for (let batch = 0; batch < MAX_BATCHES; batch++) {
    let batchDone = false; // 本批是否已完成（break 出内层循环）
    for (let round = 0; round < MAX_ROUNDS_PER_BATCH; round++, totalRound++) {
      // ── 用户主动中断：立即退出循环 ────────────────────────────────────────
      if (abortSig.aborted) { batchDone = true; break; }

      // ── 整体任务超时保护：超过 8 分钟自动中断，保存快照供断点恢复 ──────────
      if (isTaskTimedOut()) {
        console.warn(`[timeout] 任务超时（已运行 ${Math.round((Date.now() - taskStartTime) / 1000)}s），自动中断`);
        if (sb && workflowDbId) {
          await dbSaveSnapshot(sb, workflowDbId, fullMessages, currentStepId, true);
        }
        await sendTyped({ type: "status_info", message: "⏱️ 任务执行超时（超过 8 分钟），已自动暂停。您可以在「任务历史」中点击「恢复执行」继续。" });
        await sendTyped({ type: "timeout", workflow_id: workflowDbId ?? undefined });
        batchDone = true;
        break;
      }

      let assistantText = "";
      let thinkingStarted = false;
      // FC 模式下存储结构化工具调用（非 FC 模型保持 null，走 extractToolCall）
      let fcToolCall: LLMResult["toolCall"] = null;
      /** 本轮 LLM 思考内容（DeepSeek-R1 等），下轮 assistant 消息必须原样传回 */
      let lastReasoningContent: string | undefined;

      // 定义思考过程回调；普通内容 chunk 触发心跳
      const onThinkingChunk = async (chunk: string) => {
        if (!thinkingStarted) {
          await sendTyped({ type: "think_start" });
          thinkingStarted = true;
        }
        await sendTyped({ type: "think_chunk", content: chunk });
      };

      // usage 回调：收到 LLM token 用量后发送 SSE usage 事件
      const onUsageCb = (usage: LLMUsage) => {
        sendTyped({ type: "usage", prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens, model: usage.model, providerType: usage.type }).catch(() => { /* ignore send error */ });
      };

      try {
        const llmResult = await callLLM(modelConfig, platformKey, fullMessages, onThinkingChunk, heartbeat, onUsageCb);
        assistantText = llmResult.text;
        // FC 模式下，结构化工具调用直接挂到本轮作用域；非 FC 则为 null（后续走 extractToolCall）
        fcToolCall = llmResult.toolCall;
        // 保存思考内容：DeepSeek-R1 等思考模型要求下轮 assistant 消息必须原样传回
        lastReasoningContent = llmResult.reasoningContent;
        // 标记：本批次曾收到过 reasoning_content；后续所有 assistant 消息均需携带该字段
        if (llmResult.reasoningContent) reasoningContentEverSeen = true;
        if (thinkingStarted) await sendTyped({ type: "think_end" });
      } catch (e) {
        const errMsg = (e as Error).message ?? String(e);
        // ── 错误分类：永久性错误立即终止；瞬时错误指数退避重试 ──────────────────
        // 永久性：401/403/402 API Key 或余额问题，重试无意义
        const isPermanent =
          errMsg.includes("HTTP 401") || errMsg.includes("HTTP 403") || errMsg.includes("HTTP 402") ||
          errMsg.includes("401）") || errMsg.includes("403）") || errMsg.includes("402）") ||
          errMsg.includes("认证失败") || errMsg.includes("无权限") || errMsg.includes("余额不足");
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

      // ── 提取任务计划（每次 LLM 回复都尝试，直到成功提取为止）────────────────
      // 恢复执行时跳过：workflowDbId 已由断点恢复设置，不能覆盖；且 AI 不应重输 PLAN
      // 使用 planSent 标志替代 totalRound===0：
      //   修复 FC 模式下 LLM 在首轮调用 report_tool_issue 而不输出 PLAN 的 bug：
      //   此时 rawText 为空或无 PLAN 块，旧的 totalRound===0 判断一过永不再提取，
      //   导致 taskPlanSteps 始终为空，工作流进度面板无法显示步骤进度。
      if (!planSent && !isResuming) {
        const plan = extractPlan(rawText); // 使用原始文本（stripCodeFences 在内部处理）
        if (plan && plan.length > 0) {
          planSent = true; // 标记：后续轮次不再重复提取
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

      // ── 工具调用解析：FC 模式优先，否则退回文本解析 ─────────────────────────
      // FC 模式：直接用 callLLM 返回的结构化工具调用（精确、无歧义）
      // 文本模式：走 extractToolCall 正则解析（文心/custom 专用）
      const toolCall = fcToolCall
        ? {
            tool: fcToolCall.name,
            // 保留原始类型（数组参数如 batch_patch.patches 需要 Array 类型）
            ...fcToolCall.arguments,
            // 记录 FC 元数据供消息历史注入使用
            _fcId: fcToolCall.id,
          }
        : extractToolCall(assistantText);
      if (!toolCall) {
        // ── 任务完成检测：AI 输出了 TASK_DONE 标记 或 明确的完成性语句 ──────────
        // 优先于 nudge 检查：若 AI 已确认任务完成，直接跳到最终回答，不催促工具调用
        const isTaskDone =
          /\bTASK_DONE\b/.test(assistantText) ||
          /(?:全部步骤已完成|所有步骤(?:均)?已完成|任务(?:已)?全部完成|已全部完成)/.test(assistantText);

        // ── Nudge 机制：仅自主模式 且 未检测到任务完成 时生效 ─────────────────
        // 普通对话模式允许 AI 直接给最终文字回答，不强制续跑工具调用
        // 自主模式下：只要还在自主模式，无论 currentStepId 是否为 null 都应 nudge，
        // 防止步骤间歇期（上一步刚结束 currentStepId=null，LLM 还没开始下一步）
        // 输出文字后直接结束。nudgeCount 上限自身控制退出条件。
        // FC 模式：模型已使用 function calling，但本轮没有调用工具，说明任务完成或需要纯文字回答
        // FC 模式下不发 nudge（FC 模型能精确决策何时结束）
        const isFCModel = supportsFunctionCalling(modelConfig.type, modelConfig.model);
        const taskOngoing = isAutoMode && !isTaskDone && !isFCModel;
        if (taskOngoing && nudgeCount < MAX_NUDGE) {
          nudgeCount++;
          console.log(`[nudge ${nudgeCount}] totalRound=${totalRound} currentStepId=${currentStepId} 无工具调用，注入纠正提示`);
          // 保留 LLM 已输出的文字内容，再追加纠正指令
          const displayText = assistantText.replace(/\bPLAN\s*:\s*\{[\s\S]*?\}/i, "").replace(/\bTASK_DONE\b\s*/g, "").trim();
          if (displayText) await sendChunk(displayText + "\n");
          // 非 FC 模式才注入 JSON 格式纠正（FC 模型已通过 schema 约束工具格式）
          fullMessages.push({ role: "assistant", content: rawText, ...(reasoningContentEverSeen ? { reasoning_content: lastReasoningContent ?? "" } : {}) });
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
        // 去除 TASK_DONE 标记再展示给用户（用户不需要看到内部标记）
        const finalDisplayText = assistantText.replace(/\bTASK_DONE\b\s*/g, "").trim();
        // 逐词流式输出最终回答，模拟打字机效果
        await streamAnswer(finalDisplayText, sendChunk, 10, () => abortSig.aborted);
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

      const label = TOOL_LABELS[String(toolCall.tool)] || toolCall.tool;
      const hint = toolCall.tool === "read_file" && (toolCall.start_line || toolCall.end_line)
        ? `${toolCall.path} 第${toolCall.start_line || "1"}–${toolCall.end_line || "末尾"}行`
        : toolCall.tool === "patch_file"
          ? `${toolCall.path} 第${toolCall.start_line}–${toolCall.end_line}行`
          : toolCall.tool === "get_workflow_runs"
            ? `workflow: ${toolCall.workflow_id || "全部"}`
            : toolCall.tool === "get_run_jobs" || toolCall.tool === "cancel_workflow_run" || toolCall.tool === "rerun_workflow_run"
              ? `run_id: ${toolCall.run_id}`
              : toolCall.tool === "get_job_logs"
                ? toolCall.start_line
                  ? `job_id: ${toolCall.job_id} 行 ${toolCall.start_line}–${toolCall.end_line || "末尾"}`
                  : `job_id: ${toolCall.job_id}`
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
        // FC 模式下 assistant 消息要带 tool_calls 字段
        if (fcToolCall) {
          fullMessages.push({
            role: "assistant", content: "",
            tool_calls: [{ id: fcToolCall.id, type: "function", function: { name: fcToolCall.name, arguments: JSON.stringify(fcToolCall.arguments) } }],
          });
          fullMessages.push({ role: "tool", content: `已向用户请求上传文件"${toolCall.filename || 'file'}"，请继续等待用户上传。`, tool_call_id: fcToolCall.id });
        } else {
          fullMessages.push({ role: "assistant", content: rawText, ...(reasoningContentEverSeen ? { reasoning_content: lastReasoningContent ?? "" } : {}) });
          fullMessages.push({
            role: "user",
            content: `已向用户请求上传文件"${toolCall.filename || 'file'}"，请继续等待用户上传。上传完成后系统会将文件内容附加到对话中。`,
          });
        }
        // 结束本次流式（前端收到 file_request 后会引导用户上传，并开启新一轮对话）
        batchDone = true;
        break;
      }

      // ── report_tool_issue：虚拟工具，AI 上报工具问题 ─────────────────────
      if (toolCall.tool === "report_tool_issue") {
        const toolName   = String(toolCall.tool_name || "unknown");
        const issue      = String(toolCall.issue || "");
        const severity   = String(toolCall.severity || "medium");
        const context    = String(toolCall.context || `repo: ${owner}/${repo}`);
        let savedId: string | null = null;

        if (sb) {
          try {
            const { data } = await sb.from("tool_improvement_proposals").insert({
              tool_name: toolName, issue, severity, context,
              submitted_by: `${modelConfig.type}@${owner}/${repo}`,
              status: "pending",
            }).select("id").maybeSingle();
            savedId = data?.id ?? null;
          } catch (e) { console.error("[report_tool_issue] db error", (e as Error).message); }
        }

        // 通知前端刷新工具改进面板
        await sendTyped({ type: "tool_issue_reported", tool_name: toolName, severity, proposal_id: savedId });

        const ack = `✅ 已上报工具问题（${toolName} · ${severity}）${savedId ? `，提案 ID: ${savedId.slice(0, 8)}` : ""}`;
        if (fcToolCall) {
          fullMessages.push({ role: "assistant", content: "", tool_calls: [{ id: fcToolCall.id, type: "function", function: { name: fcToolCall.name, arguments: JSON.stringify(fcToolCall.arguments) } }] });
          fullMessages.push({ role: "tool", content: ack, tool_call_id: fcToolCall.id });
        } else {
          fullMessages.push({ role: "assistant", content: rawText, ...(reasoningContentEverSeen ? { reasoning_content: lastReasoningContent ?? "" } : {}) });
          fullMessages.push({ role: "user", content: ack });
        }
        continue; // 继续执行任务，不中断
      }

      // ── propose_tool_fix：虚拟工具，AI 提交代码改进方案 ──────────────────
      if (toolCall.tool === "propose_tool_fix") {
        const toolName    = String(toolCall.tool_name || "unknown");
        const explanation = String(toolCall.explanation || "");
        const codeBefore  = String(toolCall.code_before || "");
        const codeAfter   = String(toolCall.code_after || "");
        let savedId: string | null = null;

        if (sb) {
          try {
            // 尝试更新同一工具最近一条 pending 提案；若无则新建
            const { data: existing } = await sb
              .from("tool_improvement_proposals")
              .select("id")
              .eq("tool_name", toolName)
              .eq("status", "pending")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (existing?.id) {
              await sb.from("tool_improvement_proposals").update({
                explanation, code_before: codeBefore || null, code_after: codeAfter || null,
              }).eq("id", existing.id);
              savedId = existing.id;
            } else {
              const { data } = await sb.from("tool_improvement_proposals").insert({
                tool_name: toolName, issue: explanation, explanation,
                code_before: codeBefore || null, code_after: codeAfter || null,
                severity: "medium", context: `repo: ${owner}/${repo}`,
                submitted_by: `${modelConfig.type}@${owner}/${repo}`,
                status: "pending",
              }).select("id").maybeSingle();
              savedId = data?.id ?? null;
            }
          } catch (e) { console.error("[propose_tool_fix] db error", (e as Error).message); }
        }

        await sendTyped({ type: "tool_fix_proposed", tool_name: toolName, proposal_id: savedId });

        const ack = `✅ 已保存改进方案（${toolName}）${savedId ? `，提案 ID: ${savedId.slice(0, 8)}` : ""}`;
        if (fcToolCall) {
          fullMessages.push({ role: "assistant", content: "", tool_calls: [{ id: fcToolCall.id, type: "function", function: { name: fcToolCall.name, arguments: JSON.stringify(fcToolCall.arguments) } }] });
          fullMessages.push({ role: "tool", content: ack, tool_call_id: fcToolCall.id });
        } else {
          fullMessages.push({ role: "assistant", content: rawText, ...(reasoningContentEverSeen ? { reasoning_content: lastReasoningContent ?? "" } : {}) });
          fullMessages.push({ role: "user", content: ack });
        }
        continue; // 继续执行任务
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
      let isCached = false;
      const readOnlyTools = new Set([
        "list_files", "read_file", "get_file_info", "search_code",
        "grep_in_repo", "file_tree", "grep_in_file", "batch_read",
        "get_code_outline", "read_function", "list_branches", "list_commits",
        "list_pull_requests", "get_pr_files", "list_issues", "search_issues",
        "get_issue_details", "get_repo_info", "get_commit_diff", "compare_commits",
        "list_workflows", "get_workflow_runs", "check_run_status",
        "get_run_jobs", "get_job_logs", "list_actions_secrets",
        "list_actions_variables", "get_run_artifacts", "list_releases",
        "get_latest_release", "get_merged_prs_since", "request_file"
      ]);
      const toolName = String(toolCall.tool);
      const cacheKey = `${toolName}:${JSON.stringify(toolCall)}`;
      const writeOpTools = new Set([
        "patch_file", "write_file", "delete_file", "batch_patch",
        "create_branch", "create_pr", "merge_pull_request", "add_comment",
        "update_issue", "close_issue", "create_issue"
      ]);
      const isWriteOp = writeOpTools.has(toolName);

      try { 
        // 工具执行前先发一次心跳，执行过程中 GitHub API 也可能耗时数秒
        await heartbeat();

        // 【网关策略 1】熔断器检查
        if (globalCircuitBreaker.isOpen(toolName)) {
          throw new Error(`【熔断拦截】工具 "${toolName}" 近期连续失败过多，为防止风险已自动熔断冷却。请暂缓或尝试其他方案。`);
        }
        
        // 【网关策略 2】安全风控检查
        SecurityPolicyEngine.validate(toolName, toolCall, targetBranch);

        if (readOnlyTools.has(toolName) && requestCache.has(cacheKey)) {
          toolResult = requestCache.get(cacheKey)!;
          isCached = true;
          console.log(`[Cache Hit] ${toolName} -> ${cacheKey}`);
        } else {
          // 【网关策略 3】写操作工具状态机入队及并发控制
          if (isWriteOp) {
            writeTaskQueue.enqueue(toolCallId, toolName);
            writeTaskQueue.updateState(toolCallId, "running");
            await writeOpSemaphore.acquire(); // 写锁防冲突
          }

          try {
            toolResult = await executeTool(ctx, toolCall, targetBranch);
          } finally {
            if (isWriteOp) {
              writeOpSemaphore.release();
            }
          }

          if (readOnlyTools.has(toolName)) {
            requestCache.set(cacheKey, toolResult);
          }
        }
      }
      catch (e) { toolResult = `工具执行出错：${(e as Error).message}`; }
      
      const elapsedMs = Date.now() - startTime;
      // 判定工具失败：仅捕获异常前缀 或 diagnose4xx 返回的 ❌ 错误前缀
      // ⚠️ 排除"监控类工具"：这类工具执行本身成功，❌ 只是业务结论（构建失败/运行失败），
      //   不应触发智能重试（重试会误导 LLM 换参数重试工具，而不是分析日志修复代码）。
      const businessResultTools = new Set([
        "trigger_and_monitor_build",
        "check_run_status",
      ]);
      const isBusinessResult = businessResultTools.has(String(toolCall.tool));
      const toolFailed = !isBusinessResult && (
        toolResult.startsWith("工具执行出错：") || toolResult.startsWith("❌")
      );
      const toolStatus = toolFailed ? "fail" : "success";

      // 【网关策略 4】更新熔断器状态，并流转异步任务状态机
      if (toolFailed) {
        globalCircuitBreaker.recordFailure(toolName);
        if (isWriteOp) writeTaskQueue.updateState(toolCallId, "failed", { error: toolResult });
      } else {
        globalCircuitBreaker.recordSuccess(toolName);
        if (isWriteOp) writeTaskQueue.updateState(toolCallId, "completed", { result: toolResult });
      }

      // 【网关策略 5】可观测性打点
      MetricsLogger.log({
        tool: toolName,
        status: toolStatus,
        elapsedMs,
        cached: isCached,
        errorMsg: toolFailed ? toolResult.slice(0, 200) : undefined
      });

      // 【网关策略 6】协议封箱：对传回给大模型的内容使用统一协议，便于它稳定解析
      const toolProtocolOutput = normalizeResultProtocol(toolResult, toolFailed);
      
      await sendTyped({ 
        type: "tool_end", 
        id: toolCallId, 
        status: toolStatus, 
        result: toolProtocolOutput.slice(0, 2000), // 扩大前端展示与内存截断上限
        elapsedMs 
      });
      
      // 注意：覆盖 toolResult，让下游插入历史记录时存的是协议规范后的内容
      toolResult = toolProtocolOutput;


      // ── 步骤失败智能重试（最多 2 次 LLM 驱动修正，而非盲目重跑） ──────────────
      // 原旧逻辑：失败 → 等 1s/2s → 用完全相同的参数再调用一次（对参数错误/路径错误无效）
      // 新逻辑：
      //   1. 首次失败 → 把错误信息注入消息历史，让 LLM 看到错误后自己决定修正策略
      //      （可能是换参数、换工具、或者跳过该步骤）→ break 内层循环，LLM 下轮决策
      //   2. 同一步骤累计失败 ≥ MAX_SMART_RETRIES → 进入终止+修复清单流程
      if (toolFailed && currentStepId) {
        const failKey = currentStepId;
        const prevFails = (stepFailCount.get(failKey) ?? 0) + 1;
        stepFailCount.set(failKey, prevFails);

        // 持久化重试次数
        if (sb && workflowDbId) {
          await dbUpdateStep(sb, workflowDbId, currentStepId, { retry_count: prevFails });
        }
        await sendTyped({ type: "step_retry", stepId: currentStepId, retryCount: prevFails });

        if (prevFails < MAX_SMART_RETRIES) {
          // ── 未超限：注入错误分析请求，让 LLM 修正策略后继续 ──────────────
          console.log(`[smart-retry] step=${failKey} failCount=${prevFails}，注入错误分析，LLM 决定下一步`);
          const retryContent = [
            `⚠️ 工具执行失败（第 ${prevFails} 次，最多允许 ${MAX_SMART_RETRIES} 次）。`,
            `\n\n错误详情：\n${toolResult.slice(0, 2000)}`,
            `\n\n请分析上述错误，判断失败原因（参数错误？路径不存在？权限问题？），`,
            `然后采取修正行动：换用正确参数重试、换一个工具、或拆分步骤。`,
            `不要重复使用完全相同的参数。`,
          ].join("");
          // FC 模式：assistant 带 tool_calls，结果用 role:tool
          if (fcToolCall) {
            fullMessages.push({
              role: "assistant", content: "",
              tool_calls: [{ id: fcToolCall.id, type: "function", function: { name: fcToolCall.name, arguments: JSON.stringify(fcToolCall.arguments) } }],
            });
            fullMessages.push({ role: "tool", content: retryContent, tool_call_id: fcToolCall.id });
          } else {
            fullMessages.push({ role: "assistant", content: rawText, ...(reasoningContentEverSeen ? { reasoning_content: lastReasoningContent ?? "" } : {}) });
            fullMessages.push({ role: "user", content: retryContent });
          }
          // break 让外层主循环重新调用 LLM 做决策
          break;
        }

        // ── 超出重试限制：终止当前步骤，生成修复清单 ────────────────────────
        console.warn(`[smart-retry] step=${failKey} 已达失败上限 ${MAX_SMART_RETRIES}，终止`);
        await sendTyped({ type: "step_end", stepId: currentStepId, status: "error" });
        if (sb && workflowDbId) {
          await dbUpdateStep(sb, workflowDbId, currentStepId, {
            status: "error", finished_at: new Date().toISOString(),
          });
          await dbFinishWorkflow(sb, workflowDbId);
        }
        currentStepId = null;
        // 注入修复清单生成指令
        const repairInstruction = [
          `⚠️ 系统提示：步骤 "${failKey}" 已连续失败 ${MAX_SMART_RETRIES} 次，自动修复终止。`,
          `\n最终错误：${toolResult.slice(0, 1000)}`,
          `\n\n请根据以上错误信息，以 Markdown 清单格式输出完整的手动修复步骤，`,
          `帮助用户自行处理问题。不要再调用工具，直接输出清单即可。`,
        ].join("");
        if (fcToolCall) {
          fullMessages.push({
            role: "assistant", content: "",
            tool_calls: [{ id: fcToolCall.id, type: "function", function: { name: fcToolCall.name, arguments: JSON.stringify(fcToolCall.arguments) } }],
          });
          fullMessages.push({ role: "tool", content: repairInstruction, tool_call_id: fcToolCall.id });
        } else {
          fullMessages.push({ role: "assistant", content: rawText, ...(reasoningContentEverSeen ? { reasoning_content: lastReasoningContent ?? "" } : {}) });
          fullMessages.push({ role: "user", content: repairInstruction });
        }
        try {
          const repairResult = await callLLM(
            { ...modelConfig, temperature: 0.3 }, // 修复清单用低温度，确保输出聚焦
            platformKey,
            fullMessages,
          );
          await streamAnswer(repairResult.text, sendChunk, 10, () => abortSig.aborted);
        } catch (_e) {
          await streamAnswer(
            `⚠️ 步骤 "${failKey}" 执行失败（已重试 ${MAX_SMART_RETRIES} 次），自动修复终止。请检查上方日志并手动处理。`,
            sendChunk,
          );
        }
        batchDone = true;
        break;
      }

      // ── 将本轮工具调用压入消息历史（保持上下文完整）────────────────────────
      // 工具结果注入截断：文件内容类工具允许 30000 字符（约 600 行代码），其他工具 4000 字符
      const fileContentTools = ["read_file", "batch_read", "grep_in_file", "get_file_info", "get_code_outline", "read_function"];
      const resultLimit = fileContentTools.includes(String(toolCall.tool)) ? 30000 : 4000;
      const truncatedRaw = toolResult.length > resultLimit
        ? toolResult.slice(0, resultLimit) + `\n…（内容已截断，原始长度 ${toolResult.length} 字符，如需完整内容请重新调用工具并缩小查询范围）`
        : toolResult;
        
      // 优化：统一工具返回协议（规范化结构输出，提高 LLM 多步推理稳定性）
      const normalizedResult = JSON.stringify({
        status: toolStatus,
        cost: { latency_ms: elapsedMs, cached: isCached },
        data: truncatedRaw
      });
      const truncatedResult = normalizedResult;
      if (fcToolCall) {
        // FC 模式：标准 OpenAI function calling 消息格式
        // assistant → tool（不是 user），保证模型的消息历史格式完全兼容
        fullMessages.push({
          role: "assistant", content: "",
          tool_calls: [{ id: fcToolCall.id, type: "function", function: { name: fcToolCall.name, arguments: JSON.stringify(fcToolCall.arguments) } }],
        });
        fullMessages.push({ role: "tool", content: truncatedResult, tool_call_id: fcToolCall.id });
      } else {
        // 非 FC 模式：保持原有文本交互格式
        fullMessages.push({ role: "assistant", content: rawText, ...(reasoningContentEverSeen ? { reasoning_content: lastReasoningContent ?? "" } : {}) });
        fullMessages.push({
          role: "user",
          content: `工具执行结果：\n${truncatedResult}\n\n请根据结果继续执行下一步。若还有未完成的步骤，继续调用工具；若全部步骤已完成，在回复最开头输出 TASK_DONE，然后跟一句简洁的完成总结，不要再输出工具 JSON。`,
        });
      }

      // ── 上下文滑动窗口压缩：消息超过 60 条时，压缩中间的工具交互历史 ──────────
      // 保留：[0]=system、[1..4]=前4条用户/助手消息（任务背景）、[-20..]=最近20条
      // 压缩：中间的工具结果消息折叠为一条摘要，减少 token 消耗
      if (fullMessages.length > 60) {
        const system = fullMessages[0];
        const head   = fullMessages.slice(1, 5);    // 前4条（任务上下文）
        const tail   = fullMessages.slice(-20);     // 最近20条（当前进展）
        const mid    = fullMessages.slice(5, fullMessages.length - 20);
        // 统计压缩掉的工具调用数量，生成摘要
        const toolCallCount = mid.filter(m => m.role === "assistant").length;
        const summary: Message = {
          role: "user",
          content: `[系统摘要] 上面已省略 ${mid.length} 条中间过程消息（约 ${toolCallCount} 次工具调用）。` +
            `任务仍在继续，请根据最近上下文继续执行剩余步骤。`,
        };
        fullMessages.splice(0, fullMessages.length, system, ...head, summary, ...tail);
        // ⚠️ 截断后必须清理不完整的 tool_calls 对，否则会出现 summary(user)→tool 的非法序列
        fullMessages = sanitizeToolCallMessages(fullMessages);
        console.log(`[ctx-compress] 压缩后 messages=${fullMessages.length}，省略了 ${mid.length} 条中间消息`);
      }

      // ── 每 5 轮自动保存快照：页面意外关闭时任务进度不丢失 ─────────────────
      if (sb && workflowDbId && totalRound > 0 && totalRound % 5 === 0) {
        await dbSaveSnapshot(sb, workflowDbId, fullMessages, currentStepId, false);
        console.log(`[auto-snapshot] totalRound=${totalRound} workflowId=${workflowDbId} 自动保存快照`);
      }

      // ── 本批次工具轮次耗尽：任务未完则自动续跑 ─────────────────────────────
      if (round === MAX_ROUNDS_PER_BATCH - 1) {
        const hasMoreBatches = batch < MAX_BATCHES - 1;
        if (hasMoreBatches) {
          // 任务仍在进行：用 status_info 事件通知前端（toast），不写入对话气泡
          console.log(`[auto-continue] batch=${batch} totalRound=${totalRound} 自动续跑`);
          await sendTyped({ type: "status_info", message: `第 ${batch + 1} 批任务完成，继续执行剩余步骤…` });
          // 保存 messages 快照（批次续跑时持久化，供中断后恢复）
          if (sb && workflowDbId) {
            await dbSaveSnapshot(sb, workflowDbId, fullMessages, currentStepId, false);
          }
          // 注入系统提示：告知 AI 继续剩余步骤，不要重新规划
          fullMessages.push({
            role: "user",
            content: "⚠️ 系统提示：由于任务较复杂，请继续执行剩余未完成的步骤。不要重新输出 PLAN，直接从下一个工具调用开始继续。",
          });
          nudgeCount = 0; // 新批次重置 nudge 计数
          // batchDone 保持 false，外层 for 将进入下一个 batch
        } else {
          // 所有批次已耗尽：保存快照并标记为 interrupted，供用户手动恢复
          if (currentStepId) {
            await sendTyped({ type: "step_end", stepId: currentStepId, status: "done" });
            if (sb && workflowDbId) {
              await dbUpdateStep(sb, workflowDbId, currentStepId, {
                status: "done", finished_at: new Date().toISOString(),
              });
            }
          }
          // 保存快照 + 标记中断（可恢复）
          if (sb && workflowDbId) {
            await dbSaveSnapshot(sb, workflowDbId, fullMessages, currentStepId, true);
            await sb.from("task_workflows")
              .update({ status: "running", interrupted: true })
              .eq("id", workflowDbId);
          }
          await streamAnswer(
            `⚠️ 已达到最大工具调用轮次（${totalRound + 1} 轮），任务可能未完全完成。\n` +
            `💾 进度已自动保存，可在「任务历史」中点击「恢复执行」继续未完成的步骤。`,
            sendChunk
          );
          batchDone = true;
        }
      }
    } // end inner for

    if (batchDone || abortSig.aborted) break; // 内层正常完成 / 用户中断，退出外层
    } // end outer for (batch)

    // 用户主动中断：保存快照，标记为可恢复
    if (abortSig.aborted && sb && workflowDbId) {
      await dbSaveSnapshot(sb, workflowDbId, fullMessages, currentStepId, true);
      await sb.from("task_workflows")
        .update({ status: "running", interrupted: true })
        .eq("id", workflowDbId);
    }

    // 非用户中断时才标记完成（abort 时已在上方标记为 interrupted）
    if (!abortSig.aborted && sb && workflowDbId) await dbFinishWorkflow(sb, workflowDbId);
    clearInterval(heartbeatTimer);
    await sendDone();
    } catch (fatalErr) {
      // 顶层兜底：未预期的异常，写入流后关闭，防止代理层因未处理的 rejection 返回 500
      console.error("[IIFE fatal]", (fatalErr as Error).message);
      // @ts-ignore: heartbeatTimer is defined in outer scope
      if (typeof heartbeatTimer !== 'undefined') clearInterval(heartbeatTimer);
      try { await streamAnswer(`❌ 内部错误：${(fatalErr as Error).message}`, sendChunk); } catch { /* ignore */ }
      try { await sendError("INTERNAL_ERROR", (fatalErr as Error).message); } catch { /* ignore */ }
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
