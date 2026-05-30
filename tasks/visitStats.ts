// 访问统计工具模块（联网版）
// 通过 Supabase Edge Function 上报访问日志，统计真实 PV/UV
// IP 在服务端做 SHA-256 哈希，不暴露明文，保护用户隐私

import { supabase } from '@/db/supabase';

const SESSION_KEY = 'visit_session_id'; // 会话 ID（本次打开浏览器期间唯一）
const LAST_VISIT_KEY = 'visit_last_path'; // 上一次记录的路径（用于去重节流）
const VISIT_DEBOUNCE_MS = 2000; // 同一页面最小记录间隔 2 秒（防止高频触发）

// ── 会话 ID（每次刷新页面不变，关闭后重置）────────────────────────────────
function getOrCreateSessionId(): string {
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return `s_${Math.random().toString(36).slice(2)}`;
  }
}

// ── 内部上报逻辑（带重试）──────────────────────────────────────────────────
async function doRecordVisit(path: string, referrer: string | null): Promise<void> {
  const sessionId = getOrCreateSessionId();

  // 第一次尝试
  try {
    await supabase.functions.invoke('visit-tracker', {
      method: 'POST',
      body: { page_path: path, session_id: sessionId, referrer },
    });
    return;
  } catch (e) {
    console.warn('[visitStats] 第一次上报失败，准备重试:', e);
  }

  // 重试一次（短暂延迟后）
  await new Promise(r => setTimeout(r, 500));
  try {
    await supabase.functions.invoke('visit-tracker', {
      method: 'POST',
      body: { page_path: path, session_id: sessionId, referrer },
    });
    return;
  } catch (e) {
    console.warn('[visitStats] 重试后仍失败:', e);
  }

  // 兜底：使用 sendBeacon（页面卸载时也能发，可靠性更高）
  try {
    const url = `${(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')}/functions/v1/visit-tracker`;
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob(
        [JSON.stringify({ page_path: path, session_id: sessionId, referrer })],
        { type: 'application/json' }
      );
      const ok = navigator.sendBeacon(url, blob);
      if (ok) return;
    }
  } catch {
    // sendBeacon 失败则彻底放弃
  }

  throw new Error('访问统计上报最终失败');
}

// ── 记录一次页面访问（上报到 Edge Function）────────────────────────────────
export async function recordVisit(pagePath?: string): Promise<void> {
  try {
    const path = pagePath ?? (typeof location !== 'undefined' ? location.hash.replace(/^#/, '') || '/' : '/');

    // 节流：同一页面 2 秒内重复触发则跳过（避免路由快速切换、刷新时重复记录）
    try {
      const last = sessionStorage.getItem(LAST_VISIT_KEY);
      if (last) {
        const [lastPath, lastTime] = last.split('|');
        if (lastPath === path && Date.now() - parseInt(lastTime, 10) < VISIT_DEBOUNCE_MS) {
          return; // 同一页面且间隔 < 2s，跳过
        }
      }
      sessionStorage.setItem(LAST_VISIT_KEY, `${path}|${Date.now()}`);
    } catch {
      // sessionStorage 不可用时忽略节流
    }

    const referrer = typeof document !== 'undefined' ? document.referrer || null : null;
    await doRecordVisit(path, referrer);
  } catch (e) {
    // 最终仍失败时仅 console.warn，不阻断业务
    console.warn('[visitStats] recordVisit 最终失败:', e);
  }
}

// ── 类型定义（供 SettingsPage 使用）──────────────────────────────────────────
export interface DailyStats {
  date:  string;   // YYYY-MM-DD
  label: string;   // M/D 格式
  pv:    number;
  uv:    number;
}

export interface VisitSummary {
  todayPv:    number;  // 今日 PV
  todayUv:    number;  // 今日 UV
  totalPv:    number;  // 近 N 天总 PV
  totalUv:    number;  // 近 N 天总 UV（按 IP 哈希去重）
  allTimePv:  number;  // 历史累计总 PV
  allTimeUv:  number;  // 历史累计总 UV
  activeDays: number;  // 有访问的天数
}

export interface VisitStatsResult {
  trend:   DailyStats[];
  summary: VisitSummary;
}

// ── 查询近 N 天统计数据（从 Edge Function 拉取）──────────────────────────────
export async function fetchVisitStats(days = 7): Promise<VisitStatsResult> {
  const { data, error } = await supabase.functions.invoke<VisitStatsResult>(
    `visit-tracker?action=stats&days=${days}`,
    { method: 'GET' }
  );

  if (error) {
    const msg = await error?.context?.text().catch(() => error?.message ?? '未知错误');
    console.error('[visitStats] fetchVisitStats 失败:', msg);
    throw new Error(msg ?? '获取访问统计失败');
  }

  if (!data) {
    console.error('[visitStats] fetchVisitStats 返回空数据');
    throw new Error('获取访问统计返回空数据');
  }

  return data;
}
