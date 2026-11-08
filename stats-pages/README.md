# GitHubM Stats Pages Gateway

Cloudflare Pages 项目 `githubm-stats-pages`，通过 Service Binding 把请求转发到 `githubm-stats` Worker。

- 自带域名：`https://githubm-stats-pages.pages.dev`
- Worker 存储：Durable Object SQLite
- 不接触现有 `pg-8kd2m7` Pages 项目

部署：

```bash
npx wrangler pages deploy public --project-name githubm-stats-pages --branch main
```