/**
 * GitHubM 全网访问统计 Worker
 *
 * 统计口径：
 * - 只保留一个「访问量」指标
 * - 同一 GitHub 用户 30 分钟内只计 1 次
 * - 不记录路径、PV/UV、IP、登录名或明文 Token
 * - 私有仓库通过 /v1/export 拉取每日快照归档
 */

export interface Env {
  DB: D1Database;
  /** 同时用于用户 ID 哈希盐和 /v1/export 鉴权 */
  STATS_SECRET: string;
}

interface GitHubUser {
  id: number;
  login: string;
}

interface SummaryResponse {
  generatedAt: string;
  today: { visits: number };
  period: { days: number; visits: number; activeDays: number };
  total: { visits: number; activeDays: number };
  days: Array<{ date: string; visits: number }>;
}

const RATE_WINDOW_MS = 30 * 60 * 1000;
const MAX_SUMMARY_DAYS = 90;
const MAX_EXPORT_DAYS = 3650;
const AUTH_CACHE_SECONDS = 600;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data: unknown, status = 200, cacheControl?: string): Response {
  const headers = new Headers(CORS_HEADERS);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (cacheControl) headers.set('Cache-Control', cacheControl);
  return new Response(JSON.stringify(data), { status, headers });
}

function emptyCors(status = 204): Response {
  return new Response(null, { status, headers: CORS_HEADERS });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function utcDay(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * 使用用户自己的 GitHub Token 校验身份。
 * 缓存的是 token 哈希 -> 用户信息，不保存 Token 明文。
 */
async function authenticate(request: Request): Promise<GitHubUser | null> {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1];
  const tokenHash = await sha256Hex(token);
  const cacheKey = new Request(`https://githubm-stats.internal/auth/${tokenHash}`, { method: 'GET' });
  const cache = caches.default;

  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const user = (await cached.json()) as GitHubUser;
      if (Number.isFinite(user.id) && typeof user.login === 'string') return user;
    }
  } catch {
    // Cache API 不可用时继续请求 GitHub。
  }

  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'GitHubM-Stats',
      },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { id?: unknown; login?: unknown };
    if (typeof payload.id !== 'number' || typeof payload.login !== 'string') return null;
    const user: GitHubUser = { id: payload.id, login: payload.login };
    try {
      await cache.put(
        cacheKey,
        new Response(JSON.stringify(user), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `max-age=${AUTH_CACHE_SECONDS}`,
          },
        }),
      );
    } catch {
      // 缓存失败不影响本次校验。
    }
    return user;
  } catch {
    return null;
  }
}

async function userIdHash(user: GitHubUser, env: Env): Promise<string> {
  return sha256Hex(`${user.id}:${env.STATS_SECRET}`);
}

async function handleHit(request: Request, env: Env): Promise<Response> {
  if (!env.STATS_SECRET || env.STATS_SECRET.length < 16) {
    return json({ ok: false, error: 'stats_secret_not_configured' }, 503);
  }

  const user = await authenticate(request);
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401);

  const now = Date.now();
  const day = utcDay(now);
  const hash = await userIdHash(user, env);

  // 同一用户 30 分钟内只计一次；不区分页面。
  const claim = await env.DB.prepare(
    `INSERT INTO last_hits (user_id_hash, last_at)
     VALUES (?, ?)
     ON CONFLICT(user_id_hash)
     DO UPDATE SET last_at = excluded.last_at
     WHERE last_hits.last_at <= ?`,
  )
    .bind(hash, now, now - RATE_WINDOW_MS)
    .run();

  if ((claim.meta.changes ?? 0) === 0) {
    return json({ ok: true, counted: false });
  }

  await env.DB.prepare(
    `INSERT INTO daily_stats (day, visits) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET visits = visits + 1`,
  )
    .bind(day)
    .run();

  return json({ ok: true, counted: true });
}

async function readSummary(db: D1Database, days: number): Promise<SummaryResponse> {
  const today = utcDay();
  const startDay = shiftDay(today, -(days - 1));

  const [trendResult, todayResult, totalResult, activeDaysResult] = await Promise.all([
    db
      .prepare(`SELECT day AS date, visits FROM daily_stats WHERE day >= ? ORDER BY day`)
      .bind(startDay)
      .all<{ date: string; visits: number }>(),
    db.prepare(`SELECT COALESCE(visits, 0) AS visits FROM daily_stats WHERE day = ?`).bind(today).first<{ visits: number }>(),
    db.prepare(`SELECT COALESCE(SUM(visits), 0) AS visits FROM daily_stats`).first<{ visits: number }>(),
    db.prepare(`SELECT COUNT(*) AS days FROM daily_stats WHERE visits > 0`).first<{ days: number }>(),
  ]);

  const byDay = new Map(
    (trendResult.results ?? []).map((row) => [row.date, Number(row.visits) || 0]),
  );

  const daysList: Array<{ date: string; visits: number }> = [];
  let periodVisits = 0;
  let periodActiveDays = 0;
  for (let offset = -(days - 1); offset <= 0; offset += 1) {
    const date = shiftDay(today, offset);
    const visits = byDay.get(date) ?? 0;
    periodVisits += visits;
    if (visits > 0) periodActiveDays += 1;
    daysList.push({ date, visits });
  }

  return {
    generatedAt: new Date().toISOString(),
    today: { visits: Number(todayResult?.visits) || 0 },
    period: { days, visits: periodVisits, activeDays: periodActiveDays },
    total: {
      visits: Number(totalResult?.visits) || 0,
      activeDays: Number(activeDaysResult?.days) || 0,
    },
    days: daysList,
  };
}

async function handleSummary(request: Request, env: Env): Promise<Response> {
  if (!env.STATS_SECRET || env.STATS_SECRET.length < 16) {
    return json({ ok: false, error: 'stats_secret_not_configured' }, 503);
  }
  const user = await authenticate(request);
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const requestedDays = Number.parseInt(url.searchParams.get('days') ?? '7', 10);
  const days = Number.isFinite(requestedDays)
    ? Math.min(Math.max(requestedDays, 1), MAX_SUMMARY_DAYS)
    : 7;

  const summary = await readSummary(env.DB, days);
  return json(summary, 200, 'private, max-age=30');
}

async function handleExport(request: Request, env: Env): Promise<Response> {
  if (!env.STATS_SECRET || env.STATS_SECRET.length < 16) {
    return json({ ok: false, error: 'stats_secret_not_configured' }, 503);
  }

  const expected = `Bearer ${env.STATS_SECRET}`;
  const authorization = request.headers.get('Authorization') ?? '';
  if (!safeEqual(authorization, expected)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const requestedDays = Number.parseInt(url.searchParams.get('days') ?? '365', 10);
  const days = Number.isFinite(requestedDays)
    ? Math.min(Math.max(requestedDays, 1), MAX_EXPORT_DAYS)
    : 365;

  const summary = await readSummary(env.DB, days);
  return json(summary, 200, 'no-store');
}

async function route(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return emptyCors();

  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ ok: true, service: 'githubm-stats' });
  }
  if (url.pathname === '/v1/hit' && request.method === 'POST') {
    return handleHit(request, env);
  }
  if (url.pathname === '/v1/summary' && request.method === 'GET') {
    return handleSummary(request, env);
  }
  if (url.pathname === '/v1/export' && request.method === 'GET') {
    return handleExport(request, env);
  }

  return json({ ok: false, error: 'not_found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      console.error('[githubm-stats] request failed', error instanceof Error ? error.message : error);
      return json({ ok: false, error: 'internal_error' }, 500);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    // 只保留最近 7 天的去重窗口，避免 last_hits 无限增长。
    await env.DB.prepare(`DELETE FROM last_hits WHERE last_at < ?`)
      .bind(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .run();
  },
} satisfies ExportedHandler<Env>;