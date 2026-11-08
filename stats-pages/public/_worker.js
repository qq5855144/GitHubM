/**
 * Cloudflare Pages 自带 *.pages.dev 子域名。
 * 这里只作为 githubm-stats Worker 的透明入口，避免依赖当前账号异常的 workers.dev 路由。
 */
export default {
  async fetch(request, env) {
    if (!env.STATS_WORKER || typeof env.STATS_WORKER.fetch !== 'function') {
      return new Response(
        JSON.stringify({ ok: false, error: 'service_binding_missing' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }
    return env.STATS_WORKER.fetch(request);
  },
};