# GitHubM Stats Worker

全网访问量统计的 Cloudflare Worker。

## 统计口径

- 单一「访问量」指标，不再区分 PV / UV
- 同一 GitHub 账号 30 分钟内只计 1 次
- 不记录路径、IP、登录名或明文 Token
- 计数存储在 Durable Object SQLite 中，不需要单独创建 D1 数据库

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/health` | 无 | 健康检查 |
| POST | `/v1/hit` | GitHub Token | 上报一次访问 |
| GET | `/v1/summary?days=7` | GitHub Token | 读取统计 |
| GET | `/v1/export?days=365` | `STATS_SECRET` | 私有仓库归档导出 |

## 环境变量 / Secret

| 名称 | 说明 |
|---|---|
| `STATS_SECRET` | 用户 ID 哈希盐，同时用于 `/v1/export` 鉴权 |

`STATS_SECRET` 至少 32 个字符。

## 部署

GitHub Actions 工作流：`.github/workflows/deploy-stats-worker.yml`

需要的仓库 Secrets：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `STATS_SECRET`

Cloudflare API Token 需要：

- Account → Workers Scripts → Edit

本地部署：

```bash
npm install
npx wrangler deploy
```

## 自定义域名

当前 Worker：

```text
githubm-stats
```

计划使用：

```text
https://stats.callact.xyz
```

需要在 Cloudflare Dashboard 的 Worker `Settings → Domains & Routes` 中添加上面的 Custom Domain。

> 当前账号的 `workers.dev` 路由返回 `1101 Worker threw exception`，即使最小 Worker 也一样；同账号已有 Worker 的 Custom Domain 正常，因此线上入口使用 `stats.callact.xyz`。