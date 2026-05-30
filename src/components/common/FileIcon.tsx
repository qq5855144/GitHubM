// 文件类型图标工具 - 根据扩展名返回对应 Lucide 图标和颜色

import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileImage,
  FileJson,
  FileArchive,
  FileBadge,
  File,
  FileVideo,
  FileAudio,
  Database,
  Settings,
  Terminal,
  Globe,
  BookOpen,
  Package,
  Shield,
  Cpu,
  Coffee,
  Hash,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface FileIconInfo {
  Icon: LucideIcon;
  color: string;
}

// 图片文件扩展名集合
export const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
  'tiff', 'tif', 'avif', 'heic', 'heif',
]);

// 视频文件扩展名
export const VIDEO_EXTENSIONS = new Set([
  'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv',
]);

export function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

export function isVideoFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.has(ext);
}

export function getFileIconInfo(filename: string, isDir = false, isOpen = false): FileIconInfo {
  if (isDir) {
    return { Icon: isOpen ? FolderOpen : Folder, color: 'text-yellow-400' };
  }

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const name = filename.toLowerCase();

  // 特殊文件名
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return { Icon: Package, color: 'text-blue-400' };
  if (name === 'makefile' || name === 'gnumakefile') return { Icon: Settings, color: 'text-muted-foreground' };
  if (name === '.gitignore' || name === '.gitattributes') return { Icon: Shield, color: 'text-orange-400' };
  if (name === '.env' || name.startsWith('.env.')) return { Icon: Settings, color: 'text-yellow-500' };
  if (name === 'license' || name === 'licence' || name.startsWith('license.') || name.startsWith('licence.')) return { Icon: FileBadge, color: 'text-green-400' };
  if (name === 'readme' || name.startsWith('readme.')) return { Icon: BookOpen, color: 'text-blue-300' };

  // 按扩展名分类
  switch (ext) {
    // JavaScript / TypeScript
    case 'js': case 'mjs': case 'cjs': case 'jsx':
      return { Icon: FileCode, color: 'text-yellow-300' };
    case 'ts': case 'tsx':
      return { Icon: FileCode, color: 'text-blue-400' };

    // Web
    case 'html': case 'htm': case 'xhtml':
      return { Icon: Globe, color: 'text-orange-400' };
    case 'css': case 'scss': case 'sass': case 'less':
      return { Icon: FileCode, color: 'text-pink-400' };
    case 'vue':
      return { Icon: FileCode, color: 'text-green-400' };
    case 'svelte':
      return { Icon: FileCode, color: 'text-orange-500' };

    // Backend languages
    case 'py': case 'pyw': case 'pyi':
      return { Icon: FileCode, color: 'text-blue-300' };
    case 'java': case 'class': case 'jar':
      return { Icon: Coffee, color: 'text-orange-400' };
    case 'kt': case 'kts':
      return { Icon: FileCode, color: 'text-purple-400' };
    case 'go':
      return { Icon: FileCode, color: 'text-cyan-400' };
    case 'rs':
      return { Icon: Cpu, color: 'text-orange-500' };
    case 'c': case 'h':
      return { Icon: FileCode, color: 'text-blue-500' };
    case 'cpp': case 'cc': case 'cxx': case 'hpp': case 'hxx':
      return { Icon: FileCode, color: 'text-blue-400' };
    case 'cs':
      return { Icon: FileCode, color: 'text-purple-500' };
    case 'php':
      return { Icon: FileCode, color: 'text-indigo-400' };
    case 'rb': case 'erb':
      return { Icon: FileCode, color: 'text-red-400' };
    case 'swift':
      return { Icon: FileCode, color: 'text-orange-400' };
    case 'dart':
      return { Icon: FileCode, color: 'text-blue-400' };
    case 'r':
      return { Icon: FileCode, color: 'text-blue-500' };
    case 'scala':
      return { Icon: FileCode, color: 'text-red-500' };
    case 'lua':
      return { Icon: FileCode, color: 'text-blue-300' };
    case 'ex': case 'exs':
      return { Icon: FileCode, color: 'text-purple-400' };
    case 'erl': case 'hrl':
      return { Icon: FileCode, color: 'text-red-500' };
    case 'clj': case 'cljs': case 'cljc':
      return { Icon: FileCode, color: 'text-green-500' };
    case 'hs': case 'lhs':
      return { Icon: FileCode, color: 'text-purple-400' };

    // Shell / Scripts
    case 'sh': case 'bash': case 'zsh': case 'fish': case 'ps1': case 'bat': case 'cmd':
      return { Icon: Terminal, color: 'text-green-400' };

    // Data / Config
    case 'json': case 'jsonc':
      return { Icon: FileJson, color: 'text-yellow-400' };
    case 'yaml': case 'yml':
      return { Icon: Settings, color: 'text-red-300' };
    case 'toml':
      return { Icon: Settings, color: 'text-orange-300' };
    case 'xml': case 'plist':
      return { Icon: FileCode, color: 'text-orange-300' };
    case 'env':
      return { Icon: Settings, color: 'text-yellow-400' };
    case 'ini': case 'cfg': case 'conf': case 'config':
      return { Icon: Settings, color: 'text-muted-foreground' };
    case 'sql':
      return { Icon: Database, color: 'text-blue-400' };
    case 'graphql': case 'gql':
      return { Icon: FileCode, color: 'text-pink-500' };

    // Docs
    case 'md': case 'mdx': case 'markdown':
      return { Icon: FileText, color: 'text-blue-300' };
    case 'txt':
      return { Icon: FileText, color: 'text-muted-foreground' };
    case 'pdf':
      return { Icon: FileText, color: 'text-red-400' };
    case 'doc': case 'docx':
      return { Icon: FileText, color: 'text-blue-500' };
    case 'xls': case 'xlsx': case 'csv':
      return { Icon: FileText, color: 'text-green-500' };
    case 'ppt': case 'pptx':
      return { Icon: FileText, color: 'text-orange-400' };

    // Images
    case 'jpg': case 'jpeg': case 'png': case 'gif':
    case 'webp': case 'svg': case 'bmp': case 'ico':
    case 'tiff': case 'tif': case 'avif':
      return { Icon: FileImage, color: 'text-pink-400' };

    // Video
    case 'mp4': case 'webm': case 'ogg': case 'mov': case 'avi': case 'mkv':
      return { Icon: FileVideo, color: 'text-purple-400' };

    // Audio
    case 'mp3': case 'wav': case 'flac': case 'aac': case 'ogg':
      return { Icon: FileAudio, color: 'text-green-400' };

    // Archives
    case 'zip': case 'tar': case 'gz': case 'bz2':
    case 'xz': case '7z': case 'rar': case 'tgz':
      return { Icon: FileArchive, color: 'text-yellow-500' };

    // Lock files
    case 'lock':
      return { Icon: Shield, color: 'text-muted-foreground' };

    // Hash / checksum
    case 'sum': case 'sha256': case 'md5':
      return { Icon: Hash, color: 'text-muted-foreground' };

    default:
      return { Icon: File, color: 'text-muted-foreground' };
  }
}
