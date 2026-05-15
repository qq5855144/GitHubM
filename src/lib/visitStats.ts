// 访问统计工具模块（联网版）
// 通过 Supabase Edge Function 上报访问日志，统计真实 PV/UV
// IP 在服务端做 SHA-256 哈希，不暴露明文，保护用户隐私

import { supabase } from '@/db/supabase';

const SESSION_KEY = 'visit_session_id'; // 会话 ID（本次打开浏览器期间唯一）

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

// ── 记录一次页面访问（上报到 Edge Function）────────────────────────────────
export async function recordVisit(pagePath?: string): Promise<void> {
  try {
    const path = pagePath ?? (typeof location !== 'undefined' ? location.hash.replace(/^#/, '') || '/' : '/');
    const referrer = typeof document !== 'undefined' ? document.referrer || null : null;
    const sessionId = getOrCreateSessionId();

    await supabase.functions.invoke('visit-tracker', {
      method: 'POST',
      body: {
        page_path:  path,
        session_id: sessionId,
        referrer,
      },
    });
  } catch {
    // 上报失败静默忽略，不影响用户体验
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

  if (error || !data) {
    // 失败时返回空结构，避免页面崩溃
    const emptyTrend: DailyStats[] = Array.from({ length: days }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (days - 1 - i));
      const key = d.toISOString().slice(0, 10);
      return {
        date:  key,
        label: `${parseInt(key.slice(5, 7))}/${parseInt(key.slice(8, 10))}`,
        pv: 0,
        uv: 0,
      };
    });
    return {
      trend:   emptyTrend,
      summary: { todayPv: 0, todayUv: 0, totalPv: 0, totalUv: 0, allTimePv: 0, allTimeUv: 0, activeDays: 0 },
    };
  }

  return data;
}
