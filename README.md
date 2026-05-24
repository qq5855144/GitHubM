<p align="center">
  <img src="https://api.iconify.design/fe:github.svg?color=%237c3aed" alt="GitHubM" width="80" />
</p>
<h1 align="center">GitHubM</h1>
<p align="center">
  <strong>全功能 GitHub 管理面板 + AI 开发助手</strong> — 现代化 Web 应用 & Android 客户端
</p>

<p align="center">
  <a href="https://qq5855144.github.io/GitHubM/"><img src="https://img.shields.io/badge/GitHub%20Pages-在线访问-222?logo=github" alt="Pages"></a>
  <a href="https://github.com/qq5855144/GitHubM/releases"><img src="https://img.shields.io/github/v/release/qq5855144/GitHubM?label=Release&logo=android&color=blue" alt="Release"></a>
  <a href="https://github.com/qq5855144/GitHubM/actions"><img src="https://img.shields.io/badge/CI%2FCD-自动部署-success?logo=githubactions" alt="CI"></a>
  <img src="https://img.shields.io/github/stars/qq5855144/GitHubM?style=social" alt="Stars">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

---

## 简介

GitHubM 是一个全功能的 GitHub 管理面板，提供仓库浏览、Issue 追踪、Pull Request 管理、Gist、通知、搜索等一站式操作界面，同时内置 **AI 开发助手**，支持用自然语言驱动 GitHub 仓库的读写、搜索、代码审查等全流程操作。

支持 **Web 浏览器** 和 **Android APK** 两种使用方式。

> **在线体验**：[qq5855144.github.io/GitHubM](https://qq5855144.github.io/GitHubM/)

---

## 核心功能

### 管理面板

| 模块 | 说明 |
|------|------|
| **仪表盘** | 概览统计、动态流、快捷入口 |
| **仓库管理** | 浏览/搜索仓库、查看详情、分支与提交 |
| **Issues** | 创建、筛选、评论、关闭 Issue |
| **Pull Requests** | 查看 PR 列表与详情、合并状态、代码审查 |
| **Gists** | 浏览和管理代码片段 |
| **通知** | 实时通知列表 |
| **搜索** | 全站仓库与代码搜索 |
| **代码浏览** | 在线查看文件内容与目录树 |
| **Actions** | 查看 Workflow 运行状态、触发/取消工作流 |
| **Releases** | 版本发布管理 |

### AI 开发助手

内置 **ReAct Agent**，通过自然语言完成 GitHub 全流程操作，支持多模型接入。

#### 支持的 AI 模型

| 模型 | 说明 |
|------|------|
| **文心 ERNIE** | 百度千帆平台（平台托管，无需 API Key） |
| **DeepSeek** | 自带 API Key 接入 |
| **OpenAI / GPT** | 自带 API Key 接入 |
| **自定义兼容接口** | 任意 OpenAI 兼容格式 |

#### AI 工具能力（40+ 工具）

**文件操作**

| 工具 | 说明 |
|------|------|
| `read_file` | 分段读取文件，自动处理大文件（>1MB 切换 Blobs API） |
| `get_file_info` | 获取文件元信息（大小、行数、SHA）而不下载内容 |
| `patch_file` | 局部替换指定行，自动生成 git diff 风格验证快照 |
| `batch_patch` | 同一文件多处非连续修改，合并为**单个 commit** |
| `write_file` | 全量写入/创建文件 |
| `delete_file` | 删除文件 |
| `list_files` | 列出目录内容 |
| `file_tree` | 获取仓库目录树 |
| `batch_read` | 批量读取多个文件（每文件前 300 行，自动支持大文件） |

**搜索与分析**

| 工具 | 说明 |
|------|------|
| `grep_in_file` | 文件内全文搜索，支持正则，超 100 条自动分页 |
| `grep_in_repo` | **全仓库搜索**，返回精确文件路径 + 行号 + 高亮，支持路径过滤 |
| `search_code` | GitHub Search API 快速检索（仅返回文件路径） |
| `search_and_replace` | **全仓库一键批量替换**：自动搜索→按文件 batch_patch→单 commit |
| `compare_commits` | 对比两个 commit/分支/tag 的完整 diff（含 patch 片段） |
| `auto_review` | 自动审查最近 commit 变更文件的代码质量（7 类规则） |

**分支与提交**

| 工具 | 说明 |
|------|------|
| `list_branches` | 列出所有分支 |
| `create_branch` | 新建分支 |
| `list_commits` | 提交历史 |
| `get_commit_diff` | 查看单次提交变更 |

**Pull Request**

| 工具 | 说明 |
|------|------|
| `list_pull_requests` | 列出 PR |
| `create_pr` | 创建 PR |
| `merge_pull_request` | 合并 PR |
| `close_pr` | 关闭 PR |
| `get_pr_files` | 查看 PR 文件变更 |
| `submit_pr_review` | 提交 PR 代码审查 |

**Issues**

| 工具 | 说明 |
|------|------|
| `list_issues` | 列出 Issues |
| `create_issue` | 创建 Issue |
| `close_issue` | 关闭 Issue |
| `add_comment` | 添加评论 |

**GitHub Actions**

| 工具 | 说明 |
|------|------|
| `list_workflows` | 列出工作流 |
| `get_workflow_runs` | 查看运行记录 |
| `get_run_jobs` | 查看 Jobs |
| `get_job_logs` | 下载日志 |
| `trigger_workflow` | 触发工作流（自动修复缺少 workflow_dispatch 的情况） |
| `cancel_workflow_run` | 取消运行 |
| `rerun_workflow_run` | 重新运行 |
| `list_actions_secrets` | 查看 Secrets 列表 |

**Releases**

| 工具 | 说明 |
|------|------|
| `create_release` | 创建 Release |
| `list_releases` | 列出 Release |
| `get_latest_release` | 获取最新 Release |

#### auto_review 审查规则

| 级别 | 规则 |
|------|------|
| 🔴 高危 | 硬编码密钥 / Token / 私钥 |
| 🟡 待处理 | TODO/FIXME/HACK 遗留注释、`await` 缺少 try-catch、`console.log` 调试残留 |
| 🟠 可读性 | 超长行（>120 字符）、过长函数体（>80 行） |

---

## 技术栈

| 分类 | 技术 |
|------|------|
| **框架** | React 18, TypeScript |
| **构建** | Vite (rolldown-vite), pnpm |
| **路由** | React Router 7 (HashRouter) |
| **样式** | Tailwind CSS 3, tailwindcss-animate |
| **UI 组件** | Radix UI (20+ 组件), Lucide Icons |
| **表单** | React Hook Form, Zod |
| **图表** | Recharts |
| **Markdown** | react-markdown, remark-gfm, rehype-highlight |
| **HTTP** | Axios, ky |
| **后端** | Supabase Edge Functions (AI 助手 / 模型列表) |
| **Android** | Kotlin, WebView 壳, Gradle 8.7 |
| **CI/CD** | GitHub Actions (自动 Pages 部署 + APK 构建) |

---

## 项目结构

```
GitHubM/
├── .github/workflows/        # CI/CD 工作流
│   └── deploy.yml            #   自动部署 Pages + 构建 APK
├── android/                  # Android WebView 壳工程
│   ├── app/src/main/
│   │   ├── java/.../MainActivity.kt
│   │   ├── res/              # Android 资源
│   │   └── AndroidManifest.xml
│   └── build.gradle.kts
├── public/                   # 静态资源
├── src/
│   ├── components/
│   │   ├── common/           # 通用组件 (ErrorBoundary, RouteGuard...)
│   │   ├── layouts/          # 布局组件 (MainLayout)
│   │   └── ui/               # UI 组件库 (50+ Radix 封装)
│   ├── contexts/             # React Context (Auth, Theme)
│   ├── hooks/                # 自定义 Hooks
│   ├── lib/                  # 工具函数
│   ├── pages/                # 页面组件 (30+ 页面)
│   ├── services/             # API 服务层 (GitHub API)
│   ├── types/                # TypeScript 类型定义
│   └── routes.tsx            # 路由配置
├── supabase/functions/
│   ├── ai-assistant/         # AI 助手 Edge Function（ReAct Agent，40+ 工具）
│   └── list-ai-models/       # 可用模型列表接口
├── package.json
├── tailwind.config.js
└── vite.config.ts
```

---

## 快速开始

### 环境要求

- **Node.js** ≥ 20
- **pnpm** ≥ 9

### 本地开发

```bash
# 1. 克隆仓库
git clone https://github.com/qq5855144/GitHubM.git
cd GitHubM

# 2. 安装依赖
pnpm install

# 3. 启动开发服务器
pnpm exec vite
```

### 构建生产版本

```bash
pnpm exec vite build    # 产物输出到 dist/
```

---

## Android APK

每次推送 `main` 分支时，GitHub Actions 自动构建并签名 Release APK。

| 项目 | 说明 |
|------|------|
| **应用 ID** | `com.github.manager` |
| **最低 SDK** | Android 8.0 (API 26) |
| **目标 SDK** | Android 14 (API 34) |
| **架构** | WebView 壳 + 内嵌 Web 资源 |
| **下载** | [Releases 页面](https://github.com/qq5855144/GitHubM/releases) |

### 配置稳定签名（支持跨版本覆盖安装）

**方法一：脚本自动配置（推荐）**

```bash
# 需已安装 GitHub CLI 并登录（gh auth login）
bash scripts/setup-keystore-secrets.sh
```

**方法二：手动配置**

前往仓库 **Settings → Secrets and variables → Actions**，添加以下 4 个 Secret：

| Secret 名称 | 值 |
|---|---|
| `RELEASE_KEYSTORE_BASE64` | `base64 -w 0 android/release.keystore` 的输出 |
| `RELEASE_KEY_ALIAS` | `github-manager` |
| `RELEASE_STORE_PASSWORD` | `GithubManager@2024` |
| `RELEASE_KEY_PASSWORD` | `GithubManager@2024` |

> 配置完成后，每次 CI 构建的 APK 签名一致，支持直接覆盖安装旧版本，无需卸载。

---

## CI/CD 工作流

```
push main ──► build-web ──┬── deploy-pages ──► GitHub Pages
                          └── build-apk  ──► Release APK → GitHub Release
```

- **触发条件**：推送到 `main` 分支 / 手动触发
- **Web 部署**：Vite 构建 → `actions/deploy-pages@v4` → GitHub Pages
- **APK 构建**：下载 Web 产物 → 复制到 Android assets → Gradle 签名构建 → 发布 GitHub Release

---

## 使用方式

1. 访问 [GitHubM](https://qq5855144.github.io/GitHubM/)
2. 在 GitHub 生成 [Personal Access Token](https://github.com/settings/tokens)（需要 `repo`、`notifications`、`user`、`workflow` 权限）
3. 输入 Token 登录，即可管理你的 GitHub 资源
4. 点击顶部 **AI 助手** 入口，选择模型后直接用中文描述任务

> Token 仅保存在浏览器本地，不会上传至任何服务器。

---

## License

MIT © qq5855144
