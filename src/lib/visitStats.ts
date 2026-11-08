// 访问统计：全网统一访问量 + 本机访问量兜底
// 全网数据由 Cloudflare Worker + D1 提供。

const STORE_KEY = 'visit_stats_local';
const LAST_VISIT_KEY = 'visit_last_path';
const VISIT_DEBOUNCE_MS = 2000;

const REMOTE_CACHE_KEY = 'visit_stats_global_cache_v2';
const REMOTE_LAST_KEY = 'visit_global_last_v2';
const REMOTE_RATE_WINDOW_MS = 30 * 60 * 1000;

const STATS_API_URL = (import.meta.env.VITE_STATS_API_URL || '').trim().replace(/\/+$/, '');

interface VisitDayRecord {
  pv: number;
  paths: Record<string, number>;
}

interface VisitStore {
  deviceId: string;
  days: Record<string, VisitDayRecord>;
}

interface GlobalSummaryPayload {
  generatedAt?: string;
  today?: { visits?: number };
  period?: { days?: number; visits?: number; activeDays?: number };
  total?: { visits?: number; activeDays?: number };
  days?: Array<{ date?: string; visits?: number }>;
}

interface GlobalCache {
  savedAt: string;
  days: number;
  trend: DailyStats[];
  summary: VisitSummary;
}

export interface DailyStats {
  date: string;
  label: string;
  visits: number;
}

export interface VisitSummary {
  todayVisits: number;
  periodVisits: number;
  allTimeVisits: number;
  activeDays: number;
}

export type VisitStatsSource = 'global' | 'global-cache' | 'local';

export interface VisitStatsResult {
  trend: DailyStats[];
  summary: VisitSummary;
  source: VisitStatsSource;
  updatedAt?: string;
}

function loadStore(): VisitStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VisitStore>;
      if (parsed && typeof parsed === 'object') {
        return {
          deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : genDeviceId(),
          days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
        };
      }
    }
  } catch { /* ignore */ }
  return { deviceId: genDeviceId(), days: {} };
}

function genDeviceId(): string {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function saveStore(store: VisitStore): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch { /* ignore */ }
}

function todayKey(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function toCount(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function labelForDate(date: string): string {
  const [, month, day] = date.split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

// ── 本机访问记录 ─────────────────────────────────────────────────────────
export async function recordVisit(pagePath?: string): Promise<void> {
  try {
    const path = pagePath ?? (typeof location !== 'undefined' ? location.pathname || '/' : '/');

    try {
      const last = sessionStorage.getItem(LAST_VISIT_KEY);
      if (last) {
        const [lastPath, lastTime] = last.split('|');
        if (lastPath === path && Date.now() - parseInt(lastTime, 10) < VISIT_DEBOUNCE_MS) {
          return;
        }
      }
      sessionStorage.setItem(LAST_VISIT_KEY, `${path}|${Date.now()}`);
    } catch {
      // sessionStorage 不可用时忽略节流
    }

    const store = loadStore();
    const key = todayKey();
    const day = store.days[key] ?? { pv: 0, paths: {} };
    day.pv += 1;
    day.paths[path] = (day.paths[path] ?? 0) + 1;
    store.days[key] = day;
    saveStore(store);
  } catch (error) {
    console.warn('[visitStats] recordVisit 失败:', error);
  }
}

// ── 全网访问上报 ─────────────────────────────────────────────────────────
export async function recordGlobalVisit(token?: string | null): Promise<void> {
  if (!token || !STATS_API_URL) return;

  const stamp = Date.now();
  try {
    const last = Number(sessionStorage.getItem(REMOTE_LAST_KEY) || 0);
    if (Number.isFinite(last) && stamp - last < REMOTE_RATE_WINDOW_MS) return;
    sessionStorage.setItem(REMOTE_LAST_KEY, String(stamp));
  } catch {
    // sessionStorage 不可用时依赖服务端 30 分钟去重
  }

  try {
    const response = await fetch(`${STATS_API_URL}/v1/hit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: 'omit',
      keepalive: true,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    // 上报失败时不阻塞界面；移除本地节流，下一次路由变化可重试。
    try {
      if (sessionStorage.getItem(REMOTE_LAST_KEY) === String(stamp)) {
        sessionStorage.removeItem(REMOTE_LAST_KEY);
      }
    } catch { /* ignore */ }
  }
}

// ── 全网统计读取 ─────────────────────────────────────────────────────────
function readGlobalCache(): GlobalCache | null {
  try {
    const raw = localStorage.getItem(REMOTE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GlobalCache>;
    if (
      !parsed ||
      typeof parsed.savedAt !== 'string' ||
      typeof parsed.days !== 'number' ||
      !Array.isArray(parsed.trend) ||
      !parsed.summary
    ) {
      return null;
    }
    return parsed as GlobalCache;
  } catch {
    return null;
  }
}

function writeGlobalCache(days: number, trend: DailyStats[], summary: VisitSummary, updatedAt: string): void {
  try {
    localStorage.setItem(
      REMOTE_CACHE_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), days, trend, summary, updatedAt }),
    );
  } catch { /* ignore */ }
}

async function fetchGlobalVisitStats(token: string, days: number): Promise<VisitStatsResult> {
  const response = await fetch(`${STATS_API_URL}/v1/summary?days=${days}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    credentials: 'omit',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const payload = (await response.json()) as GlobalSummaryPayload;
  const trend = (payload.days ?? [])
    .filter((item): item is { date: string; visits?: number } => typeof item?.date === 'string')
    .map((item) => ({
      date: item.date,
      label: labelForDate(item.date),
      visits: toCount(item.visits),
    }));

  const summary: VisitSummary = {
    todayVisits: toCount(payload.today?.visits),
    periodVisits: toCount(payload.period?.visits),
    allTimeVisits: toCount(payload.total?.visits),
    activeDays: toCount(payload.total?.activeDays),
  };
  const updatedAt = payload.generatedAt || new Date().toISOString();
  writeGlobalCache(days, trend, summary, updatedAt);

  return { trend, summary, source: 'global', updatedAt };
}

// ── 本机统计读取 ─────────────────────────────────────────────────────────
function fetchLocalVisitStats(days: number): VisitStatsResult {
  const store = loadStore();
  const today = new Date();
  const trend: DailyStats[] = [];
  let periodVisits = 0;
  let allTimeVisits = 0;
  let activeDays = 0;

  for (const day of Object.values(store.days)) {
    allTimeVisits += day.pv;
    if (day.pv > 0) activeDays += 1;
  }

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const visits = store.days[key]?.pv ?? 0;
    periodVisits += visits;
    trend.push({
      date: key,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      visits,
    });
  }

  const todayVisits = store.days[todayKey()]?.pv ?? 0;

  return {
    trend,
    summary: {
      todayVisits,
      periodVisits,
      allTimeVisits,
      activeDays,
    },
    source: 'local',
  };
}

// ── 对外读取入口 ─────────────────────────────────────────────────────────
export async function fetchVisitStats(days = 7, token?: string | null): Promise<VisitStatsResult> {
  const local = fetchLocalVisitStats(days);
  if (!token || !STATS_API_URL) return local;

  try {
    return await fetchGlobalVisitStats(token, days);
  } catch (error) {
    console.warn('[visitStats] 全网统计读取失败，使用缓存或本地数据:', error);
    const cached = readGlobalCache();
    if (cached && cached.days === days) {
      return {
        trend: cached.trend,
        summary: cached.summary,
        source: 'global-cache',
        updatedAt: cached.savedAt,
      };
    }
    return local;
  }
}