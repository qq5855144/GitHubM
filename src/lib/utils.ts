import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 将 GitHub API 返回的 base64 内容解码为字符串，支持 UTF-8 / GBK / ISO-8859-1
 * 直接使用 atob() 会导致多字节 UTF-8 字符乱码，必须经由 Uint8Array + TextDecoder 解码。
 */
export function decodeBase64Content(b64: string): string {
  // 移除 GitHub API 响应中的换行符
  const raw = b64.replace(/\n/g, '');
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  } catch {
    return raw; // base64 解码失败则原样返回
  }
  // 1. UTF-8（最常用）
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { /* 继续 */ }
  // 2. GBK（中文 Windows 常用）
  try {
    return new TextDecoder('gbk', { fatal: true }).decode(bytes);
  } catch { /* 继续 */ }
  // 3. ISO-8859-1 兜底
  return new TextDecoder('iso-8859-1').decode(bytes);
}

export type Params = Partial<
  Record<keyof URLSearchParams, string | number | null | undefined>
>;

export function createQueryString(
  params: Params,
  searchParams: URLSearchParams
) {
  const newSearchParams = new URLSearchParams(searchParams?.toString());

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      newSearchParams.delete(key);
    } else {
      newSearchParams.set(key, String(value));
    }
  }

  return newSearchParams.toString();
}

export function formatDate(
  date: Date | string | number,
  opts: Intl.DateTimeFormatOptions = {}
) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: opts.month ?? "long",
    day: opts.day ?? "numeric",
    year: opts.year ?? "numeric",
    ...opts,
  }).format(new Date(date));
}

/**
 * 安全复制文本到剪贴板，兼容低版本 Android WebView（file:// 协议）。
 * navigator.clipboard API 在 file:// 下可能不可用或抛出异常，
 * 降级为 document.execCommand('copy')（广泛兼容 Android 4.4+）。
 * @returns Promise<boolean> true=成功，false=失败（调用方自行决定是否提示用户）
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 优先使用现代 Clipboard API
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 降级到 execCommand
    }
  }
  // 降级：创建临时 textarea + execCommand（兼容旧版 WebView）
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
