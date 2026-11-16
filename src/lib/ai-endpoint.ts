// 自定义接口地址规整：基础地址与完整 chat/completions 地址互相兼容
const CHAT_SUFFIX = /\/chat\/completions$/i;

/** 去掉末尾斜杠，返回基础地址（如 http://127.0.0.1:17890/v1） */
export function normalizeBaseEndpoint(endpoint?: string): string {
  const raw = (endpoint || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.replace(CHAT_SUFFIX, '');
}

/** 补全成 chat/completions 地址；已带该后缀则原样返回 */
export function normalizeChatEndpoint(endpoint?: string): string {
  const raw = (endpoint || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return CHAT_SUFFIX.test(raw) ? raw : `${raw}/chat/completions`;
}