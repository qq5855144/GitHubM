/**
 * GitHub 个人成就
 *
 * GitHub 官方 REST / GraphQL API 没有开放成就列表字段。
 * 优先通过 GitHubM Stats Worker 代理读取并缓存，Worker 不可用时回退到
 * Android 原生抓取；本地再用 localStorage 做持久化缓存。
 */

export interface ProfileAchievement {
  slug: string;
  name: string;
  iconUrl: string;
  tier: string | null;
  count: number | null;
}

interface AchievementPayload {
  login?: string;
  success?: boolean;
  ok?: boolean;
  achievements?: unknown;
  message?: string;
}

interface RemoteCache {
  savedAt: string;
  achievements: ProfileAchievement[];
}

interface AndroidAchievementBridge {
  fetchProfileAchievements?: (login: string) => void;
}

const ACHIEVEMENT_EVENT = 'profileAchievementsLoaded';
const OFFICIAL_ICON_PREFIX = 'https://github.githubassets.com/';
const LOCAL_CACHE_PREFIX = 'github_achievements_cache_v1:';
const STATS_API_URL = (import.meta.env.VITE_STATS_API_URL || '').trim().replace(/\/+$/, '');
const memoryCache = new Map<string, ProfileAchievement[]>();
const inflight = new Map<string, Promise<ProfileAchievement[]>>();

function normalizeAchievement(value: unknown): ProfileAchievement | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.slug !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.iconUrl !== 'string' ||
    !item.iconUrl.startsWith(OFFICIAL_ICON_PREFIX)
  ) {
    return null;
  }
  const countValue = typeof item.count === 'number' ? item.count : Number(item.count);
  return {
    slug: item.slug,
    name: item.name,
    iconUrl: item.iconUrl,
    tier: typeof item.tier === 'string' && item.tier ? item.tier : null,
    count: Number.isFinite(countValue) && countValue > 0 ? countValue : null,
  };
}

function normalizeList(value: unknown): ProfileAchievement[] {
  return Array.isArray(value)
    ? value.map(normalizeAchievement).filter((item): item is ProfileAchievement => item !== null)
    : [];
}

function readLocalCache(key: string): ProfileAchievement[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_CACHE_PREFIX}${key}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<RemoteCache>;
    return normalizeList(parsed.achievements);
  } catch {
    return [];
  }
}

function writeLocalCache(key: string, achievements: ProfileAchievement[]): void {
  if (achievements.length === 0) return;
  try {
    localStorage.setItem(
      `${LOCAL_CACHE_PREFIX}${key}`,
      JSON.stringify({ savedAt: new Date().toISOString(), achievements }),
    );
  } catch {
    // ignore storage failures
  }
}

export function getCachedProfileAchievements(login: string): ProfileAchievement[] {
  const key = login.trim().toLowerCase();
  if (!key) return [];
  return memoryCache.get(key) ?? readLocalCache(key);
}

async function fetchRemoteAchievements(
  login: string,
  token: string,
): Promise<ProfileAchievement[] | null> {
  if (!STATS_API_URL) return null;
  const response = await fetch(
    `${STATS_API_URL}/v1/achievements?login=${encodeURIComponent(login)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      credentials: 'omit',
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as AchievementPayload;
  if (payload.ok !== true && payload.success !== true) return null;
  return normalizeList(payload.achievements);
}

function fetchNativeAchievements(login: string): Promise<ProfileAchievement[]> {
  const bridge = (window as unknown as { AndroidBridge?: AndroidAchievementBridge }).AndroidBridge;
  if (!bridge?.fetchProfileAchievements) return Promise.resolve([]);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (items: ProfileAchievement[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(ACHIEVEMENT_EVENT, onResult as EventListener);
      window.clearTimeout(timer);
      resolve(items);
    };
    const onResult = (event: Event) => {
      const payload = (event as CustomEvent<AchievementPayload>).detail;
      if (!payload || payload.login?.trim().toLowerCase() !== login.trim().toLowerCase()) return;
      finish(payload.success === true ? normalizeList(payload.achievements) : []);
    };
    const timer = window.setTimeout(() => finish([]), 8000);
    window.addEventListener(ACHIEVEMENT_EVENT, onResult as EventListener);
    try {
      bridge.fetchProfileAchievements?.(login.trim());
    } catch {
      finish([]);
    }
  });
}

export function loadProfileAchievements(
  login: string,
  token?: string | null,
  force = false,
): Promise<ProfileAchievement[]> {
  const normalizedLogin = login.trim();
  const key = normalizedLogin.toLowerCase();
  if (!key) return Promise.resolve([]);

  const cached = getCachedProfileAchievements(normalizedLogin);
  if (!force && cached.length > 0) return Promise.resolve(cached);
  if (!force && inflight.has(key)) return inflight.get(key) ?? Promise.resolve([]);

  const request = (async () => {
    let items: ProfileAchievement[] | null = null;

    if (token && STATS_API_URL) {
      try {
        items = await fetchRemoteAchievements(normalizedLogin, token);
      } catch {
        // Worker 不可用时回退原生抓取。
      }
    }

    if (!items || items.length === 0) {
      const nativeItems = await fetchNativeAchievements(normalizedLogin);
      if (nativeItems.length > 0) items = nativeItems;
    }

    if (items && items.length > 0) {
      memoryCache.set(key, items);
      writeLocalCache(key, items);
      return items;
    }
    return cached;
  })();

  inflight.set(key, request);
  request.finally(() => inflight.delete(key));
  return request;
}