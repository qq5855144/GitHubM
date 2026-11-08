/**
 * GitHub 个人成就
 *
 * GitHub 官方 REST / GraphQL API 目前都没有开放成就列表字段，
 * 因此 Android 原生层读取公开个人主页的成就徽章区域，
 * 再把解析好的徽章（官方图片地址、名称、等级、次数）回传给前端。
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
  achievements?: unknown;
  message?: string;
}

interface AndroidAchievementBridge {
  fetchProfileAchievements?: (login: string) => void;
}

const ACHIEVEMENT_EVENT = 'profileAchievementsLoaded';
const OFFICIAL_ICON_PREFIX = 'https://github.githubassets.com/';
const cache = new Map<string, ProfileAchievement[]>();
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

export function loadProfileAchievements(login: string, force = false): Promise<ProfileAchievement[]> {
  const key = login.trim().toLowerCase();
  if (!key) return Promise.resolve([]);
  if (!force && cache.has(key)) return Promise.resolve(cache.get(key) ?? []);
  if (!force && inflight.has(key)) return inflight.get(key) ?? Promise.resolve([]);

  const bridge = (window as unknown as { AndroidBridge?: AndroidAchievementBridge }).AndroidBridge;
  if (!bridge?.fetchProfileAchievements) return Promise.resolve([]);

  const request = new Promise<ProfileAchievement[]>((resolve) => {
    let settled = false;
    const finish = (items: ProfileAchievement[], success: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener(ACHIEVEMENT_EVENT, onResult as EventListener);
      window.clearTimeout(timer);
      inflight.delete(key);
      if (success) cache.set(key, items);
      resolve(items);
    };
    const onResult = (event: Event) => {
      const payload = (event as CustomEvent<AchievementPayload>).detail;
      if (!payload || payload.login?.trim().toLowerCase() !== key) return;
      const list = Array.isArray(payload.achievements)
        ? payload.achievements
            .map(normalizeAchievement)
            .filter((item): item is ProfileAchievement => item !== null)
        : [];
      finish(list, payload.success === true);
    };
    const timer = window.setTimeout(() => finish([], false), 15000);
    window.addEventListener(ACHIEVEMENT_EVENT, onResult as EventListener);
    try {
      bridge.fetchProfileAchievements?.(login.trim());
    } catch {
      finish([], false);
    }
  });

  inflight.set(key, request);
  return request;
}