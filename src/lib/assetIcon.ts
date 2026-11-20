// Release / Artifacts 产物图标：按产物类型（而不是单纯扩展名）给更形象的图标与配色。
// 与 common/FileIcon 的区别：这里面向“分发包”语义，例如 .apk 是安卓安装包、
// .dmg/.exe/.msi 是桌面安装包、.aab 是上架包、.sha256 是校验文件。
//
// 注意：GitHub Actions 的 artifact 名通常不带后缀（例如 `github-manager-test-apk`），
// 因此除扩展名外还要做文件名语义识别，否则一整列都是通用文件图标。
import type { AssetIconComponent } from '@/components/common/AssetIcons';
import {
  AndroidBundleIcon,
  AndroidIcon,
  AndroidLibraryIcon,
  AppImageIcon,
  AppleIcon,
  ArchiveBoxIcon,
  AudioNoteIcon,
  ChecksumIcon,
  CoffeeIcon,
  DiscImageIcon,
  DocumentIcon,
  FilmIcon,
  GenericFileIcon,
  JsonDataIcon,
  LinuxIcon,
  MacOSIcon,
  PictureIcon,
  ScriptIcon,
  SignatureIcon,
  SourceBoxIcon,
  WebDistIcon,
  WindowsIcon,
} from '@/components/common/AssetIcons';

export interface AssetIconInfo {
  Icon: AssetIconComponent;
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

type Rule = { Icon: AssetIconComponent; color: string; label: string };

const APK: Rule = { Icon: AndroidIcon, color: 'text-emerald-400', label: 'Android 安装包' };
const AAB: Rule = { Icon: AndroidBundleIcon, color: 'text-emerald-500', label: 'Android App Bundle' };
const AAR: Rule = { Icon: AndroidLibraryIcon, color: 'text-emerald-600', label: 'Android Library' };
const IPA: Rule = { Icon: AppleIcon, color: 'text-zinc-300', label: 'iOS 安装包' };
const WIN: Rule = { Icon: WindowsIcon, color: 'text-sky-400', label: 'Windows 安装包' };
const MAC: Rule = { Icon: MacOSIcon, color: 'text-zinc-300', label: 'macOS 安装包' };
const LINUX: Rule = { Icon: LinuxIcon, color: 'text-orange-400', label: 'Linux 安装包' };
const APPIMAGE: Rule = { Icon: AppImageIcon, color: 'text-orange-300', label: 'AppImage' };
const ARCHIVE: Rule = { Icon: ArchiveBoxIcon, color: 'text-yellow-500', label: '压缩包' };
const CHECKSUM: Rule = { Icon: ChecksumIcon, color: 'text-teal-400', label: '校验文件' };
const SIGNED: Rule = { Icon: SignatureIcon, color: 'text-teal-300', label: '签名文件' };
const IMAGE: Rule = { Icon: DiscImageIcon, color: 'text-indigo-400', label: '镜像文件' };
const JSONFILE: Rule = { Icon: JsonDataIcon, color: 'text-yellow-400', label: 'JSON 数据' };
const DOC: Rule = { Icon: DocumentIcon, color: 'text-blue-300', label: '文档' };
const IMGFILE: Rule = { Icon: PictureIcon, color: 'text-pink-400', label: '图片' };
const VIDEO: Rule = { Icon: FilmIcon, color: 'text-purple-400', label: '视频' };
const AUDIO: Rule = { Icon: AudioNoteIcon, color: 'text-green-400', label: '音频' };
const JAVA: Rule = { Icon: CoffeeIcon, color: 'text-orange-400', label: 'Java 构建产物' };
const SCRIPT: Rule = { Icon: ScriptIcon, color: 'text-yellow-300', label: '脚本产物' };
const WEBDIST: Rule = { Icon: WebDistIcon, color: 'text-cyan-400', label: '网页构建产物' };
const SOURCE: Rule = { Icon: SourceBoxIcon, color: 'text-amber-400', label: '源码包' };
const UNKNOWN: Rule = { Icon: GenericFileIcon, color: 'text-muted-foreground', label: '文件' };

/** 扩展名 -> 产物类型 */
const BY_EXT: Record<string, Rule> = {
  apk: APK,
  aab: AAB,
  aar: AAR,
  ipa: IPA,
  exe: WIN, msi: WIN, msix: WIN,
  dmg: MAC, pkg: MAC,
  deb: LINUX, rpm: LINUX, snap: LINUX, flatpak: LINUX,
  appimage: APPIMAGE,
  zip: ARCHIVE, '7z': ARCHIVE, rar: ARCHIVE, tar: ARCHIVE,
  'tar.gz': ARCHIVE, 'tar.bz2': ARCHIVE, 'tar.xz': ARCHIVE, 'tar.zst': ARCHIVE, 'tar.lz4': ARCHIVE,
  tgz: ARCHIVE, gz: ARCHIVE, bz2: ARCHIVE, xz: ARCHIVE, zst: ARCHIVE, lz4: ARCHIVE,
  sha256: CHECKSUM, sha1: CHECKSUM, sha512: CHECKSUM, md5: CHECKSUM, sum: CHECKSUM,
  sig: SIGNED, asc: SIGNED, pem: SIGNED, crt: SIGNED, cer: SIGNED,
  iso: IMAGE, img: IMAGE, qcow2: IMAGE, vhd: IMAGE, vhdx: IMAGE,
  json: JSONFILE, jsonc: JSONFILE,
  md: DOC, mdx: DOC, txt: DOC, pdf: DOC, csv: DOC, log: DOC,
  doc: DOC, docx: DOC, xls: DOC, xlsx: DOC, ppt: DOC, pptx: DOC,
  png: IMGFILE, jpg: IMGFILE, jpeg: IMGFILE, gif: IMGFILE, webp: IMGFILE,
  svg: IMGFILE, bmp: IMGFILE, ico: IMGFILE, avif: IMGFILE,
  mp4: VIDEO, webm: VIDEO, mov: VIDEO, mkv: VIDEO, avi: VIDEO,
  mp3: AUDIO, wav: AUDIO, flac: AUDIO, aac: AUDIO, ogg: AUDIO,
  jar: JAVA, war: JAVA,
  map: SCRIPT, js: SCRIPT, mjs: SCRIPT, wasm: SCRIPT,
};

/**
 * 无后缀产物名 -> 类型（GitHub Actions artifact 常态，例如 `github-manager-test-apk`）。
 * 顺序敏感：靠前的规则优先，避免 `test-apk` 被更宽泛的规则抢走。
 */
const BY_NAME: { test: RegExp; rule: Rule }[] = [
  // 顺序：bundle/aab 先于 apk，避免 `android-bundle` 被当成 apk
  { test: /(^|[-_.])(aab|app-?bundle|bundle)([-_.]|$)/, rule: AAB },
  { test: /(^|[-_.])(apk|android|android\d*)([-_.]|$)/, rule: APK },
  { test: /(^|[-_.])(ipa|ios)([-_.]|$)/, rule: IPA },
  { test: /(^|[-_.])(windows?|win(32|64)?|msi|exe)([-_.]|$)/, rule: WIN },
  { test: /(^|[-_.])(macos?|darwin|osx|dmg)([-_.]|$)/, rule: MAC },
  { test: /(^|[-_.])(linux|deb|rpm|appimage)([-_.]|$)/, rule: LINUX },
  { test: /(^|[-_.])(web-?dist|dist|build-?output|webapp|frontend|website|site|pages)([-_.]|$)/, rule: WEBDIST },
  { test: /(^|[-_.])(checksums?|sha\d*(sums?)?|md5|hashes)([-_.]|$)/, rule: CHECKSUM },
  { test: /(^|[-_.])(sig|signature|asc|gpg)([-_.]|$)/, rule: SIGNED },
  { test: /(^|[-_.])(source|src|sources)([-_.]|$)/, rule: SOURCE },
  { test: /(^|[-_.])(coverage|report|junit|test-results|logs?|artifacts)([-_.]|$)/, rule: DOC },
];

/**
 * 根据文件名推断产物类型图标。
 * 判定顺序：组合扩展名 -> 纯扩展名 -> 无后缀语义 -> 兜底。
 */
export function getAssetIcon(name: string): AssetIconInfo {
  const normalized = (name ?? '').trim();
  if (!normalized) return UNKNOWN;

  const ext = compoundExt(normalized);
  if (ext && BY_EXT[ext]) return BY_EXT[ext];

  const lower = normalized.toLowerCase();
  for (const { test, rule } of BY_NAME) {
    if (test.test(lower)) return rule;
  }

  return UNKNOWN;
}
