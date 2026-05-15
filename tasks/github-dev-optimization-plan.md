# GitHubM 系统性优化方案 — 结合 GitHub 开发环境

> 针对 GitHubM 项目（React + Android WebView + CI/CD）的全栈优化方案

---

## 目录

- [一、CI/CD 流程优化](#一cicd-流程优化)
- [二、Android 工程优化](#二android-工程优化)
- [三、前端性能与工程化](#三前端性能与工程化)
- [四、GitHub 生态集成优化](#四github-生态集成优化)
- [五、代码质量与测试](#五代码质量与测试)
- [六、开发工作流优化](#六开发工作流优化)

---

## 一、CI/CD 流程优化

### 1.1 当前痛点

| 问题 | 影响 |
|------|------|
| build-web 和 build-apk 串行 | APK 构建需等待 build-web 完成，总时间延长 |
| 缺少缓存回收机制 | Artifacts 1 天后自动删除，但无用的中间产物可能占用存储 |
| CI 节点缺少并行度 | 只有 3 个 Job，未充分利用 Actions 并行能力 |
| 缺少测试阶段 | CI 直接构建部署，没有运行测试用例阶段 |
| 缺少 PR 检查 | 只有 push 触发，PR 合并前没有自动检查 |

### 1.2 优化后的 CI 架构

```
┌───────────────────────────────────────────────────────────┐
│                    Trigger: push to main / PR / workflow_dispatch                  │
├───────────────────────────────────────────────────────────┤
│  Phase 1: 质量门卡  (max 2min)                                            │
│  ┌─────────────────────────────────────────────────────┐         │
│  │ lint → test → type-check → build (dry-run)                   │ ← 必须全通过
│  └─────────────────────────────────────────────────────┘         │
├───────────────────────────────────────────────────────────┤
│  Phase 2: 并行构建  (max 5min)                                            │
│  ┌─────────────────────────────────────────────────────┐         │
│  │ build-web (with cache)                              │         │
│  └─────────────────────────────────────────────────────┘         │
├───────────────────────────────────────────────────────────┤
│  Phase 3: 并行发布  (max 4min)                                            │
│  ┌─────────────────────────────────────────────────────┐         │
│  │ deploy-pages (needs: build-web)                     │         │
│  │ build-apk (needs: build-web, parallel)              │         │
│  └─────────────────────────────────────────────────────┘         │
├───────────────────────────────────────────────────────────┤
│  Phase 4: Release 发布  (needs: build-apk)                             │
│  ├─────────────────────────────────────────────────────┤         │
│  │ • 自动创建 GitHub Release                              │         │
│  │ • 上传 APK + 构建产物                                    │         │
│  │ • 生成变更日志 (auto changelog)                         │         │
│  └─────────────────────────────────────────────────────┘         │
└───────────────────────────────────────────────────────────┘
```

### 1.3 关键改进点

#### 改进 1：添加 PR 检查工作流

```yaml
# .github/workflows/pr-check.yml
name: PR Check

on:
  pull_request:
    branches: [main, master]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run test
      - name: TypeScript Check
        run: npx tsc --noEmit
```

#### 改进 2：添加构建缓存

```yaml
# 在 build-web job 中添加
- name: Setup pnpm cache
  uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: 'pnpm'

- name: Setup build cache
  uses: actions/cache@v4
  with:
    path: |
      .vite_cache
      dist
    key: ${{ runner.os }}-vite-${{ hashFiles('pnpm-lock.yaml') }}
    restore-keys: |
      ${{ runner.os }}-vite-
```

#### 改进 3：添加变更日志自动生成

```yaml
# 在 Release 创建步骤中
- name: Generate Changelog
  id: changelog
  run: |
    # 获取上次 tag 以来的所有 commit
    LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
    if [ -z "$LAST_TAG" ]; then
      COMMITS=$(git log --pretty=format:"- %s" | head -50)
    else
      COMMITS=$(git log ${LAST_TAG}..HEAD --pretty=format:"- %s")
    fi

    # 按前缀分类
    FEATURES=$(echo "$COMMITS" | grep -E "^.*feat[(:]" || true)
    FIXES=$(echo "$COMMITS" | grep -E "^.*fix[(:]" || true)
    DOCS=$(echo "$COMMITS" | grep -E "^.*doc[(:]" || true)
    OTHERS=$(echo "$COMMITS" | grep -vE "^.*(feat|fix|doc)[(:]" || true)

    echo "changelog<<EOF" >> $GITHUB_OUTPUT
    echo "## 功能" >> $GITHUB_OUTPUT
    echo "$FEATURES" >> $GITHUB_OUTPUT
    echo "" >> $GITHUB_OUTPUT
    echo "## 修复" >> $GITHUB_OUTPUT
    echo "$FIXES" >> $GITHUB_OUTPUT
    echo "EOF" >> $GITHUB_OUTPUT
```

#### 改进 4：添加构建测试

```yaml
# 在 CI 中添加 e2e 测试（可选）
- name: Build Test
  run: |
    pnpm exec vite build --mode ci-test
    # 验证构建产物
    ls -la dist/
    # 检查关键文件是否存在
    test -f dist/index.html
    test -d dist/assets
```

---

## 二、Android 工程优化

### 2.1 当前痛点

| 问题 | 影响 |
|------|------|
| WebView 未启用硬件加速 | 动画和滚动性能受限 |
| 缺少离线缓存策略 | 无网络时无法使用 |
| 启动画面无进度条 | 用户不知道加载进度 |
| 缺少更新检查 | 用户不知道有新版本 |
| 安全设置过宽 | WebSettings 未限制跨域请求 |

### 2.2 优化方案

#### 改进 1：启用硬件加速与现代 WebView 功能

```kotlin
// MainActivity.kt 中添加
webView.settings.apply {
    // 硬件加速
    setRenderPriority(WebSettings.RenderPriority.HIGH)
    setLayerType(View.LAYER_TYPE_HARDWARE, null)

    // 离线 Web 应用模式
    setDatabaseEnabled(true)
    setDomStorageEnabled(true)
    databasePath = applicationContext.getDir("database", Context.MODE_PRIVATE).path

    // 允许文件访问
    allowFileAccess = true
    allowContentAccess = true

    // 优化滚动
    isSmoothScrollingEnabled = true
}

// 启用 Chrome DevTools 调试（debug 构建）
if (BuildConfig.DEBUG) {
    WebView.setWebContentsDebuggingEnabled(true)
}
```

#### 改进 2：添加更新检查 JavaScript 接口

```kotlin
// 在 MainActivity 中添加 JS Bridge
@JavascriptInterface
fun checkUpdate() {
    lifecycleScope.launch(Dispatchers.IO) {
        try {
            val url = URL("https://api.github.com/repos/${OWNER}/${REPO}/releases/latest")
            val conn = url.openConnection() as HttpURLConnection
            conn.setRequestProperty("Accept", "application/vnd.github.v3+json")
            conn.connectTimeout = 10000
            conn.readTimeout = 10000

            val response = conn.inputStream.bufferedReader().use { it.readText() }
            val json = JSONObject(response)
            val latestTag = json.getString("tag_name")
            val downloadUrl = json.getJSONArray("assets")
                .getJSONObject(0).getString("browser_download_url")

            // 比较版本
            val currentVersion = BuildConfig.VERSION_NAME
            if (latestTag != "v$currentVersion") {
                withContext(Dispatchers.Main) {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('appUpdateAvailable', {" +
                        "detail: { version: '$latestTag', url: '$downloadUrl' }}))",
                        null
                    )
                }
            }
        } catch (e: Exception) {
            // 静默失败，不打扰用户
        }
    }
}
```

#### 改进 3：添加 Service Worker 离线缓存（前端）

```typescript
// public/sw.js — 简单离线缓存 Service Worker
const CACHE_NAME = 'githubm-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/assets/index.css',
  '/assets/index.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      // 网络优先，失败时使用缓存
      return response || fetch(e.request).catch(() => {
        // 对于 API 请求，返回一个简单的离线响应
        if (e.request.url.includes('api.github.com')) {
          return new Response(JSON.stringify({ offline: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error('Network error');
      });
    })
  );
});

// 注册（main.tsx 或 App.tsx）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // WebView 不支持 Service Worker 时静默失败
  });
}
```

#### 改进 4：启动画面添加进度条

```xml
<!-- splash_screen.xml 添加 -->
<ProgressBar
    android:id="@+id/progressBar"
    style="?android:attr/progressBarStyleHorizontal"
    android:layout_width="200dp"
    android:layout_height="4dp"
    android:layout_gravity="center|bottom"
    android:layout_marginBottom="120dp"
    android:indeterminate="true"
    android:progressTint="@color/splash_accent"
    android:trackTint="@color/splash_track" />
```

---

## 三、前端性能与工程化

### 3.1 当前痛点

| 问题 | 影响 |
|------|------|
| 所有页面打包到单一 chunk | 首屏加载时间长，即使只访问首页 |
| 缺少代码拆分 | 38 个页面全部静态 import，无懒加载 |
| 没有构建产物分析 | 不知道哪个依赖体积最大 |
| 缺少图片优化 | 占星头、仓库图标等外部图片无缓存/预加载 |

### 3.2 优化方案

#### 改进 1：按路由懒加载页面

```tsx
// routes.tsx 改为动态导入
import { lazy, Suspense } from 'react';

const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ReposPage = lazy(() => import('./pages/ReposPage'));
// ... 其他页面类似

// App.tsx 或路由加载处添加懒加载壳
<Suspense fallback={<PageSkeleton />}>
  <Outlet />
</Suspense>

// PageSkeleton 组件
function PageSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="h-8 bg-muted rounded w-1/3" />
      <div className="h-32 bg-muted rounded" />
      <div className="h-32 bg-muted rounded" />
    </div>
  );
}
```

#### 改进 2：建议的 manualChunks 重新设计

```typescript
// vite.config.ts
build: {
  // 保留不拆包作为默认行为，但对于不是 WebView 的 Web 部署，可以开启
  rollupOptions: {
    output: {
      manualChunks: (id) => {
        // 仅在 Web 部署时启用（非 WebView）
        if (process.env.VITE_TARGET === 'web') {
          if (id.includes('recharts')) return 'charts';
          if (id.includes('react-markdown')) return 'markdown';
          if (id.includes('node_modules')) return 'vendor';
        }
      },
    },
  },
}
```

#### 改进 3：添加构建产物分析脚本

```json
// package.json 添加
{
  "scripts": {
    "analyze": "pnpm exec vite build --mode analyze && npx vite-bundle-analyzer dist"
  }
}
```

#### 改进 4：图片优化

```tsx
// 对于外部 GitHub 头像，添加缓存和幻影占位
<img
  src={avatarUrl}
  loading="lazy"
  decoding="async"
  className="rounded-full bg-muted"
  onError={(e) => {
    (e.target as HTMLImageElement).src = '/default-avatar.png';
  }}
/>
```

---

## 四、GitHub 生态集成优化

### 4.1 当前痛点

| 问题 | 影响 |
|------|------|
| 缺少 Issue 模板 | Issue 提交不规范，信息不完整 |
| 缺少 PR 模板 | PR 描述不清晰，审查困难 |
| 缺少贡献指南 | 新开发者不知道如何参与 |
| 缺少 Code Owners | 代码审查没有自动指派 |
| README 缺少开发贡献章节 | 没有如何提交 PR 的说明 |

### 4.2 优化方案

#### 改进 1：添加 Issue/PR 模板

```markdown
<!-- .github/ISSUE_TEMPLATE/bug_report.md -->
---
name: Bug 报告
about: 报告一个 bug
labels: bug
---

### 问题描述
清晰简洁地描述 bug。

### 重现步骤
1. 进入 '...'
2. 点击 '...'
3. 滚动到 '...'

### 预期行为
描述你期望的正确行为。

### 环境信息
- OS: [e.g. iOS, Android]
- 版本: [e.g. v1.0.0]
- 浏览器: [e.g. Chrome 120]
```

```markdown
<!-- .github/PULL_REQUEST_TEMPLATE.md -->
## 变更描述
简要描述本 PR 的目的和改变。

## 相关 Issue
Fixes #(issue 编号)

## 检查清单
- [ ] 代码通过 lint
- [ ] 测试通过
- [ ] 文档已更新
```

#### 改进 2：添加 CONTRIBUTING.md

```markdown
# 贡献指南

## 开发流程

1. Fork 本仓库
2. 创建功能分支 `git checkout -b feature/xxx`
3. 提交更改 `git commit -m "feat: 描述"`
4. 推送到你的 Fork `git push origin feature/xxx`
5. 创建 Pull Request

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat:` 新功能
- `fix:` bug 修复
- `docs:` 文档更新
- `style:` 代码格式（不影响功能）
- `refactor:` 重构
- `test:` 测试
- `chore:` 构建/工具
```

#### 改进 3：添加 CODEOWNERS

```
# .github/CODEOWNERS
# 全局默认审查人
* @qq5855144

# Android 相关代码需要审查
/android/ @qq5855144

# CI/CD 配置
/.github/workflows/ @qq5855144
```

#### 改进 4：添加 Issue 自动关闭工作流

```yaml
# .github/workflows/issue-management.yml
name: Issue Management

on:
  schedule:
    - cron: '0 0 * * *'  # 每天 UTC 00:00

jobs:
  stale:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/stale@v9
        with:
          stale-issue-message: '此 Issue 已经 30 天未活跃，如无更新将自动关闭。'
          days-before-stale: 30
          days-before-close: 7
          stale-issue-label: 'stale'
```

---

## 五、代码质量与测试

### 5.1 当前痛点

| 问题 | 影响 |
|------|------|
| 测试覆盖率低 | 大部分页面组件无测试 |
| 缺少 E2E 测试 | 没有流程级验证 |
| 代码规范仅依赖 Biome | 缺少 ESLint 更丰富的规则 |

### 5.2 优化方案

#### 改进 1：添加页面组件测试

```tsx
// src/pages/__tests__/DashboardPage.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import DashboardPage from '../DashboardPage';

describe('DashboardPage', () => {
  it('渲染欢迎标题', () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>
    );
    expect(screen.getByText(/GitHub 管理面板/i)).toBeInTheDocument();
  });
});
```

#### 改进 2：添加 MSW 模拟 API

```typescript
// src/tests/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('https://api.github.com/user', () => {
    return HttpResponse.json({
      login: 'testuser',
      name: 'Test User',
      avatar_url: 'https://example.com/avatar.png',
    });
  }),
];
```

#### 改进 3：添加组件快照测试

```typescript
// vitest.config.ts 或 package.json
{
  "scripts": {
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

## 六、开发工作流优化

### 6.1 建议的工作流

```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│  GitHub Flow + Conventional Commits + SemVer                                                         │
│                                                                                                       │
│  main 分支 ←──────────────────────────────────────────────────────────────────────────────────────┐  │
│    ↓   feature/分支 ←────────────────────────────────────────────────────────────────────────────────────┐│
│    ↓   PR 提交 ←─────────────────────────────────────────────────────────────────────────────────────────────────┐│
│    ↓   CI 检查 (lint + test + build) ←──────────────────────────────────────────────────────────────────────────────────────┘│
│    ↓   Code Review ←─────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│    ↓   Squash Merge ←───────────────────────────────────────────────────────────────────────────────────────────────┘  │
│    ↓   Auto Deploy + Release ←──────────────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 分支保护建议

在仓库 Settings 中配置分支保护规则：

| 规则 | 设置 |
|------|------|
| main 分支推送 | 需要 PR + 1 个审批 + CI 通过 |
| PR 合并 | 需要 1 个审批 + 最新代码 + 对话解决 |
| 强制 linear history | 开启（禁止 force push） |

### 6.3 版本发布流程

```bash
# 使用 npm version 自动打 tag
npm version patch   # v1.0.0 → v1.0.1
npm version minor   # v1.0.0 → v1.1.0
npm version major   # v1.0.0 → v2.0.0

# 推送后 CI 自动构建并发布 Release
git push origin main --follow-tags
```

---

## 优先级排序

| 优先级 | 项目 | 提升效果 | 实施难度 |
|--------|------|----------|----------|
| P0 | PR Check CI | 防止坏代码进入 main | 实施快 |
| P0 | Issue/PR 模板 | 提升协作效率 | 实施快 |
| P1 | CI 缓存优化 | 构建时间 -50% | 实施快 |
| P1 | 变更日志自动生成 | 发布体验提升 | 实施快 |
| P2 | 路由懒加载 | 首屏加载加速 | 实施中 |
| P2 | Android 更新检查 | 用户体验提升 | 实施中 |
| P3 | 测试覆盖率提升 | 代码质量保障 | 实施慢 |
| P3 | Service Worker | 离线体验 | 实施中 |

---

## 总结

本方案从 **CI/CD 流程、Android 工程、前端性能、GitHub 生态、代码质量、开发工作流** 六个维度提出了系统性优化建议。

建议按照 **P0 → P1 → P2 → P3** 的优先级逐步实施，
每一步都能带来可感知的提升。
