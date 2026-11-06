// GitHubM 无状态 LLM 代理（Cloudflare Worker）
//
// 目的：解决 Android WebView 直连模型 API 时的 CORS / 网络问题。
// 原则：
//   - 不保存会话、不保存 API Key、不跑 Agent 循环
//   - 只接受白名单 provider（custom 需显式配置上游域名）
//   - 原样透传 SSE，保证前端流式体验
//
// 部署后前端调用：
//   POST https://<worker>.workers.dev/v1/chat/completions
//   Header: Authorization: Bearer <用户自己的模型 API Key>
//   Header: x-llm-provider: deepseek | openai | gemini | qwen | custom
//   Header: x-llm-upstream: https://...   （仅 custom 使用）

interface Env {
  /** 允许的前端 Origin；不配置则 *（WebView / 本地页面） */
  ALLOWED_ORIGIN?: string;
  /** custom 允许的上游域名，逗号分隔，例如 api.example.com,llm.example.com */
  ALLOWED_UPSTREAMS?: string;
}

const PROVIDERS: Record<string, string> = {
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
};

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-llm-provider, x-llm-upstream',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(env),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function resolveUpstream(req: Request, env: Env): string | null {
  const provider = (req.headers.get('x-llm-provider') || 'deepseek').toLowerCase();
  if (provider !== 'custom') return PROVIDERS[provider] ?? null;

  const raw = req.headers.get('x-llm-upstream') || '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const allowed = (env.ALLOWED_UPSTREAMS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(url.hostname.toLowerCase())) return null;
  return url.toString();
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'githubm-llm-proxy' }, 200, env);
    }

    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      return json({ error: 'Not Found' }, 404, env);
    }

    const upstream = resolveUpstream(req, env);
    if (!upstream) {
      return json({ error: 'Unsupported provider or upstream not allowed' }, 400, env);
    }

    // Authorization 由客户端传入，代理不保存；也允许自定义 header 名由上游要求时透传
    const auth = req.headers.get('authorization');
    if (!auth) return json({ error: 'Missing Authorization' }, 401, env);

    const contentType = req.headers.get('content-type') || 'application/json';
    const body = await req.text();

    try {
      const upstreamResp = await fetch(upstream, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          Authorization: auth,
          Accept: 'text/event-stream, application/json',
        },
        body,
      });

      const headers = new Headers(corsHeaders(env));
      headers.set('Cache-Control', 'no-store');
      headers.set('X-Accel-Buffering', 'no');

      const upstreamType = upstreamResp.headers.get('content-type') || '';
      if (upstreamType.includes('text/event-stream')) {
        headers.set('Content-Type', 'text/event-stream; charset=utf-8');
      } else {
        headers.set('Content-Type', upstreamType || 'application/json; charset=utf-8');
      }

      // 流式 body 直接透传，Worker 不做缓冲
      return new Response(upstreamResp.body, {
        status: upstreamResp.status,
        headers,
      });
    } catch (err) {
      return json(
        { error: 'Upstream request failed', detail: err instanceof Error ? err.message : String(err) },
        502,
        env,
      );
    }
  },
};
