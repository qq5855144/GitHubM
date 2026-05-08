<p align="center">
  <img src="https://api.iconify.design/fe:github.svg?color=%237c3aed" alt="GitHubM" width="80" />
</p>

<h1 align="center">GitHubM</h1>

<p align="center">
  <strong>全功能 GitHub 管理面板</strong> — 现代化 Web 应用 + Android 客户端
</p>

<p align="center">
  <a href="https://qq5855144.github.io/GitHubM/"><img src="https://img.shields.io/badge/GitHub%20Pages-在线访问-222?logo=github" alt="Pages"></a>
  <a href="https://github.com/qq5855144/GitHubM/releases"><img src="https://img.shields.io/badge/Release-APK%20下载-blue?logo=android" alt="Release"></a>
  <a href="https://github.com/qq5855144/GitHubM/actions"><img src="https://img.shields.io/badge/CI/CD-自动部署-success?logo=githubactions" alt="CI"></a>
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
</p>

---

## 📖 简介

GitHubM 是一个全功能的 GitHub 管理面板，提供仓库浏览、Issue追踪、Pull Request管理、Gist、通知、搜索等一站式操作界面。支持 **Web浏览器** 和 **Android APK** 两种使用方式。

> 🔗 **在线体验**：[qq5855144.github.io/GitHubM](https://qq5855144.github.io/GitHubM/)

### ✨ 核心功能

| 模块 | 说明 |
|------|------|
| 📊 **仪表盘** | 概览统计、动态流、快捷入口 |
| 📦 **仓库管理** | 浏览/搜索仓库、查看详情、分支与提交 |
| 🐛 **Issues** | 创建、筛选、评论、关闭 Issue |
| 🔀 **Pull Requests** | 查看 PR 列表与详情、合并状态 |
| 📝 **Gists** | 浏览和管理代码片段 |
| 🔔 **通知** | 实时通知列表 |
| 🔍 **搜索** | 全站仓库与代码搜索 |
| 📄 **代码浏览** | 在线查看文件内容与目录树 |
| ⚙️ **Actions** | 查看 Workflow 运行状态 |
| 📦 **Packages** | 浏览 GitHub Packages |
| 📋 **Projects** | 项目看板管理 |
| 👥 **协作者** | 仓库协作者管理 |

---

## 🛠 技术栈

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
| **后端** | Supabase (可选) |
| **Android** | Kotlin, WebView 壳, Gradle 8.7 |
| **CI/CD** | GitHub Actions (自动 Pages 部署 + APK 构建) |

---

## 📁 项目结构

```
GitHubM/
├── .github/workflows/        # CI/CD 工作流
│   └── deploy.yml            #   自动部署 Pages + 构建 APK
├── android/                  # Android WebView 壳工程
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── java/.../MainActivity.kt
│   │   │   ├── res/          # Android 资源
│   │   │   └── AndroidManifest.xml
│   │   └── build.gradle.kts
│   ├── build.gradle.kts
│   └── settings.gradle.kts
├── public/                   # 静态资源
│   ├── favicon.png
│   └── images/               # Logo、错误页插图
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
│   ├── App.tsx               # 根组件
│   ├── main.tsx              # 入口
│   └── routes.tsx            # 路由配置
├── index.html
├── package.json
├── pnpm-workspace.yaml
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 20
- **pnpm** ≥ 9

```bash
node -v   # v20.x+
pnpm -v   # 9.x+
```

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

## 📱 Android APK

每次推送 `main` 分支时，GitHub Actions 自动构建 Android Debug APK。

| 项目 | 说明 |
|------|------|
| **应用 ID** | `com.github.manager` |
| **最低 SDK** | Android 8.0 (API 26) |
| **目标 SDK** | Android 14 (API 34) |
| **架构** | WebView 壳 + 内嵌 Web 资源 |
| **下载** | [Releases 页面](https://github.com/qq5855144/GitHubM/releases) |

---

## 🔄 CI/CD 工作流

```
push main ──► build-web ──┬── deploy-pages ──► GitHub Pages
                          └── build-apk  ──► APK Artifact
```

- **触发条件**：推送到 `main` 分支 / 手动触发
- **Web 部署**：Vite 构建 → `actions/deploy-pages@v4` → GitHub Pages
- **APK 构建**：下载 Web 产物 → 复制到 Android assets → Gradle 构建 → 上传 Artifact（保留 30 天）

---

## 🔐 使用方式

1. 访问 [GitHubM](https://qq5855144.github.io/GitHubM/)
2. 在 GitHub 生成 [Personal Access Token](https://github.com/settings/tokens)（需要 `repo`、`notifications`、`user` 权限）
3. 输入 Token 登录，即可管理你的 GitHub 资源

> ⚠️ Token 仅保存在浏览器本地，不会上传至任何服务器。

---

## 📄 License

MIT © qq5855144