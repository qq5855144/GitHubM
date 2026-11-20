// 产物类型图标集（Material 风格实心图形）
//
// 为什么不直接用 lucide：lucide 是统一的线性描边风格，一个 `Package` 图标
// 会被 AAB / AAR / 压缩包 / 镜像文件同时复用，用户扫一眼根本分不出这是安卓上架包
// 还是 zip。这里改成"每个产物类型一个独有形体的实心图标"——
// 安卓用机器人、iOS 用苹果、Windows 用四格窗、macOS 用 Finder 式双色圆、
// Linux 用企鹅、压缩包用带拉链的盒子……靠轮廓就能认出类型。
//
// 所有图标统一 viewBox 0 0 24 24、fill=currentColor、尺寸由 className 控制，
// 因此可以直接替换原来 lucide 图标的位置，不需要改调用方。
import type { ReactNode, SVGProps } from 'react';

/**
 * 产物图标统一签名：接受 SVG 属性（className / title 等），由调用方控制尺寸与颜色。
 * 单独导出这个类型，是为了让 assetIcon.ts 的规则表能用它约束图标字段，
 * 而不是继续依赖 lucide 的 `LucideIcon`。
 */
export type AssetIconComponent = (props: SVGProps<SVGSVGElement>) => ReactNode;

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      width="16"
      height="16"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Android 机器人（APK 安装包）—— 用户指定的那个形体 */
export function AndroidIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M1 18q.25-2.625 1.6-4.775t3.475-3.5L4.15 6.5q-.225-.35-.112-.75t.462-.6q.35-.225.75-.125t.6.45l2 3.325q.95-.4 1.988-.6T12 8t2.163.2t1.987.6l2-3.325q.2-.35.6-.45t.75.125q.35.2.45.6t-.1.75l-1.925 3.225q2.125 1.35 3.475 3.5T23 18zm17.013-3.787q.037-.438-.238-.863t-.675-.55t-.725.1t-.375.65t.225.85t.688.563t.737-.088t.363-.663M7.1 14.95q.4-.125.675-.55t.238-.862t-.363-.663t-.737-.088t-.688.563T6 14.2t.375.65t.725.1" />
    </Svg>
  );
}

/** Android App Bundle：机器人 + 外框，表达"被打包进商店的上架包" */
export function AndroidBundleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m0 2v16h16V4z" />
      <path d="M6 15q.187-1.969 1.2-3.581T9.806 8.794L8.363 6.394q-.169-.263-.084-.563t.347-.45q.263-.169.563-.094t.45.338l1.5 2.494q.713-.3 1.491-.45T14.25 7.57t1.62.15t1.49.45l1.5-2.494q.15-.263.45-.338t.563.094q.263.15.338.45t-.076.563l-1.444 2.4q1.594 1.012 2.606 2.625T18.75 15z" />
    </Svg>
  );
}

/** Android Library（AAR）：机器人 + 库叠层 */
export function AndroidLibraryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2 2 7l10 5 10-5-10-5m0 7.5L2 14.5 12 19.5l10-5-10-5m0 4L2 18.5 12 23.5l10-5-10-5" opacity=".95" />
    </Svg>
  );
}

/** iOS 安装包：苹果剪影 */
export function AppleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M17.05 12.536c-.026-2.554 2.086-3.78 2.181-3.84-1.189-1.738-3.04-1.977-3.694-2.003-1.573-.16-3.07.926-3.868.926-.797 0-2.027-.903-3.334-.879-1.715.026-3.297.997-4.179 2.532-1.782 3.09-.456 7.671 1.28 10.184.85 1.227 1.858 2.607 3.183 2.558 1.277-.05 1.76-.826 3.303-.826 1.544 0 1.976.826 3.328.8 1.375-.025 2.245-1.25 3.086-2.484.97-1.42 1.37-2.795 1.393-2.866-.03-.014-2.674-1.026-2.7-4.07zM14.63 4.99c.7-.85 1.174-2.03 1.045-3.207-1.01.041-2.234.673-2.958 1.52-.647.75-1.213 1.95-1.06 3.1 1.127.088 2.273-.573 2.973-1.413z" />
    </Svg>
  );
}

/** Windows 安装包：四格窗 */
export function WindowsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 5.5 10.5 4.4v7.1H3zM11.7 4.2 21 3v8.5h-9.3zM3 12.8h7.5v7.1L3 18.8zM11.7 12.8H21V21l-9.3-1.3z" />
    </Svg>
  );
}

/** macOS 安装包：Finder 式双色圆（用不透明度分左右脸） */
export function MacOSIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 1.8a8.2 8.2 0 1 1 0 16.4 8.2 8.2 0 0 1 0-16.4" />
      <path d="M12 3.8v16.4a8.2 8.2 0 0 0 0-16.4" opacity=".45" />
      <path d="M8.15 10.4c.32 0 .58.26.58.58s-.26.57-.58.57-.57-.25-.57-.57.25-.58.57-.58m7.7 0c.32 0 .57.26.57.58s-.25.57-.57.57-.58-.25-.58-.57.26-.58.58-.58M7.6 14.7c.45.9 1.6 2.1 4.4 2.1s3.95-1.2 4.4-2.1c.15-.3.5-.42.78-.27.28.15.38.5.23.79-.6 1.2-2.1 2.98-5.41 2.98s-4.8-1.78-5.4-2.98a.58.58 0 0 1 .22-.79c.28-.15.63-.03.78.27" />
    </Svg>
  );
}

/** Linux 安装包：企鹅剪影 */
export function LinuxIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2c-2.2 0-3.6 1.7-3.6 3.9 0 1.2.2 2 .2 2.8 0 .7-.4 1.4-1.1 2.5-1.1 1.7-2.2 3.5-2.2 5.3 0 .9.3 1.6.9 2 .2-.7.5-1.3.9-1.9-.2.5-.3 1-.3 1.6 0 1.9 1.9 3.1 5.2 3.1s5.2-1.2 5.2-3.1c0-.6-.1-1.1-.3-1.6.4.6.7 1.2.9 1.9.6-.4.9-1.1.9-2 0-1.8-1.1-3.6-2.2-5.3-.7-1.1-1.1-1.8-1.1-2.5 0-.8.2-1.6.2-2.8C15.6 3.7 14.2 2 12 2M10.4 5.3c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9m3.2 0c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9M12 7.3c.6 0 1.3.5 1.3 1s-.7.8-1.3.8-1.3-.3-1.3-.8.7-1 1.3-1" />
    </Svg>
  );
}

/** AppImage：单文件便携包 —— 光盘/便携盒形体 */
export function AppImageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16m0 3.5A4.5 4.5 0 1 0 12 16.5 4.5 4.5 0 0 0 12 7.5m0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5" />
    </Svg>
  );
}

/** 压缩包：带拉链的盒子 */
export function ArchiveBoxIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4h16a1 1 0 0 1 1 1v3H3V5a1 1 0 0 1 1-1m0 5.5h7.2v1.8h1.6V9.5H20V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm7.2 3.6v1.6h1.6v-1.6zm0 3v1.6h1.6v-1.6z" />
    </Svg>
  );
}

/** 校验文件：盾牌 + 勾（SHA / MD5） */
export function ChecksumIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2 3 5.5v6c0 5 3.8 9.1 9 10.5 5.2-1.4 9-5.5 9-10.5v-6zm-1.2 13.3-3.4-3.4 1.3-1.3 2.1 2.1 4.9-4.9 1.3 1.3z" />
    </Svg>
  );
}

/** 签名文件：钥匙 + 印章感 */
export function SignatureIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.5 2a5.5 5.5 0 0 0-5.4 6.6L2 15.7V22h6.3l1.4-1.4V19h1.6l1.4-1.4v-1.6h1.6l1-1A5.5 5.5 0 1 0 14.5 2m1.3 3.4a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6" />
    </Svg>
  );
}

/** 镜像文件：光盘 */
export function DiscImageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 2.2a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6m0 3.3a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9m0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5" />
    </Svg>
  );
}

/** 网页构建产物：浏览器窗口 */
export function WebDistIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1m1 3v11h16V7zm1.5-2.2a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8m2.6 0a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8" />
    </Svg>
  );
}

/** Java 构建产物（jar / war）：咖啡杯 */
export function CoffeeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5h13v2h1.5a3.5 3.5 0 0 1 0 7H17v1a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zm13 4v3h1.5a1.5 1.5 0 0 0 0-3zM2 20h17v2H2z" />
    </Svg>
  );
}

/** JSON：大括号数据块 */
export function JsonDataIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.4 2c-1.7 0-2.9.5-3.5 1.4-.5.7-.6 1.6-.6 2.5v1.3c0 1.1-.2 1.7-.6 2.2-.4.4-1 .7-1.7.8v1.6c.7.1 1.3.4 1.7.8.4.5.6 1.1.6 2.2V16c0 .9.1 1.8.6 2.5.6.9 1.8 1.4 3.5 1.4v-2c-.8 0-1.2-.2-1.4-.5-.2-.3-.3-.8-.3-1.5v-1.5c0-1.3-.3-2.2-1-2.8.7-.6 1-1.5 1-2.8V7.4c0-.7.1-1.2.3-1.5.2-.3.6-.5 1.4-.5zm5.2 0v2c.8 0 1.2.2 1.4.5.2.3.3.8.3 1.5v1.3c0 1.3.3 2.2 1 2.8-.7.6-1 1.5-1 2.8V14c0 .7-.1 1.2-.3 1.5-.2.3-.6.5-1.4.5v2c1.7 0 2.9-.5 3.5-1.4.5-.7.6-1.6.6-2.5v-1.4c0-1.1.2-1.7.6-2.2.4-.4 1-.7 1.7-.8V8.2c-.7-.1-1.3-.4-1.7-.8-.4-.5-.6-1.1-.6-2.2V3.9c0-.9-.1-1.8-.6-2.5C18.5 2.5 17.3 2 15.6 2z" />
    </Svg>
  );
}

/** 文档：纸张 + 折角 */
export function DocumentIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 2.5L18.5 10H13zM7 13h10v2H7zm0 3.5h10v2H7z" />
    </Svg>
  );
}

/** 图片：照片框 + 山与太阳 */
export function PictureIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1m1 2v9.5l3-3 2.5 2.5L15 10l4 4V6zm2.8.8a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4" />
    </Svg>
  );
}

/** 视频：胶片/播放器 */
export function FilmIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1m1 2v2h2V6zm4 0v2h2V6zm4 0v2h2V6zm4 0v2h2V6zM4 10v4h16v-4zm2 6.5V18h2v-1.5zm4 0V18h2v-1.5zm4 0V18h2v-1.5z" />
    </Svg>
  );
}

/** 音频：音符 */
export function AudioNoteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z" />
    </Svg>
  );
}

/** 脚本产物：终端提示符 >_ */
export function ScriptIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1m2.6 4.1L4.2 9.5l3 3-3 3 1.4 1.4 4.4-4.4zm5.4 7.4h6v-2h-6z" />
    </Svg>
  );
}

/** 通用文件：折角纸张 */
export function GenericFileIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 2.5L18.5 10H13z" />
    </Svg>
  );
}

/** 源码包：纸箱（开源分发型） */
export function SourceBoxIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2 5h20v4H2zm1 5h18v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm6 2v2h6v-2z" />
    </Svg>
  );
}
