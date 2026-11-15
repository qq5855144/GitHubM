// AI V2 — 图片 Blob 存储：消息里只保留缩略图，发送时按需回填
import { idbDelete, idbGet, idbSet } from './idbKv';

const PREFIX = 'attach_img:';
const CACHE_LIMIT = 6;
const dataUrlCache = new Map<string, string>();

export async function putImageBlob(id: string, blob: Blob): Promise<boolean> {
  const saved = await idbSet(`${PREFIX}${id}`, blob);
  if (!saved) dataUrlCache.delete(id);
  return saved;
}

export async function getImageBlob(id: string): Promise<Blob | null> {
  const value = await idbGet<Blob>(`${PREFIX}${id}`);
  return value instanceof Blob ? value : null;
}

export async function deleteImageBlob(id: string): Promise<void> {
  dataUrlCache.delete(id);
  await idbDelete(`${PREFIX}${id}`);
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
  if (cached) return cached;
  const blob = await getImageBlob(id);
  if (!blob) return undefined;
  const dataUrl = await blobToDataUrl(blob);
  if (dataUrlCache.size >= CACHE_LIMIT) {
    const oldest = dataUrlCache.keys().next().value;
    if (oldest) dataUrlCache.delete(oldest);
  }
  dataUrlCache.set(id, dataUrl);
  return dataUrl;
}
