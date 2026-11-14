# GitHubM LLM Proxy

无状态模型代理，解决 Android WebView 直连模型 API 的 CORS / 网络问题。  
只转发请求和 SSE，不保存会话、不保存 API Key、不跑 Agent 循环。

## 接口

```http
POST /v1/chat/completions
Authorization: Bearer <用户自己的模型 API Key>
Content-Type: application/json
x-llm-provider: deepseek | openai | gemini | qwen | github | custom
x-llm-upstream: https://...   # 仅 custom
```

- `deepseek` → `https://api.deepseek.com/v1/chat/completions`
- `openai` → `https://api.openai.com/v1/chat/completions`
- `gemini` → `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- `qwen` → `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- `github` → `https://models.github.ai/inference/chat/completions`
- `custom` 必须配置 `ALLOWED_UPSTREAMS`，否则拒绝

健康检查：

```http
GET /health
```

## 部署

```bash
cd cloudflare/llm-proxy
npx wrangler login
npx wrangler deploy
```

或使用 API Token（推荐 CI/自动化）：

```bash
CLOUDFLARE_API_TOKEN=... npx wrangler deploy
```

Token 权限：

- Account → Workers Scripts → Edit
- Account → Account Settings → Read
- 如使用 workers.dev 子域，确保账号已启用 Workers 子域

部署成功后会得到：

```text
https://githubm-llm-proxy.<account>.workers.dev
```

当前项目已部署到：

```text
https://llm.callact.xyz
```

`workers.dev` 在部分网络会被 DNS 污染，因此生产使用自定义域 `llm.callact.xyz`。  
`wrangler.toml` 里的 `routes` 已绑定该自定义域。

## 安全说明

- 不要使用 Cloudflare 邮箱/密码登录自动化；请使用 API Token，并开启 2FA。
- 生产环境建议把 `ALLOWED_ORIGIN` 改成 App 的实际 Origin，而不是 `*`。
- 代理不记录请求体和 Authorization。
