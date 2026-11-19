// Release / Artifacts 产物图标：按产物类型（而不是单纯扩展名）给更形象的图标与配色。
// 与 common/FileIcon 的区别：这里面向“分发包”语义，例如 .apk 是安卓安装包、
// .dmg/.exe/.msi 是桌面安装包、.aab 是上架包、.sha256 是校验文件。
import {
  FileArchive,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileVideo,
  FileAudio,
  FileBadge,
  Package,
  Smartphone,
  Apple,
  Monitor,
  Terminal,
  Cpu,
  ShieldCheck,
  Hash,
  Database,
  File,
  type LucideIcon,
} from 'lucide-react';

export interface AssetIconInfo {
  Icon: LucideIcon;
  /** tailwind 文本色，用于图标着色 */
  color: string;
  /** 语义标签，用于 tooltip / 读屏 */
  label: string;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** 组合扩展名，例如 tar.gz / zip.001 需要整体判断 */
export function compoundExt(name: string): string {
  const lower = name.toLowerCase();
  const pairs = [
    'tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst', 'tar.lz4',
    'appimage', 'dmg', 'msi', 'msix', 'exe', 'pkg', 'deb', 'rpm', 'snap', 'flatpak',
    'apk', 'aab', 'ipa', 'aar',
  ];
  for (const p of pairs) {
    if (lower.endsWith(`.${p}`)) return p;
  }
  return extOf(name);
}

/**
 * 根据文件名推断产物类型图标。
 * 优先匹配“分发形态”，再回落到内容类型（图片/文档/归档/校验）。
 */
export function getAssetIcon(name: string): AssetIconInfo {
  const ext = compoundExt(name);
  const lower = name.toLowerCase();

  switch (ext) {
    // —— 移动端 ——
    case 'apk':
      return { Icon: Smartphone, color: 'text-emerald-400', label: 'Android 安装包' };
    case 'aab':
      return { Icon: Package, color: 'text-emerald-500', label: 'Android App Bundle' };
    case 'aar':
      return { Icon: Package, color: 'text-emerald-600', label: 'Android Library' };
    case 'ipa':
      return { Icon: Apple, color: 'text-zinc-300', label: 'iOS 安装包' };

    // —— 桌面端 ——
    case 'exe': case 'msi': case 'msix':
      return { Icon: Monitor, color: 'text-sky-400', label: 'Windows 安装包' };
    case 'dmg': case 'pkg':
      return { Icon: Apple, color: 'text-zinc-300', label: 'macOS 安装包' };
    case 'deb': case 'rpm': case 'snap': case 'flatpak':
      return { Icon: Terminal, color: 'text-orange-400', label: 'Linux 安装包' };
    case 'appimage':
      return { Icon: Cpu, color: 'text-orange-300', label: 'AppImage' };

    // —— 归档 / 源码包 ——
    case 'zip': case '7z': case 'rar': case 'tar':
    case 'tar.gz': case 'tar.bz2': case 'tar.xz': case 'tar.zst': case 'tar.lz4':
    case 'tgz': case 'gz': case 'bz2': case 'xz': case 'zst': case 'lz4':
      return { Icon: FileArchive, color: 'text-yellow-500', label: '压缩包' };

    // —— 校验 / 签名 ——
    case 'sha256': case 'sha1': case 'sha512': case 'md5': case 'sum':
      return { Icon: Hash, color: 'text-teal-400', label: '校验文件' };
    case 'sig': case 'asc': case 'pem': case 'crt': case 'cer':
      return { Icon: ShieldCheck, color: 'text-teal-300', label: '签名文件' };

    // —— 镜像 / 数据库 ——
    case 'iso': case 'img': case 'qcow2': case 'vhd': case 'vhdx':
      return { Icon: Database, color: 'text-indigo-400', label: '镜像文件' };

    // —— 内容类型 ——
    case 'json': case 'jsonc':
      return { Icon: FileJson, color: 'text-yellow-400', label: 'JSON 数据' };
    case 'md': case 'mdx': case 'txt': case 'pdf': case 'csv': case 'log':
    case 'doc': case 'docx': case 'xls': case 'xlsx': case 'ppt': case 'pptx':
      return { Icon: FileText, color: 'text-blue-300', label: '文档' };
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'svg': case 'bmp': case 'ico': case 'avif':
      return { Icon: FileImage, color: 'text-pink-400', label: '图片' };
    case 'mp4': case 'webm': case 'mov': case 'mkv': case 'avi':
      return { Icon: FileVideo, color: 'text-purple-400', label: '视频' };
    case 'mp3': case 'wav': case 'flac': case 'aac': case 'ogg':
      return { Icon: FileAudio, color: 'text-green-400', label: '音频' };
    case 'jar': case 'war':
      return { Icon: FileBadge, color: 'text-orange-400', label: 'Java 构建产物' };
    case 'map': case 'js': case 'mjs': case 'wasm':
      return { Icon: FileCode, color: 'text-yellow-300', label: '脚本产物' };
    default:
      break;
  }

  // 文件名线索兜底（例如 source code / checksums.txt）
  if (lower.includes('checksum') || lower.includes('sha256')) {
    return { Icon: Hash, color: 'text-teal-400', label: '校验文件' };
  }
  if (lower.includes('source') || lower.includes('src')) {
    return { Icon: FileArchive, color: 'text-yellow-500', label: '源码包' };
  }

  return { Icon: File, color: 'text-muted-foreground', label: '文件' };
}
