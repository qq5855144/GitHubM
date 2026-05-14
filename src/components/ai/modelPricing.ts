/**
 * AI 模型官方定价表
 * 单位：USD / 1M tokens
 * 数据来源：各平台官网定价页，最后更新：2025-05
 *
 * CNY 定价（通义千问 DashScope）按 1 USD = 7.2 CNY 换算为 USD
 * 标注 isEstimated=true 的条目为估算（无精确模型定价时按 provider 兜底价）
 */

export interface ModelPrice {
  /** 输入 Token 单价（USD / 1M tokens） */
  inputPer1M: number;
  /** 输出 Token 单价（USD / 1M tokens） */
  outputPer1M: number;
  /** 是否免费（免费额度内） */
  isFree?: boolean;
  /** 是否为估算/兜底价（非官方精确值） */
  isEstimated?: boolean;
  /** 原始货币（USD/CNY 等） */
  currency?: string;
  /** 定价来源链接 */
  sourceUrl?: string;
  /** 备注（如「免费额度每分钟 15 次」） */
  note?: string;
}

// ── 定价来源 URL ─────────────────────────────────────────────────────────────
const SOURCES = {
  deepseek: 'https://platform.deepseek.com/docs/api/pricing',
  gemini:   'https://ai.google.dev/pricing',
  qwen:     'https://help.aliyun.com/zh/model-studio/developer-reference/tongyi-qianwen-7b-14b-72b-api',
  groq:     'https://console.groq.com/settings/billing',
  openai:   'https://openai.com/api/pricing',
  wenxin:   'https://cloud.baidu.com/doc/WENXINWORKSHOP/s/Blfmc9dlf',
} as const;

// ── 各平台精确定价（按模型 ID 精确匹配） ────────────────────────────────────
const MODEL_PRICES: Record<string, ModelPrice> = {

  // ── DeepSeek ──────────────────────────────────────────────────────────────
  // https://platform.deepseek.com/docs/api/pricing（2025-05）
  'deepseek-chat': {
    inputPer1M: 0.27,
    outputPer1M: 1.10,
    sourceUrl: SOURCES.deepseek,
    note: '缓存命中输入价格 $0.07/M',
  },
  'deepseek-coder': {
    inputPer1M: 0.27,
    outputPer1M: 1.10,
    sourceUrl: SOURCES.deepseek,
    note: '与 deepseek-chat 同价',
  },
  'deepseek-reasoner': {
    inputPer1M: 0.55,
    outputPer1M: 2.19,
    sourceUrl: SOURCES.deepseek,
    note: 'R1 推理模型，含 Chain-of-Thought 输出',
  },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  // https://ai.google.dev/pricing（2025-05）
  // 注：Google AI Studio 提供免费额度；以下为超额计费价格
  'gemini-2.5-flash-preview-05-20': {
    inputPer1M: 0.15,
    outputPer1M: 0.60,
    sourceUrl: SOURCES.gemini,
    note: '含免费额度（RPM 15）；思考输出按 $3.50/M 计',
    isFree: true,
  },
  'gemini-2.5-flash-preview-04-17': {
    inputPer1M: 0.15,
    outputPer1M: 0.60,
    sourceUrl: SOURCES.gemini,
    isFree: true,
  },
  'gemini-2.5-pro-preview-05-06': {
    inputPer1M: 1.25,
    outputPer1M: 10.00,
    sourceUrl: SOURCES.gemini,
    note: '≤200K token 输入单价；>200K 为 $2.50/M',
    isFree: true,
  },
  'gemini-2.5-pro-preview-03-25': {
    inputPer1M: 1.25,
    outputPer1M: 10.00,
    sourceUrl: SOURCES.gemini,
    isFree: true,
  },
  'gemini-2.0-flash': {
    inputPer1M: 0.10,
    outputPer1M: 0.40,
    sourceUrl: SOURCES.gemini,
    isFree: true,
  },
  'gemini-1.5-flash': {
    inputPer1M: 0.075,
    outputPer1M: 0.30,
    sourceUrl: SOURCES.gemini,
    isFree: true,
  },
  'gemini-1.5-pro': {
    inputPer1M: 1.25,
    outputPer1M: 5.00,
    sourceUrl: SOURCES.gemini,
    isFree: true,
  },

  // ── Qwen（通义千问 DashScope）────────────────────────────────────────────
  // 官网 CNY 价格 ÷ 7.2 换算为 USD（2025-05）
  // https://help.aliyun.com/zh/model-studio/developer-reference/
  'qwen2.5-coder-32b-instruct': {
    inputPer1M: 2.00 / 7.2,        // ¥2.00/M → ~$0.278/M
    outputPer1M: 6.00 / 7.2,       // ¥6.00/M → ~$0.833/M
    currency: 'CNY',
    sourceUrl: SOURCES.qwen,
    note: '原价 ¥2.00/¥6.00 per 1M tokens，按 1 USD=7.2 CNY 换算',
  },
  'qwen2.5-coder-7b-instruct': {
    inputPer1M: 0.50 / 7.2,        // ¥0.50/M → ~$0.069/M
    outputPer1M: 2.00 / 7.2,       // ¥2.00/M → ~$0.278/M
    currency: 'CNY',
    sourceUrl: SOURCES.qwen,
    note: '原价 ¥0.50/¥2.00 per 1M tokens',
  },
  'qwen-plus': {
    inputPer1M: 0.80 / 7.2,        // ¥0.80/M → ~$0.111/M
    outputPer1M: 2.00 / 7.2,       // ¥2.00/M → ~$0.278/M
    currency: 'CNY',
    sourceUrl: SOURCES.qwen,
    note: '原价 ¥0.80/¥2.00 per 1M tokens',
  },
  'qwen-turbo': {
    inputPer1M: 0.30 / 7.2,        // ¥0.30/M → ~$0.042/M
    outputPer1M: 0.60 / 7.2,       // ¥0.60/M → ~$0.083/M
    currency: 'CNY',
    sourceUrl: SOURCES.qwen,
    note: '原价 ¥0.30/¥0.60 per 1M tokens',
  },
  'qwen-max': {
    inputPer1M: 2.40 / 7.2,        // ¥2.40/M → ~$0.333/M
    outputPer1M: 9.60 / 7.2,       // ¥9.60/M → ~$1.333/M
    currency: 'CNY',
    sourceUrl: SOURCES.qwen,
    note: '原价 ¥2.40/¥9.60 per 1M tokens',
  },

  // ── Groq ─────────────────────────────────────────────────────────────────
  // https://console.groq.com/settings/billing（2025-05）
  'llama-3.3-70b-versatile': {
    inputPer1M: 0.59,
    outputPer1M: 0.79,
    sourceUrl: SOURCES.groq,
    isFree: true,
    note: '含免费额度（每日 1000 次）',
  },
  'llama-3.1-70b-versatile': {
    inputPer1M: 0.59,
    outputPer1M: 0.79,
    sourceUrl: SOURCES.groq,
    isFree: true,
  },
  'llama-3.1-8b-instant': {
    inputPer1M: 0.05,
    outputPer1M: 0.08,
    sourceUrl: SOURCES.groq,
    isFree: true,
  },
  'mixtral-8x7b-32768': {
    inputPer1M: 0.24,
    outputPer1M: 0.24,
    sourceUrl: SOURCES.groq,
    isFree: true,
  },
  'gemma2-9b-it': {
    inputPer1M: 0.20,
    outputPer1M: 0.20,
    sourceUrl: SOURCES.groq,
    isFree: true,
  },

  // ── OpenAI ────────────────────────────────────────────────────────────────
  // https://openai.com/api/pricing（2025-05）
  'gpt-4o': {
    inputPer1M: 2.50,
    outputPer1M: 10.00,
    sourceUrl: SOURCES.openai,
  },
  'gpt-4o-mini': {
    inputPer1M: 0.15,
    outputPer1M: 0.60,
    sourceUrl: SOURCES.openai,
  },
  'gpt-4-turbo': {
    inputPer1M: 10.00,
    outputPer1M: 30.00,
    sourceUrl: SOURCES.openai,
  },
  'gpt-4': {
    inputPer1M: 30.00,
    outputPer1M: 60.00,
    sourceUrl: SOURCES.openai,
  },
  'gpt-3.5-turbo': {
    inputPer1M: 0.50,
    outputPer1M: 1.50,
    sourceUrl: SOURCES.openai,
  },
  'o1': {
    inputPer1M: 15.00,
    outputPer1M: 60.00,
    sourceUrl: SOURCES.openai,
  },
  'o1-mini': {
    inputPer1M: 3.00,
    outputPer1M: 12.00,
    sourceUrl: SOURCES.openai,
  },
  'o3-mini': {
    inputPer1M: 1.10,
    outputPer1M: 4.40,
    sourceUrl: SOURCES.openai,
  },
};

// ── Provider 级兜底价（模型 ID 未命中时使用） ──────────────────────────────
const PROVIDER_FALLBACK: Record<string, ModelPrice> = {
  deepseek: {
    inputPer1M: 0.27,
    outputPer1M: 1.10,
    isEstimated: true,
    sourceUrl: SOURCES.deepseek,
    note: '未知模型，按 deepseek-chat 估算',
  },
  gemini: {
    inputPer1M: 0.10,
    outputPer1M: 0.40,
    isEstimated: true,
    isFree: true,
    sourceUrl: SOURCES.gemini,
    note: '未知 Gemini 模型，按 gemini-2.0-flash 估算',
  },
  qwen: {
    inputPer1M: 0.50 / 7.2,
    outputPer1M: 2.00 / 7.2,
    isEstimated: true,
    currency: 'CNY',
    sourceUrl: SOURCES.qwen,
    note: '未知通义模型，按 qwen2.5-coder-7b 估算',
  },
  groq: {
    inputPer1M: 0.40,
    outputPer1M: 0.60,
    isEstimated: true,
    isFree: true,
    sourceUrl: SOURCES.groq,
    note: '未知 Groq 模型，按均价估算',
  },
  openai: {
    inputPer1M: 0.15,
    outputPer1M: 0.60,
    isEstimated: true,
    sourceUrl: SOURCES.openai,
    note: '未知 OpenAI 模型，按 gpt-4o-mini 估算',
  },
  wenxin: {
    inputPer1M: 0,
    outputPer1M: 0,
    isFree: true,
    sourceUrl: SOURCES.wenxin,
    note: '平台内置，免费使用',
  },
  custom: {
    inputPer1M: 0,
    outputPer1M: 0,
    isEstimated: true,
    note: '自定义接口，无法自动估算费用',
  },
};

/**
 * 获取指定平台+模型的定价
 * 优先精确匹配 model ID，未命中时使用 provider 兜底价
 */
export function getModelPrice(providerType: string, model: string): ModelPrice {
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  const fallback = PROVIDER_FALLBACK[providerType];
  if (fallback) return fallback;
  // 完全未知：按 $0 处理，标注估算
  return { inputPer1M: 0, outputPer1M: 0, isEstimated: true, note: '未知平台，无法估算费用' };
}

/**
 * 计算一条记录的估算费用（USD）
 * promptTokens / 1_000_000 * inputPer1M + completionTokens / 1_000_000 * outputPer1M
 */
export function calcCostUsd(
  providerType: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): { costUsd: number; price: ModelPrice } {
  const price = getModelPrice(providerType, model);
  const costUsd =
    (promptTokens / 1_000_000) * price.inputPer1M +
    (completionTokens / 1_000_000) * price.outputPer1M;
  return { costUsd, price };
}

/** 格式化费用展示（< $0.000001 显示 "< $0.000001"，其余保留 6 位有效数字） */
export function formatCostUsd(costUsd: number): string {
  if (costUsd === 0) return '$0.00';
  if (costUsd < 0.000001) return '< $0.000001';
  if (costUsd < 0.001) return `$${costUsd.toFixed(6)}`;
  if (costUsd < 1) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(2)}`;
}

export { SOURCES };
