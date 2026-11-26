// 代码浏览页共享工具与移动端快捷栏组件。
import { getFileIconInfo } from '@/components/common/FileIcon';
import i18n from '@/i18n';

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      const CHUNK = 8192;
      let binary = '';
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      resolve(btoa(binary));
    };
    reader.onerror = () => reject(new Error(i18n.t('读取文件失败')));
    reader.readAsArrayBuffer(file);
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// 将 base64 文件内容转为 data URI 用于图片预览
export function base64ToDataUri(base64: string, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', ico: 'image/x-icon',
  };
  const mime = mimeMap[ext] || 'image/png';
  return `data:${mime};base64,${base64}`;
}

// 文件图标组件
export function FileItemIcon({ filename, isDir, isOpen = false, size = 'w-4 h-4' }: {
  filename: string;
  isDir: boolean;
  isOpen?: boolean;
  size?: string;
}) {
  const { Icon, color } = getFileIconInfo(filename, isDir, isOpen);
  return <Icon className={`${size} ${color} shrink-0`} />;
}

// ── 代码浏览页面内导航栈（sessionStorage，标签页级）────────────────────────
// 用于在点击面包屑时回溯 browser history，而非推入新条目（避免"返回"跳到错误位置）
export function codeNavKey(owner: string, repo: string) {
  return `code_nav_${owner}_${repo}`;
}
export function getCodeNavStack(owner: string, repo: string): string[] {
  try { return JSON.parse(sessionStorage.getItem(codeNavKey(owner, repo)) || '[]'); }
  catch { return []; }
}
export function setCodeNavStack(owner: string, repo: string, stack: string[]) {
  try { sessionStorage.setItem(codeNavKey(owner, repo), JSON.stringify(stack)); }
  catch { /* ignore */ }
}

// 编辑器符号面板。
export const EDITOR_QUICK_SYMBOLS: Array<{ label: string; value: string }> = [
  { label: 'Tab', value: '  ' },
  { label: '{', value: '{' },
  { label: '}', value: '}' },
  { label: '(', value: '(' },
  { label: ')', value: ')' },
  { label: '[', value: '[' },
  { label: ']', value: ']' },
  { label: '<', value: '<' },
  { label: '>', value: '>' },
  { label: ';', value: ';' },
  { label: ':', value: ':' },
  { label: '=', value: '=' },
  { label: '+', value: '+' },
  { label: '-', value: '-' },
  { label: '*', value: '*' },
  { label: '/', value: '/' },
  { label: '\\', value: '\\' },
  { label: "'", value: "'" },
  { label: '"', value: '"' },
  { label: '#', value: '#' },
  { label: '!', value: '!' },
  { label: '_', value: '_' },
  { label: '?', value: '?' },
  { label: '.', value: '.' },
  { label: ',', value: ',' },
  { label: '@', value: '@' },
  { label: '&', value: '&' },
  { label: '|', value: '|' },
  { label: '$', value: '$' },
  { label: '%', value: '%' },
];
