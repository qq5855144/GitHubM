// AI V2 — 图片 Blob 存储：消息里只保留缩略图，发送时按需回填
import { idbDelete, idbGet, idbSet } from './idbKv';

export const IMAGE_BLOB_PREFIX = 'attach_img:';
const CACHE_CHAR_LIMIT = 4 * 1024 * 1024;
let cachedChars = 0;
const dataUrlCache = new Map<string, string>();
let cacheGeneration = 0;

export function clearImageCache(): void {
  cacheGeneration++;
  dataUrlCache.clear();
  cachedChars = 0;
}

export async function putImageBlob(id: string, blob: Blob): Promise<boolean> {
  const saved = await idbSet(`${IMAGE_BLOB_PREFIX}${id}`, blob);
  if (!saved) forgetImage(id);
  return saved;
}

export async function getImageBlob(id: string): Promise<Blob | null> {
  const value = await idbGet<Blob>(`${IMAGE_BLOB_PREFIX}${id}`);
  return value instanceof Blob ? value : null;
}

function forgetImage(id: string): void {
  const cached = dataUrlCache.get(id);
  if (cached) cachedChars -= cached.length;
  dataUrlCache.delete(id);
}

export async function deleteImageBlob(id: string): Promise<void> {
  cacheGeneration++;
  forgetImage(id);
  await idbDelete(`${IMAGE_BLOB_PREFIX}${id}`);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

export async function loadImageDataUrl(id: string): Promise<string | undefined> {
  const cached = dataUrlCache.get(id);
  if (cached) {
    dataUrlCache.delete(id);
    dataUrlCache.set(id, cached);
    return cached;
  }
  const generation = cacheGeneration;
  const blob = await getImageBlob(id);
  if (!blob) return undefined;
  const dataUrl = await blobToDataUrl(blob);
  if (generation !== cacheGeneration) return dataUrl;
  if (dataUrl.length > CACHE_CHAR_LIMIT) return dataUrl;
  forgetImage(id);
  while (cachedChars + dataUrl.length > CACHE_CHAR_LIMIT) {
    const oldest = dataUrlCache.keys().next().value;
    if (!oldest) break;
    forgetImage(oldest);
  }
  dataUrlCache.set(id, dataUrl);
  cachedChars += dataUrl.length;
  return dataUrl;
}
