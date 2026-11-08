/**
 * GitHubM 全网访问统计 Worker
 *
 * 统计口径：
 * - 只保留一个「访问量」指标
 * - 同一 GitHub 用户 30 分钟内只计 1 次
 * - 不记录路径、PV/UV、IP、登录名或明文 Token
 * - 计数状态存放在 Durable Object，无需单独部署数据库
 * - 私有仓库通过 /v1/export 拉取每日快照归档
 */

export interface Env {
  STATS: DurableObjectNamespace;
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

interface ProfileAchievement {
  slug: string;
  name: string;
  iconUrl: string;
  tier: string | null;
  count: number | null;
}

const RATE_WINDOW_MS = 30 * 60 * 1000;
const MAX_SUMMARY_DAYS = 90;
const MAX_EXPORT_DAYS = 3650;
const AUTH_CACHE_SECONDS = 600;
const ACHIEVEMENT_CACHE_MS = 6 * 60 * 60 * 1000;

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

function internalJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
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

function getCounter(env: Env): DurableObjectStub {
  return env.STATS.get(env.STATS.idFromName('global'));
}

async function readCounterSummary(env: Env, days: number): Promise<Response> {
  return getCounter(env).fetch(
    new Request(`https://stats.internal/summary?days=${days}`, { method: 'GET' }),
  );
}

async function handleHit(request: Request, env: Env): Promise<Response> {
  if (!env.STATS_SECRET || env.STATS_SECRET.length < 16) {
    return json({ ok: false, error: 'stats_secret_not_configured' }, 503);
  }

  const user = await authenticate(request);
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401);

  const hash = await userIdHash(user, env);
  const response = await getCounter(env).fetch(
    new Request('https://stats.internal/hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userHash: hash }),
    }),
  );
  return json(await response.json(), response.status);
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

  const response = await readCounterSummary(env, days);
  return json(await response.json(), response.status, 'private, max-age=30');
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

  const response = await readCounterSummary(env, days);
  return json(await response.json(), response.status, 'no-store');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseAchievements(html: string): ProfileAchievement[] {
  const result: ProfileAchievement[] = [];
  const seen = new Set<string>();
  const anchorPattern =
    /<a[^>]+href="\/[^"]*\?achievement=([a-z0-9-]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const imagePattern =
    /<img[^>]+src="([^"]+)"[^>]*alt="Achievement: ([^"]+)"/i;
  const tierPattern = /achievement-tier-label--([a-z]+)/;
  const countPattern = />x(\d+)</;

  let anchor: RegExpExecArray | null;
  while ((anchor = anchorPattern.exec(html)) !== null && result.length < 24) {
    const slug = anchor[1].toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);

    const block = anchor[2] ?? '';
    const image = imagePattern.exec(block);
    if (!image) continue;
    const iconUrl = image[1];
    if (!iconUrl.startsWith('https://github.githubassets.com/')) continue;

    const tier = tierPattern.exec(block)?.[1] ?? null;
    const countValue = countPattern.exec(block)?.[1];
    result.push({
      slug,
      name: decodeHtml(image[2]),
      iconUrl,
      tier,
      count: countValue ? Number.parseInt(countValue, 10) || null : null,
    });
  }
  return result;
}

async function handleAchievements(request: Request, env: Env): Promise<Response> {
  const user = await authenticate(request);
  if (!user) return json({ ok: false, error: 'unauthorized' }, 401);

  const stub = getCounter(env);
  let cached: { achievements: ProfileAchievement[]; fetchedAt: number } | null = null;
  try {
    const cachedResponse = await stub.fetch(
      `https://stats.internal/achievements/get?login=${encodeURIComponent(user.login)}`,
    );
    if (cachedResponse.ok) {
      cached = (await cachedResponse.json()) as {
        achievements: ProfileAchievement[];
        fetchedAt: number;
      };
    }
  } catch {
    // 缓存不可用时继续尝试 GitHub。
  }

  if (cached && Date.now() - cached.fetchedAt < ACHIEVEMENT_CACHE_MS) {
    return json({
      ok: true,
      cached: true,
      generatedAt: new Date(cached.fetchedAt).toISOString(),
      achievements: cached.achievements,
    });
  }

  try {
    const response = await fetch(`https://github.com/${encodeURIComponent(user.login)}?tab=achievements`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 GitHubM',
      },
    });
    if (!response.ok) throw new Error(`GitHub profile HTTP ${response.status}`);

    const achievements = parseAchievements(await response.text());
    if (achievements.length > 0) {
      await stub.fetch('https://stats.internal/achievements/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: user.login, achievements }),
      });
      return json({
        ok: true,
        cached: false,
        generatedAt: new Date().toISOString(),
        achievements,
      });
    }

    if (cached) {
      return json({
        ok: true,
        cached: true,
        stale: true,
        generatedAt: new Date(cached.fetchedAt).toISOString(),
        achievements: cached.achievements,
      });
    }
    return json({ ok: true, cached: false, generatedAt: new Date().toISOString(), achievements: [] });
  } catch (error) {
    if (cached) {
      return json({
        ok: true,
        cached: true,
        stale: true,
        generatedAt: new Date(cached.fetchedAt).toISOString(),
        achievements: cached.achievements,
      });
    }
    console.error(
      '[githubm-stats] achievement fetch failed',
      error instanceof Error ? error.message : error,
    );
    return json({ ok: false, error: 'achievement_upstream_unavailable' }, 502);
  }
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
  if (url.pathname === '/v1/achievements' && request.method === 'GET') {
    return handleAchievements(request, env);
  }

  return json({ ok: false, error: 'not_found' }, 404);
}

export class StatsCounter {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, readonly env: Env) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        day TEXT PRIMARY KEY,
        visits INTEGER NOT NULL DEFAULT 0
      );
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS last_hits (
        user_id_hash TEXT PRIMARY KEY,
        last_at INTEGER NOT NULL
      );
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS achievement_cache (
        login TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/hit' && request.method === 'POST') {
      return this.handleHitAsync(request);
    }
    if (url.pathname === '/summary' && request.method === 'GET') {
      return this.handleSummary(request);
    }
    if (url.pathname === '/cleanup' && request.method === 'POST') {
      return this.handleCleanup();
    }
    if (url.pathname === '/achievements/get' && request.method === 'GET') {
      return this.handleAchievementGet(request);
    }
    if (url.pathname === '/achievements/put' && request.method === 'POST') {
      return this.handleAchievementPut(request);
    }
    return internalJson({ ok: false, error: 'not_found' }, 404);
  }

  private async handleHitAsync(request: Request): Promise<Response> {
    const body = (await request.json()) as { userHash?: unknown };
    const hash = typeof body.userHash === 'string' ? body.userHash : '';
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      return internalJson({ ok: false, error: 'invalid_user_hash' }, 400);
    }

    const now = Date.now();
    const day = utcDay(now);
    const recent = this.sql
      .exec<{ last_at: number }>(`SELECT last_at FROM last_hits WHERE user_id_hash = ?`, hash)
      .toArray()[0];

    if (recent && now - Number(recent.last_at) < RATE_WINDOW_MS) {
      return internalJson({ ok: true, counted: false });
    }

    this.sql.exec(
      `INSERT INTO last_hits (user_id_hash, last_at) VALUES (?, ?)
       ON CONFLICT(user_id_hash) DO UPDATE SET last_at = excluded.last_at`,
      hash,
      now,
    );
    this.sql.exec(
      `INSERT INTO daily_stats (day, visits) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET visits = visits + 1`,
      day,
    );
    return internalJson({ ok: true, counted: true });
  }

  private handleSummary(request: Request): Response {
    const url = new URL(request.url);
    const requestedDays = Number.parseInt(url.searchParams.get('days') ?? '7', 10);
    const days = Number.isFinite(requestedDays)
      ? Math.min(Math.max(requestedDays, 1), MAX_EXPORT_DAYS)
      : 7;
    const today = utcDay();
    const startDay = shiftDay(today, -(days - 1));

    const rows = this.sql
      .exec<{ date: string; visits: number }>(
        `SELECT day AS date, visits FROM daily_stats WHERE day >= ? ORDER BY day`,
        startDay,
      )
      .toArray();
    const byDay = new Map(rows.map((row) => [row.date, Number(row.visits) || 0]));

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

    const total = this.sql
      .exec<{ visits: number }>(`SELECT COALESCE(SUM(visits), 0) AS visits FROM daily_stats`)
      .one();
    const activeDays = this.sql
      .exec<{ days: number }>(`SELECT COUNT(*) AS days FROM daily_stats WHERE visits > 0`)
      .one();

    const summary: SummaryResponse = {
      generatedAt: new Date().toISOString(),
      today: { visits: byDay.get(today) ?? 0 },
      period: { days, visits: periodVisits, activeDays: periodActiveDays },
      total: {
        visits: Number(total.visits) || 0,
        activeDays: Number(activeDays.days) || 0,
      },
      days: daysList,
    };
    return internalJson(summary);
  }

  private handleAchievementGet(request: Request): Response {
    const url = new URL(request.url);
    const login = (url.searchParams.get('login') ?? '').trim();
    if (!login) return internalJson({ ok: false, error: 'invalid_login' }, 400);

    const row = this.sql
      .exec<{ payload: string; fetched_at: number }>(
        `SELECT payload, fetched_at FROM achievement_cache WHERE login = ?`,
        login,
      )
      .toArray()[0];
    if (!row) return internalJson({ ok: false, error: 'not_found' }, 404);

    try {
      return internalJson({
        achievements: JSON.parse(row.payload),
        fetchedAt: Number(row.fetched_at) || 0,
      });
    } catch {
      return internalJson({ ok: false, error: 'invalid_cache' }, 500);
    }
  }

  private async handleAchievementPut(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      login?: unknown;
      achievements?: unknown;
    };
    const login = typeof body.login === 'string' ? body.login.trim() : '';
    if (!login || !Array.isArray(body.achievements)) {
      return internalJson({ ok: false, error: 'invalid_payload' }, 400);
    }

    this.sql.exec(
      `INSERT INTO achievement_cache (login, payload, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(login) DO UPDATE SET
         payload = excluded.payload,
         fetched_at = excluded.fetched_at`,
      login,
      JSON.stringify(body.achievements),
      Date.now(),
    );
    return internalJson({ ok: true });
  }

  private handleCleanup(): Response {
    this.sql.exec(
      `DELETE FROM last_hits WHERE last_at < ?`,
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    );
    return internalJson({ ok: true });
  }
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
    await getCounter(env).fetch(
      new Request('https://stats.internal/cleanup', { method: 'POST' }),
    );
  },
} satisfies ExportedHandler<Env>;