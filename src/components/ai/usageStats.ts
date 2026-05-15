// AI 用量统计本地存储工具
// 数据存于 localStorage key: ai_usage_stats
// 结构：每条记录含平台、模型、token 用量和时间戳
// 自动清理 30 天前记录

import { calcCostUsd } from './modelPricing';

export interface UsageRecord {
  id: string;           // 唯一 ID
  providerType: string; // 平台类型（deepseek/gemini/qwen/groq/openai/custom）
  model: string;        // 模型名
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: number;    // ms since epoch
}

/** 按模型细分的统计 */
export interface ModelStats {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  requestCount: number;
}

export interface ProviderStats {
  providerType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 估算总费用（USD） */
  costUsd: number;
  requestCount: number;
  lastUsed: number;
  /** 按模型细分 */
  modelBreakdown: ModelStats[];
}

const STORAGE_KEY = 'ai_usage_stats';
const RETENTION_DAYS = 30;

function loadAll(): UsageRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(records: UsageRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // localStorage 已满时静默失败
  }
}

/** 清理 30 天前的记录 */
function prune(records: UsageRecord[]): UsageRecord[] {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return records.filter(r => r.timestamp >= cutoff);
}

/** 写入一条用量记录 */
export function appendUsageRecord(
  providerType: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  totalTokens: number,
) {
  const all = prune(loadAll());
  const record: UsageRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    providerType,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    timestamp: Date.now(),
  };
  all.push(record);
  saveAll(all);
}

/** 获取近 30 天按平台分组的汇总统计（含费用估算 + 按模型细分） */
export function getProviderStats(): ProviderStats[] {
  const all = prune(loadAll());

  // provider 级汇总 map
  const providerMap = new Map<string, ProviderStats>();
  // model 级汇总 map：key = `${providerType}::${model}`
  const modelMap = new Map<string, ModelStats>();

  for (const r of all) {
    // 计算本条记录的费用
    const { costUsd } = calcCostUsd(r.providerType, r.model, r.promptTokens, r.completionTokens);

    // ── provider 级 ──
    let ps = providerMap.get(r.providerType);
    if (!ps) {
      ps = {
        providerType: r.providerType,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        requestCount: 0,
        lastUsed: 0,
        modelBreakdown: [],
      };
      providerMap.set(r.providerType, ps);
    }
    ps.promptTokens += r.promptTokens;
    ps.completionTokens += r.completionTokens;
    ps.totalTokens += r.totalTokens;
    ps.costUsd += costUsd;
    ps.requestCount += 1;
    if (r.timestamp > ps.lastUsed) ps.lastUsed = r.timestamp;

    // ── model 级 ──
    const mKey = `${r.providerType}::${r.model}`;
    let ms = modelMap.get(mKey);
    if (!ms) {
      ms = { model: r.model, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, requestCount: 0 };
      modelMap.set(mKey, ms);
    }
    ms.promptTokens += r.promptTokens;
    ms.completionTokens += r.completionTokens;
    ms.totalTokens += r.totalTokens;
    ms.costUsd += costUsd;
    ms.requestCount += 1;
  }

  // 将 model 细分挂入 provider
  for (const [mKey, ms] of modelMap) {
    const providerType = mKey.split('::')[0];
    const ps = providerMap.get(providerType);
    if (ps) ps.modelBreakdown.push(ms);
  }
  // model breakdown 按费用降序
  for (const ps of providerMap.values()) {
    ps.modelBreakdown.sort((a, b) => b.costUsd - a.costUsd);
  }

  return Array.from(providerMap.values()).sort((a, b) => b.lastUsed - a.lastUsed);
}

/** 获取近 30 天总记录数 */
export function getTotalRequestCount(): number {
  return prune(loadAll()).length;
}

/** 清空所有用量记录 */
export function clearAllUsage() {
  localStorage.removeItem(STORAGE_KEY);
}
