// AI V2 — 会话附件与 @ 仓库文件引用
import type { UiChatMessage, V2ContentPart } from './types';
import { loadImageDataUrl, putImageBlob } from './imageStore';

export interface UiAttachment {
  id: string;
  name: string;
  path?: string;
  source: 'local' | 'repo';
  kind?: 'text' | 'image';
  size: number;
  content: string;
  /** 发送给模型时使用；图片压缩后按需回填 */
  dataUrl?: string;
  /** 消息列表里展示的缩略图，避免整张大图常驻内存 */
  thumbDataUrl?: string;
  /** 压缩后的图片 Blob 存放于 IndexedDB */
  imageBlobId?: string;
  width?: number;
  height?: number;
}

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 200_000;
export const MAX_MODEL_ATTACHMENT_CHARS = 80_000;

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function buildModelUserContent(
  text: string,
  attachments: UiAttachment[],
  maxChars = MAX_MODEL_ATTACHMENT_CHARS,
): string {
  if (!attachments.length) return text;
  let remaining = Math.max(0, maxChars);
  const blocks: string[] = [];
  for (let index = 0; index < attachments.length; index++) {
    const attachment = attachments[index];
    if (attachment.kind === 'image') {
      blocks.push(`\n\n[图片附件] ${attachment.name}（图片内容已作为视觉输入发送）`);
      continue;
    }
    const label = attachment.path || attachment.name;
    const header = `\n\n[附件 ${index + 1}] ${label}（${formatFileSize(attachment.size)}${attachment.source === 'repo' ? '，来自当前仓库' : ''}）`;
    if (remaining <= 0) {
      blocks.push(`${header}\n…（附件总长度超出限制，未包含正文）`);
      continue;
    }
    const content = attachment.content.slice(0, remaining);
    blocks.push(`${header}\n~~~\n${content}${content.length < attachment.content.length ? '\n…（附件已截断）' : ''}\n~~~`);
    remaining -= content.length;
  }
  return `${text}${blocks.join('')}`;
}

export function buildModelUserParts(
  text: string,
  attachments: UiAttachment[],
  maxChars = MAX_MODEL_ATTACHMENT_CHARS,
): string | V2ContentPart[] {
  const images = attachments.filter(item => item.kind === 'image' && item.dataUrl);
  if (!images.length) return buildModelUserContent(text, attachments, maxChars);
  return [
    { type: 'text', text: buildModelUserContent(text, attachments.filter(item => item.kind !== 'image'), maxChars) },
    ...images.map((image): V2ContentPart => ({
      type: 'image_url',
      image_url: { url: image.dataUrl! },
    })),
  ];
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'env',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'css', 'scss', 'sass', 'less', 'html', 'htm',
  'xml', 'svg', 'vue', 'svelte', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'gradle',
  'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'sh', 'bash', 'zsh', 'sql', 'csv', 'log',
]);

export function isTextFilePath(path: string): boolean {
  const name = path.split('/').pop() || path;
  if (/^\.env/.test(name) || name === 'Dockerfile' || name === 'Makefile') return true;
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  return TEXT_EXTENSIONS.has(extension);
}

export function filterRepoFiles(paths: string[], query: string, limit = 80): string[] {
  const keyword = query.trim().toLowerCase();
  const filtered = keyword
    ? paths.filter(path => path.toLowerCase().includes(keyword))
    : paths;
  return filtered.slice(0, Math.max(1, limit));
}

export function makeAttachmentId(prefix = 'att'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 图片压缩：最长边 1600px，JPEG 质量 0.82，另存一张缩略图 */
export interface PreparedImage {
  blob: Blob;
  thumbDataUrl: string;
  width: number;
  height: number;
  size: number;
}

const MAX_IMAGE_EDGE = 1600;
const THUMB_EDGE = 256;
const IMAGE_QUALITY = 0.82;
const KEEP_ORIGINAL_BYTES = 400_000;

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('当前环境不支持图片压缩'));
      return;
    }
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('图片压缩失败'));
    }, type, quality);
  });
}

function drawScaled(source: HTMLImageElement, maxEdge: number): HTMLCanvasElement | null {
  const scale = Math.min(1, maxEdge / Math.max(source.naturalWidth, source.naturalHeight));
  const width = Math.max(1, Math.round(source.naturalWidth * scale));
  const height = Math.max(1, Math.round(source.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

export async function prepareImageAttachment(file: File): Promise<PreparedImage> {
  const image = await loadImageElement(file);
  try {
    const canvas = drawScaled(image, MAX_IMAGE_EDGE);
    if (!canvas) throw new Error('无法创建画布');
    const thumbCanvas = drawScaled(image, THUMB_EDGE);
    const thumbDataUrl = thumbCanvas ? thumbCanvas.toDataURL('image/jpeg', 0.6) : '';
    const compressed = Math.max(image.naturalWidth, image.naturalHeight) <= MAX_IMAGE_EDGE
      && file.size <= KEEP_ORIGINAL_BYTES;
    const blob = compressed ? file : await canvasToBlob(canvas, 'image/jpeg', IMAGE_QUALITY);
    return {
      blob,
      thumbDataUrl,
      width: canvas.width,
      height: canvas.height,
      size: blob.size,
    };
  } finally {
    if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
  }
}

/** 把图片 Blob 回填成 dataUrl（发送给模型前调用） */
export async function hydrateAttachmentImages(attachments: UiAttachment[]): Promise<UiAttachment[]> {
  let changed = false;
  const next: UiAttachment[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === 'image' && !attachment.dataUrl && attachment.imageBlobId) {
      const dataUrl = await loadImageDataUrl(attachment.imageBlobId);
      if (dataUrl) {
        next.push({ ...attachment, dataUrl });
        changed = true;
        continue;
      }
    }
    next.push(attachment);
  }
  return changed ? next : attachments;
}

/** 历史消息里的图片同样按需回填，避免整段历史常驻大图 */
export async function hydrateMessageImages(messages: UiChatMessage[]): Promise<UiChatMessage[]> {
  const next: UiChatMessage[] = [];
  let changed = false;
  for (const message of messages) {
    if (!message.attachments?.length) {
      next.push(message);
      continue;
    }
    const hydrated = await hydrateAttachmentImages(message.attachments);
    if (hydrated === message.attachments) {
      next.push(message);
      continue;
    }
    next.push({ ...message, attachments: hydrated });
    changed = true;
  }
  return changed ? next : messages;
}

export async function persistAttachmentBlobs(attachments: UiAttachment[]): Promise<UiAttachment[]> {
  const next: UiAttachment[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === 'image' && attachment.dataUrl && !attachment.imageBlobId) {
      try {
        const blob = await (await fetch(attachment.dataUrl)).blob();
        const saved = await putImageBlob(attachment.id, blob);
        next.push(saved ? { ...attachment, imageBlobId: attachment.id } : attachment);
        continue;
      } catch {
        next.push(attachment);
        continue;
      }
    }
    next.push(attachment);
  }
  return next;
}