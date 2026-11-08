<p align="center">
  <img src="./public/logo.svg" alt="GitHubM" width="88" />
</p>
<h1 align="center">GitHubM</h1>
<p align="center">
  <strong>全功能 GitHub 管理面板 + AI 开发助手</strong><br/>
  Web / Android / Desktop 三端共用一套前端，浏览器端直连，无自建后端
</p>

<p align="center">
  <a href="https://qq5855144.github.io/GitHubM/"><img src="https://img.shields.io/badge/GitHub%20Pages-在线体验-222?logo=github" alt="Pages"></a>
  <a href="https://github.com/qq5855144/GitHubM/releases"><img src="https://img.shields.io/github/v/release/qq5855144/GitHubM?label=Release&logo=android&color=blue" alt="Release"></a>
  <a href="https://github.com/qq5855144/GitHubM/actions"><img src="https://img.shields.io/badge/CI%2CD%20Actions-自动部署-success?logo=githubactions" alt="CI"></a>
  <img src="https://img.shields.io/badge/React-18-61dafb?logo=react" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/github/stars/qq5855144/GitHubM?style=social" alt="Stars">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

---

## 简介

GitHubM 把 GitHub 的日常操作集中到一个界面里：仓库、Issue、Pull Request、Actions、Packages、Discussions、Wiki、Gist、通知、搜索、代码浏览——**40+ 页面**覆盖 GitHub 主流功能；同时内置 **AI 开发助手**，用自然语言驱动仓库读写、搜索、CI 修复、代码审查等完整流程。

设计上有三条硬约束：

- **纯前端**：所有 GitHub API 调用由浏览器/WebView 直连完成，Token 与模型 Key 只存在本机，无中转服务器
- **一套代码三端复用**：Web（GitHub Pages）、Android（Kotlin WebView 壳）、Desktop（Tauri 2）共享同一份 `dist/`
- **移动端优先的健壮性**：针对 Android 老版本 WebView 做了 polyfill、`file://` 资源加载、前后台保活等专项适配

> **在线体验**：<https://qq5855144.github.io/GitHubM/>

---

## 功能一览

### 全局功能

| 模块 | 能力 |
|------|------|
| **仪表盘** | 数据概览、动态流、快捷入口 |
| **仓库** | 创建 / 编辑 / 删除、搜索筛选、详情与统计 |
| **Issues** | 列表、详情、创建、评论、标签、开关状态 |
| **Pull Requests** | 列表、详情、文件变更、Diff 视图、合并与审查 |
| **代码浏览** | 目录树、文件内容、语法高亮、在线编辑 |
| **提交与分支** | 提交历史、提交详情 Diff、分支列表与新建 |
| **Actions** | Workflow 运行记录、Jobs 与实时日志、触发 / 取消 / 重跑 |
| **Releases / Artifacts** | 版本发布管理、构建产物下载 |
| **Packages / Projects / Discussions / Wiki** | 仓库外围协作模块 |
| **Gists** | 代码片段浏览与详情 |
| **通知 / 活动 / 搜索** | 未读通知、动态时间线、仓库与代码与用户全局搜索 |
| **更多** | 多账号切换、数据导出、批量上传、Pages 部署、GraphQL Playground、访问统计 |

### 仓库内子模块

进入任意仓库后可访问：Issues、Pull Requests、PR Diff、代码浏览、提交历史、分支管理、协作者、Actions、Packages、Projects、Discussions、Wiki、批量上传、Pages 部署、Artifacts、Forks、Stargazers。

### 使用体验

- **主题**：深色 / 浅色 / 跟随系统，**16 套强调色**，首屏无 FOUC（`index.html` 内联预初始化脚本同步设置 `html.class` 与 `theme-color`）
- **国际化**：中英双语全站切换（i18next + react-i18next）
- **多账号**：本地保存多个 GitHub Token，一键切换，互不干扰
- **离线感知**：`NetworkStatusBanner` 实时提示网络断开与恢复
- **隐私**：访问统计完全本地化（localStorage 记录 PV / UV），不上报任何服务器

---

## AI 开发助手

内置 **LangGraph 编排的 ReAct Agent**，可在对话中完成「读代码 → 改代码 → 提交 → 开 PR → 查 CI → 修 CI」的闭环。

### 模型接入

| 提供商 | 说明 |
|--------|------|
| **DeepSeek** | 自带 API Key，`deepseek-v4-flash` / `deepseek-v4-pro`，支持思考模式 |
| **OpenAI / GPT** | 自带 API Key，OpenAI 兼容格式 |
| **Gemini** | 自带 API Key，OpenAI 兼容端点 |
| **Qwen 通义千问** | 自带 API Key，DashScope 兼容模式 |
| **自定义接口** | 任意 OpenAI 兼容服务，可指定 endpoint |

模型配置项支持 `temperature` 手动指定或按任务类型自动推断（写代码 0.1 / 分析 0.3 / 对话 0.7）、`reasoning_effort` 思考强度、请求超时。

### 工具层：双通道

| 通道 | 工具数 | 说明 |
|------|--------|------|
| **官方 GitHub Remote MCP** | 44 | 直连 `https://api.githubcopilot.com/mcp/`（Streamable HTTP），工具 Schema 缓存 24h，会话失效自动重连一次 |
| **本地内置工具** | 62 | 覆盖 MCP 未提供的精细化能力（分页读取、行级 patch、CI 日志分析、构建修复循环等） |

同名工具**本地优先**；MCP 不可达时自动降级为纯本地工具，且不会把无法执行的远端工具暴露给模型（避免连续调用全部报错）。

<details>
<summary><b>本地工具清单（62 个）</b></summary>

**文件操作**：`list_files` `file_tree` `read_file` `get_file_info` `batch_read` `patch_file` `batch_patch` `write_file` `delete_file` `preview_diff` `undo_last_commit`

**搜索与代码理解**：`grep_in_file` `grep_in_repo` `search_code` `search_and_replace` `get_code_outline` `read_function` `npm_search`

**分支与提交**：`list_branches` `create_branch` `list_commits` `get_commit_diff` `compare_commits`

**Pull Request**：`list_pull_requests` `create_pr` `merge_pull_request` `close_pr` `get_pr_files` `submit_pr_review` `resolve_git_conflict`

**Issues**：`list_issues` `search_issues` `get_issue_details` `create_issue` `update_issue` `close_issue` `add_comment`

**仓库**：`get_repo_info`

**GitHub Actions / CI**：`list_workflows` `get_workflow_runs` `get_run_jobs` `get_job_logs` `trigger_workflow` `check_run_status` `cancel_workflow_run` `rerun_workflow_run` `verify_changes` `run_lint` `trigger_and_monitor_build` `list_actions_secrets` `list_actions_variables` `set_actions_variable` `get_run_artifacts` `check_security`

**Releases**：`list_releases` `get_latest_release` `create_release` `get_merged_prs_since`

**协作**：`request_file` `report_tool_issue` `propose_tool_fix` `auto_review`

</details>

### 工程化能力

- **断点续跑**：任务计划与文件快照持久化到 localStorage，超时或断网后可「立即恢复」继续剩余步骤
- **写操作保护**：检测到本轮含写操作时，自动重连改为手动确认，避免重复执行
- **消息完整性**：`repairToolCallPairs` / `compressMessages` 修正 function-calling 的 tool_call / tool_result 配对，长会话自动压缩
- **安全风控**：`toolPolicy` 按工具风险分级（`getToolRisk`）、必填参数校验、超长结果截断
- **变更验证**：写操作后自动比对 Check Runs / Commit Status，必要时提示触发 CI 验证（`verification.ts`）
- **执行追踪**：`runTrace` 记录每轮工具调用的耗时与结果，便于排查
- **后台保活**：Android 端通过 `AndroidBridge.startAgentTask` 启动前台服务，切换后台任务继续跑
- **auto_review 规则**：硬编码密钥 / Token、TODO-FIXME 遗留、`await` 缺少 try-catch、`console.log` 残留、超长行（>120）、过长函数（>80 行）

### 移动端网络适配：LLM Proxy（可选）

Android WebView 下部分模型 API 受 CORS / DNS 影响，项目内置一个**无状态** Cloudflare Worker 代理（`cloudflare/llm-proxy`）：只转发请求与 SSE 流，不保存会话、不记录 API Key、不跑 Agent 循环，并对上游地址做白名单校验。

```http
POST /v1/chat/completions
Authorization: Bearer <用户自己的模型 API Key>
x-llm-provider: deepseek | openai | gemini | qwen | custom
x-llm-upstream: https://...        # 仅 custom 使用
```

```bash
cd cloudflare/llm-proxy
npx wrangler deploy
```

详见 [`cloudflare/llm-proxy/README.md`](./cloudflare/llm-proxy/README.md)。

---

## 技术栈

| 分类 | 技术 |
|------|------|
| **框架** | React 18、TypeScript 5.9 |
| **构建** | Vite（rolldown-vite）、pnpm 9+、Biome 2 |
| **路由** | React Router 7（HashRouter，兼容 `file://`） |
| **样式** | Tailwind CSS 3、tailwindcss-animate、CSS 变量主题 |
| **UI** | shadcn/ui（new-york）+ Radix UI（40+ 组件）、Lucide Icons、sonner |
| **状态与表单** | zustand、React Hook Form、Zod |
| **编辑器与图表** | CodeMirror 6（15+ 语言）、Recharts |
| **AI** | LangChain Core、LangGraph、官方 GitHub Remote MCP（Streamable HTTP） |
| **国际化 / 内容渲染** | i18next、react-i18next；react-markdown、remark-gfm、rehype-highlight |
| **测试与质量** | Vitest、Testing Library、ast-grep 自定义规则（`.rules/`） |
| **Android** | Kotlin、WebView 壳、Gradle 8.7、minSdk 26 / targetSdk 35 |
| **Desktop** | Tauri 2（Rust） |
| **CI/CD** | GitHub Actions（Pages 部署 + APK 构建签名 + Tauri 打包 + PR 质量门卡） |

---

## 项目结构

```
GitHubM/
├── .github/
│   ├── workflows/
│   │   ├── deploy.yml            # 构建 Web → 部署 Pages → 构建签名 APK → 发布 Release
│   │   ├── pr-check.yml          # PR 质量门卡：Biome + 类型检查 + 单测 + 构建验证
│   │   ├── android-test-apk.yml  # 仅上传测试 APK 供真机回归（不发 Release）
│   │   ├── tauri-build.yml       # tag v* 触发，macOS/Windows/Linux 桌面包
│   │   └── stale.yml             # Issue/PR 自动清理
│   ├── ISSUE_TEMPLATE/ · CODEOWNERS · PULL_REQUEST_TEMPLATE.md
├── android/                      # Android WebView 壳工程
│   ├── app/src/main/             # MainActivity.kt · assets(注入 dist) · res
│   ├── app/build.gradle.kts      # 签名、混淆、CI 版本号注入
│   └── generate-keystore.sh
├── cloudflare/llm-proxy/         # 无状态 LLM 转发 Worker（可选）
├── src-tauri/                    # Tauri 2 桌面壳（Cargo.toml · tauri.conf.json · icons）
├── src/
│   ├── components/
│   │   ├── ai/                   # AI 对话、任务计划、工具轨迹 UI
│   │   ├── code/ · repo/         # 代码浏览与仓库组件
│   │   ├── common/               # ErrorBoundary · PageMeta · RouteGuard
│   │   ├── layouts/              # MainLayout（侧边栏 / 底部导航）
│   │   └── ui/                   # 50+ shadcn/ui 封装组件
│   ├── contexts/                 # AuthContext（多账号 Token）· ThemeContext（16 套强调色）
│   ├── hooks/                    # use-debounce · use-mobile · use-network-status · use-go-back
│   ├── lib/
│   │   ├── aiAgentCore.ts        # AI 引擎：工具定义、模型适配、ReAct 循环
│   │   ├── mcpClient.ts          # 官方 GitHub MCP 客户端 + 工具缓存
│   │   ├── agent/                # langgraph/runtime · toolPolicy · messageIntegrity · verification · runTrace
│   │   ├── githubDownload.ts · auto-translator.ts · visitStats.ts · page-cache.ts
│   ├── pages/                    # 40+ 页面（每个 GitHub 模块一页）
│   ├── services/                 # github.ts（REST）· github-graphql.ts · github-achievements.ts
│   ├── stores/ · types/ · tests/
│   ├── i18n.ts                   # 中英翻译资源
│   └── routes.tsx                # 路由表（public / 受保护）
├── .skills/                      # 80+ 能力包（OCR、图像/视频生成、检索、支付等）
├── .rules/                       # ast-grep 自定义 lint 规则 + check.sh
├── scripts/                      # i18n 同步、keystore Secrets 配置等工具脚本
├── docs/prd.md                   # 产品需求文档
├── vite.config.ts                # base "./" · 移除 crossorigin · WebView 构建优化
└── tailwind.config.js · biome.json · tsconfig*.json
```

---

## 快速开始

### 环境要求

- **Node.js** ≥ 20（CI 使用 22 / 24）
- **pnpm** ≥ 9

### 本地开发

```bash
git clone https://github.com/qq5855144/GitHubM.git
cd GitHubM

pnpm install
pnpm dev            # 启动开发服务器 http://localhost:5173
```

首次打开会跳转登录页，填入 GitHub Personal Access Token 即可使用。

### 常用命令

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 启动 Vite 开发服务器 |
| `pnpm build` | 生产构建，产物输出到 `dist/` |
| `pnpm test` | Vitest 单元测试 |
| `pnpm test:watch` | 监听模式 |
| `pnpm test:coverage` | 生成覆盖率报告 |
| `pnpm lint` | 完整质量检查：类型检查 + Biome + ast-grep 规则 + Tailwind CSS 校验 + 构建验证 |

### Token 权限

在 <https://github.com/settings/tokens> 生成 Token，勾选：

- `repo` — 仓库读写
- `notifications` — 通知
- `user` — 用户信息
- `workflow` — Actions 触发与重跑

### 环境变量

`.env` 由构建流程按需读取，非必需：

| 变量 | 说明 |
|------|------|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | 若使用 Supabase 相关能力时配置 |
| `VITE_APP_VERSION` | 由 CI 注入，格式 `1.0.<run_number>`；本地开发为 `undefined` |

AI 模型的 API Key 不放在 `.env`，而是登录后在**设置 → AI 配置**中填写，仅保存到本机 localStorage。

---

## 多端构建

### Web

```bash
pnpm build          # dist/
```

`vite.config.ts` 针对运行环境做了三处关键处理，均为 WebView / 子目录部署服务：

- `base: "./"` — 相对路径资源，兼容 GitHub Pages 子目录与 `file://`
- 移除 `crossorigin` 属性 — `file://` 无 Origin，带该属性会触发 CORS 预检并静默白屏
- 关闭 `modulePreload` 与 `manualChunks` — 避免 `file://` 下跨 chunk 动态 import 被拦截

### Android APK

```bash
# 1. 构建前端
pnpm build

# 2. 复制资源到壳工程
mkdir -p android/app/src/main/assets && cp -r dist/. android/app/src/main/assets/

# 3. 构建 APK（本地未配置 KEYSTORE_PATH 时回退 debug 签名）
cd android && gradle assembleRelease
```

| 项目 | 值 |
|------|-----|
| 应用 ID | `com.github.manager` |
| 最低 SDK | Android 8.0（API 26） |
| 目标 / 编译 SDK | Android 15（API 35） |
| 架构 | WebView 壳 + 内嵌 Web 资源（离线可用） |
| 下载 | [Releases](https://github.com/qq5855144/GitHubM/releases) |

### Desktop（Tauri 2）

```bash
pnpm tauri dev
pnpm tauri build
```

推送到 `v*` tag 时，`tauri-build.yml` 自动产出 macOS（arm64 / x64）、Windows、Linux 安装包。

---

## 签名与发布

APK 默认使用仓库内置 `android/release.keystore` 签名，保证跨版本覆盖安装。若要使用自有证书：

```bash
# 推荐：脚本自动写入 4 个 Actions Secrets（需已 gh auth login）
bash scripts/setup-keystore-secrets.sh
```

或在 **Settings → Secrets and variables → Actions** 手动添加：`RELEASE_KEYSTORE_BASE64`、`RELEASE_KEY_ALIAS`、`RELEASE_STORE_PASSWORD`、`RELEASE_KEY_PASSWORD`。

CI 还支持**零配置自动持久化**：若上述 Secret 缺失但配置了 `GH_PAT`（需 `repo` 权限），首次构建会自动生成 Keystore 并回写到 Secrets，后续构建复用同一证书。

> ⚠️ 生产使用请替换为你自己的 keystore，不要沿用仓库中的示例证书。

---

## CI/CD

```
push main ──► build-web ──┬── deploy-pages ──► GitHub Pages
                          └── build-apk   ──► Release APK → GitHub Release

PR ────────► pr-check（Biome + tsgo + Vitest + 生产构建验证）
PR ────────► android-test-apk（真机回归包，仅 Artifact）
tag v* ────► tauri-build（三平台桌面安装包）
```

- `versionCode` 使用 **Unix 时间戳**，保证严格递增，避免测试包与正式包互相降级
- `versionName` 为人类可读的 `1.0.<run_number>`
- Pages 部署同组并发、自动取消旧任务；APK 构建不受影响

---

## 隐私与安全

- **GitHub Token** 仅存于本机 localStorage，所有请求直连 `api.github.com`，不经过任何第三方服务器
- **模型 API Key** 同样仅本地保存；使用 LLM Proxy 时代理不记录请求体与 Authorization
- **访问统计** 完全本地计算 PV / UV，无上报
- **代码安全**：`check_security` 工具与 `auto_review` 规则会扫描硬编码密钥、`eval`、SQL 注入、XSS 等常见风险
- **依赖忽略**：`.gitignore` 已排除 `node_modules`、`dist`、`*.keystore`（示例证书除外）、`local.properties` 等

发现安全问题请通过 Issue 私下沟通，避免公开披露细节。

---

## 贡献

欢迎提交 Issue 与 PR，请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。要点：

- 从 `main` 拉功能分支，PR 遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)
- 提交前本地执行 `pnpm lint` 与 `pnpm test`
- 新增工具函数需附带 Vitest 用例；UI 改动请附改动前后截图
- 样式仅使用语义 token（`bg-primary`），禁止直接使用 `bg-blue-500` 这类固定色值类

---

## License

[MIT](./LICENSE) © qq5855144

> 本项目与 GitHub, Inc. 无关联，为第三方开源客户端。
