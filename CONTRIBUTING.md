# GitHubM 贡献指南

感谢你对 GitHubM 的兴趣！本文档帮助你快速上手参与贡献。

---

## 目录

- [项目概述](#项目概述)
- [环境准备](#环境准备)
- [开发流程](#开发流程)
- [提交规范](#提交规范)
- [代码风格](#代码风格)
- [测试要求](#测试要求)
- [PR 提交指南](#pr-提交指南)
- [Issue 报告指南](#issue-报告指南)

---

## 项目概述

GitHubM 是一款 Android WebView 应用，前端基于 React + TypeScript + Vite 构建，
通过 GitHub API 实现仓库、Issues、PR、Actions 等 GitHub 核心功能的移动端管理。

**技术栈**

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| 客户端 | Android WebView（Kotlin）|
| 后端 | Supabase Edge Functions（AI 助手） |
| CI/CD | GitHub Actions |

---

## 环境准备

```bash
# 1. 克隆仓库
git clone https://github.com/qq5855144/GitHubM.git
cd GitHubM

# 2. 安装 pnpm（如未安装）
npm install -g pnpm@9

# 3. 安装依赖
pnpm install

# 4. 复制环境变量模板（如有 .env.example）
cp .env.example .env
# 编辑 .env，填入 Supabase 配置
```

**前端开发环境要求**

- Node.js ≥ 20
- pnpm ≥ 9

**Android 开发环境要求（仅在修改 android/ 时需要）**

- JDK 17
- Android Studio Ladybug 或更高
- Android SDK API 34+

---

## 开发流程

GitHubM 采用 **GitHub Flow**：

```
main（受保护）
  └─ feature/your-feature   ← 从 main 创建
       └─ PR → Code Review → Squash Merge → main
```

```bash
# 1. 从最新 main 创建功能分支
git checkout main && git pull origin main
git checkout -b feature/your-feature-name

# 2. 开发、提交
git add .
git commit -m "feat: 你的功能描述"

# 3. 推送并创建 PR
git push origin feature/your-feature-name
# 在 GitHub 上创建 PR，填写模板内容
```

---

## 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范：

```
<类型>[可选作用域]: <简短描述>

[可选正文]

[可选脚注]
```

**类型说明**

| 类型 | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat: 添加 GraphQL 查询历史记录` |
| `fix` | Bug 修复 | `fix: 修复 PR 列表翻页后滚动位置重置` |
| `perf` | 性能优化 | `perf: 仓库列表添加虚拟滚动` |
| `refactor` | 代码重构 | `refactor: 提取 useGitHubAPI 通用 hook` |
| `style` | 代码格式 | `style: 统一缩进为 2 空格` |
| `test` | 测试 | `test: 补充 formatRelativeTime 边界测试` |
| `docs` | 文档 | `docs: 更新贡献指南` |
| `chore` | 构建/工具 | `chore: 升级 Vite 到 6.x` |
| `ci` | CI 配置 | `ci: 添加 PR 自动检查工作流` |

**注意事项**

- 标题不超过 72 个字符
- 标题使用祈使句（"添加"而非"添加了"）
- Breaking Change 需在脚注加 `BREAKING CHANGE:` 说明

---

## 代码风格

项目使用 [Biome](https://biomejs.dev/) 进行代码检查和格式化：

```bash
# 检查代码（包含 lint + 类型检查 + 构建验证）
pnpm run lint

# 运行单元测试
pnpm test

# 查看测试覆盖率
pnpm test:coverage
```

**核心约定**

- 2 空格缩进，不使用 tab
- 组件文件使用 PascalCase（`UserCard.tsx`）
- 工具函数文件使用 camelCase（`githubUtils.ts`）
- 常量使用 SCREAMING_SNAKE_CASE
- 类型定义统一放 `src/types/types.ts`
- 禁止使用直接 Tailwind 颜色类（`bg-blue-500`），只用语义 token（`bg-primary`）

---

## 测试要求

- 新增的工具函数 **必须** 有对应的单元测试
- 测试文件放在 `src/tests/` 目录下，命名为 `*.test.ts`
- 使用 Vitest + Testing Library

```bash
# 运行全部测试
pnpm test

# 监视模式（开发时使用）
pnpm test:watch
```

---

## PR 提交指南

1. **一个 PR 解决一个问题**：避免大型混合 PR，更容易 review 和回滚
2. **填写 PR 模板**：描述改动原因、范围和测试情况
3. **确保 CI 通过**：本地执行 `pnpm run lint` 和 `pnpm test` 后再提交
4. **附上截图**：涉及 UI 改动时，提供改动前后对比截图
5. **关联 Issue**：在 PR 描述中使用 `Fixes #xxx` 自动关联并关闭 Issue

---

## Issue 报告指南

- 报告 Bug 前请先搜索是否已有相同 Issue
- 使用对应模板（Bug 报告 / 功能请求 / 性能问题）
- 提供尽可能详细的环境信息和重现步骤
- 截图和录屏能显著加快问题定位

---

## 行为准则

本项目遵循 [Contributor Covenant](https://www.contributor-covenant.org/zh-cn/) 行为准则。
请尊重所有参与者，保持友善、建设性的交流氛围。

---

感谢你的贡献！🎉
