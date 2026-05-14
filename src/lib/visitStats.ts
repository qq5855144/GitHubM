// 访问统计工具模块
// 记录维度：PV（页面访问次数）、UV（独立访客）、按日期分组
// 数据存储在 localStorage，无需后端

const PV_KEY = 'visit_stats_pv';    // Record<dateStr, number>
const UV_KEY = 'visit_stats_uv_days'; // Record<dateStr, string[]>
const UID_KEY = 'visit_uid';         // 设备唯一标识

// ── 设备唯一标识 ────────────────────────────────────────────────────────────
function getOrCreateUid(): string {
  try {
    let uid = localStorage.getItem(UID_KEY);
    if (!uid) {
      uid = `uid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(UID_KEY, uid);
    }
    return uid;
  } catch {
    return 'uid_fallback';
  }
}

// ── 当前日期字符串 YYYY-MM-DD ────────────────────────────────────────────────
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── 读取 PV 记录 ────────────────────────────────────────────────────────────
function readPv(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PV_KEY) || '{}');
  } catch {
    return {};
  }
}

// ── 读取 UV 记录 ────────────────────────────────────────────────────────────
function readUvDays(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(UV_KEY) || '{}');
  } catch {
    return {};
  }
}

// ── 写 PV ────────────────────────────────────────────────────────────────────
function writePv(data: Record<string, number>) {
  try { localStorage.setItem(PV_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

// ── 写 UV ────────────────────────────────────────────────────────────────────
function writeUvDays(data: Record<string, string[]>) {
  try { localStorage.setItem(UV_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

// ── 记录一次页面访问 ─────────────────────────────────────────────────────────
export function recordVisit() {
  const date = today();
  const uid = getOrCreateUid();

  // PV
  const pv = readPv();
  pv[date] = (pv[date] ?? 0) + 1;
  writePv(pv);

  // UV（同一 uid 同一天只计一次）
  const uvDays = readUvDays();
  const set = new Set(uvDays[date] ?? []);
  set.add(uid);
  uvDays[date] = Array.from(set);
  writeUvDays(uvDays);
}

// ── 获取近 N 天统计数据 ──────────────────────────────────────────────────────
export interface DailyStats {
  date: string;      // YYYY-MM-DD
  label: string;     // M/D 格式
  pv: number;
  uv: number;
}

export function getRecentDays(n = 7): DailyStats[] {
  const pv = readPv();
  const uvDays = readUvDays();
  const result: DailyStats[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const [, month, day] = dateStr.split('-');
    result.push({
      date: dateStr,
      label: `${parseInt(month)}/${parseInt(day)}`,
      pv: pv[dateStr] ?? 0,
      uv: uvDays[dateStr]?.length ?? 0,
    });
  }
  return result;
}

// ── 汇总指标 ─────────────────────────────────────────────────────────────────
export interface VisitSummary {
  todayPv: number;      // 今日 PV
  totalPv: number;      // 总 PV
  activeDays: number;   // 有访问记录的天数
  totalUv: number;      // 总 UV（全局不去重同一 uid）
}

export function getVisitSummary(): VisitSummary {
  const pv = readPv();
  const uvDays = readUvDays();
  const date = today();
  const todayPv = pv[date] ?? 0;
  const totalPv = Object.values(pv).reduce((s, v) => s + v, 0);
  const activeDays = Object.keys(pv).filter(d => pv[d] > 0).length;
  // 全局 UV：所有天 uid 集合的并集大小
  const allUids = new Set<string>();
  Object.values(uvDays).forEach(uids => uids.forEach(u => allUids.add(u)));
  return { todayPv, totalPv, activeDays, totalUv: allUids.size };
}
